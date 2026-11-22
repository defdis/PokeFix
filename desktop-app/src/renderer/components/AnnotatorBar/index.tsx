import {useEffect, useMemo, useRef, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';

import {IPC_MAIN_CHANNELS} from 'common/constants';
import {setAnnotatorOpen, selectIsAnnotatorOpen} from 'renderer/store/features/annotator';
import {webViewPubSub} from 'renderer/lib/pubsub';

interface BarConfig {
  cssClasses: boolean;
  fullText: boolean;
  computedStyles: boolean;
  clearAfterCopy: boolean;
  clearAfterSend: boolean;
}

const DEFAULT_CONFIG: BarConfig = {
  cssClasses: true,
  fullText: true,
  computedStyles: false,
  clearAfterCopy: false,
  clearAfterSend: true,
};

const CONFIG_STORAGE_KEY = 'baAnnotatorBarConfig';

const AGENT_COMMAND_KEY = 'baAgentCommand';
const AGENT_CWD_KEY = 'baAgentCwd';
const DEFAULT_AGENT_COMMAND = 'hermes -z {prompt}';
const AGENT_PRESETS: Array<{label: string; command: string}> = [
  {label: 'Hermes', command: 'hermes -z {prompt}'},
  {label: 'Claude Code', command: 'claude -p {prompt}'},
  {label: 'Codex', command: 'codex exec {prompt}'},
  {label: 'Gemini', command: 'gemini -p {prompt}'},
];

interface BarEntry {
  index: number;
  tag: string;
  text: string;
  selector: string;
  feedback: string;
  styles?: string;
  attributes?: string;
  html?: string;
  position?: {x: number; y: number; width: number; height: number};
  /** Device label the mark was made in, e.g. "iPhone 12 Pro". */
  device: string;
  /** webContents id, needed to route removal back to the right preview. */
  webviewId: string;
  /** Preview URL for the markdown export. */
  url: string;
  /** Preview CSS size, for the markdown export header. */
  viewport: string;
}

const listWebviews = () => Array.from(document.querySelectorAll<Electron.WebviewTag>('webView'));

// Inline stroke glyphs instead of @iconify/react: the icon CDN
// (api.iconify.design) is unreachable on this network setup (000 via the
// transit), so network-fetched `ph:` icons silently render empty.
const GLYPH_PATHS: Record<string, React.ReactNode> = {
  eye: (
    <>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeSlash: (
    <>
      <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z" opacity="0.45" />
      <path d="M4 4l16 16" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  check: <path d="M4 12.5 9.5 18 20 6.5" />,
  pencil: <path d="M4 20l.9-3.6L16.2 5.1a2 2 0 0 1 2.8 0l-.1-.1a2 2 0 0 1 0 2.8L7.6 19.1 4 20Z" />,
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M5 6l1 14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-14" />
      <path d="M10 10.5v6.5M14 10.5v6.5" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h12M9 12h12M9 18h12" />
      <path d="M4.5 5.5h.01M4.5 11.5h.01M4.5 17.5h.01" strokeWidth="3" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="7.5" opacity="0.6" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
    </>
  ),
  x: <path d="M5 5l14 14M19 5L5 19" />,
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />,
  spinner: (
    <g className="origin-center animate-spin">
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </g>
  ),
  folder: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </>
  ),
};

const BarGlyph = ({
  name,
  fontSize = 19,
  className,
}: {
  name: string;
  fontSize?: number;
  className?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    width={fontSize}
    height={fontSize}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {GLYPH_PATHS[name] ?? null}
  </svg>
);

// The bar mirrors MarkAgent: a single dark capsule docked at the bottom of
// the window with a collapsible list of every mark in all previews. It owns
// no mode state of its own — closing the capsule turns the whole mode off.
const AnnotatorBar = () => {
  const isOpen = useSelector(selectIsAnnotatorOpen);
  const dispatch = useDispatch();
  const [expanded, setExpanded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const [entries, setEntries] = useState<BarEntry[]>([]);
  const [editingIndex, setEditingIndex] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [agentStatus, setAgentStatus] = useState<'idle' | 'running' | 'ok' | 'fail'>('idle');
  const sendStatusTimer = useRef<number | null>(null);
  const agentTimer = useRef<number | null>(null);
  const [agentElapsed, setAgentElapsed] = useState(0);
  const [agentResult, setAgentResult] = useState<{
    ok: boolean;
    output: string;
    error?: string;
    durationMs: number;
    cancelled?: boolean;
    exitCode: number | null;
    truncated?: boolean;
  } | null>(null);
  const [showAgentResult, setShowAgentResult] = useState(false);
  const [agentCommand, setAgentCommand] = useState(
    () => window.localStorage.getItem(AGENT_COMMAND_KEY) ?? DEFAULT_AGENT_COMMAND
  );
  const [agentCwd, setAgentCwd] = useState(() => window.localStorage.getItem(AGENT_CWD_KEY) ?? '');
  const [showTour, setShowTour] = useState(
    () => window.localStorage.getItem('baAnnotatorOnboardingDismissed') == null
  );
  const [config, setConfig] = useState<BarConfig>(() => {
    try {
      const stored = window.localStorage.getItem(CONFIG_STORAGE_KEY);
      return stored === null ? DEFAULT_CONFIG : (JSON.parse(stored) as BarConfig);
    } catch (error) {
      return DEFAULT_CONFIG;
    }
  });
  // Mirror of `hidden` and `config` for the poll loop (avoids re-arming it).
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    setExpanded(false);
    setShowSettings(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setPicking(false);
      return undefined;
    }
    const handler = (pickingNow: boolean) => {
      setPicking(pickingNow);
    };
    webViewPubSub.subscribe('ba-annotate-picking', handler);
    return () => {
      webViewPubSub.unsubscribe('ba-annotate-picking', handler);
    };
  }, [isOpen]);

  useEffect(() => {
    // In-guest toggles (Cmd/Ctrl+Shift+. or the guest badge) → mirror into the
    // host store so the bar and previews never fight over the mode.
    const handler = (active: boolean) => {
      dispatch(setAnnotatorOpen(active === true));
    };
    webViewPubSub.subscribe('ba-annotate-toggled', handler);
    return () => {
      webViewPubSub.unsubscribe('ba-annotate-toggled', handler);
    };
  }, [dispatch]);

  useEffect(() => {
    if (!isOpen) {
      setEntries([]);
      return undefined;
    }
    let disposed = false;
    const collect = async () => {
      const collected = await Promise.all(
        listWebviews().map(async (webview, position) => {
          try {
            // One round trip per preview: re-arm the mode (the guest resets it
            // on reload), re-apply config/hidden (idempotent in the guest),
            // then read the marks.
            const items: unknown = await webview.executeJavaScript(
              `(() => {
                if (window.baAnnotatorSetEnabled) { window.baAnnotatorSetEnabled(true); }
                if (window.baAnnotationApi) {
                  window.baAnnotationApi.configure(${JSON.stringify(configRef.current)});
                  window.baAnnotationApi.setHidden(${hiddenRef.current ? 'true' : 'false'});
                  return window.baAnnotationApi.get();
                }
                return [];
              })()`,
              false
            );
            if (!Array.isArray(items)) {
              return [];
            }
            const device = (() => {
              try {
                const name = webview.getAttribute('data-device-name');
                return name || webview.getTitle() || `Preview ${position + 1}`;
              } catch (error) {
                return `Preview ${position + 1}`;
              }
            })();
            const url = (() => {
              try {
                return webview.getURL();
              } catch (error) {
                return '';
              }
            })();
            // offsetWidth/offsetHeight are layout pixels — the CSS zoom used
            // for previews must not shrink the reported viewport.
            const viewport = `${webview.offsetWidth}x${webview.offsetHeight}`;
            return (items as BarEntry[]).map((item) => ({
              ...item,
              device,
              url,
              viewport,
              webviewId: String(webview.getWebContentsId?.() ?? position),
            }));
          } catch (error) {
            return [];
          }
        })
      );
      if (!disposed) {
        const flat = collected.flat();
        setEntries((current) =>
          JSON.stringify(current) === JSON.stringify(flat) ? current : flat
        );
      }
    };
    const timer = setInterval(collect, 1500);
    collect();
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [isOpen]);

  const totalCount = useMemo(() => entries.length, [entries]);

  const updateConfig = (patch: Partial<BarConfig>) => {
    const next = {...config, ...patch};
    setConfig(next);
    try {
      window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      // localStorage unavailable — settings stay session-only.
    }
    // Re-apply before re-paint so the very next mark already uses new rules.
    listWebviews().forEach((webview) => {
      webview
        .executeJavaScript(
          `window.baAnnotationApi && window.baAnnotationApi.configure(${JSON.stringify(next)})`,
          false
        )
        .catch(() => undefined);
    });
  };

  const toggleHidden = () => {
    const next = !hidden;
    setHidden(next);
    listWebviews().forEach((webview) => {
      webview
        .executeJavaScript(
          `window.baAnnotationApi && window.baAnnotationApi.setHidden(${next})`,
          false
        )
        .catch(() => undefined);
    });
  };

  const removeEntry = (entry: BarEntry) => {
    const webview = listWebviews().find(
      (candidate) => String(candidate.getWebContentsId?.()) === entry.webviewId
    );
    webview
      ?.executeJavaScript(
        `window.baAnnotationApi && window.baAnnotationApi.remove(${entry.index})`,
        false
      )
      .catch(() => undefined);
    setEntries((current) => current.filter((candidate) => candidate !== entry));
  };

  const saveEdit = (entry: BarEntry) => {
    const webview = listWebviews().find(
      (candidate) => String(candidate.getWebContentsId?.()) === entry.webviewId
    );
    webview
      ?.executeJavaScript(
        `window.baAnnotationApi && window.baAnnotationApi.edit(${entry.index}, ${JSON.stringify(
          editDraft
        )})`,
        false
      )
      .catch(() => undefined);
    setEntries((current) =>
      current.map((candidate) =>
        candidate === entry ? {...candidate, feedback: editDraft} : candidate
      )
    );
    setEditingIndex(null);
  };

  const clearAll = () => {
    listWebviews().forEach((webview) => {
      webview
        .executeJavaScript('window.baAnnotationApi && window.baAnnotationApi.clear()', false)
        .catch(() => undefined);
    });
    setEntries([]);
  };

  const buildMarkdown = (): string => {
    // Page-supplied strings must never break the line format — newlines are
    // collapsed. Keep in sync with the MCP export.
    const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();
    const codeSafe = (value: string) => value.replace(/`/g, "'");
    const lines: string[] = ['Feedback:', ''];
    entries.forEach((entry) => {
      lines.push(
        `For ${entry.device}${entry.viewport ? ` (${entry.viewport})` : ''}${entry.url ? ` — ${entry.url}` : ''}`
      );
      lines.push(`### ${entry.index}. ${entry.tag} "${oneLine(entry.text)}"`);
      lines.push(`Selector: \`${codeSafe(entry.selector)}\``);
      if (entry.position) {
        lines.push(
          `Position: x=${entry.position.x} y=${entry.position.y} (${entry.position.width}x${entry.position.height})`
        );
      }
      if (entry.attributes && entry.attributes.length > 0) {
        lines.push(`Attributes: ${entry.attributes}`);
      }
      if (entry.html) {
        lines.push(`HTML: \`${codeSafe(entry.html)}\``);
      }
      if (entry.feedback.length > 0) {
        lines.push(`Feedback: ${oneLine(entry.feedback)}`);
      }
      if (entry.styles) {
        lines.push(`Styles: ${entry.styles}`);
      }
      lines.push('');
    });
    return lines.join('\n');
  };

  const buildAgentPrompt = () => {
    const items = entries.map(
      ({webviewId: _webviewId, device: _device, viewport: _viewport, ...rest}) => rest
    );
    return [
      'You are an agent fixing UI issues found in a responsive preview (Pokefix).',
      'Apply the fixes in the current repository (markup/styles/logic), then reply briefly:',
      'what you changed and what you could not verify. Work autonomously with the tools you have.',
      '',
      '## Annotations (markdown)',
      buildMarkdown(),
      '',
      '## Items (JSON)',
      '```json',
      JSON.stringify(items, null, 2),
      '```',
    ].join('\n');
  };

  const runAgent = async () => {
    if (entries.length === 0 || agentStatus === 'running') {
      return;
    }
    setAgentStatus('running');
    setAgentElapsed(0);
    const startedAt = Date.now();
    if (agentTimer.current !== null) {
      window.clearInterval(agentTimer.current);
    }
    agentTimer.current = window.setInterval(
      () => setAgentElapsed(Math.max(1, Math.floor((Date.now() - startedAt) / 1000))),
      250
    );
    try {
      const result = await window.electron.ipcRenderer.invoke<
        {command: string; cwd?: string; prompt: string},
        {
          ok: boolean;
          exitCode: number | null;
          signal: string | null;
          output: string;
          stderrTail: string;
          error?: string;
          cancelled?: boolean;
          durationMs: number;
          truncated?: boolean;
        }
      >(IPC_MAIN_CHANNELS.BA_AGENT_RUN, {
        command: agentCommand,
        cwd: agentCwd.trim().length > 0 ? agentCwd.trim() : undefined,
        prompt: buildAgentPrompt(),
      });
      const combined = result.output.trim();
      setAgentResult({
        ok: result.ok,
        output: combined || result.stderrTail || '(no output)',
        error: result.error,
        durationMs: result.durationMs,
        cancelled: result.cancelled,
        exitCode: result.exitCode,
        truncated: result.truncated,
      });
      setShowAgentResult(true);
      setAgentStatus(result.ok ? 'ok' : 'fail');
      if (result.ok && configRef.current.clearAfterSend) {
        clearAll();
      }
    } catch (error) {
      setAgentResult({
        ok: false,
        output: '',
        error: String(error),
        durationMs: Date.now() - startedAt,
        exitCode: null,
      });
      setShowAgentResult(true);
      setAgentStatus('fail');
    } finally {
      if (agentTimer.current !== null) {
        window.clearInterval(agentTimer.current);
        agentTimer.current = null;
      }
      if (sendStatusTimer.current !== null) {
        window.clearTimeout(sendStatusTimer.current);
      }
      sendStatusTimer.current = window.setTimeout(() => setAgentStatus('idle'), 2500);
    }
  };

  const cancelAgent = () => {
    window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.BA_AGENT_CANCEL).catch(() => undefined);
  };

  const pickProjectFolder = async () => {
    try {
      const picked = await window.electron.ipcRenderer.invoke<Record<string, never>, string | null>(
        IPC_MAIN_CHANNELS.BA_PICK_DIRECTORY,
        {}
      );
      if (picked) {
        setAgentCwd(picked);
        window.localStorage.setItem(AGENT_CWD_KEY, picked);
      }
    } catch {
      // picker unavailable — user can still type the path
    }
  };

  // Don't fire setState after unmount.
  useEffect(
    () => () => {
      if (sendStatusTimer.current !== null) {
        window.clearTimeout(sendStatusTimer.current);
      }
      if (agentTimer.current !== null) {
        window.clearInterval(agentTimer.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!showAgentResult) {
      return undefined;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowAgentResult(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showAgentResult]);

  const copyMarkdown = async () => {
    const text = buildMarkdown();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      if (config.clearAfterCopy) {
        clearAll();
      }
    } catch (error) {
      // Clipboard denied — keep marks, the list panel is still a manual source.
    }
  };

  const turnOff = () => {
    listWebviews().forEach((webview) => {
      webview
        .executeJavaScript(
          'window.baAnnotatorSetEnabled && window.baAnnotatorSetEnabled(false)',
          false
        )
        .catch(() => undefined);
    });
    dispatch(setAnnotatorOpen(false));
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="pointer-events-none relative z-50 pt-1 pb-2">
      {picking && (
        <div className="pointer-events-none mx-auto mb-1.5 flex w-fit items-center gap-1.5 rounded-full bg-blue-500/95 px-3 py-1 text-[11px] font-semibold text-white shadow-lg">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          Picking element — click to mark
        </div>
      )}
      {showTour && (
        <div className="pointer-events-auto relative mx-auto mb-1.5 w-fit rounded-full bg-[#111a31]/95 px-4 py-1.5 text-[11px] text-slate-300 shadow-lg ring-1 ring-white/10">
          Hold <kbd className="font-semibold text-white">Option</kbd> + click an element to mark it.
          Pokefix hands the list to your agent — configure it in{' '}
          <button
            type="button"
            onClick={() => {
              setShowSettings(true);
              setShowTour(false);
              window.localStorage.setItem('baAnnotatorOnboardingDismissed', '1');
            }}
            className="font-semibold text-emerald-300 hover:underline"
          >
            ⚙ settings
          </button>
          ).
          <button
            type="button"
            aria-label="Dismiss hint"
            onClick={() => {
              setShowTour(false);
              window.localStorage.setItem('baAnnotatorOnboardingDismissed', '1');
            }}
            className="absolute -top-2 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#1e2739] text-slate-400 hover:text-slate-200"
          >
            <BarGlyph name="x" fontSize={10} />
          </button>
        </div>
      )}
      <div
        className={`pointer-events-auto mx-auto w-fit max-w-[92%] rounded-full bg-[#111a31]/95 px-4 py-2 shadow-[0_8px_28px_rgba(0,0,0,0.55)] ${
          picking ? 'ring-2 ring-blue-400/80' : 'ring-1 ring-white/10'
        }`}
      >
        <div className="flex items-center gap-3 text-slate-200">
          <button
            type="button"
            title={hidden ? 'Show annotations' : 'Hide annotations'}
            aria-label={hidden ? 'Show annotations' : 'Hide annotations'}
            onClick={toggleHidden}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10"
          >
            <BarGlyph
              name={hidden ? 'eyeSlash' : 'eye'}
              fontSize={19}
              className={hidden ? 'opacity-40' : ''}
            />
          </button>
          <button
            type="button"
            title="Copy annotations as Markdown"
            aria-label="Copy annotations as Markdown"
            onClick={copyMarkdown}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10"
          >
            <BarGlyph
              name={copied ? 'check' : 'copy'}
              fontSize={19}
              className={copied ? 'text-emerald-400' : ''}
            />
          </button>
          <button
            type="button"
            title={
              agentStatus === 'running'
                ? `Agent is working… ${agentElapsed}s (✕ to cancel)`
                : agentStatus === 'fail'
                  ? 'Agent run failed — see the result window'
                  : 'Send annotations to the agent (runs the configured CLI)'
            }
            aria-label="Send annotations to the agent"
            onClick={runAgent}
            disabled={agentStatus === 'running' || entries.length === 0}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 disabled:cursor-wait"
          >
            <BarGlyph
              name={agentStatus === 'running' ? 'spinner' : 'send'}
              fontSize={19}
              className={
                agentStatus === 'ok'
                  ? 'text-emerald-400'
                  : agentStatus === 'fail'
                    ? 'text-red-400'
                    : agentStatus === 'running'
                      ? 'text-sky-300'
                      : ''
              }
            />
          </button>
          {agentStatus === 'running' && (
            <button
              type="button"
              title="Cancel agent run"
              aria-label="Cancel agent run"
              onClick={cancelAgent}
              className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-red-300"
            >
              <BarGlyph name="x" fontSize={16} />
            </button>
          )}
          <button
            type="button"
            title="Clear annotations"
            aria-label="Clear annotations"
            onClick={clearAll}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10"
          >
            <BarGlyph name="trash" fontSize={19} />
          </button>
          <button
            type="button"
            title="Show annotation list"
            aria-label="Show annotation list"
            onClick={() => setExpanded((value) => !value)}
            className="relative flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10"
          >
            <BarGlyph name="list" fontSize={19} />
            {totalCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold text-[#0b1220]">
                {totalCount}
              </span>
            )}
          </button>
          <button
            type="button"
            title="Annotator settings"
            aria-label="Annotator settings"
            onClick={() => setShowSettings((value) => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10"
          >
            <BarGlyph name="gear" fontSize={19} />
          </button>
          <span className="mx-0.5 h-5 w-px bg-white/15" />
          <button
            type="button"
            title="Stop annotating"
            aria-label="Stop annotating"
            onClick={turnOff}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10"
          >
            <BarGlyph name="x" fontSize={19} />
          </button>
        </div>
      </div>
      {showSettings && (
        <div className="pointer-events-auto absolute right-1/2 bottom-full mb-2 w-[300px] translate-x-1/2 rounded-2xl bg-[#111a31]/97 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
          <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
            Identify element by
          </p>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-slate-200">CSS classes</span>
            <input
              type="checkbox"
              checked={config.cssClasses}
              onChange={(event) => updateConfig({cssClasses: event.target.checked})}
            />
          </div>
          <p className="mt-3 mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
            Element data
          </p>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-slate-200">Full element text</span>
            <input
              type="checkbox"
              checked={config.fullText}
              onChange={(event) => updateConfig({fullText: event.target.checked})}
            />
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-slate-200">Computed styles</span>
            <input
              type="checkbox"
              checked={config.computedStyles}
              onChange={(event) => updateConfig({computedStyles: event.target.checked})}
            />
          </div>
          <p className="mt-3 mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
            Behavior
          </p>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-slate-200">Clear after copy</span>
            <input
              type="checkbox"
              checked={config.clearAfterCopy}
              onChange={(event) => updateConfig({clearAfterCopy: event.target.checked})}
            />
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-xs text-slate-200">Clear after agent run</span>
            <input
              type="checkbox"
              checked={config.clearAfterSend}
              onChange={(event) => updateConfig({clearAfterSend: event.target.checked})}
            />
          </div>
          <p className="mt-3 mb-2 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
            Agent
          </p>
          <label className="mb-1 block text-[10px] text-slate-500" htmlFor="ba-agent-command">
            Command
          </label>
          <input
            id="ba-agent-command"
            value={agentCommand}
            onChange={(event) => {
              setAgentCommand(event.target.value);
              window.localStorage.setItem(AGENT_COMMAND_KEY, event.target.value);
            }}
            placeholder={DEFAULT_AGENT_COMMAND}
            spellCheck={false}
            className="w-full rounded-md border border-white/15 bg-[#0b1220]/80 px-2 py-1.5 font-mono text-[11px] text-slate-100"
          />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {AGENT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setAgentCommand(preset.command);
                  window.localStorage.setItem(AGENT_COMMAND_KEY, preset.command);
                }}
                className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-slate-300 hover:border-emerald-400/50 hover:text-emerald-300"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <label className="mt-2 mb-1 block text-[10px] text-slate-500" htmlFor="ba-agent-cwd">
            Project folder
          </label>
          <div className="flex gap-1.5">
            <input
              id="ba-agent-cwd"
              value={agentCwd}
              onChange={(event) => {
                setAgentCwd(event.target.value);
                window.localStorage.setItem(AGENT_CWD_KEY, event.target.value);
              }}
              placeholder="~/path/to/project (default: home)"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-white/15 bg-[#0b1220]/80 px-2 py-1.5 font-mono text-[11px] text-slate-100"
            />
            <button
              type="button"
              onClick={pickProjectFolder}
              title="Choose folder…"
              aria-label="Choose project folder"
              className="flex w-8 shrink-0 items-center justify-center rounded-md border border-white/15 text-slate-300 hover:bg-white/5"
            >
              <BarGlyph name="folder" fontSize={15} />
            </button>
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
            The plane runs this CLI with the annotations as the prompt — no gateway or webhook
            needed. <code className="text-slate-400">{'{prompt}'}</code> is replaced by the
            annotation payload (appended at the end if omitted). Leave the folder empty to use your
            home directory.
          </p>
        </div>
      )}
      {showAgentResult && agentResult && (
        <div className="pointer-events-auto fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close agent response"
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-black/60"
            onClick={() => setShowAgentResult(false)}
          />
          <div
            className="relative flex max-h-[76vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-[#111a31] shadow-[0_20px_60px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
            role="dialog"
            aria-modal="true"
            aria-label="Agent response"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    agentResult.ok
                      ? 'bg-emerald-400'
                      : agentResult.cancelled
                        ? 'bg-amber-400'
                        : 'bg-red-400'
                  }`}
                />
                <p className="truncate text-sm font-semibold text-slate-100">
                  {agentResult.ok
                    ? 'Agent finished'
                    : agentResult.cancelled
                      ? 'Agent cancelled'
                      : 'Agent failed'}
                </p>
                {agentResult.durationMs > 0 && (
                  <span className="text-[10px] text-slate-500">
                    {(agentResult.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
                {typeof agentResult.exitCode === 'number' && !agentResult.ok && (
                  <span className="text-[10px] text-slate-500">exit {agentResult.exitCode}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowAgentResult(false)}
                aria-label="Close"
                className="rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100"
              >
                <BarGlyph name="x" fontSize={15} />
              </button>
            </div>
            <pre className="min-h-[120px] flex-1 overflow-auto px-4 py-3 font-sans text-[12px] leading-relaxed whitespace-pre-wrap text-slate-100">
              {agentResult.output}
            </pre>
            {agentResult.error && (
              <pre className="max-h-28 overflow-auto border-t border-red-500/20 bg-red-950/20 px-4 py-2 font-mono text-[11px] leading-snug whitespace-pre-wrap text-red-300">
                {agentResult.error}
              </pre>
            )}
            {agentResult.truncated && (
              <p className="border-t border-white/5 px-4 py-1.5 text-[10px] text-amber-300/80">
                Output was truncated — only the end is shown.
              </p>
            )}
            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-2.5">
              <button
                type="button"
                onClick={() => {
                  const text = agentResult.error
                    ? `${agentResult.output}

--- error ---
${agentResult.error}`
                    : agentResult.output;
                  navigator.clipboard.writeText(text).catch(() => undefined);
                }}
                className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setShowAgentResult(false)}
                className="rounded-md bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-400"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {expanded && (
        <div className="pointer-events-auto absolute bottom-full left-1/2 mb-2 max-h-[46vh] w-[520px] -translate-x-1/2 overflow-y-auto rounded-2xl bg-[#111a31]/97 p-2 shadow-[0_12px_40px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
          {entries.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-400">
              No marks yet — hold Option and click an element in a preview.
            </p>
          )}
          {entries.map((entry) => (
            <div
              key={`${entry.webviewId}-${entry.index}`}
              className="group flex items-start gap-2 rounded-xl px-3 py-2 text-slate-200 hover:bg-white/5"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/90 text-[11px] font-semibold text-white">
                {entry.index}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-slate-400">
                  {entry.device} · {entry.tag} · {entry.selector}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-100">
                  {entry.feedback || entry.text || '—'}
                </p>
                {editingIndex === `${entry.webviewId}-${entry.index}` && (
                  <textarea
                    value={editDraft}
                    onChange={(event) => setEditDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        saveEdit(entry);
                      }
                      if (event.key === 'Escape') {
                        setEditingIndex(null);
                      }
                    }}
                    rows={2}
                    placeholder="What about this element?"
                    className="mt-1.5 w-full resize-y rounded-md border border-white/15 bg-[#0b1220]/80 px-2 py-1.5 text-xs text-slate-100"
                  />
                )}
              </div>
              {editingIndex === `${entry.webviewId}-${entry.index}` ? (
                <button
                  type="button"
                  title="Save edit"
                  aria-label="Save edit"
                  onClick={() => saveEdit(entry)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-emerald-400"
                >
                  <BarGlyph name="check" fontSize={14} />
                </button>
              ) : (
                <button
                  type="button"
                  title="Edit feedback"
                  aria-label="Edit feedback"
                  onClick={() => {
                    setEditingIndex(`${entry.webviewId}-${entry.index}`);
                    setEditDraft(entry.feedback);
                  }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-amber-300"
                >
                  <BarGlyph name="pencil" fontSize={14} />
                </button>
              )}
              <button
                type="button"
                title="Remove mark"
                aria-label="Remove mark"
                onClick={() => removeEntry(entry)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-red-400"
              >
                <BarGlyph name="trash" fontSize={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AnnotatorBar;
