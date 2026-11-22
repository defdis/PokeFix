import fs from 'fs';
import path from 'path';

/**
 * Writes the Pokefix MCP server into the config files of AI coding tools.
 * These files belong to other applications, so every write reads the
 * existing content, changes only our own entry, and saves atomically — an
 * unparseable or unexpected file is left alone rather than overwritten.
 *
 * The stdio bridge ships inside the app (resources/mcp/cli.js) and is copied
 * into userData on every startup (see mcp/beacon.ts), so agent configs can
 * reference a stable absolute path: <execPath> as a Node runtime (via
 * ELECTRON_RUN_AS_NODE) + <userData>/mcp/cli.js. No npm, no network, no
 * separate bootstrap package required.
 */

export const SERVER_KEY = 'responsively';

export interface BridgeSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** The bridge spec written into agent configs (with a dev-machine fallback). */
export const bridgeSpec = (env: AgentEnv): BridgeSpec => {
  if (env.execPath && env.bridgePath && fs.existsSync(env.bridgePath)) {
    return {
      command: env.execPath,
      args: [env.bridgePath],
      env: {ELECTRON_RUN_AS_NODE: '1'},
    };
  }
  // Dev builds (and the pre-bridge fallback): use the npm bootstrap.
  return {command: 'npx', args: ['-y', '@responsively/mcp'], env: {}};
};

export type ConfigFormat = 'json' | 'toml' | 'yaml';

export type EntryKind =
  | 'standard' // {command, args, env?} under the servers map
  | 'opencode'; // opencode's own shape: [command, ...args] array + environment

export interface AgentTool {
  id: string;
  name: string;
  icon: string;
  color: string;
  format: ConfigFormat;
  /** Property that holds the server map (VS Code uses `servers`, opencode `mcp`). */
  serversKey: string;
  /** JSON entry shape (json format only). */
  entry: EntryKind;
  configPath: string;
  /** Directory whose presence means the tool is installed. */
  markerPath: string | null;
}

export interface AgentToolState {
  id: string;
  name: string;
  icon: string;
  color: string;
  installed: boolean;
  added: boolean;
  configPath: string | null;
  error?: string;
}

export interface AgentEnv {
  homeDir: string;
  platform: NodeJS.Platform;
  /** %APPDATA% on Windows. */
  appData?: string;
  /** Absolute path of the app's executable (used as the Node runtime). */
  execPath?: string;
  /** Stable path of the bundled MCP bridge (userData/mcp/cli.js). */
  bridgePath?: string;
}

const appSupportDir = (env: AgentEnv, name: string): string => {
  if (env.platform === 'darwin') {
    return path.join(env.homeDir, 'Library', 'Application Support', name);
  }
  if (env.platform === 'win32') {
    return path.join(env.appData ?? path.join(env.homeDir, 'AppData', 'Roaming'), name);
  }
  return path.join(env.homeDir, '.config', name);
};

