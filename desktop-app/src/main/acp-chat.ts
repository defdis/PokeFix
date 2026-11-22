/**
 * ACP (Agent Client Protocol) chat backend. Spawns the selected agent CLI in
 * ACP mode over stdio and pipes a minimal JSON-RPC 2.0 conversation to the
 * renderer's chat panel. One session at a time — the chat is a companion to
 * the previews, not a full IDE agent host.
 *
 * Wire protocol: newline-delimited JSON-RPC 2.0 (what `hermes acp` and
 * `opencode acp` speak). We deliberately depend on no SDK; everything we need
 * lives in ../common/acp.
 */
import {ipcMain, type WebContents} from 'electron';
import {spawn, type ChildProcessWithoutNullStreams} from 'child_process';
import os from 'os';
import fs from 'fs';
import {randomUUID} from 'crypto';
import {IPC_MAIN_CHANNELS} from '../common/constants';
import {resolveExecutable} from './resolve-executable';
import {
  parseAcpLine,
  mapSessionUpdate,
  parsePermissionRequest,
  permissionResponse,
} from '../common/acp';
import log from './logging';

export interface ChatAgentSpec {
  id: string;
  name: string;
  binary: string;
  args: string[];
}

export const CHAT_AGENTS: readonly ChatAgentSpec[] = [
  {id: 'hermes', name: 'Hermes', binary: 'hermes', args: ['acp']},
  {id: 'opencode', name: 'OpenCode', binary: 'opencode', args: ['acp']},
] as const;

export const listChatAgents = (
  resolve: (binary: string) => string | null = resolveExecutable
): Array<{id: string; name: string; available: boolean}> =>
  CHAT_AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    available: resolve(agent.binary) !== null,
  }));

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

interface SessionState {
  child: ChildProcessWithoutNullStreams;
  agentId: string;
  cwd: string;
  sessionId: string;
  /** Random per-spawn token; permission replies must echo it so a stale card from a previous session can't answer a fresh prompt. */
  nonce: string;
  owner: WebContents;
  buffer: string;
  pending: Map<number, PendingRequest>;
  pendingPermissions: Map<number, {optionIds: Set<string>; timer: NodeJS.Timeout | null}>;
  nextId: number;
  /** Id of the in-flight session/prompt, if any — used by cancel and the UI. */
  activePromptId: number | null;
  /** True once this turn produced at least one content update (chunk/tool/plan). */
  turnChunkSeen: boolean;
  /** Hard watchdog: if the agent goes silent mid-turn, free the turn anyway. */
  turnWatchdog: NodeJS.Timeout | null;
}

let current: SessionState | null = null;

const sendTo = (state: SessionState | null, channel: string, payload: unknown): void => {
  if (state && !state.owner.isDestroyed()) {
    state.owner.send(channel, payload);
  }
};

const writeLine = (state: SessionState, message: object): void => {
  try {
    if (state.child.stdin.destroyed) {
      return;
    }
    state.child.stdin.write(`${JSON.stringify(message)}\n`);
  } catch (error) {
    log.warn('[acp] stdin write failed', error);
  }
};

const call = (
  state: SessionState,
  method: string,
  params: unknown,
  timeoutMs?: number
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const id = state.nextId;
    state.nextId += 1;
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            if (state.pending.delete(id)) {
              reject(new Error(`${method} timed out after ${timeoutMs}ms`));
            }
          }, timeoutMs);
    state.pending.set(id, {
      resolve: (value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      },
      reject: (error: Error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      },
      method,
    });
    writeLine(state, {jsonrpc: '2.0', id, method, params});
  });

const notify = (state: SessionState, method: string, params?: unknown): void => {
  writeLine(state, {jsonrpc: '2.0', method, params});
};

const TURN_TIMEOUT_MS = 4 * 60 * 1000;
const PERMISSION_TIMEOUT_MS = 2 * 60 * 1000;
/** Drop lines/buffers beyond this — a runaway agent must not eat main-process memory. */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/**
 * Mark the in-flight turn finished: stop the watchdog, free the prompt slot and
 * notify the renderer. Idempotent — hermes never sends the session/prompt
 * response, so BOTH the (possibly absent) response and the trailing usage_update
 * funnel here; whichever comes first wins.
 */
