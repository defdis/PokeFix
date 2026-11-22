/**
 * Write coalescing for the renderer → main electron-store bridge.
 *
 * The renderer's persistence middleware fires an IPC "set" per dispatched
 * action — e.g. the design-overlay opacity slider emits one per mousemove,
 * each carrying a multi-megabyte base64 image. electron-store serializes the
 * WHOLE config and does an atomic rename per set(), synchronously on the
 * main-process loop. This buffer collapses bursts per key: the latest value
 * wins and a single trailing flush happens 250 ms after the last write.
 *
 * Reads (sendSync) consult the buffer first so the renderer never observes a
 * stale value. Flush on will-quit so nothing is lost.
 */
import store from '../store';
import log from './logging';

const FLUSH_MS = 250;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pending = new Map<string, any>();
let timer: ReturnType<typeof setTimeout> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const readStoreKey = (key: string): any =>
  pending.has(key) ? pending.get(key) : store.get(key);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const bufferStoreWrite = (key: string, value: any): void => {
  pending.set(key, value);
  if (!timer) {
    timer = setTimeout(flushStoreWrites, FLUSH_MS);
    // Never hold the event loop open for a pending flush.
    timer.unref?.();
  }
};

export const flushStoreWrites = (): void => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.size === 0) {
    return;
  }
  const entries = [...pending.entries()];
  pending.clear();
  for (const [key, value] of entries) {
    try {
      store.set(key, value);
    } catch (error) {
      // A schema-invalid value must not take down the main process.
      log.warn('[store-write-buffer] rejected write', key, error);
    }
  }
};
