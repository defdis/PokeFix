/**
 * Embedded agent terminal ("agent dock"): spawns the selected agent CLI on a
 * pty (node-pty) and pipes it to the renderer's xterm. One session at a time
 * by design — the dock is a quick way to drive an agent, not a tmux.
 *
 * Only whitelisted agents and argument vectors are spawned — the renderer
 * cannot supply arbitrary commands.
 */
import {ipcMain, type WebContents} from 'electron';
import os from 'os';
import fs from 'fs';
import {IPC_MAIN_CHANNELS} from '../common/constants';
import {resolveExecutable} from './agent-runner';
import log from './logging';

// Loaded lazily: the native module may be unavailable in some dev setups,
// and we want a structured error instead of a main-process crash.

const nodePty: typeof import('node-pty') | null = (() => {
  try {
    return require('node-pty');
  } catch (error) {
    log.error('[agent-terminal] node-pty failed to load:', error);
    return null;
  }
})();

export interface AgentTerminalSpec {
  id: string;
  name: string;
  binary: string;
  args: string[];
}

/** Fixed whitelist. Args are curated — never taken from the renderer. */
export const TERMINAL_AGENTS: readonly AgentTerminalSpec[] = [
  {id: 'hermes', name: 'Hermes', binary: 'hermes', args: []},
  {id: 'claude-code', name: 'Claude Code', binary: 'claude', args: []},
  {id: 'codex', name: 'Codex', binary: 'codex', args: []},
  {id: 'gemini-cli', name: 'Gemini CLI', binary: 'gemini', args: []},
  {id: 'opencode', name: 'OpenCode', binary: 'opencode', args: []},
] as const;

export interface AgentAvailability {
  id: string;
  name: string;
  available: boolean;
}

/** Exported for tests: what the renderer's picker should show. */
export const listTerminalAgents = (
  resolve: (binary: string) => string | null = resolveExecutable
): AgentAvailability[] =>
  TERMINAL_AGENTS.map(({id, name, binary}) => ({
    id,
    name,
    available: resolve(binary) !== null,
  }));

const clampDimension = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' ? Math.floor(value) : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

type PtyLike = {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: {exitCode: number}) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

let pty: PtyLike | null = null;
let owner: WebContents | null = null;

const send = (channel: string, payload: unknown): void => {
  if (owner && !owner.isDestroyed()) {
    owner.send(channel, payload);
  }
};

export const killAgentTerminal = (): void => {
  if (pty) {
    try {
      pty.kill();
    } catch {
      // already dead — fine
    }
    pty = null;
  }
};

const spawnAgent = (
  agentId: unknown,
  options: {cwd?: unknown; cols?: unknown; rows?: unknown},
  sender: WebContents
): {ok: boolean; cwd?: string; error?: string} => {
  const spec = TERMINAL_AGENTS.find((agent) => agent.id === agentId);
  if (!spec) {
    return {ok: false, error: 'Unknown agent'};
  }
  if (nodePty === null) {
    return {
      ok: false,
      error: 'node-pty failed to load — run "yarn rebuild" or reinstall the app',
    };
  }
  const binary = resolveExecutable(spec.binary);
  if (binary === null) {
    return {
      ok: false,
      error: `“${spec.binary}” не найден на PATH — агент не установлен?`,
    };
  }
  killAgentTerminal();
  const cwd =
    typeof options.cwd === 'string' &&
    options.cwd.length > 0 &&
    fs.existsSync(options.cwd) &&
    fs.statSync(options.cwd).isDirectory()
      ? options.cwd
      : os.homedir();
  const cols = clampDimension(options.cols, 80, 20, 500);
  const rows = clampDimension(options.rows, 24, 2, 200);
  try {
    pty = nodePty.spawn(binary, spec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor'},
    });
  } catch (error) {
    pty = null;
    log.error('[agent-terminal] spawn failed:', error);
    return {ok: false, error: String(error)};
  }
  owner = sender;
  pty.onData((data) => send(IPC_MAIN_CHANNELS.TERMINAL_DATA, {data}));
  pty.onExit(({exitCode}) => {
    pty = null;
    send(IPC_MAIN_CHANNELS.TERMINAL_EXIT, {exitCode});
  });
  return {ok: true, cwd};
};

export const initAgentTerminal = (): void => {
  ipcMain.handle(IPC_MAIN_CHANNELS.TERMINAL_LIST_AGENTS, () => listTerminalAgents());

  ipcMain.handle(
    IPC_MAIN_CHANNELS.TERMINAL_OPEN,
    (event, request: {agentId?: unknown; cwd?: unknown; cols?: unknown; rows?: unknown}) =>
      spawnAgent(request?.agentId, request ?? {}, event.sender)
  );

  ipcMain.handle(IPC_MAIN_CHANNELS.TERMINAL_KILL, () => {
    killAgentTerminal();
    return {ok: true};
  });

  ipcMain.handle(IPC_MAIN_CHANNELS.TERMINAL_WRITE, (_event, payload: {data?: unknown}) => {
    const data = payload?.data;
    if (pty && typeof data === 'string' && data.length > 0 && data.length <= 64 * 1024) {
      pty.write(data);
    }
    return {ok: true};
  });

  ipcMain.handle(
    IPC_MAIN_CHANNELS.TERMINAL_RESIZE,
    (_event, payload: {cols?: unknown; rows?: unknown}) => {
      if (!pty) {
        return {ok: false};
      }
      const cols = clampDimension(payload?.cols, 80, 20, 500);
      const rows = clampDimension(payload?.rows, 24, 2, 200);
      try {
        pty.resize(cols, rows);
        return {ok: true};
      } catch {
        return {ok: false};
      }
    }
  );
};
