import type {
  McpAnnotation,
  McpAnnotationsResult,
  McpAppState,
  McpHistoryEntry,
} from '../../common/mcp';

/**
 * Builds the payload for the read-only `get_session_handoff` tool: a Markdown
 * brief for agents plus the raw JSON. Pure and electron-free so it can be
 * unit-tested outside the app.
 */

export interface HandoffInput {
  appState: McpAppState | null;
  annotations: McpAnnotationsResult | null;
  annotationsError?: string;
  history: McpHistoryEntry[] | null;
  historyError?: string;
  /** Injected for deterministic tests; ISO string. */
  now: string;
}

const MAX_NOTES_PER_VIEWPORT = 10;
const MAX_HISTORY = 10;

const oneLine = (value: string | undefined, max = 140): string => {
  if (!value) {
    return '';
  }
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
};

const formatNote = (entry: McpAnnotation): string => {
  const bits = [`${entry.index}. <${entry.tag}>`];
  if (entry.text) {
    bits.push(`"${oneLine(entry.text, 80)}"`);
  }
  if (entry.selector) {
    bits.push(`selector \`${oneLine(entry.selector, 120)}\``);
  }
  if (entry.feedback) {
    bits.push(`— ${oneLine(entry.feedback, 200)}`);
  }
  return bits.join(' ');
};

export const buildHandoff = (input: HandoffInput): {markdown: string; json: unknown} => {
  const {appState, annotations, annotationsError, history, historyError, now} = input;

  const annotationSummary = (() => {
    if (annotations === null) {
      return {
        total: 0,
        viewports: [] as Array<Record<string, unknown>>,
        error: annotationsError ?? 'unavailable',
      };
    }
    const viewports = annotations.viewports.map((viewport) => {
      const notes = viewport.annotations.slice(0, MAX_NOTES_PER_VIEWPORT).map((entry) => ({
        index: entry.index,
        tag: entry.tag,
        text: oneLine(entry.text, 200),
        selector: entry.selector,
        feedback: oneLine(entry.feedback, 300),
      }));
      return {
        deviceName: viewport.deviceName,
        width: viewport.width,
        height: viewport.height,
        url: viewport.url,
        pageTitle: oneLine(viewport.pageTitle, 120),
        count: viewport.annotations.length,
        truncated: viewport.annotations.length > MAX_NOTES_PER_VIEWPORT,
        notes,
      };
    });
    const total = viewports.reduce((sum, v) => sum + v.count, 0);
    return {total, viewports, skipped: annotations.skipped};
  })();

  const historyJson =
    history === null
      ? {error: historyError ?? 'unavailable'}
      : history.slice(0, MAX_HISTORY).map((entry) => ({
          url: entry.url,
          title: oneLine(entry.title, 120),
          lastVisited: entry.lastVisited,
        }));

  const json = {
    generatedAt: now,
    app: appState,
    annotations: annotationSummary,
    history: historyJson,
    hint: 'Read-only. Call get_annotations to consume the pending marks (it clears them), or navigate to continue from the current page.',
  };

  const lines: string[] = [];
  lines.push(`# Pokefix session handoff — ${now}`);
  lines.push('');
  lines.push('## Preview');
  if (appState) {
    lines.push(`- URL: ${appState.url}`);
    lines.push(`- Title: ${oneLine(appState.pageTitle, 160)}`);
    lines.push(
      `- Layout: ${appState.layout} · Zoom: ${Math.round(appState.zoomFactor * 100)}% · Suite: ${appState.activeSuite}`
    );
    const devices = appState.activeDevices
      .map((d) => `${d.name} (${d.width}x${d.height})`)
      .join(', ');
    lines.push(`- Devices: ${devices || 'none'}`);
  } else {
    lines.push('- app state unavailable');
  }
  lines.push('');

  if (annotations === null) {
    lines.push(`## Annotations: unavailable (${annotationsError ?? 'unknown error'})`);
  } else if (annotationSummary.total === 0) {
    lines.push('## Annotations: none pending');
  } else {
    lines.push(`## Annotations: ${annotationSummary.total} pending (not consumed)`);
    annotations.viewports.forEach((viewport) => {
      if (viewport.annotations.length === 0) {
        return;
      }
      lines.push('');
      lines.push(
        `### ${viewport.deviceName} (${viewport.width}x${viewport.height}) — ${viewport.url}`
      );
      viewport.annotations.slice(0, MAX_NOTES_PER_VIEWPORT).forEach((entry) => {
        lines.push(`- ${formatNote(entry)}`);
      });
      if (viewport.annotations.length > MAX_NOTES_PER_VIEWPORT) {
        lines.push(
          `- … and ${viewport.annotations.length - MAX_NOTES_PER_VIEWPORT} more — call get_annotations for the full list (consumes the marks).`
        );
      }
    });
    lines.push('');
    lines.push('Marks are NOT cleared by this call. Call get_annotations to consume them.');
  }

  lines.push('');
  lines.push('## Recent history');
  if (history === null) {
    lines.push(`- unavailable (${historyError ?? 'unknown error'})`);
  } else if (history.length === 0) {
    lines.push('- empty');
  } else {
    history.slice(0, MAX_HISTORY).forEach((entry) => {
      const when = entry.lastVisited
        ? new Date(entry.lastVisited).toISOString().slice(0, 16).replace('T', ' ')
        : '—';
      lines.push(`- ${oneLine(entry.title, 80) || entry.url} — ${entry.url} (${when})`);
    });
  }

  return {markdown: lines.join('\n'), json};
};