const completeTurn = (state: SessionState, stopReason: string): void => {
  if (state.turnWatchdog) {
    clearTimeout(state.turnWatchdog);
    state.turnWatchdog = null;
  }
  if (state.activePromptId === null) return; // already completed
  const promptId = state.activePromptId;
  state.activePromptId = null;
  state.pending.delete(promptId);
  sendTo(state, IPC_MAIN_CHANNELS.AGENT_CHAT_EVENT, {type: 'turn-complete', stopReason});
};

const clearPermission = (
  state: SessionState,
  requestId: number
): {optionIds: Set<string>} | undefined => {
  const pending = state.pendingPermissions.get(requestId);
  if (!pending) return undefined;
  if (pending.timer) clearTimeout(pending.timer);
  state.pendingPermissions.delete(requestId);
  return pending;
};

const clearAllPermissions = (state: SessionState): void => {
  for (const pending of state.pendingPermissions.values()) {
    if (pending.timer) clearTimeout(pending.timer);
  }
  state.pendingPermissions.clear();
};

const armTurnWatchdog = (state: SessionState): void => {
  if (state.turnWatchdog) clearTimeout(state.turnWatchdog);
  state.turnWatchdog = setTimeout(() => {
    if (state.activePromptId !== null) {
      completeTurn(state, 'timeout');
      sendTo(state, IPC_MAIN_CHANNELS.AGENT_CHAT_EVENT, {
        type: 'error',
        message: 'Агент молчит больше четырёх минут — ход закрыт по таймауту.',
      });
    }
  }, TURN_TIMEOUT_MS);
};

const handleLine = (state: SessionState, raw: string): void => {
  try {
    handleLineUnsafe(state, raw);
  } catch (error) {
    log.error('[acp] dropped malformed agent message', error);
  }
};

const handleLineUnsafe = (state: SessionState, raw: string): void => {
  if (raw.length > MAX_BUFFER_BYTES) {
    log.warn(`[acp] dropping oversized line (${raw.length} bytes)`);
    return;
  }
  const msg = parseAcpLine(raw);
  if (!msg) return;

  // Response to a request we sent.
  if ('id' in msg && ('result' in msg || 'error' in msg) && !('method' in msg)) {
    const pending = state.pending.get(Number(msg.id));
    if (!pending) return;
    state.pending.delete(Number(msg.id));
    const err = (msg as {error?: {message?: string}}).error;
    if (err) {
      pending.reject(new Error(err.message ?? `ACP error from ${pending.method}`));
    } else {
      pending.resolve((msg as {result?: unknown}).result);
    }
    return;
  }

  // Agent → client request (permission prompts are the only ones we support).
  if ('method' in msg && 'id' in msg && typeof msg.method === 'string') {
    const requestId = Number(msg.id);
    if (msg.method === 'session/request_permission') {
      const parsed = parsePermissionRequest(msg.params);
      if (parsed) {
        armTurnWatchdog(state);
        const timer = setTimeout(() => {
          const pending = state.pendingPermissions.get(requestId);
          if (!pending) return;
          state.pendingPermissions.delete(requestId);
          writeLine(state, {
            jsonrpc: '2.0',
            id: requestId,
            result: permissionResponse(null),
          });
          sendTo(state, IPC_MAIN_CHANNELS.AGENT_CHAT_PERMISSION, {
            requestId,
            nonce: state.nonce,
            expired: true,
          });
        }, PERMISSION_TIMEOUT_MS);
        state.pendingPermissions.set(requestId, {
          optionIds: new Set(parsed.options.map((o) => o.optionId)),
          timer,
        });
        sendTo(state, IPC_MAIN_CHANNELS.AGENT_CHAT_PERMISSION, {
          requestId,
          nonce: state.nonce,
          ...parsed,
        });
        return;
      }
    }
    // Unknown agent→client request: fail it cleanly so the agent never hangs.
    writeLine(state, {
      jsonrpc: '2.0',
      id: msg.id,
      error: {code: -32601, message: `Client does not support ${msg.method}`},
    });
    return;
  }

  // Notification.
  if ('method' in msg && msg.method === 'session/update') {
    const params = (msg.params ?? {}) as {update?: unknown};
    const event = mapSessionUpdate(params.update);
    if (!event) return;
    if (
      event.type === 'agent-message' ||
      event.type === 'agent-thought' ||
      event.type === 'tool-call' ||
      event.type === 'tool-update' ||
      event.type === 'plan'
    ) {
      state.turnChunkSeen = true;
      // Long-running tools/streams: keep the watchdog alive while the agent breathes.
      if (state.activePromptId !== null) armTurnWatchdog(state);
    }
    // Hermes never answers session/prompt — the turn is done when the
    // trailing usage_update lands AFTER actual content was produced.
    if (event.type === 'usage' && state.activePromptId !== null && state.turnChunkSeen) {
      sendTo(state, IPC_MAIN_CHANNELS.AGENT_CHAT_EVENT, event);
      completeTurn(state, 'end_turn');
      return;
    }
    sendTo(state, IPC_MAIN_CHANNELS.AGENT_CHAT_EVENT, event);
  }
};

