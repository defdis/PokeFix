import {Icon} from '@iconify/react';
import {useCallback, useEffect, useRef, useState} from 'react';

import {IPC_MAIN_CHANNELS} from 'common/constants';
import type {LocalServerInfo} from 'main/local-servers';

interface Props {
  /** Called with the chosen server's URL; reuses the address bar's navigate flow. */
  onPick: (url: string) => void;
}

/**
 * Live-localhost picker: lists processes listening on TCP ports that answer
 * HTTP, so the user can jump straight into the thing they are debugging
 * instead of retyping ports. Backed by BA_LIST_LOCAL_SERVERS (lsof + probe,
 * 5s cache in main).
 */
const LocalServers = ({onPick}: Props) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [servers, setServers] = useState<LocalServerInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.electron.ipcRenderer.invoke<
        Record<string, never>,
        LocalServerInfo[]
      >(IPC_MAIN_CHANNELS.BA_LIST_LOCAL_SERVERS, {});
      setServers(Array.isArray(list) ? list : []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      setServers((previous) => previous ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="contents">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Локальные серверы — что дебажим?"
        aria-label="Список живых localhost-серверов"
        aria-expanded={open}
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[15px] transition-colors hover:bg-white/10"
      >
        <Icon icon="lucide:monitor" />
      </button>
      {open && (
        <div className="absolute top-full right-2 z-50 mt-2 w-96 overflow-hidden rounded-xl border border-line bg-panel shadow-elevated">
          <div className="flex items-center justify-between border-b border-line-soft px-3 py-2">
            <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Локальные серверы
            </p>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              title="Обновить список"
              aria-label="Обновить список"
              className="rounded-md p-1 text-muted hover:bg-white/5 hover:text-fg disabled:opacity-50"
            >
              <Icon
                icon="lucide:rotate-ccw"
                fontSize={13}
                className={loading ? 'animate-spin' : ''}
              />
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {loading && servers === null && (
              <p className="px-3 py-4 text-center text-xs text-muted">Сканирую localhost…</p>
            )}
            {error && !servers && (
              <p className="px-3 py-4 text-center text-xs text-red-400">{error}</p>
            )}
            {!loading && servers?.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted">
                Живых HTTP-серверов на localhost не найдено
              </p>
            )}
            {servers?.map((server) => (
              <button
                key={server.port}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPick(server.url);
                }}
                className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left hover:bg-white/5"
              >
                <span className="w-14 shrink-0 rounded-md bg-black/30 px-1.5 py-0.5 text-center font-mono text-[11px] text-emerald-400">
                  :{server.port}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-fg">
                    {server.title ?? `HTTP сервер на порту ${server.port}`}
                  </span>
                  <span className="block text-[10px] text-muted">{server.process}</span>
                </span>
                <Icon
                  icon="mdi:web"
                  className="shrink-0 text-muted opacity-60 transition-opacity group-hover:opacity-100"
                  fontSize={14}
                />
              </button>
            ))}
          </div>
          <p className="border-t border-line-soft px-3 py-1.5 text-[10px] text-muted">
            Только HTTP, только localhost; ssh/postgres и прочий не-HTTP отфильтрован.
          </p>
        </div>
      )}
    </div>
  );
};

export default LocalServers;
