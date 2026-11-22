import {describe, expect, it} from 'vitest';
import type {McpAnnotationsResult, McpAppState, McpHistoryEntry} from '../../common/mcp';
import {buildHandoff} from './handoff';

const appState: McpAppState = {
  url: 'http://localhost:8001/shares',
  pageTitle: 'YARDELFIN — Поделиться',
  layout: 'FLEX' as McpAppState['layout'],
  zoomFactor: 1,
  activeSuite: 'default',
  activeDevices: [
    {id: 'iphone', name: 'iPhone 15', width: 393, height: 852, type: 'mobile'},
    {id: 'desktop', name: 'MacBook', width: 1440, height: 900, type: 'desktop'},
  ],
};

const annotations: McpAnnotationsResult = {
  viewports: [
    {
      deviceName: 'iPhone 15',
      width: 393,
      height: 852,
      url: 'http://localhost:8001/shares',
      pageTitle: 'YARDELFIN',
      formatted: 'unused',
      annotations: [
        {
          index: 1,
          tag: 'img',
          text: 'carousel',
          selector: 'ol.carousel__track > li:nth-of-type(8) img',
          feedback: 'отцентрируй по середине',
        },
      ],
    },
  ],
  skipped: [],
};

const history: McpHistoryEntry[] = [
  {url: 'http://localhost:8001/shares', title: 'YARDELFIN', lastVisited: 1_700_000_000_000},
];

const now = '2026-11-22T12:00:00.000Z';

describe('buildHandoff', () => {
  it('marks the handoff with pending annotation count and details', () => {
    const {markdown, json} = buildHandoff({appState, annotations, history, now});
    expect(markdown).toContain('## Annotations: 1 pending');
    expect(markdown).toContain('iPhone 15');
    expect(markdown).toContain('отцентрируй по середине');
    expect(markdown).toContain('localhost:8001/shares');
    expect(JSON.stringify(json)).toContain('"total":1');
  });

  it('reports clean state when there are no annotations', () => {
    const {markdown, json} = buildHandoff({
      appState,
      annotations: {viewports: [], skipped: []},
      history,
      now,
    });
    expect(markdown).toContain('## Annotations: none pending');
    expect((json as {annotations: {total: number}}).annotations.total).toBe(0);
  });

  it('degrades gracefully when annotations and history fail', () => {
    const {markdown, json} = buildHandoff({
      appState,
      annotations: null,
      annotationsError: 'renderer gone',
      history: null,
      historyError: 'store read failed',
      now,
    });
    expect(markdown).toContain('unavailable (renderer gone)');
    expect(markdown).toContain('unavailable (store read failed)');
    expect(JSON.stringify(json)).toContain('store read failed');
  });

  it('includes recent history in the markdown brief', () => {
    const {markdown} = buildHandoff({appState, annotations, history, now});
    expect(markdown).toContain('## Recent history');
    expect(markdown).toContain('http://localhost:8001/shares');
  });
});
