import fs from 'fs';
import os from 'os';
import path from 'path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {AgentEnv, listAgentTools, setToolEntry} from './agent-config';

let homeDir: string;
const env = (): AgentEnv => ({homeDir, platform: 'darwin'});

// Bridge spec: app binary + bundled cli.js (ELECTRON_RUN_AS_NODE).
const bridgeEnv = (): AgentEnv => {
  const bridgePath = path.join(homeDir, 'userData', 'mcp', 'cli.js');
  fs.mkdirSync(path.dirname(bridgePath), {recursive: true});
  fs.writeFileSync(bridgePath, '// bridge');
  return {
    homeDir,
    platform: 'darwin',
    execPath: '/Applications/Pokefix.app/Contents/MacOS/Pokefix',
    bridgePath,
  };
};

const cursorConfig = () => path.join(homeDir, '.cursor', 'mcp.json');
const codexConfig = () => path.join(homeDir, '.codex', 'config.toml');
const vscodeConfig = () =>
  path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');

const write = (file: string, contents: string) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, contents, 'utf-8');
};

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-'));
});

afterEach(() => {
  fs.rmSync(homeDir, {recursive: true, force: true});
});

describe('listAgentTools', () => {
  it('reports tools as not installed when nothing is on disk', () => {
    const tools = listAgentTools(env());
    expect(tools).toHaveLength(11);
    expect(tools.every((t) => !t.installed)).toBe(true);
    expect(tools.every((t) => !t.added)).toBe(true);
  });

  it('detects an installed tool by its config directory', () => {
    fs.mkdirSync(path.join(homeDir, '.cursor'), {recursive: true});
    const cursor = listAgentTools(env()).find((t) => t.id === 'cursor');
    expect(cursor?.installed).toBe(true);
    expect(cursor?.added).toBe(false);
  });
});

describe('setToolEntry (JSON tools)', () => {
  it('adds the server without disturbing existing config', () => {
    write(
      cursorConfig(),
      JSON.stringify({mcpServers: {other: {command: 'foo'}}, somethingElse: 42}, null, 2)
    );

    setToolEntry(env(), 'cursor', true);

    const config = JSON.parse(fs.readFileSync(cursorConfig(), 'utf-8'));
    expect(config.mcpServers.responsively).toEqual({
      command: 'npx',
      args: ['-y', '@responsively/mcp'],
    });
    // Untouched neighbours.
    expect(config.mcpServers.other).toEqual({command: 'foo'});
    expect(config.somethingElse).toBe(42);
  });

  it('creates the file when it does not exist yet', () => {
    setToolEntry(env(), 'cursor', true);
    const config = JSON.parse(fs.readFileSync(cursorConfig(), 'utf-8'));
    expect(config.mcpServers.responsively).toBeDefined();
  });

  it('removes only our entry', () => {
    write(cursorConfig(), JSON.stringify({mcpServers: {other: {command: 'foo'}}}, null, 2));
    setToolEntry(env(), 'cursor', true);
    setToolEntry(env(), 'cursor', false);

    const config = JSON.parse(fs.readFileSync(cursorConfig(), 'utf-8'));
    expect(config.mcpServers.responsively).toBeUndefined();
    expect(config.mcpServers.other).toEqual({command: 'foo'});
  });

  it('refuses to touch a malformed config', () => {
    write(cursorConfig(), '{ this is not json');
    const result = setToolEntry(env(), 'cursor', true);
    expect(result).toHaveProperty('error');
    expect(fs.readFileSync(cursorConfig(), 'utf-8')).toBe('{ this is not json');
  });

  it('uses the servers key for VS Code', () => {
    setToolEntry(env(), 'vscode', true);
    const config = JSON.parse(fs.readFileSync(vscodeConfig(), 'utf-8'));
    expect(config.servers.responsively).toBeDefined();
    expect(config.mcpServers).toBeUndefined();
  });

  it('is idempotent', () => {
    setToolEntry(env(), 'cursor', true);
    setToolEntry(env(), 'cursor', true);
    const config = JSON.parse(fs.readFileSync(cursorConfig(), 'utf-8'));
    expect(Object.keys(config.mcpServers)).toEqual(['responsively']);
  });
});

