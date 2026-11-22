import {useCallback, useEffect, useRef, useState} from 'react';
import {Terminal} from '@xterm/xterm';
import {FitAddon} from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import {Icon} from '@iconify/react';
import cx from 'classnames';
import {IPC_MAIN_CHANNELS} from 'common/constants';

interface AgentAvailability {
  id: string;
  name: string;
  available: boolean;
}

const OPEN_KEY = 'baAgentDockOpen';
const AGENT_KEY = 'baAgentDockAgent';
const CWD_KEY = 'baAgentCwd'; // shared with the annotation plane — one project folder everywhere

type DockStatus = 'idle' | 'running' | 'exited';

/**
 * Agent dock — an embedded terminal (xterm.js) hosting the actual agent CLI
 * (hermes / claude / codex / gemini / opencode) via a pty in the main process.
 * One session at a time; collapsing the dock never kills the process.
 */
const AgentDock = () => {
  const [open, setOpen] = useState<boolean>(() => window.localStorage.getItem(OPEN_KEY) !== '0');
  const [agents, setAgents] = useState<AgentAvailability[]>([]);
  const [agentId, setAgentId] = useState<string>(
    () => window.localStorage.getItem(AGENT_KEY) ?? 'hermes'
  );
  const [status, setStatus] = useState<DockStatus>('idle');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [cwd, setCwd] = useState<string>('');
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const fitAndReport = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    try {
      fit.fit();
    } catch {
      return; // container not measurable yet (hidden)
    }
    window.electron.ipcRenderer
      .invoke(IPC_MAIN_CHANNELS.TERMINAL_RESIZE, {cols: term.cols, rows: term.rows})
      .catch(() => undefined);
  }, []);

  const spawn = useCallback(async (id: string) => {
    setSpawnError(null);
    const term = termRef.current;
    const cwdPref = window.localStorage.getItem(CWD_KEY) ?? undefined;
    try {
      const result = await window.electron.ipcRenderer.invoke<
        {agentId: string; cwd?: string; cols?: number; rows?: number},
        {ok: boolean; cwd?: string; error?: string}
      >(IPC_MAIN_CHANNELS.TERMINAL_OPEN, {
        agentId: id,
        cwd: cwdPref,
        cols: term?.cols,
        rows: term?.rows,
      });
      if (!result.ok) {
        setStatus('exited');
        setSpawnError(result.error ?? 'unknown error');
        term?.write(`\x1b[31m[pokefix] ${result.error ?? 'failed to start agent'}\x1b[0m\r\n`);
        return;
      }
      setStatus('running');
      setExitCode(null);
      setCwd(result.cwd ?? '');
    } catch (error) {
      setStatus('exited');
      setSpawnError(String(error));
    }
  }, []);

  // Ask main which agents are installed (PATH probe, cached there).
  useEffect(() => {
    window.electron.ipcRenderer
      .invoke<undefined, AgentAvailability[]>(IPC_MAIN_CHANNELS.TERMINAL_LIST_AGENTS)
      .then((list) => setAgents(list))
      .catch(() => setAgents([]));
  }, []);

  // Create the xterm instance once, keep it mounted (collapse = CSS hiding,
  // never unmount — the pty session survives dock toggles).
  useEffect(() => {
    if (hostRef.current == null || termRef.current !== null) {
      return undefined;
    }
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: false,
      theme: {
        background: '#0b1220',
        foreground: '#dbe4f0',
        cursor: '#7dd3fc',
        selectionBackground: '#1f3a5f',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    term.focus();
    term.onData((data) => {
      window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.TERMINAL_WRITE, {data}).catch(() => {});
    });
    termRef.current = term;
    fitRef.current = fit;

    const offData = window.electron.ipcRenderer.on<{data: string}>(
      IPC_MAIN_CHANNELS.TERMINAL_DATA,
      (payload) => {
        if (payload && typeof payload.data === 'string') {
          term.write(payload.data);
        }
      }
    );
    const offExit = window.electron.ipcRenderer.on<{exitCode: number}>(
      IPC_MAIN_CHANNELS.TERMINAL_EXIT,
      (payload) => {
        setStatus('exited');
        setExitCode(typeof payload?.exitCode === 'number' ? payload.exitCode : null);
      }
    );

    const observer = new ResizeObserver(() => fitAndReport());
    observer.observe(hostRef.current);
    observerRef.current = observer;
    fit.fit();
    void spawn(window.localStorage.getItem(AGENT_KEY) ?? 'hermes');

    return () => {
      observer.disconnect();
      offData?.();
      offExit?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit when the dock is expanded again and on window resize.
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(fitAndReport, 60);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open, fitAndReport]);

  useEffect(() => {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  }, [open]);

  const pickAgent = (id: string) => {
    setAgentId(id);
    window.localStorage.setItem(AGENT_KEY, id);
    setStatus('idle');
    termRef.current?.clear();
    void spawn(id);
  };

  const kill = () => {
    window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.TERMINAL_KILL).catch(() => undefined);
  };

  const active = agents.find((a) => a.id === agentId);
  const cwdShort = cwd.length > 46 ? `…${cwd.slice(-45)}` : cwd;

  return (
    <div className="shrink-0 border-t border-white/10 bg-[#0b1220]">
      {/* slim bar — always visible */}
      <div className="flex h-7 items-center gap-2 px-3 text-[10px] font-semibold tracking-[0.18em] text-slate-500 select-none">
        <Icon icon="lucide:terminal" fontSize={12} className="text-sky-400" />
        <span>AGENT</span>
        <span
          className={cx(
            'h-1.5 w-1.5 rounded-full',
            status === 'running'
              ? 'bg-emerald-400'
              : status === 'exited'
                ? 'bg-slate-600'
                : 'bg-slate-600'
          )}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="tracking-normal text-slate-400 normal-case hover:text-slate-100"
          title={open ? 'Collapse agent terminal' : 'Expand agent terminal'}
        >
          {active?.name ?? agentId}
          {status === 'exited' ? (exitCode ? ` · exited ${exitCode}` : ' · exited') : ''}
        </button>
        {cwd && open ? (
          <span
            className="max-w-[42vw] truncate font-mono text-[10px] font-normal tracking-normal text-slate-600 normal-case"
            title={cwd}
          >
            {cwdShort}
          </span>
        ) : null}
        <span className="flex-1" />
        {open && status === 'running' ? (
          <button
            type="button"
            onClick={kill}
            title="Kill the agent process"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-red-400/90 hover:bg-red-500/10 hover:text-red-300"
          >
            <Icon icon="lucide:square" fontSize={10} />
            KILL
          </button>
        ) : null}
        {open ? (
          <button
            type="button"
            onClick={() => spawn(agentId)}
            title="Restart agent session"
            className="rounded p-1 text-slate-500 hover:bg-white/5 hover:text-slate-200"
          >
            <Icon icon="lucide:rotate-cw" fontSize={12} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Collapse agent terminal' : 'Expand agent terminal'}
          className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-slate-100"
        >
          <Icon icon={open ? 'lucide:chevron-down' : 'lucide:chevron-up'} fontSize={14} />
        </button>
      </div>

      {/* terminal body — always mounted, hidden when collapsed */}
      <div className={cx('overflow-hidden border-t border-white/5', open ? 'block' : 'hidden')}>
        <div className="flex h-7 items-center gap-2 border-b border-white/5 px-3">
          <span className="text-[9px] tracking-[0.14em] text-slate-600 uppercase">Agent</span>
          <select
            value={agentId}
            onChange={(event) => pickAgent(event.target.value)}
            className="h-5 rounded border border-white/10 bg-[#111a2e] px-1 text-[11px] text-slate-200 outline-none"
            aria-label="Agent to run"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id} disabled={!agent.available}>
                {agent.name}
                {agent.available ? '' : ' — не установлен'}
              </option>
            ))}
            {agents.length === 0 ? <option value={agentId}>…</option> : null}
          </select>
          <span className="text-[10px] text-slate-600">cwd:</span>
          <span className="truncate font-mono text-[10px] text-slate-500" title={cwd}>
            {cwd || '~'}
          </span>
          {spawnError ? (
            <span className="truncate text-[10px] text-red-400" title={spawnError}>
              {spawnError}
            </span>
          ) : null}
        </div>
        <div ref={hostRef} className="h-[240px] w-full px-2 pt-1" />
      </div>
    </div>
  );
};

export default AgentDock;