export const getAgentTools = (env: AgentEnv): AgentTool[] => {
  const vsCodeUserDir = path.join(appSupportDir(env, 'Code'), 'User');

  return [
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      icon: 'lucide:message-square',
      color: '#d97757',
      format: 'json',
      serversKey: 'mcpServers',
      entry: 'standard',
      configPath: path.join(appSupportDir(env, 'Claude'), 'claude_desktop_config.json'),
      markerPath: appSupportDir(env, 'Claude'),
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      icon: 'lucide:square-terminal',
      color: '#b85c3e',
      format: 'json',
      serversKey: 'mcpServers',
      entry: 'standard',
      configPath: path.join(env.homeDir, '.claude.json'),
      markerPath: path.join(env.homeDir, '.claude'),
    },
    {
      id: 'codex',
      name: 'Codex',
      icon: 'lucide:cpu',
      color: '#10a37f',
      format: 'toml',
      serversKey: 'mcp_servers',
      entry: 'standard',
      configPath: path.join(env.homeDir, '.codex', 'config.toml'),
      markerPath: path.join(env.homeDir, '.codex'),
    },
    {
      id: 'cursor',
      name: 'Cursor',
      icon: 'lucide:mouse-pointer-2',
      color: '#4f46e5',
      format: 'json',
      serversKey: 'mcpServers',
      entry: 'standard',
      configPath: path.join(env.homeDir, '.cursor', 'mcp.json'),
      markerPath: path.join(env.homeDir, '.cursor'),
    },
    {
      id: 'vscode',
      name: 'VS Code',
      icon: 'lucide:code',
      color: '#007acc',
      format: 'json',
      serversKey: 'servers',
      entry: 'standard',
      configPath: path.join(vsCodeUserDir, 'mcp.json'),
      markerPath: vsCodeUserDir,
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      icon: 'lucide:wind',
      color: '#00c2a8',
      format: 'json',
      serversKey: 'mcpServers',
      entry: 'standard',
      configPath: path.join(env.homeDir, '.codeium', 'windsurf', 'mcp_config.json'),
      markerPath: path.join(env.homeDir, '.codeium'),
    },
    {
      id: 'cline',
      name: 'Cline',
      icon: 'lucide:bot',
      color: '#a259ff',
      format: 'json',
      serversKey: 'mcpServers',
      entry: 'standard',
      configPath: path.join(
        vsCodeUserDir,
        'globalStorage',
        'saoudrizwan.claude-dev',
        'settings',
        'cline_mcp_settings.json'
      ),
      markerPath: path.join(vsCodeUserDir, 'globalStorage', 'saoudrizwan.claude-dev'),
    },
    {
      id: 'gemini-cli',
      name: 'Gemini CLI',
      icon: 'lucide:sparkles',
      color: '#4285f4',
      format: 'json',
      serversKey: 'mcpServers',
      entry: 'standard',
      configPath: path.join(env.homeDir, '.gemini', 'settings.json'),
      markerPath: path.join(env.homeDir, '.gemini'),
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      icon: 'lucide:terminal',
      color: '#334155',
      format: 'json',
      serversKey: 'mcp',
      entry: 'opencode',
      configPath: path.join(env.homeDir, '.config', 'opencode', 'opencode.json'),
      markerPath: path.join(env.homeDir, '.config', 'opencode'),
    },
    {
      id: 'continue',
      name: 'Continue',
      icon: 'lucide:play',
      color: '#9333ea',
      format: 'yaml',
      serversKey: 'mcpServers',
      entry: 'standard',
      configPath: path.join(env.homeDir, '.continue', 'config.yaml'),
      markerPath: path.join(env.homeDir, '.continue'),
    },
    {
      id: 'hermes',
      name: 'Hermes Agent',
      icon: 'emoji:🧠',
      color: '#FFD84D',
      format: 'yaml',
      serversKey: 'mcp_servers',
      entry: 'standard',
      configPath: path.join(env.homeDir, '.hermes', 'config.yaml'),
      markerPath: path.join(env.homeDir, '.hermes'),
    },
  ];
};

const exists = (target: string | null): boolean => target !== null && fs.existsSync(target);

const readJson = (file: string): Record<string, unknown> | null => {
  if (!fs.existsSync(file)) {
    return {};
  }
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (raw === '') {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Someone else's malformed config: refuse rather than clobber it.
    return null;
  }
};

/** Write via a temp file so a crash can't truncate someone's config. */
const writeAtomic = (file: string, contents: string): void => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = `${file}.pokefix.tmp`;
  fs.writeFileSync(tmp, contents, 'utf-8');
  fs.renameSync(tmp, file);
};

const standardJsonEntry = (spec: BridgeSpec): Record<string, unknown> => ({
  command: spec.command,
  args: spec.args,
  ...(Object.keys(spec.env).length > 0 ? {env: spec.env} : {}),
});

const opencodeEntry = (spec: BridgeSpec): Record<string, unknown> => ({
  type: 'local',
  command: [spec.command, ...spec.args],
  enabled: true,
  ...(Object.keys(spec.env).length > 0 ? {environment: spec.env} : {}),
});

const tomlEscape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const TOML_SECTION = (key: string) => `[${key}.${SERVER_KEY}]`;

const tomlHasEntry = (raw: string, serversKey: string): boolean =>
  raw.split('\n').some((line) => line.trim() === TOML_SECTION(serversKey));