describe('setToolEntry (Codex TOML)', () => {
  it('appends a section and keeps existing content', () => {
    write(codexConfig(), 'model = "o3"\n\n[mcp_servers.other]\ncommand = "foo"\n');

    setToolEntry(env(), 'codex', true);

    const raw = fs.readFileSync(codexConfig(), 'utf-8');
    expect(raw).toContain('model = "o3"');
    expect(raw).toContain('[mcp_servers.other]');
    expect(raw).toContain('[mcp_servers.responsively]');
    expect(raw).toContain('command = "npx"');
    expect(raw).toContain('args = ["-y", "@responsively/mcp"]');
  });

  it('does not duplicate the section', () => {
    setToolEntry(env(), 'codex', true);
    setToolEntry(env(), 'codex', true);
    const raw = fs.readFileSync(codexConfig(), 'utf-8');
    expect(raw.match(/\[mcp_servers\.responsively\]/g)).toHaveLength(1);
  });

  it('removes only our section', () => {
    write(codexConfig(), 'model = "o3"\n\n[mcp_servers.other]\ncommand = "foo"\n');
    setToolEntry(env(), 'codex', true);
    setToolEntry(env(), 'codex', false);

    const raw = fs.readFileSync(codexConfig(), 'utf-8');
    expect(raw).not.toContain('responsively');
    expect(raw).toContain('model = "o3"');
    expect(raw).toContain('[mcp_servers.other]');
    expect(raw).toContain('command = "foo"');
  });

  it('round-trips through the reported state', () => {
    setToolEntry(env(), 'codex', true);
    expect(listAgentTools(env()).find((t) => t.id === 'codex')?.added).toBe(true);
    setToolEntry(env(), 'codex', false);
    expect(listAgentTools(env()).find((t) => t.id === 'codex')?.added).toBe(false);
  });
});

describe('bridge spec', () => {
  it('writes the app binary + bundled bridge for JSON tools when available', () => {
    setToolEntry(bridgeEnv(), 'cursor', true);
    const config = JSON.parse(fs.readFileSync(cursorConfig(), 'utf-8'));
    expect(config.mcpServers.responsively).toEqual({
      command: '/Applications/Pokefix.app/Contents/MacOS/Pokefix',
      args: [path.join(homeDir, 'userData', 'mcp', 'cli.js')],
      env: {ELECTRON_RUN_AS_NODE: '1'},
    });
  });

  it('writes env into the Codex TOML block when the bridge is used', () => {
    setToolEntry(bridgeEnv(), 'codex', true);
    const raw = fs.readFileSync(codexConfig(), 'utf-8');
    expect(raw).toContain('command = "/Applications/Pokefix.app/Contents/MacOS/Pokefix"');
    expect(raw).toContain('env = { ELECTRON_RUN_AS_NODE = "1" }');
  });
});

describe('setToolEntry (opencode)', () => {
  const opencodeConfig = () => path.join(homeDir, '.config', 'opencode', 'opencode.json');

  it('writes the flat mcp entry with array command', () => {
    write(
      opencodeConfig(),
      JSON.stringify(
        {mcp: {'chrome-devtools': {type: 'local', command: ['npx'], enabled: true}}},
        null,
        2
      )
    );
    setToolEntry(bridgeEnv(), 'opencode', true);
    const config = JSON.parse(fs.readFileSync(opencodeConfig(), 'utf-8'));
    expect(config.mcp['chrome-devtools']).toBeDefined();
    expect(config.mcp.responsively).toEqual({
      type: 'local',
      command: [
        '/Applications/Pokefix.app/Contents/MacOS/Pokefix',
        path.join(homeDir, 'userData', 'mcp', 'cli.js'),
      ],
      enabled: true,
      environment: {ELECTRON_RUN_AS_NODE: '1'},
    });
  });

  it('removes only our entry', () => {
    write(
      opencodeConfig(),
      JSON.stringify({mcp: {'chrome-devtools': {type: 'local', command: ['npx'], enabled: true}}})
    );
    setToolEntry(bridgeEnv(), 'opencode', true);
    setToolEntry(bridgeEnv(), 'opencode', false);
    const config = JSON.parse(fs.readFileSync(opencodeConfig(), 'utf-8'));
    expect(config.mcp.responsively).toBeUndefined();
    expect(config.mcp['chrome-devtools']).toBeDefined();
  });
});

