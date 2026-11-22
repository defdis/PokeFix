import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {webContents} from 'electron';
import {
  McpAppState,
  McpAnnotationsResult,
  McpCaptureTargetsResult,
  McpClearAnnotationsResult,
  McpDeviceInfo,
  McpHistoryEntry,
  McpNavigateResult,
  McpSetActiveDevicesResult,
  McpSkippedCapture,
} from '../../common/mcp';
import {captureImage} from '../screenshot';
import {GetMainWindow, sendBridgeCommand} from './bridge';
import {clickElement, readPage, typeText} from './interactions';
import {toolDefs} from './toolDefs';
import {buildHandoff} from './handoff';
import {normalizeUrl} from './utils';

const MAX_SCREENSHOT_WIDTH = 1000;
const SCREENSHOT_JPEG_QUALITY = 80;
const NAVIGATE_BRIDGE_TIMEOUT_MS = 35_000;

interface TextContent {
  type: 'text';
  text: string;
}

interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

const textResult = (value: unknown) => ({
  content: [{type: 'text' as const, text: JSON.stringify(value, null, 2)}],
});

const errorResult = (error: unknown) => ({
  content: [{type: 'text' as const, text: error instanceof Error ? error.message : String(error)}],
  isError: true,
});

const captureTarget = async (
  target: McpCaptureTargetsResult['targets'][number]
): Promise<{content: [TextContent, ImageContent]} | {skip: McpSkippedCapture}> => {
  const targetContents = webContents.fromId(target.webContentsId);
  if (targetContents === undefined || targetContents.isDestroyed()) {
    return {skip: {deviceName: target.deviceName, reason: 'the preview was closed'}};
  }
  let image: Electron.NativeImage | undefined;
  try {
    image = await captureImage(target.webContentsId);
  } catch (error) {
    return {
      skip: {
        deviceName: target.deviceName,
        reason: `capture failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  if (image === undefined || image.isEmpty()) {
    return {
      skip: {
        deviceName: target.deviceName,
        reason: 'capture returned an empty image (the app window may be hidden or minimized)',
      },
    };
  }
  const resized =
    image.getSize().width > MAX_SCREENSHOT_WIDTH
      ? image.resize({width: MAX_SCREENSHOT_WIDTH})
      : image;
  return {
    content: [
      {
        type: 'text',
        text: `${target.deviceName} (${target.width}x${target.height}) — ${target.url}`,
      },
      {
        type: 'image',
        data: resized.toJPEG(SCREENSHOT_JPEG_QUALITY).toString('base64'),
        mimeType: 'image/jpeg',
      },
    ],
  };
};

export const registerTools = (server: McpServer, getMainWindow: GetMainWindow) => {
  const handoffHandler = async () => {
    let appState: McpAppState | null = null;
    try {
      appState = await sendBridgeCommand<McpAppState>(getMainWindow, 'get-app-state');
    } catch (error) {
      return errorResult(error);
    }
    // Both side-channels are best-effort: the tool still answers if one fails.
    let annotations: McpAnnotationsResult | null = null;
    let annotationsError: string | undefined;
    try {
      annotations = await sendBridgeCommand<McpAnnotationsResult>(getMainWindow, 'get-annotations');
    } catch (error) {
      annotationsError = error instanceof Error ? error.message : String(error);
    }
    let history: McpHistoryEntry[] | null = null;
    let historyError: string | undefined;
    try {
      history = await sendBridgeCommand<McpHistoryEntry[]>(getMainWindow, 'get-history');
    } catch (error) {
      historyError = error instanceof Error ? error.message : String(error);
    }
    const {markdown, json} = buildHandoff({
      appState,
      annotations,
      annotationsError,
      history,
      historyError,
      now: new Date().toISOString(),
    });
    return {
      content: [
        {type: 'text' as const, text: markdown},
        {type: 'text' as const, text: JSON.stringify(json, null, 2)},
      ],
    };
  };
  server.registerTool('get_session_handoff', toolDefs.get_session_handoff, handoffHandler);
  server.registerTool('get_work_status', toolDefs.get_work_status, handoffHandler);

  server.registerTool('get_app_state', toolDefs.get_app_state, async () => {
    try {
      const state = await sendBridgeCommand<McpAppState>(getMainWindow, 'get-app-state');
      return textResult(state);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('navigate', toolDefs.navigate, async ({url}) => {
    try {
      const normalizedUrl = normalizeUrl(url);
      const result = await sendBridgeCommand<McpNavigateResult>(
        getMainWindow,
        'navigate',
        {url: normalizedUrl},
        NAVIGATE_BRIDGE_TIMEOUT_MS
      );
      return textResult(result);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('list_devices', toolDefs.list_devices, async () => {
    try {
      const devices = await sendBridgeCommand<McpDeviceInfo[]>(getMainWindow, 'list-devices');
      return textResult(devices);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('set_active_devices', toolDefs.set_active_devices, async ({devices}) => {
    try {
      const result = await sendBridgeCommand<McpSetActiveDevicesResult>(
        getMainWindow,
        'set-active-devices',
        {devices}
      );
      return textResult(result);
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('read_page', toolDefs.read_page, async ({device}) => {
    try {
      return textResult(await readPage(getMainWindow, device));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('click', toolDefs.click, async ({selector, device}) => {
    try {
      return textResult(await clickElement(getMainWindow, selector, device));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool(
    'type_text',
    toolDefs.type_text,
    async ({text, selector, clear, pressEnter, device}) => {
      try {
        return textResult(
          await typeText(getMainWindow, {text, selector, clear, pressEnter, device})
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool('screenshot', toolDefs.screenshot, async ({device}) => {
    try {
      const {targets, skipped} = await sendBridgeCommand<McpCaptureTargetsResult>(
        getMainWindow,
        'get-capture-targets',
        {device}
      );
      if (targets.length === 0 && skipped.length === 0) {
        return errorResult(
          new Error('No active devices to capture. Use the set_active_devices tool first.')
        );
      }
      const captures = await Promise.all(targets.map(captureTarget));
      const content: Array<TextContent | ImageContent> = [];
      const skips: McpSkippedCapture[] = [...skipped];
      captures.forEach((capture) => {
        if ('skip' in capture) {
          skips.push(capture.skip);
        } else {
          content.push(...capture.content);
        }
      });
      if (skips.length > 0) {
        content.push({
          type: 'text',
          text: `Skipped: ${skips.map((s) => `${s.deviceName} (${s.reason})`).join('; ')}`,
        });
      }
      return {content};
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('get_annotations', toolDefs.get_annotations, async ({clear}) => {
    try {
      const result = await sendBridgeCommand<McpAnnotationsResult>(
        getMainWindow,
        'get-annotations'
      );
      // Consume-on-read: the agent took the marks, so clear them from every
      // viewport unless the caller explicitly opted out (clear === false).
      let clearNote = '';
      if (clear !== false && result.viewports.length > 0) {
        try {
          const cleared = await sendBridgeCommand<McpClearAnnotationsResult>(
            getMainWindow,
            'clear-annotations'
          );
          clearNote =
            cleared.cleared.length > 0
              ? `\n\nMarks cleared in: ${cleared.cleared.join(', ')}.`
              : '\n\nMarks could not be cleared in any viewport.';
          if (cleared.skipped.length > 0) {
            clearNote += ` Skipped: ${cleared.skipped
              .map((s) => `${s.deviceName} (${s.reason})`)
              .join(', ')}.`;
          }
        } catch (error) {
          clearNote = `\n\nNOTE: could not auto-clear marks: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      }
      if (result.viewports.length === 0) {
        const skippedNote =
          result.skipped.length > 0
            ? ` (${result.skipped.map((s) => s.deviceName).join(', ')} are not mounted)`
            : '';
        return textResult({
          message: `No annotations collected yet.${skippedNote} The reviewer toggles annotate mode with Cmd/Ctrl+Shift+. then Alt+clicks elements in the device previews.`,
        });
      }
      const lines: string[] = ['Feedback:'];
      result.viewports.forEach((viewport) => {
        lines.push('');
        lines.push(
          `For ${viewport.deviceName} (${viewport.width}x${viewport.height}) — ${viewport.url}`
        );
        lines.push(viewport.formatted);
      });
      if (result.skipped.length > 0) {
        lines.push('');
        lines.push(
          `Skipped viewports: ${result.skipped.map((s) => `${s.deviceName} (${s.reason})`).join('; ')}`
        );
      }
      return {content: [{type: 'text', text: lines.join('\n') + clearNote}]};
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool('clear_annotations', toolDefs.clear_annotations, async () => {
    try {
      const result = await sendBridgeCommand<McpClearAnnotationsResult>(
        getMainWindow,
        'clear-annotations'
      );
      const parts: string[] = [];
      if (result.cleared.length > 0) {
        parts.push(`Cleared annotations in: ${result.cleared.join(', ')}`);
      }
      if (result.skipped.length > 0) {
        parts.push(
          `Skipped: ${result.skipped.map((s) => `${s.deviceName} (${s.reason})`).join('; ')}`
        );
      }
      if (parts.length === 0) {
        parts.push('No active viewports to clear.');
      }
      return textResult({result: parts.join('\n')});
    } catch (error) {
      return errorResult(error);
    }
  });
};
