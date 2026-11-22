/**
 * Minimal ACP (Agent Client Protocol, JSON-RPC 2.0 over stdio) helpers shared
 * between the main process and tests. Deliberately hand-rolled: the protocol
 * surface we use is tiny (initialize / session/new / session/prompt /
 * session/cancel + the session/update notification stream).
 */

export interface AcpRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface AcpResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {code: number; message: string; data?: unknown};
}

export interface AcpNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type AcpInbound = AcpResponse | AcpNotification;

/** Parse one NDJSON line; null when the line isn't a valid ACP message. */
export const parseAcpLine = (line: string): AcpInbound | null => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const msg = value as Record<string, unknown>;
  if (msg.jsonrpc !== '2.0') return null;
  if ('method' in msg && typeof msg.method === 'string') {
    return msg as unknown as AcpNotification;
  }
  return msg as unknown as AcpResponse;
};

// ---- session/update mapping → renderer-friendly events -------------------

export type AcpChatEvent =
  | {type: 'agent-message'; text: string}
  | {type: 'agent-thought'; text: string}
  | {type: 'tool-call'; id: string; title: string; kind: string; status: string}
  | {type: 'tool-update'; id: string; status?: string; text?: string}
  | {type: 'plan'; entries: Array<{content: string; status: string}>}
  | {type: 'usage'; used: number; size: number}
  | {type: 'session-info'; title: string};

const textOf = (content: unknown): string => {
  // Iterative with a depth cap — agent-controlled input, never trust nesting.
  const parts: string[] = [];
  const stack: Array<{value: unknown; depth: number}> = [{value: content, depth: 0}];
  while (stack.length > 0) {
    const {value, depth} = stack.pop()!;
    if (value == null || depth > 16) continue;
    if (typeof value === 'string') {
      parts.push(value);
      continue;
    }
    if (Array.isArray(value)) {
      // preserve order: push reversed
      for (let i = value.length - 1; i >= 0; i -= 1) {
        stack.push({value: value[i], depth: depth + 1});
      }
      continue;
    }
    if (typeof value === 'object') {
      const rec = value as Record<string, unknown>;
      if (typeof rec.text === 'string') {
        parts.push(rec.text);
        continue;
      }
      const inner = rec.type === 'content' ? rec.content : undefined;
      if (inner !== undefined) {
        stack.push({value: inner, depth: depth + 1});
      }
    }
  }
  // Document order is preserved (children are pushed in reverse, then popped).
  return parts.join('');
};

/** Map one ACP session/update payload to UI events (may produce 0-1 events). */
export const mapSessionUpdate = (update: unknown): AcpChatEvent | null => {
  if (typeof update !== 'object' || update === null) return null;
  const u = update as Record<string, unknown>;
  const kind = u.sessionUpdate;
  switch (kind) {
    case 'agent_message_chunk': {
      const text = textOf(u.content);
      return text ? {type: 'agent-message', text} : null;
    }
    case 'agent_thought_chunk': {
      const text = textOf(u.content);
      return text ? {type: 'agent-thought', text} : null;
    }
    case 'tool_call': {
      return {
        type: 'tool-call',
        id: String(u.toolCallId ?? ''),
        title: String(u.title ?? u.kind ?? 'tool'),
        kind: String(u.kind ?? 'other'),
        status: String(u.status ?? 'pending'),
      };
    }
    case 'tool_call_update': {
      const text = textOf(u.content);
      return {
        type: 'tool-update',
        id: String(u.toolCallId ?? ''),
        status: typeof u.status === 'string' ? u.status : undefined,
        text: text || undefined,
      };
    }
    case 'plan': {
      const entries = Array.isArray(u.entries) ? u.entries : [];
      return {
        type: 'plan',
        entries: entries.map((e) => {
          const rec = (e ?? {}) as Record<string, unknown>;
          return {content: String(rec.content ?? ''), status: String(rec.status ?? 'pending')};
        }),
      };
    }
    case 'usage_update': {
      const used = Number(u.used);
      const size = Number(u.size);
      if (Number.isFinite(used) && Number.isFinite(size)) {
        return {type: 'usage', used, size};
      }
      return null;
    }
    case 'session_info_update': {
      return typeof u.title === 'string' ? {type: 'session-info', title: u.title} : null;
    }
    default:
      return null;
  }
};

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

/** Normalize session/request_permission params; null when unusable. */
export const parsePermissionRequest = (
  params: unknown
): {sessionId: string; title: string; options: PermissionOption[]} | null => {
  if (typeof params !== 'object' || params === null) return null;
  const p = params as Record<string, unknown>;
  const toolCall = (p.toolCall ?? {}) as Record<string, unknown>;
  const optionsRaw = Array.isArray(p.options) ? p.options : [];
  const options: PermissionOption[] = optionsRaw
    .map((o) => {
      const rec = (o ?? {}) as Record<string, unknown>;
      return {
        optionId: String(rec.optionId ?? ''),
        name: String(rec.name ?? rec.optionId ?? 'option'),
        kind: String(rec.kind ?? 'allow_once'),
      };
    })
    .filter((o) => o.optionId.length > 0);
  if (options.length === 0) return null;
  return {
    sessionId: String(p.sessionId ?? ''),
    title: String(toolCall.title ?? toolCall.kind ?? 'Agent requests permission'),
    options,
  };
};

/** Build the session/request_permission response for a chosen option. */
export const permissionResponse = (optionId: string | null): unknown => ({
  outcome: optionId === null ? {outcome: 'cancelled'} : {outcome: 'selected', optionId},
});