describe('setToolEntry (Hermes yaml)', () => {
  const hermesConfig = () => path.join(homeDir, '.hermes', 'config.yaml');
  const withMcpServers = [
    'model: test',
    'mcp_servers:',
    '  mempalace:',
    '    url: http://example.invalid/mcp',
    '    timeout: 180',
    '',
  ].join('\n');

  it('inserts under an existing mcp_servers key and removes cleanly', () => {
    write(hermesConfig(), withMcpServers);
    setToolEntry(bridgeEnv(), 'hermes', true);
    const added = fs.readFileSync(hermesConfig(), 'utf-8');
    expect(added).toContain('mcp_servers:');
    expect(added).toContain('mempalace:');
    expect(added).toContain('responsively:');
    expect(added).toContain('ELECTRON_RUN_AS_NODE');

    setToolEntry(bridgeEnv(), 'hermes', false);
    const removed = fs.readFileSync(hermesConfig(), 'utf-8');
    expect(removed).not.toContain('responsively');
    expect(removed).toContain('mempalace:');
    expect(removed).toContain('mcp_servers:'); // user's own key survives
  });

  it('creates the mcp_servers section when missing', () => {
    write(hermesConfig(), 'model: test\n');
    setToolEntry(bridgeEnv(), 'hermes', true);
    const added = fs.readFileSync(hermesConfig(), 'utf-8');
    expect(added).toContain('mcp_servers:');
    expect(added).toContain('responsively:');
  });

  it('add is idempotent', () => {
    write(hermesConfig(), withMcpServers);
    setToolEntry(bridgeEnv(), 'hermes', true);
    const once = fs.readFileSync(hermesConfig(), 'utf-8');
    setToolEntry(bridgeEnv(), 'hermes', true);
    expect(fs.readFileSync(hermesConfig(), 'utf-8')).toBe(once);
  });

  it('refuses an inline mcp_servers flow value', () => {
    write(hermesConfig(), 'mcp_servers: {}\n');
    const result = setToolEntry(bridgeEnv(), 'hermes', true);
    expect(result).toHaveProperty('error');
    expect(fs.readFileSync(hermesConfig(), 'utf-8')).toBe('mcp_servers: {}\n');
  });

  it('removing when nothing was added leaves the file untouched', () => {
    write(hermesConfig(), withMcpServers);
    setToolEntry(bridgeEnv(), 'hermes', false);
    expect(fs.readFileSync(hermesConfig(), 'utf-8')).toBe(withMcpServers);
  });
});

describe('setToolEntry (Continue yaml)', () => {
  const continueConfig = () => path.join(homeDir, '.continue', 'config.yaml');

  it('appends a stdio list item under mcpServers', () => {
    write(continueConfig(), 'models:\n  - name: test\n');
    setToolEntry(bridgeEnv(), 'continue', true);
    const raw = fs.readFileSync(continueConfig(), 'utf-8');
    expect(raw).toContain('mcpServers:');
    expect(raw).toContain('- name: responsively');
    expect(raw).toContain('type: stdio');
    expect(raw).toContain('ELECTRON_RUN_AS_NODE');

    setToolEntry(bridgeEnv(), 'continue', false);
    const after = fs.readFileSync(continueConfig(), 'utf-8');
    expect(after).not.toContain('responsively');
    expect(after).not.toContain('mcpServers:'); // our-only key is dropped with our block
    expect(after).toContain('name: test');
  });
});

