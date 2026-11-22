import {describe, it, expect, vi} from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {handle: vi.fn(), on: vi.fn()},
}));

import {listTerminalAgents, TERMINAL_AGENTS} from './agent-terminal';

describe('listTerminalAgents', () => {
  it('reports every whitelisted agent with availability from the resolver', () => {
    const found = new Set(['hermes', 'opencode']);
    const list = listTerminalAgents((binary) => (found.has(binary) ? `/bin/${binary}` : null));
    expect(list).toHaveLength(TERMINAL_AGENTS.length);
    expect(list.find((a) => a.id === 'hermes')?.available).toBe(true);
    expect(list.find((a) => a.id === 'opencode')?.available).toBe(true);
    expect(list.find((a) => a.id === 'codex')?.available).toBe(false);
  });

  it('reports everything unavailable when nothing resolves', () => {
    const list = listTerminalAgents(() => null);
    expect(list.every((a) => !a.available)).toBe(true);
  });
});