export const killAgentChat = (): void => {
  const state = current;
  current = null;
  if (!state) return;
  if (state.turnWatchdog) clearTimeout(state.turnWatchdog);
  for (const pending of state.pending.values()) {
    pending.reject(new Error('Chat session closed'));
  }
  state.pending.clear();
  clearAllPermissions(state);
  try {
    state.child.kill();
  } catch {
    // already dead
  }
};

const spawnSession = async (
  agentId: unknown,
  cwdRaw: unknown,
  sender: WebContents
): Promise<{ok: boolean; cwd?: string; agentId?: string; error?: string}> => {
  const spec = CHAT_AGENTS.find((agent) => agent.id === agentId);
  if (!spec) {
    return {ok: false, error: 'Unknown agent'};
  }
  const binary = resolveExecutable(spec.binary);
  if (!binary) {
    return {ok: false, error: `“${spec.binary}” не найден на PATH — агент не установлен?`};
  }
  const cwd =
    typeof cwdRaw === 'string' &&
    cwdRaw.length > 0 &&
    fs.existsSync(cwdRaw) &&
    fs.statSync(cwdRaw).isDirectory()
      ? cwdRaw
      : os.homedir();

  killAgentChat();

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(binary, spec.args, {
      cwd,
      env: {...process.env, TERM: 'dumb'},
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    return {ok: false, error: String(error)};
  }

  const state: SessionState = {
    child,
    agentId: spec.id,
    cwd,
    sessionId: '',
    nonce: randomUUID(),
    owner: sender,
    buffer: '',
    pending: new Map(),
    pendingPermissions: new Map(),
    nextId: 1,
    activePromptId: null,
    turnChunkSeen: false,
    turnWatchdog: null,
  };
  current = state;

  child.stdin.on('error', (error) => {
    log.warn('[acp] stdin error', error);
  });
  child.stdout.on('data', (chunk: Buffer) => {
    state.buffer += chunk.toString('utf8');
    if (state.buffer.length > MAX_BUFFER_BYTES) {
      log.warn('[acp] agent output exceeded buffer cap — dropping buffered bytes');
      state.buffer = '';
      return;
    }
    let index = state.buffer.indexOf('\n');
    while (index !== -1) {
      const line = state.buffer.slice(0, index);
      state.buffer = state.buffer.slice(index + 1);
      handleLine(state, line);
      index = state.buffer.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    log.warn('[acp]', chunk.toString().trimEnd().slice(0, 2000));
  });
  child.on('error', (error) => {
    log.error('[acp] spawn error', error);
    sendTo(state, IPC_MAIN_CHANNELS.AGENT_CHAT_EXIT, {code: -1, error: String(error)});
  });
  child.on('exit', (code) => {
    if (state.turnWatchdog) clearTimeout(state.turnWatchdog);
    for (const pending of state.pending.values()) {
      pending.reject(new Error('Agent process exited'));
    }
    state.pending.clear();
    clearAllPermissions(state);
    if (current === state) {
      current = null;
    }
    sendTo(state, IPC_MAIN_CHANNELS.AGENT_CHAT_EXIT, {code});
  });

  try {
    await call(
      state,
      'initialize',
      {
        protocolVersion: 1,
        clientCapabilities: {
          fs: {readTextFile: false, writeTextFile: false},
          terminal: false,
        },
        clientInfo: {name: 'pokefix', version: '1.0.0'},
      },
      30000
    );
    const created = (await call(state, 'session/new', {cwd, mcpServers: []}, 60000)) as {
      sessionId?: string;
    };
    state.sessionId = String(created?.sessionId ?? '');
    if (!state.sessionId) {
      throw new Error('Agent did not return a sessionId');
    }
    return {ok: true, cwd, agentId: spec.id};
  } catch (error) {
    killAgentChat();
    return {ok: false, error: error instanceof Error ? error.message : String(error)};
  }
};

export const initAgentChat = (): void => {
  ipcMain.handle(IPC_MAIN_CHANNELS.AGENT_CHAT_AGENTS, () => listChatAgents());

  ipcMain.handle(
    IPC_MAIN_CHANNELS.AGENT_CHAT_SPAWN,
    (event, request: {agentId?: unknown; cwd?: unknown}) =>
      spawnSession(request?.agentId, request?.cwd, event.sender)
  );

  ipcMain.handle(IPC_MAIN_CHANNELS.AGENT_CHAT_SEND, async (_event, payload: {text?: unknown}) => {
    const state = current;
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!state) {
      return {ok: false, error: 'No agent session — pick an agent first.'};
    }
    if (!text) {
      return {ok: false, error: 'Empty message'};
    }
    if (state.activePromptId !== null) {
      return {ok: false, error: 'Agent is still answering — wait or stop it.'};
    }
    const sentId = state.nextId;
    state.turnChunkSeen = false;
    const promptResult = call(
      state,
      'session/prompt',
      {sessionId: state.sessionId, prompt: [{type: 'text', text}]},
      undefined
    );
    state.activePromptId = sentId;
    armTurnWatchdog(state);
    promptResult
      .then((res) => {
        const stopReason =
          typeof res === 'object' && res !== null && 'stopReason' in res
            ? String((res as {stopReason?: unknown}).stopReason ?? 'end_turn')
            : 'end_turn';
        completeTurn(state, stopReason);
        return undefined;
      })
      .catch((error: Error) => {
        completeTurn(state, 'error');
        sendTo(state, IPC_MAIN_CHANNELS.AGENT_CHAT_EVENT, {
          type: 'error',
          message: error.message,
        });
      });
    return {ok: true};
  });

  ipcMain.handle(IPC_MAIN_CHANNELS.AGENT_CHAT_CANCEL, () => {
    const state = current;
    if (!state) return {ok: false};
    notify(state, 'session/cancel', {sessionId: state.sessionId});
    // Free the UI immediately — hermes will not answer session/prompt anyway.
    completeTurn(state, 'cancelled');
    return {ok: true};
  });

  ipcMain.handle(IPC_MAIN_CHANNELS.AGENT_CHAT_KILL, () => {
    killAgentChat();
    return {ok: true};
  });

  ipcMain.handle(
    IPC_MAIN_CHANNELS.AGENT_CHAT_PERMISSION,
    (_event, payload: {requestId?: unknown; optionId?: unknown; nonce?: unknown}) => {
      const requestId = Number(payload?.requestId);
      const optionId = typeof payload?.optionId === 'string' ? payload.optionId : null;
      const state = current;
      if (!state || state.nonce !== payload?.nonce) {
        return {ok: false};
      }
      const pending = clearPermission(state, requestId);
      if (!pending) {
        return {ok: false};
      }
      if (optionId !== null && !pending.optionIds.has(optionId)) {
        // Answer with a cancelled outcome instead of honouring an option the agent never offered.
        writeLine(state, {jsonrpc: '2.0', id: requestId, result: permissionResponse(null)});
        return {ok: false};
      }
      writeLine(state, {jsonrpc: '2.0', id: requestId, result: permissionResponse(optionId)});
      return {ok: true};
    }
  );
};