describe('setToolEntry (review hardening)', () => {
  const hermesConfig = () => path.join(homeDir, '.hermes', 'config.yaml');

  it('refuses a top-level JSON array config', () => {
    write(cursorConfig(), '[]');
    const result = setToolEntry(bridgeEnv(), 'cursor', true);
    expect(result).toHaveProperty('error');
    expect(fs.readFileSync(cursorConfig(), 'utf-8')).toBe('[]');
  });

  it('refuses a non-object serversKey instead of clobbering it', () => {
    write(cursorConfig(), '{"mcpServers": [1, 2, 3]}');
    const result = setToolEntry(bridgeEnv(), 'cursor', true);
    expect(result).toHaveProperty('error');
    expect(fs.readFileSync(cursorConfig(), 'utf-8')).toBe('{"mcpServers": [1, 2, 3]}');
  });

  it('detects a TOML section with a trailing comment', () => {
    write(codexConfig(), '[mcp_servers.responsively] # ours\ncommand = "/bin/echo"\n');
    // already present → adding must be a no-op (no duplicate table)
    setToolEntry(bridgeEnv(), 'codex', true);
    const raw = fs.readFileSync(codexConfig(), 'utf-8');
    expect(raw.match(/\[mcp_servers\.responsively\]/g)).toHaveLength(1);
  });

  it('matches the child indentation of the yaml parent key', () => {
    write(
      hermesConfig(),
      'model: test\nmcp_servers:\n    mempalace:\n      url: http://example.invalid/mcp\n'
    );
    setToolEntry(bridgeEnv(), 'hermes', true);
    const raw = fs.readFileSync(hermesConfig(), 'utf-8');
    expect(raw).toContain('    responsively:\n');
    expect(raw).toContain('      command:');
    // and removal still works
    setToolEntry(bridgeEnv(), 'hermes', false);
    const after = fs.readFileSync(hermesConfig(), 'utf-8');
    expect(after).not.toContain('responsively');
    expect(after).toContain('mempalace:');
  });

  it('keeps CRLF line endings in yaml round-trips', () => {
    const crlf =
      'model: test\r\nmcp_servers:\r\n  mempalace:\r\n    url: http://example.invalid/mcp\r\n';
    write(hermesConfig(), crlf);
    setToolEntry(bridgeEnv(), 'hermes', true);
    const added = fs.readFileSync(hermesConfig(), 'utf-8');
    expect(added).toContain('\r\n');
    expect(added.split('\n').some((l) => !l.endsWith('\r') && l !== '')).toBe(false);
    setToolEntry(bridgeEnv(), 'hermes', false);
    const after = fs.readFileSync(hermesConfig(), 'utf-8');
    expect(after).toContain('mempalace:');
    expect(after.split('\n').some((l) => !l.endsWith('\r') && l !== '')).toBe(false);
  });

  it('refuses yaml with a dangling BEGIN marker', () => {
    write(hermesConfig(), 'model: test\n# >>> pokefix-mcp >>>\n  responsively:\n');
    const result = setToolEntry(bridgeEnv(), 'hermes', true);
    expect(result).toHaveProperty('error');
    expect(fs.readFileSync(hermesConfig(), 'utf-8')).toBe(
      'model: test\n# >>> pokefix-mcp >>>\n  responsively:\n'
    );
  });

  it('writes through a symlinked config instead of replacing the link', () => {
    const real = path.join(homeDir, 'real-cursor.json');
    write(real, '{}');
    fs.mkdirSync(path.dirname(cursorConfig()), {recursive: true});
    fs.symlinkSync(real, cursorConfig());
    setToolEntry(bridgeEnv(), 'cursor', true);
    expect(fs.lstatSync(cursorConfig()).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(real, 'utf-8')).toContain('responsively');
  });
});
