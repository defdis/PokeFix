import {describe, expect, it} from 'vitest';
import {extractTitle, parseLsofOutput} from './local-servers';

const LSOF_SAMPLE = `
COMMAND     PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node      12345 defdis   22u  IPv6 0x1abc      0t0  TCP *:3000 (LISTEN)
node      12345 defdis   23u  IPv4 0x1abd      0t0  TCP 127.0.0.1:3000 (LISTEN)
Google Chrome Helper 12346 defdis   44u  IPv4 0x1abe      0t0  TCP 127.0.0.1:9222 (LISTEN)
rapportd    555 defdis    9u  IPv6 0x1abf      0t0  TCP [::1]:49152 (LISTEN)
postgres   777 defdis    5u  IPv4 0x1ac0      0t0  TCP 127.0.0.1:5432 (LISTEN)
Electron    888 defdis   30u  IPv4 0x1ac1      0t0  TCP *:80 (LISTEN)
dovecot     999 defdis    7u  IPv4 0x1ac2      0t0  TCP *:12720 (LISTEN)
`;

describe('parseLsofOutput', () => {
  it('extracts unique ports >= 1024, excluding the Pokefix MCP port', () => {
    const result = parseLsofOutput(LSOF_SAMPLE);
    const ports = result.map((r) => r.port);
    expect(ports).toEqual([3000, 5432, 9222, 49152]);
    expect(ports).not.toContain(80); // privileged
    expect(ports).not.toContain(12720); // Pokefix MCP
  });

  it('keeps the process name and sorts by port', () => {
    const result = parseLsofOutput(LSOF_SAMPLE);
    expect(result.find((r) => r.port === 3000)?.process).toBe('node');
    expect(result[0].port).toBeLessThanOrEqual(result[result.length - 1].port);
  });

  it('returns an empty list for empty/garbage output', () => {
    expect(parseLsofOutput('')).toEqual([]);
    expect(parseLsofOutput('garbage\nwithout markers\n')).toEqual([]);
  });
});

describe('extractTitle', () => {
  it('pulls and normalizes the title', () => {
    expect(extractTitle('<html><head><title>  My\n  Dev Server </title></head>')).toBe(
      'My Dev Server'
    );
  });

  it('returns null without a title', () => {
    expect(extractTitle('<html><body>hi</body></html>')).toBeNull();
    expect(extractTitle('')).toBeNull();
  });

  it('ignores attributes on the title tag and caps length', () => {
    const long = 'x'.repeat(500);
    expect(extractTitle(`<title lang="en">${long}</title>`)).toHaveLength(120);
  });
});
