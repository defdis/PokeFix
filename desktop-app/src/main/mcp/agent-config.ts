import fs from 'fs';
import path from 'path';

/**
 * Writes the Pokefix MCP server into the config files of AI coding
 * tools. These files belong to other applications, so every write reads the
 * existing content, changes only our own entry, and saves atomically — an
 * unparseable or unexpected file is left alone rather than overwritten.
 */

export const SERVER_KEY = 'responsively';
export const SERVER_COMMAND = 'npx';
export const SERVER_ARGS = ['-y', '@responsively/mcp'];

export type ConfigFormat = 'json' | 'toml' | 'yaml';

/**
 * Hermes config.yaml block appended by the hermes-webhook "tool". YAML text is
 * appended (not re-dumped) so user comments elsewhere in the file survive.
 */
const HERMES_HOOK_BLOCK = [
  'platforms:',
  '  webhook:',
  '    enabled: true',
  '    extra:',
  '      host: "127.0.0.1"',
  '      port: 8644',
  '      secret: "INSECURE_NO_AUTH"',
  '      routes:',
  '        responsively:',
  '          secret: "INSECURE_NO_AUTH"',
  '          events: "annotations"',
  '          deliver: "log"',
  '          prompt: "Пользователь прислал замечания по UI из Pokefix. payload.markdown и payload.items содержат метки. Забери их и обработай: исправь код и ответь, что сделал."',
].join('\n');

/**
 * Marker for our webhook route. The route key sits at a fixed indent (8
 * spaces) inside the `routes:` map; matching the bare word would also match
 * unrelated keys/comments that happen to contain 'responsively:'.
 */
const HOOK_ROUTE_MARKER_REGEX = /^ {8}responsively:\s*$/m;

const hermesConfigState = (raw: string): 'absent' | 'configured' | 'conflict' => {
  if (HOOK_ROUTE_MARKER_REGEX.test(raw)) {
    return 'configured';
  }
  // A root-level 'platforms:' key already exists (possibly for other platforms).
  // Appending ours again would create a duplicate key, so we refuse to guess.
  return /^platforms:\s*$/m.test(raw) ? 'conflict' : 'absent';
};

export interface AgentTool {
  id: string;
  name: string;
  icon: string;
  color: string;
  format: ConfigFormat;
  /** Property that holds the server map. VS Code calls it `servers`. */
  serversKey: string;
  /** Config file, or null when the tool has no known location here. */
  configPath: string | null;
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
  const claudeDir = appSupportDir(env, 'Claude');
  const vsCodeUserDir = path.join(appSupportDir(env, 'Code'), 'User');

