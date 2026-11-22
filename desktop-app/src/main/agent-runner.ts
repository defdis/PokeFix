/**
 * Runs an external "agent" CLI (Hermes, Claude Code, Codex, …) as a child
 * process for the AnnotatorBar "send to agent" action.
 *
 * The command is a user-configured template, e.g. `hermes -z {prompt}` or
 * `claude -p {prompt}`. The `{prompt}` token is replaced with the full
 * prompt as a single argv entry (never through a shell); without a token the
 * prompt is appended as the last argument.
 */
import {spawn, type ChildProcess} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface AgentRunRequest {
  /** Command template, e.g. "hermes -z {prompt}". */
  command: string;
  /** Working directory for the agent (the project to fix). */
  cwd?: string;
  /** Full prompt text. */
  prompt: string;
}

export interface AgentRunResult {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  /** stdout, ANSI-stripped, capped. */
  output: string;
  /** Last bytes of stderr, ANSI-stripped. */
  stderrTail: string;
  error?: string;
  cancelled?: boolean;
  durationMs: number;
  truncated?: boolean;
}

const MAX_PROMPT_BYTES = 120 * 1024; // stay well below the single-argv limit
const MAX_STDOUT = 512 * 1024;
const MAX_STDERR_TAIL = 16 * 1024;

/** Splits a command template into argv, honoring single/double quotes and backslashes. */
export function tokenizeCommand(template: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let hasToken = false;
  const push = () => {
    if (hasToken || current.length > 0) {
      tokens.push(current);
      current = '';
      hasToken = false;
    }
  };
  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i];
    if (quote === 'single') {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === 'double') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && template[i + 1] === '"') {
        current += '"';
        i += 1;
      } else current += ch;
      continue;
    }
    if (ch === "'") {
      quote = 'single';
      hasToken = true;
      continue;
    }
    if (ch === '"') {
      quote = 'double';
      hasToken = true;
      continue;
    }
    if (ch === '\\' && i + 1 < template.length) {
      current += template[i + 1];
      i += 1;
      hasToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      push();
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (quote) {
    throw new Error(`Unterminated ${quote} quote in agent command`);
  }
  push();
  return tokens;
}

/** Substitutes {prompt} tokens; appends the prompt when no token is present. */
export function buildArgv(template: string, prompt: string): {argv: string[]} {
  const tokens = tokenizeCommand(template);
  if (tokens.length === 0) {
    throw new Error('Agent command is empty');
  }
  const hasPromptToken = tokens.includes('{prompt}');
  const substituted = hasPromptToken
    ? tokens.map((token) => (token === '{prompt}' ? prompt : token))
    : [...tokens, prompt];
  return {argv: substituted};
}

/** Resolves the binary: absolute/relative path as-is, otherwise PATH + common agent locations. */
export function resolveExecutable(command: string): string | null {
  const candidateDirs = [
    ...String(process.env.PATH ?? '').split(path.delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.hermes', 'hermes-agent', '.hermes', 'bin'),
  ].filter(Boolean);
  const isExecutable = (file: string): boolean => {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };
  if (command.includes('/')) {
    return isExecutable(command) ? command : null;
  }
  for (const dir of new Set(candidateDirs)) {
    const full = path.join(dir, command);
    if (isExecutable(full)) {
      return full;
    }
  }
  return null;
}

/** Strips ANSI escape sequences (colors, cursor moves) from CLI output. */
export function stripAnsi(input: string): string {
  return input.replace(
    // eslint-disable-next-line no-control-regex -- stripping ANSI control sequences is the point
    /[\u001B\u009B](?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)|\][^\u0007]*$)/g,
    ''
  );
}

interface RunHandle {
  child: ChildProcess;
  cancelRequested: boolean;
}

let current: RunHandle | null = null;

export const isAgentRunning = (): boolean => current !== null;

export function cancelAgent(): boolean {
  if (!current) {
    return false;
  }
  current.cancelRequested = true;
  const child = current.child;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }
  }, 3000).unref();
  return true;
}

export function runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
  const startedAt = Date.now();
  const fail = (error: string): AgentRunResult => ({
    ok: false,
    exitCode: null,
    signal: null,
    output: '',
    stderrTail: '',
    error,
    durationMs: Date.now() - startedAt,
  });

  if (current) {
    return Promise.resolve(fail('An agent run is already in progress'));
  }
  if (typeof request.prompt !== 'string' || request.prompt.length === 0) {
    return Promise.resolve(fail('Nothing to send: the annotation payload is empty'));
  }
  if (Buffer.byteLength(request.prompt, 'utf8') > MAX_PROMPT_BYTES) {
    return Promise.resolve(
      fail('Annotation payload is too large to pass as a command-line argument — use Copy instead')
    );
  }
  let argv: string[];
  try {
    ({argv} = buildArgv(request.command, request.prompt));
  } catch (error) {
    return Promise.resolve(fail(error instanceof Error ? error.message : String(error)));
  }
  const resolved = resolveExecutable(argv[0]);
  if (!resolved) {
    return Promise.resolve(
      fail(
        `Command not found: ${argv[0]}. Set the agent command in ⚙ settings (e.g. "hermes -z {prompt}").`
      )
    );
  }
  const cwd = request.cwd && request.cwd.trim().length > 0 ? request.cwd : os.homedir();
  try {
    if (!fs.statSync(cwd).isDirectory()) {
      return Promise.resolve(fail(`Project folder is not a directory: ${cwd}`));
    }
  } catch {
    return Promise.resolve(fail(`Project folder does not exist: ${cwd}`));
  }

  return new Promise<AgentRunResult>((resolve) => {
    const handle: RunHandle = {child: null as unknown as ChildProcess, cancelRequested: false};
    let stdout = '';
    let stderrTail = '';
    let truncated = false;
    const child = spawn(resolved, argv.slice(1), {
      cwd,
      env: {...process.env, NO_COLOR: '1', PAGER: 'cat'},
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    handle.child = child;
    current = handle;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT) {
        stdout = (stdout + chunk.toString('utf8')).slice(-MAX_STDOUT);
        if (stdout.length >= MAX_STDOUT) truncated = true;
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-MAX_STDERR_TAIL);
    });
    child.on('error', (error) => {
      current = null;
      resolve({
        ok: false,
        exitCode: null,
        signal: null,
        output: stripAnsi(stdout),
        stderrTail: stripAnsi(stderrTail),
        error: `Failed to start ${argv[0]}: ${error.message}`,
        durationMs: Date.now() - startedAt,
      });
    });
    child.on('close', (code, signal) => {
      const cancelled = handle.cancelRequested;
      current = null;
      resolve({
        ok: !cancelled && code === 0,
        exitCode: code,
        signal,
        output: stripAnsi(stdout).trim(),
        stderrTail: stripAnsi(stderrTail).trim(),
        cancelled: cancelled || undefined,
        truncated: truncated || undefined,
        durationMs: Date.now() - startedAt,
        ...(cancelled
          ? {error: 'Cancelled by user'}
          : code === 0
            ? {}
            : {error: `Exited with code ${code}`}),
      });
    });
  });
}

/** Best-effort cleanup on app quit. */
export function killAgentOnQuit(): void {
  if (current) {
    current.child.kill('SIGTERM');
    current = null;
  }
}
