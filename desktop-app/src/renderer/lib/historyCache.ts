/**
 * Renderer-side cache for the address history (electron-store is a sync IPC
 * round-trip; reading it per keystroke/navigation blocks the renderer).
 * Writes go through setHistory so the cache stays coherent.
 */

export interface HistoryEntry {
  title: string;
  url: string;
  lastVisited: number;
}

let cache: HistoryEntry[] | null = null;

export const getHistory = (): HistoryEntry[] => {
  if (!cache) {
    try {
      cache = (window.electron.store.get('history') as HistoryEntry[]) ?? [];
      if (!Array.isArray(cache)) {
        cache = [];
      }
    } catch {
      cache = [];
    }
  }
  return cache;
};

export const setHistory = (entries: HistoryEntry[]): void => {
  cache = entries;
  window.electron.store.set('history', entries);
};

export const clearHistory = (): void => {
  cache = [];
  window.electron.store.set('history', []);
};