  return [
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      icon: 'lucide:message-square',
      color: '#d97757',
      format: 'json',
      serversKey: 'mcpServers',
      configPath: path.join(claudeDir, 'claude_desktop_config.json'),
      markerPath: claudeDir,
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      icon: 'lucide:square-terminal',
      color: '#b85c3e',
      format: 'json',
      serversKey: 'mcpServers',
      configPath: path.join(env.homeDir, '.claude.json'),
      markerPath: path.join(env.homeDir, '.claude'),
    },
    {
      id: 'codex',
      name: 'Codex',
      icon: 'lucide:terminal',
      color: '#10a37f',
      format: 'toml',
      serversKey: 'mcp_servers',
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
      configPath: path.join(vsCodeUserDir, 'mcp.json'),
      markerPath: vsCodeUserDir,
    },
    {
      id: 'hermes-webhook',
      name: 'Hermes Agent',
      icon: 'emoji:🧠',
      color: '#FFD84D',
      format: 'yaml',
      serversKey: 'responsively',
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

const TOML_SECTION = (key: string) => `[${key}.${SERVER_KEY}]`;

const tomlHasEntry = (raw: string, serversKey: string): boolean =>
  raw.split('\n').some((line) => line.trim() === TOML_SECTION(serversKey));

const tomlAddEntry = (raw: string, serversKey: string): string => {
  const block = [
    TOML_SECTION(serversKey),
    `command = "${SERVER_COMMAND}"`,
    `args = [${SERVER_ARGS.map((a) => `"${a}"`).join(', ')}]`,
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

const jsonHasEntry = (config: Record<string, unknown>, serversKey: string): boolean => {
  const servers = config[serversKey];
  return typeof servers === 'object' && servers !== null && SERVER_KEY in servers;
};

export const isToolAdded = (tool: AgentTool): boolean => {
  if (tool.configPath === null || !fs.existsSync(tool.configPath)) {
    return false;
  }
  if (tool.format === 'toml') {
    return tomlHasEntry(fs.readFileSync(tool.configPath, 'utf-8'), tool.serversKey);
  }
  if (tool.format === 'yaml') {
    return HOOK_ROUTE_MARKER_REGEX.test(fs.readFileSync(tool.configPath, 'utf-8'));
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

export const setToolEntry = (
  env: AgentEnv,
  toolId: string,
  add: boolean
): AgentToolState | {error: string} => {
  const tool = getAgentTools(env).find((t) => t.id === toolId);
  if (tool === undefined || tool.configPath === null) {
    return {error: `Unknown tool: ${toolId}`};
  }

  if (tool.format === 'yaml') {
    // Hermes config.yaml — comments belong to the user, so we append/strip text
    // instead of re-dumping the parsed tree.
    const raw = fs.existsSync(tool.configPath) ? fs.readFileSync(tool.configPath, 'utf-8') : '';
    const state = hermesConfigState(raw);
    if (add) {
      if (state === 'configured') {
        return {
          id: tool.id,
          name: tool.name,
          icon: tool.icon,
          color: tool.color,
          configPath: tool.configPath,
          installed: true,
          added: true,
        };
      }
      if (state === 'conflict') {
        return {
          error: `${tool.name}'s config already has a root 'platforms:' key — add the webhook block manually to avoid a duplicate key.`,
        };
      }
      writeAtomic(tool.configPath, `${raw.trimEnd()}\n\n${HERMES_HOOK_BLOCK}\n`);
    } else {
      if (state !== 'configured') {
        return {
          id: tool.id,
          name: tool.name,
          icon: tool.icon,
          color: tool.color,
          configPath: tool.configPath,
          installed: true,
          added: false,
        };
      }
      // Remove only the route we added; leave the rest of the file untouched.
      const lines = raw.split('\n');
      const isOursBlock = raw.includes(HERMES_HOOK_BLOCK);
      const routeStart = lines.findIndex((line) => line.trim() === 'responsively:');
      if (routeStart !== -1) {
        let end = routeStart + 1;
        while (end < lines.length && lines[end].startsWith('          ')) {
          end += 1;
        }
        let kept = [...lines.slice(0, routeStart), ...lines.slice(end)];
        // If the whole scaffold was ours (block matched byte-for-byte), drop it too.
        if (isOursBlock) {
          const scaffoldStart = lines.findIndex((line) => line.trim() === 'platforms:');
          let scaffoldEnd = scaffoldStart + 1;
          while (scaffoldEnd < lines.length && lines[scaffoldEnd].startsWith('  ')) {
            scaffoldEnd += 1;
          }
          kept = [...lines.slice(0, scaffoldStart), ...lines.slice(scaffoldEnd)];
        }
        writeAtomic(
          tool.configPath,
          `${kept
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trimEnd()}\n`
        );
      }
    }

    return {
      id: tool.id,
      name: tool.name,
      icon: tool.icon,
      color: tool.color,
      configPath: tool.configPath,
      installed: true,
      added: isToolAdded(tool),
    };
  }

  if (tool.format === 'toml') {
    const raw = fs.existsSync(tool.configPath) ? fs.readFileSync(tool.configPath, 'utf-8') : '';
    const next = add
      ? tomlHasEntry(raw, tool.serversKey)
        ? raw
        : tomlAddEntry(raw, tool.serversKey)
      : tomlRemoveEntry(raw, tool.serversKey);
    writeAtomic(tool.configPath, next);
  } else {
    const config = readJson(tool.configPath);
    if (config === null) {
      return {error: `${tool.name}'s config file isn't valid JSON — left untouched.`};
    }
    const servers =
      typeof config[tool.serversKey] === 'object' && config[tool.serversKey] !== null
        ? {...(config[tool.serversKey] as Record<string, unknown>)}
        : {};
    if (add) {
      servers[SERVER_KEY] = {command: SERVER_COMMAND, args: SERVER_ARGS};
    } else {
      delete servers[SERVER_KEY];
    }
    writeAtomic(
      tool.configPath,
      `${JSON.stringify({...config, [tool.serversKey]: servers}, null, 2)}\n`
    );
  }

  return {
    id: tool.id,
    name: tool.name,
    icon: tool.icon,
    color: tool.color,
    configPath: tool.configPath,
    installed: true,
    added: isToolAdded(tool),
  };
};