const tomlAddEntry = (raw: string, serversKey: string, spec: BridgeSpec): string => {
  const block = [
    TOML_SECTION(serversKey),
    `command = "${tomlEscape(spec.command)}"`,
    `args = [${spec.args.map((a) => `"${tomlEscape(a)}"`).join(', ')}]`,
    ...(Object.keys(spec.env).length > 0
      ? [
          `env = { ${Object.entries(spec.env)
            .map(([k, v]) => `${k} = "${tomlEscape(v)}"`)
            .join(', ')} }`,
        ]
      : []),
  ].join('\n');
  const base = raw.trim();
  return base === '' ? `${block}\n` : `${base}\n\n${block}\n`;
};

const tomlRemoveEntry = (raw: string, serversKey: string): string => {
  const lines = raw.split('\n');
  const start = lines.findIndex((line) => line.trim() === TOML_SECTION(serversKey));
  if (start === -1) {
    return raw;
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].trim().startsWith('[')) {
    end += 1;
  }
  const kept = [...lines.slice(0, start), ...lines.slice(end)];
  return `${kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
};

// --- YAML: Hermes uses a map under `mcp_servers:`, Continue a list under
// `mcpServers:`. Our entries live between marker comments we own, so they can
// be added/removed without re-dumping — and without touching anything else.

const YAML_BEGIN = '  # >>> pokefix-mcp >>>';
const YAML_END = '  # <<< pokefix-mcp <<<';
const yamlScalar = (value: string): string => JSON.stringify(value);

const yamlBlockLines = (spec: BridgeSpec, asListItem: boolean): string[] => {
  const envLines =
    Object.keys(spec.env).length > 0
      ? ['    env:', ...Object.entries(spec.env).map(([k, v]) => `      ${k}: ${yamlScalar(v)}`)]
      : [];
  const head = asListItem
    ? [`  - name: ${SERVER_KEY}`, '    type: stdio', `    command: ${yamlScalar(spec.command)}`]
    : [`  ${SERVER_KEY}:`, `    command: ${yamlScalar(spec.command)}`];
  return [...head, '    args:', ...spec.args.map((a) => `      - ${yamlScalar(a)}`), ...envLines];
};

const yamlHasEntry = (raw: string): boolean => raw.includes(YAML_BEGIN);

/**
 * Insert our marked block under `key` (a top-level map or list), or append a
 * new top-level section when missing. Refuses to guess when the key exists
 * with an inline/flow value.
 */
const yamlAdd = (raw: string, key: string, block: string[]): string | {error: string} => {
  if (raw.includes(YAML_BEGIN)) {
    return raw; // already present (idempotent)
  }
  const marked = [YAML_BEGIN, ...block, YAML_END].join('\n');
  const keyRe = new RegExp(`^${key}:[ \\t]*$`, 'm');
  const inlineRe = new RegExp(`^${key}:[ \\t]*\\S`, 'm');
  const match = raw.match(keyRe);
  if (match && match.index !== undefined) {
    const insertAt = match.index + match[0].length;
    return `${raw.slice(0, insertAt)}\n${marked}\n${raw.slice(insertAt)}`;
  }
  if (inlineRe.test(raw)) {
    return {
      error: `${key} is set inline — add the Pokefix entry manually to keep your file intact.`,
    };
  }
  const base = raw.trimEnd();
  return `${base === '' ? '' : `${base}\n\n`}${key}:\n${marked}\n`;
};

const yamlRemove = (raw: string, key: string): string => {
  const begin = raw.indexOf(YAML_BEGIN);
  if (begin === -1) {
    return raw;
  }
  const endIdx = raw.indexOf(YAML_END, begin);
  if (endIdx === -1) {
    return raw;
  }
  const end = endIdx + YAML_END.length;
  const lineStart = raw.lastIndexOf('\n', begin) + 1;
  let lineEnd = raw.indexOf('\n', end);
  lineEnd = lineEnd === -1 ? raw.length : lineEnd + 1;
  const out = raw.slice(0, lineStart) + raw.slice(lineEnd);
  // If the owning top-level key is now childless, drop it — a bare `key:`
  // parses as null and some loaders choke on it.
  const lines = out.split('\n');
  const keyIdx = lines.findIndex((line) => line.trim() === `${key}:`);
  if (keyIdx !== -1) {
    let i = keyIdx + 1;
    let hasChild = false;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') {
        i += 1;
        continue;
      }
      hasChild = /^\s/.test(line);
      break;
    }
    if (!hasChild) {
      lines.splice(keyIdx, 1);
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
};

const jsonHasEntry = (config: Record<string, unknown>, serversKey: string): boolean => {
  const servers = config[serversKey];
  return typeof servers === 'object' && servers !== null && SERVER_KEY in servers;
};

export const isToolAdded = (tool: AgentTool): boolean => {
  if (!fs.existsSync(tool.configPath)) {
    return false;
  }
  const raw = fs.readFileSync(tool.configPath, 'utf-8');
  if (tool.format === 'toml') {
    return tomlHasEntry(raw, tool.serversKey);
  }
  if (tool.format === 'yaml') {
    return yamlHasEntry(raw);
  }
  const config = readJson(tool.configPath);
  return config !== null && jsonHasEntry(config, tool.serversKey);
};

export const listAgentTools = (env: AgentEnv): AgentToolState[] =>
  getAgentTools(env).map((tool) => ({
    id: tool.id,
    name: tool.name,
    icon: tool.icon,
    color: tool.color,
    configPath: tool.configPath,
    installed: exists(tool.markerPath) || exists(tool.configPath),
    added: isToolAdded(tool),
  }));

interface SetToolResult {
  id: string;
  name: string;
  icon: string;
  color: string;
  configPath: string | null;
  installed: boolean;
  added: boolean;
}

const stateFor = (tool: AgentTool): SetToolResult => ({
  id: tool.id,
  name: tool.name,
  icon: tool.icon,
  color: tool.color,
  configPath: tool.configPath,
  installed: exists(tool.markerPath) || exists(tool.configPath),
  added: isToolAdded(tool),
});

export const setToolEntry = (
  env: AgentEnv,
  toolId: string,
  add: boolean
): SetToolResult | {error: string} => {
  const tool = getAgentTools(env).find((t) => t.id === toolId);
  if (tool === undefined) {
    return {error: `Unknown tool: ${toolId}`};
  }

  const spec = bridgeSpec(env);

  if (tool.format === 'toml') {
    const raw = fs.existsSync(tool.configPath) ? fs.readFileSync(tool.configPath, 'utf-8') : '';
    const next = add
      ? tomlHasEntry(raw, tool.serversKey)
        ? raw
        : tomlAddEntry(raw, tool.serversKey, spec)
      : tomlRemoveEntry(raw, tool.serversKey);
    writeAtomic(tool.configPath, next);
    return stateFor(tool);
  }

  if (tool.format === 'yaml') {
    const raw = fs.existsSync(tool.configPath) ? fs.readFileSync(tool.configPath, 'utf-8') : '';
    if (add) {
      const result = yamlAdd(raw, tool.serversKey, yamlBlockLines(spec, tool.id === 'continue'));
      if (typeof result !== 'string') {
        return {error: result.error};
      }
      writeAtomic(tool.configPath, result);
    } else {
      writeAtomic(tool.configPath, yamlRemove(raw, tool.serversKey));
    }
    return stateFor(tool);
  }

  // JSON family
  const config = readJson(tool.configPath);
  if (config === null) {
    return {error: `${tool.name}'s config file isn't valid JSON — left untouched.`};
  }
  const servers =
    typeof config[tool.serversKey] === 'object' && config[tool.serversKey] !== null
      ? {...(config[tool.serversKey] as Record<string, unknown>)}
      : {};
  if (add) {
    servers[SERVER_KEY] = tool.entry === 'opencode' ? opencodeEntry(spec) : standardJsonEntry(spec);
  } else {
    delete servers[SERVER_KEY];
  }
  writeAtomic(
    tool.configPath,
    `${JSON.stringify({...config, [tool.serversKey]: servers}, null, 2)}\n`
  );
  return stateFor(tool);
};
