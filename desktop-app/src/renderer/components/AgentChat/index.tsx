import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Icon} from '@iconify/react';
import cx from 'classnames';
import {IPC_MAIN_CHANNELS} from 'common/constants';
import {subscribeAgentChat} from '../../lib/agentChatBus';

type ChatItem =
  | {id: string; kind: 'user'; text: string}
  | {id: string; kind: 'assistant'; text: string; streaming?: boolean}
  | {id: string; kind: 'tool'; toolId: string; title: string; status: string; text?: string}
  | {id: string; kind: 'note'; text: string; tone?: 'error' | 'info'};

interface PermissionRequest {
  requestId: number;
  title: string;
  options: Array<{optionId: string; name: string; kind: string}>;
  nonce?: string;
  expired?: boolean;
}

interface AgentAvailability {
  id: string;
  name: string;
  available: boolean;
}

const CWD_KEY = 'baAgentCwd'; // shared with the annotation plane — one project folder everywhere
const AGENT_KEY = 'baChatAgent';
const OPEN_KEY = 'baChatOpen';

/** Minimal safe markup: fenced code blocks + inline code, everything else is plain text. */
const renderInline = (text: string, keyPrefix: string) => {
  const parts = text.split(/(`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return (
        <code
          key={`${keyPrefix}-c-${index}`}
          className="rounded bg-black/40 px-1 py-0.5 font-mono text-[10.5px] text-sky-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyPrefix}-t-${index}`}>{part}</span>;
  });
};

