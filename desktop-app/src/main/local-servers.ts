/**
 * Discover dev servers listening on loopback so the toolbar can offer a
 * "what should I debug right now" picker. macOS/Linux only (lsof); other
 * platforms get an empty list rather than a failure.
 *
 * Discovery = lsof (which ports are LISTENING) → HTTP probe per port
 * (only ports that answer HTTP survive; SSH/Postgres/etc. drop out by
 * themselves) → <title> scraped for a human label. Cached briefly.
 */
import {execFile} from 'child_process';
import http from 'http';

export interface LocalServerInfo {
  port: number;
  process: string;
  url: string;
  /** <title> text when present, else null (the server answered but had none). */
  title: string | null;
}

/** Ports that are never useful debug targets for this app. */
const EXCLUDED_PORTS = new Set([12719, 12720]); // Pokefix's own listeners (app bridge, MCP)
const PROBE_TIMEOUT_MS = 800;
const MAX_SERVERS = 20;

export const parseLsofOutput = (output: string): Array<{port: number; process: string}> => {
  const byPort = new Map<number, string>();
  for (const line of output.split('\n')) {
    if (!line.includes('(LISTEN)')) continue;
    // "node      1234 user   22u  IPv4 0x...  TCP *:3000 (LISTEN)"
    // "rapportd   567 user   9u   IPv6 0x...  TCP [::1]:49200 (LISTEN)"
    const match = line.match(/:(\d+)\s+\(LISTEN\)/);
    if (!match) continue;
    const port = Number(match[1]);
    if (!Number.isFinite(port) || port < 1024 || EXCLUDED_PORTS.has(port)) continue;
    if (byPort.has(port)) continue;
    const process = line.trim().split(/\s+/)[0] ?? 'unknown';
    byPort.set(port, process);
  }
  return [...byPort.entries()]
    .map(([port, process]) => ({port, process}))
    .sort((a, b) => a.port - b.port);
};

export const extractTitle = (html: string): string | null => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const text = match[1].replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, 120) : null;
};

const probeHttp = (port: number): Promise<string | null | undefined> =>
  // undefined = not HTTP (or refused); null = HTTP 200-ish without <title>; string = title
  new Promise((resolve) => {
    let buf = '';
    let done = false;
    const finish = (value: string | null | undefined) => {
      if (!done) {
        done = true;
        resolve(value);
      }
    };
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        timeout: PROBE_TIMEOUT_MS,
        headers: {'User-Agent': 'Pokefix-local-server-probe', Accept: 'text/html'},
      },
      (res) => {
        // Redirects still mean "an HTTP server lives here"; follow one hop via
        // the Location's origin would complicate — treat any HTTP answer as alive.
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          if (buf.length > 64 * 1024) {
            req.destroy();
          }
        });
        res.on('end', () => finish(extractTitle(buf)));
        res.on('error', () => finish(undefined));
        res.on('close', () => finish(extractTitle(buf)));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      finish(undefined);
    });
    req.on('error', () => finish(undefined));
  });

const LIST_CACHE_MS = 5000;
const PROBE_CONCURRENCY = 8;
let cache: {at: number; servers: LocalServerInfo[]} | null = null;
let pendingList: Promise<LocalServerInfo[]> | null = null;

export const listLocalServers = (): Promise<LocalServerInfo[]> => {
  if (cache && Date.now() - cache.at < LIST_CACHE_MS) {
    return Promise.resolve(cache.servers);
  }
  // De-dupe concurrent invocations — a click-happy user must not spawn N lsof
  // processes and N×ports probes in parallel.
  if (pendingList) {
    return pendingList;
  }
  pendingList = scanLocalServers().finally(() => {
    pendingList = null;
  });
  return pendingList;
};

const scanLocalServers = async (): Promise<LocalServerInfo[]> => {
  const candidates = await new Promise<Array<{port: number; process: string}>>((resolve) => {
    execFile(
      'lsof',
      ['-nP', '-iTCP', '-sTCP:LISTEN'],
      {timeout: 3000, maxBuffer: 4 * 1024 * 1024},
      (error, stdout) => {
        // lsof exits non-zero when nothing matches; stdout still has what it found.
        if (error && !stdout) {
          resolve([]);
          return;
        }
        resolve(parseLsofOutput(stdout ?? ''));
      }
    );
  });
  const slice = candidates.slice(0, MAX_SERVERS);
  // Probe in small batches so a box with many listeners doesn't fan out
  // 20 simultaneous connections.
  const probed: Array<LocalServerInfo | null> = [];
  for (let i = 0; i < slice.length; i += PROBE_CONCURRENCY) {
    const batch = await Promise.all(
      slice.slice(i, i + PROBE_CONCURRENCY).map(async ({port, process}) => {
        const title = await probeHttp(port);
        if (title === undefined) {
          return null; // not HTTP — not a debug target
        }
        return {port, process, url: `http://localhost:${port}/`, title};
      })
    );
    probed.push(...batch);
  }
  const result = probed.filter((s): s is LocalServerInfo => s !== null);
  cache = {at: Date.now(), servers: result};
  return result;
};
