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
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Someone else's malformed config: refuse rather than clobber it.
    return null;
  }
};

/**
 * Write via a temp file + rename so a crash can't truncate someone's config.
 * - unique tmp name (two Pokefix instances can't clobber each other's scratch)
 * - fsync before rename (and best-effort dir fsync after)
 * - writes through symlinks to their target instead of replacing the link
 */
const writeAtomic = (file: string, contents: string): void => {
  let target = file;
  try {
    if (fs.lstatSync(file).isSymbolicLink()) {
      target = fs.realpathSync(file);
    }
  } catch {
    /* doesn't exist yet — fine */
  }
  fs.mkdirSync(path.dirname(target), {recursive: true});
  const tmp = `${target}.pokefix-${process.pid}-${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, contents, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
  try {
    const dirFd = fs.openSync(path.dirname(target), 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    /* dir fsync is best-effort on some filesystems */
  }
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

const eolOf = (raw: string): string => (raw.includes('\r\n') ? '\r\n' : '\n');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const tomlEscape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const TOML_SECTION_RE = (key: string) => new RegExp(`^\\s*\\[${key}\\.${SERVER_KEY}\\](\\s*#.*)?$`);

const tomlHasEntry = (raw: string, serversKey: string): boolean =>
  raw.split(/\r?\n/).some((line) => TOML_SECTION_RE(serversKey).test(line));

const tomlAddEntry = (raw: string, serversKey: string, spec: BridgeSpec): string => {
  for (const key of Object.keys(spec.env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Unsafe env key for TOML output: ${JSON.stringify(key)}`);
    }
  }
  const eol = eolOf(raw);
  const block = [
    `[${serversKey}.${SERVER_KEY}]`,
    `command = "${tomlEscape(spec.command)}"`,
    `args = [${spec.args.map((a) => `"${tomlEscape(a)}"`).join(', ')}]`,
    ...(Object.keys(spec.env).length > 0
      ? [
          `env = { ${Object.entries(spec.env)
            .map(([k, v]) => `${k} = "${tomlEscape(v)}"`)
            .join(', ')} }`,
        ]
      : []),
  ].join(eol);
  const base = raw.trim();
  return base === '' ? `${block}${eol}` : `${base}${eol}${eol}${block}${eol}`;
};

const tomlRemoveEntry = (raw: string, serversKey: string): string => {
  const eol = eolOf(raw);
  const lines = raw.split(eol);
  const start = lines.findIndex((line) => TOML_SECTION_RE(serversKey).test(line));
  if (start === -1) {
    return raw;
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].trim().startsWith('[')) {
    end += 1;
  }
  const kept = [...lines.slice(0, start), ...lines.slice(end)];
  const joined = kept.join(eol).replace(new RegExp(`${eol}{3,}`, 'g'), eol + eol);
  return `${joined.trim()}${eol}`;
};

// --- YAML: Hermes uses a map under `mcp_servers:`, Continue a list under
// `mcpServers:`. Our entries live between marker comments we own, so they can
// be added/removed without re-dumping — and without touching anything else.

// Column-0 markers: matched by substring, so indentation is irrelevant.
const YAML_BEGIN = '# >>> pokefix-mcp >>>';
const YAML_END = '# <<< pokefix-mcp <<<';
const yamlScalar = (value: string): string => JSON.stringify(value);

const yamlBlockLines = (spec: BridgeSpec, asListItem: boolean, indent: number): string[] => {
  const pad = ' '.repeat(indent);
  const pad2 = ' '.repeat(indent + 2);
  const envLines =
    Object.keys(spec.env).length > 0
      ? [
          `${pad2}env:`,
          ...Object.entries(spec.env).map(([k, v]) => `${pad2}  ${k}: ${yamlScalar(v)}`),
        ]
      : [];
  const head = asListItem
    ? [
        `${pad}- name: ${SERVER_KEY}`,
        `${pad2}type: stdio`,
        `${pad2}command: ${yamlScalar(spec.command)}`,
      ]
    : [`${pad}${SERVER_KEY}:`, `${pad2}command: ${yamlScalar(spec.command)}`];
  return [
    ...head,
    `${pad2}args:`,
    ...spec.args.map((a) => `${pad2}  - ${yamlScalar(a)}`),
    ...envLines,
  ];
};

/** Indent of the first child of a top-level key line, or 2 when none exists. */
const detectChildIndent = (lines: string[], keyLineIndex: number): number => {
  for (let i = keyLineIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) return 2; // next top-level key → treat as childless
    return line.match(/^ */)?.[0].length ?? 2;
  }
  return 2;
};

const yamlHasEntry = (raw: string): boolean => raw.includes(YAML_BEGIN);

/**
 * Insert our marked block under `key` (a top-level map or list), or append a
 * new top-level section when missing. Refuses to guess when the key exists
 * with an inline/flow value.
 */
const yamlAdd = (
  raw: string,
  key: string,
  spec: BridgeSpec,
  asListItem: boolean
): string | {error: string} => {
  const eol = eolOf(raw);
  const hasBegin = raw.includes(YAML_BEGIN);
  const hasEnd = raw.includes(YAML_END);
  if (hasBegin && hasEnd) {
    return raw; // already present (idempotent)
  }
  if (hasBegin !== hasEnd) {
    return {
      error:
        'Found a dangling "# >>> pokefix-mcp >>>" marker without its end marker. ' +
        'Remove the stray marker by hand, then retry — refusing to guess.',
    };
  }
  const lines = raw.split(eol);
  const keyRe = new RegExp(`^${key}:[ \\t]*(#.*)?$`);
  const inlineRe = new RegExp(`^${key}:[ \\t]*\\S`);
  const keyIdx = lines.findIndex((line) => keyRe.test(line));
  if (keyIdx !== -1) {
    const indent = detectChildIndent(lines, keyIdx);
    const block = yamlBlockLines(spec, asListItem, indent);
    lines.splice(keyIdx + 1, 0, YAML_BEGIN, ...block, YAML_END);
    return lines.join(eol);
  }
  if (lines.some((line) => inlineRe.test(line))) {
    return {
      error: `${key} is set inline — add the Pokefix entry manually to keep your file intact.`,
    };
  }
  // No such key at all: create it at top level.
  const block = yamlBlockLines(spec, asListItem, 2);
  const marked = [YAML_BEGIN, ...block, YAML_END].join(eol);
  const base = raw.trim();
  return `${base === '' ? '' : `${base}${eol}${eol}`}${key}:${eol}${marked}${eol}`;
};

const yamlRemove = (raw: string, key: string): string => {
  const eol = eolOf(raw);
  const lines = raw.split(eol);
  const beginLine = lines.findIndex((line) => line.includes(YAML_BEGIN));
  if (beginLine === -1) {
    return raw;
  }
  const endLine = lines.findIndex((line, i) => i > beginLine && line.includes(YAML_END));
  if (endLine === -1) {
    return raw; // dangling BEGIN — don't guess; leave the file untouched
  }
  lines.splice(beginLine, endLine - beginLine + 1);
  // If the owning TOP-LEVEL key is now childless, drop it — a bare `key:`
  // parses as null and some loaders choke on it.
  const keyRe = new RegExp(`^${key}:[ \\t]*(#.*)?$`);
  const keyIdx = lines.findIndex((line) => keyRe.test(line));
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
  return lines.join(eol).replace(new RegExp(`${eol}{3,}`, 'g'), eol + eol);
};

const jsonHasEntry = (config: Record<string, unknown>, serversKey: string): boolean => {
  const servers = config[serversKey];
  return isPlainObject(servers) && SERVER_KEY in servers;
};

export const isToolAdded = (tool: AgentTool): boolean => {
  if (!fs.existsSync(tool.configPath)) {
    return false;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(tool.configPath, 'utf-8');
  } catch {
    return false;
  }
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
    try {
      const raw = fs.existsSync(tool.configPath) ? fs.readFileSync(tool.configPath, 'utf-8') : '';
      const next = add
        ? tomlHasEntry(raw, tool.serversKey)
          ? raw
          : tomlAddEntry(raw, tool.serversKey, spec)
        : tomlRemoveEntry(raw, tool.serversKey);
      writeAtomic(tool.configPath, next);
      return stateFor(tool);
    } catch (error) {
      return {error: error instanceof Error ? error.message : String(error)};
    }
  }

  if (tool.format === 'yaml') {
    const raw = fs.existsSync(tool.configPath) ? fs.readFileSync(tool.configPath, 'utf-8') : '';
    if (add) {
      const result = yamlAdd(raw, tool.serversKey, spec, tool.id === 'continue');
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
  const existingKey = config[tool.serversKey];
  if (existingKey !== undefined && !isPlainObject(existingKey)) {
    return {
      error: `${tool.name}'s config has a non-object "${tool.serversKey}" — refusing to overwrite it.`,
    };
  }
  const servers = isPlainObject(existingKey) ? {...existingKey} : {};
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