const renderRichText = (text: string) => {
  const segments = text.split(/```/g);
  return segments.map((segment, index) => {
    if (index % 2 === 1) {
      const firstNewline = segment.indexOf('\n');
      const body = firstNewline === -1 ? segment : segment.slice(firstNewline + 1);
      return (
        <pre
          key={`code-${index}`}
          className="my-1 overflow-x-auto rounded-lg border border-white/10 bg-black/50 p-2 font-mono text-[10.5px] leading-snug text-slate-200"
        >
          {body}
        </pre>
      );
    }
    return (
      <p key={`text-${index}`} className="[overflow-wrap:anywhere] break-words whitespace-pre-wrap">
        {renderInline(segment, `s${index}`)}
      </p>
    );
  });
};

const toolStatusIcon = (status: string): {icon: string; className: string} => {
  if (status === 'completed' || status === 'success') {
    return {icon: 'lucide:check', className: 'text-emerald-400'};
  }
  if (status === 'failed' || status === 'error') {
    return {icon: 'lucide:x', className: 'text-red-400'};
  }
  return {icon: 'lucide:loader-circle', className: 'text-amber-300 animate-spin'};
};

const ChatMessage = memo(function ChatMessage({item}: {item: ChatItem}) {
  if (item.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] rounded-2xl rounded-br-md bg-sky-600/90 px-3 py-2 text-[12px] leading-snug [overflow-wrap:anywhere] break-words text-white">
          {item.text}
        </div>
      </div>
    );
  }
  if (item.kind === 'assistant') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-white/5 bg-[#141d33] px-3 py-2 text-[12px] leading-snug text-slate-100">
          {renderRichText(item.text)}
          {item.streaming && <span className="animate-pulse text-sky-400">▍</span>}
        </div>
      </div>
    );
  }
  if (item.kind === 'tool') {
    const {icon, className} = toolStatusIcon(item.status);
    return (
      <div className="flex justify-start pl-1">
        <details className="max-w-full rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] text-slate-400 hover:text-slate-200">
            <Icon icon={icon} fontSize={11} className={className} />
            <span className="max-w-[240px] truncate font-mono">{item.title}</span>
            <span className="text-[9px] text-slate-600 uppercase">{item.status}</span>
          </summary>
          {item.text ? (
            <pre className="mt-1 max-h-32 overflow-auto border-t border-white/5 pt-1 font-mono text-[9.5px] whitespace-pre-wrap text-slate-400">
              {item.text}
            </pre>
          ) : null}
        </details>
      </div>
    );
  }
  return (
    <div
      className={cx(
        'mx-auto w-fit max-w-full rounded-md px-2 py-1 text-center text-[10px]',
        item.tone === 'error' ? 'bg-red-500/10 text-red-300' : 'text-slate-500'
      )}
    >
      {item.text}
    </div>
  );
});

/**
 * Floating "support chat" style panel that talks to a real agent CLI in ACP
 * mode (Hermes / OpenCode today). Streams tokens, shows tool calls and
 * permission prompts inline.
 */
const AgentChat = () => {
  const [open, setOpen] = useState<boolean>(() =>
    window.localStorage.getItem(OPEN_KEY) === null
      ? true
      : window.localStorage.getItem(OPEN_KEY) === '1'
  );
  const [agents, setAgents] = useState<AgentAvailability[]>([]);
  const [agentId, setAgentId] = useState<string>(
    () => window.localStorage.getItem(AGENT_KEY) ?? 'hermes'
  );
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<'idle' | 'spawning' | 'ready' | 'failed'>('idle');
  const [cwd, setCwd] = useState<string>(() => window.localStorage.getItem(CWD_KEY) ?? '');
  const [tokens, setTokens] = useState<number | null>(null);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [unread, setUnread] = useState(false);
  const unreadRef = useRef(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const idRef = useRef(0);
  const nextId = () => `m-${(idRef.current += 1)}`;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const scrollRaf = useRef<number | null>(null);
  const lastScrollHeight = useRef(0);
  const scrollToBottom = useCallback((force = false) => {
    if (scrollRaf.current !== null) {
      return; // one flush per frame is enough
    }
    scrollRaf.current = window.requestAnimationFrame(() => {
      scrollRaf.current = null;
      const el = scrollRef.current;
      if (!el) return;
      if (force || stickToBottom.current) {
        if (force || el.scrollHeight !== lastScrollHeight.current) {
          el.scrollTop = el.scrollHeight;
          lastScrollHeight.current = el.scrollHeight;
        }
      }
    });
  }, []);

  const pushNote = useCallback((text: string, tone: 'error' | 'info' = 'info') => {
    setItems((prev) => [...prev, {id: nextId(), kind: 'note', text, tone}]);
  }, []);

  const spawn = useCallback(
    async (id: string, cwdOverride?: string) => {
      setStatus('spawning');
      const dir = cwdOverride ?? cwd;
      let result: {ok: boolean; cwd?: string; error?: string};
      try {
        result = await window.electron.ipcRenderer.invoke<
          {agentId: string; cwd?: string},
          {ok: boolean; cwd?: string; error?: string}
        >(IPC_MAIN_CHANNELS.AGENT_CHAT_SPAWN, {agentId: id, cwd: dir || undefined});
      } catch (error) {
        setStatus('failed');
        pushNote(
          `Агент не запустился: ${error instanceof Error ? error.message : String(error)}`,
          'error'
        );
        return;
      }
      if (result.ok) {
        setStatus('ready');
        setCwd(result.cwd ?? dir ?? '');
      } else {
        setStatus('failed');
        pushNote(result.error ?? 'Agent failed to start', 'error');
      }
    },
    [cwd, pushNote]
  );

  // Agent availability list (once).
  useEffect(() => {
    window.electron.ipcRenderer
      .invoke<undefined, AgentAvailability[]>(IPC_MAIN_CHANNELS.AGENT_CHAT_AGENTS)
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);

  // Lazy-spawn on first open.
  useEffect(() => {
    if (open && status === 'idle') {
      void spawn(agentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // External surfaces (annotator plane button) push prompts into the chat here.
  useEffect(
    () =>
      subscribeAgentChat((event) => {
        if (event.type === 'send') {
          setOpen(true);
          setPendingText(event.text);
        }
      }),
    []
  );

  // Event plumbing.
  useEffect(() => {
    const offEvent = window.electron.ipcRenderer.on<Record<string, unknown>>(
      IPC_MAIN_CHANNELS.AGENT_CHAT_EVENT,
      (event) => {
        if (!event || typeof event !== 'object') return;
        const type = String(event.type ?? '');
        if (type === 'agent-message' || type === 'agent-thought') {
          const text = String(event.text ?? '');
          if (!text) return;
          setItems((prev) => {
            const last = prev[prev.length - 1];
            if (type === 'agent-message' && last?.kind === 'assistant' && last.streaming) {
              return [...prev.slice(0, -1), {...last, text: last.text + text}];
            }
            if (type === 'agent-message') {
              return [...prev, {id: nextId(), kind: 'assistant', text, streaming: true}];
            }
            return prev; // thoughts are intentionally not rendered
          });
          if (!unreadRef.current) {
            unreadRef.current = true;
            setUnread(true);
          }
          scrollToBottom();
          return;
        }
        if (type === 'tool-call') {
          setItems((prev) => [
            ...prev,
            {
              id: nextId(),
              kind: 'tool',
              toolId: String(event.id ?? ''),
              title: String(event.title ?? 'tool'),
              status: String(event.status ?? 'pending'),
            },
          ]);
          setTimeout(scrollToBottom, 20);
          return;
        }
        if (type === 'tool-update') {
          setItems((prev) =>
            prev.map((item) =>
              item.kind === 'tool' && item.toolId === event.id
                ? {
                    ...item,
                    status: typeof event.status === 'string' ? event.status : item.status,
                    text: typeof event.text === 'string' && event.text ? event.text : item.text,
                  }
                : item
            )
          );
          return;
        }
        if (type === 'usage') {
          const used = Number(event.used);
          if (Number.isFinite(used)) setTokens(used);
          return;
        }
        if (type === 'turn-complete') {
          setRunning(false);
          setPermission(null);
          setItems((prev) =>
            prev.map((item) =>
              item.kind === 'assistant' && item.streaming ? {...item, streaming: false} : item
            )
          );
          return;
        }
        if (type === 'error') {
          setRunning(false);
          pushNote(String(event.message ?? 'Agent error'), 'error');
          setItems((prev) =>
            prev.map((item) =>
              item.kind === 'assistant' && item.streaming ? {...item, streaming: false} : item
            )
          );
        }
      }
    );

    const offExit = window.electron.ipcRenderer.on<{code: number | null}>(
      IPC_MAIN_CHANNELS.AGENT_CHAT_EXIT,
      (payload) => {
        setRunning(false);
        setPermission(null);
        setStatus('failed');
        pushNote(`Агент завершил работу (код ${payload?.code ?? '?'}). Жми «Новый чат».`, 'info');
        setItems((prev) =>
          prev.map((item) =>
            item.kind === 'assistant' && item.streaming ? {...item, streaming: false} : item
          )
        );
      }
    );

    const offPermission = window.electron.ipcRenderer.on<PermissionRequest>(
      IPC_MAIN_CHANNELS.AGENT_CHAT_PERMISSION,
      (payload) => {
        if (!payload || typeof payload.requestId !== 'number') return;
        if (payload.expired) {
          setPermission((current) =>
            current && current.requestId === payload.requestId ? null : current
          );
          pushNote('Время на решение истекло — агент увидел «cancelled».', 'info');
          return;
        }
        setPermission(payload);
      }
    );

    return () => {
      offEvent?.();
      offExit?.();
      offPermission?.();
      window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.AGENT_CHAT_KILL).catch(() => undefined);
    };
  }, [pushNote, scrollToBottom]);

  useEffect(() => {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    if (open) {
      unreadRef.current = false;
      setUnread(false);
    }
  }, [open]);

  // Permission cards render below the fold when the user is scrolled up (or
  // reading a long reply): jump to the bottom and badge the FAB, otherwise
  // the agent sits blocked on an approval nobody saw.
  useEffect(() => {
    if (!permission) {
      return;
    }
    scrollToBottom(true);
    if (!openRef.current && !unreadRef.current) {
      unreadRef.current = true;
      setUnread(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permission]);

  const sendText = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || running || status !== 'ready') return;
    setItems((prev) => [...prev, {id: nextId(), kind: 'user', text}]);
    setRunning(true);
    stickToBottom.current = true;
    try {
      const result = await window.electron.ipcRenderer.invoke<
        {text: string},
        {ok: boolean; error?: string}
      >(IPC_MAIN_CHANNELS.AGENT_CHAT_SEND, {text});
      if (!result.ok) {
        setRunning(false);
        pushNote(result.error ?? 'Не удалось отправить', 'error');
      }
    } catch (error) {
      setRunning(false);
      pushNote(
        `Не удалось отправить: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
    setTimeout(() => scrollToBottom(true), 30);
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    await sendText(text);
  };

  // Flush a prompt pushed by the annotator plane once the session is up.
  useEffect(() => {
    if (pendingText === null) return;
    if (status === 'ready') {
      const text = pendingText;
      setPendingText(null);
      void sendText(text);
    } else if (status === 'failed') {
      setPendingText(null);
      pushNote('Агент недоступен — сообщение не отправлено', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingText, status]);

  const stop = () => {
    window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.AGENT_CHAT_CANCEL).catch(() => {
      setRunning(false);
    });
    // The turn-complete broadcast clears `running` authoritatively; if IPC is
    // broken entirely, at least surface the button again shortly after.
    window.setTimeout(() => setRunning(false), 1500);
  };

  const newSession = () => {
    setItems([]);
    setTokens(null);
    setPermission(null);
    setStatus('idle');
    void spawn(agentId);
  };

  const pickFolder = async () => {
    const picked = await window.electron.ipcRenderer.invoke<Record<string, never>, string | null>(
      IPC_MAIN_CHANNELS.BA_PICK_DIRECTORY,
      {}
    );
    if (!picked) return;
    window.localStorage.setItem(CWD_KEY, picked);
    setCwd(picked);
    // The ACP session is bound to a cwd — restart it there.
    setItems((prev) => [
      ...prev,
      {id: nextId(), kind: 'note', text: `Папка: ${picked}`, tone: 'info'},
    ]);
    setStatus('idle');
    void spawn(agentId, picked);
  };

  const pickAgent = (id: string) => {
    setAgentId(id);
    window.localStorage.setItem(AGENT_KEY, id);
    setItems([]);
    setTokens(null);
    setPermission(null);
    setStatus('idle');
    void spawn(id);
  };

  const respondPermission = (optionId: string | null) => {
    if (!permission) return;
    window.electron.ipcRenderer
      .invoke(IPC_MAIN_CHANNELS.AGENT_CHAT_PERMISSION, {
        requestId: permission.requestId,
        optionId,
        nonce: permission.nonce,
      })
      .catch(() => {
        /* stale card — main already forgot this request */
      });
    setPermission(null);
  };

  const cwdShort = useMemo(() => {
    if (!cwd) return '~';
    return cwd.length > 34 ? `…${cwd.slice(-33)}` : cwd;
  }, [cwd]);

  return (
    <>
      {/* FAB */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open agent chat"
          className="fixed right-5 bottom-14 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-sky-500 to-blue-700 text-white shadow-[0_10px_30px_rgba(2,132,199,0.45)] transition-transform hover:scale-105"
        >
          <Icon icon="lucide:message-circle" fontSize={24} />
          {unread && (
            <span className="absolute top-0.5 right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#0b1220] bg-emerald-400" />
          )}
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="fixed right-5 bottom-14 z-40 flex h-[540px] w-[400px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d1526]/95 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          {/* header */}
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 px-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/15">
              <Icon icon="lucide:messages-square" fontSize={14} className="text-sky-400" />
            </span>
            <select
              value={agentId}
              onChange={(e) => pickAgent(e.target.value)}
              aria-label="Agent"
              className="h-6 rounded-md border border-white/10 bg-[#111a2e] px-1.5 text-[11px] font-medium text-slate-100 outline-none"
            >
              {agents.length === 0 ? (
                <option value={agentId}>{agentId}</option>
              ) : (
                agents.map((agent) => (
                  <option key={agent.id} value={agent.id} disabled={!agent.available}>
                    {agent.name}
                    {agent.available ? '' : ' — не установлен'}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              onClick={pickFolder}
              title={cwd || 'Choose working folder'}
              className="flex h-6 min-w-0 items-center gap-1 rounded-md border border-white/10 px-1.5 text-[10.5px] text-slate-400 hover:border-sky-400/40 hover:text-sky-300"
            >
              <Icon icon="lucide:folder" fontSize={11} />
              <span className="max-w-[110px] truncate font-mono">{cwdShort}</span>
            </button>
            <span className="flex-1" />
            {tokens !== null && (
              <span className="font-mono text-[9.5px] text-slate-500 tabular-nums">
                {(tokens / 1000).toFixed(1)}k tok
              </span>
            )}
            <button
              type="button"
              onClick={() => void sendText('/undo')}
              disabled={running || status !== 'ready'}
              title="Отменить последний шаг агента (/undo)"
              aria-label="Отменить последний шаг агента"
              className="rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200 disabled:opacity-30"
            >
              <Icon icon="lucide:rotate-ccw" fontSize={13} />
            </button>
            <button
              type="button"
              onClick={newSession}
              title="New session"
              aria-label="New session"
              className="rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200"
            >
              <Icon icon="lucide:plus" fontSize={14} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Close chat"
              className="rounded p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-200"
            >
              <Icon icon="lucide:chevron-down" fontSize={15} />
            </button>
          </div>

          {/* messages */}
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
            className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
          >
            {items.length === 0 && status !== 'failed' && (
              <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-3 text-[11.5px] leading-relaxed text-slate-400">
                <p className="mb-1 font-semibold text-slate-300">Привет. Я подключён к агенту.</p>
                Рабочая папка — та же, что у кнопки-самолётика. Попроси поправить вёрстку по меткам:{' '}
                <span className="text-slate-200">«исправь аннотации из Pokefix»</span> — агент
                вычитает их через MCP (get_annotations).
              </div>
            )}
            {items.map((item) => (
              <ChatMessage key={item.id} item={item} />
            ))}

            {permission && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2">
                <p className="mb-1.5 text-[11px] font-semibold break-all text-amber-300">
                  Агент просит разрешение: {permission.title}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {permission.options.map((option) => (
                    <button
                      key={option.optionId}
                      type="button"
                      onClick={() => respondPermission(option.optionId)}
                      className={cx(
                        'rounded-md px-2 py-1 text-[10.5px] font-semibold',
                        option.kind === 'allow_once'
                          ? 'bg-emerald-500/80 text-emerald-950 hover:bg-emerald-400'
                          : option.kind.startsWith('allow')
                            ? 'border border-emerald-400/60 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                            : 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                      )}
                    >
                      {option.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => respondPermission(null)}
                    className="rounded-md bg-white/5 px-2 py-1 text-[10.5px] text-slate-400 hover:bg-white/10"
                  >
                    Отклонить
                  </button>
                </div>
              </div>
            )}

            {running && (
              <div className="flex items-center gap-1.5 pt-0.5 pl-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400/80"
                    style={{animationDelay: `${i * 120}ms`}}
                  />
                ))}
              </div>
            )}
          </div>

          {/* input */}
          <div className="flex shrink-0 items-end gap-2 border-t border-white/10 p-2.5">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={
                status === 'ready' ? 'Спроси агента… (Enter — отправить)' : 'Подключение…'
              }
              disabled={status !== 'ready'}
              className="max-h-36 min-h-[36px] flex-1 resize-none rounded-xl border border-white/10 bg-[#111a2e] px-3 py-2 text-[12px] leading-snug text-slate-100 placeholder-slate-500 outline-none focus:border-sky-500/50 disabled:opacity-50"
            />
            {running ? (
              <button
                type="button"
                onClick={stop}
                title="Остановить агента"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/80 text-white hover:bg-red-500"
              >
                <Icon icon="lucide:square" fontSize={13} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send()}
                disabled={status !== 'ready' || input.trim().length === 0}
                title="Отправить"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500 text-white transition-colors hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon icon="lucide:send-horizontal" fontSize={16} />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default AgentChat;
