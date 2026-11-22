/* eslint global-require: off, no-console: off, promise/always-return: off */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn run build` or `yarn run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */
import path from 'path';
import {app, BrowserWindow, session, shell, ipcMain, dialog} from 'electron';
import cli from './cli';
import {IPC_MAIN_CHANNELS, PROTOCOL} from '../common/constants';
import MenuBuilder from './menu';
import {resolveHtmlPath} from './util';
import {
  getBrowserSyncHost,
  getBrowserSyncPort,
  initInstance,
  stopWatchFiles,
  watchFiles,
} from './browser-sync';
import store from '../store';
import {initWebviewContextMenu} from './webview-context-menu/register';
import {initScreenshotHandlers} from './screenshot';
import {initDevtoolsHandlers} from './devtools';
import {initWebviewStorageManagerHandlers} from './webview-storage-manager';
import {initNativeFunctionHandlers} from './native-functions';
import {WebPermissionHandlers} from './web-permissions';
import {initHttpBasicAuthHandlers} from './http-basic-auth';
import {initAppMetaHandlers, isSafeExternalUrl} from './app-meta';
import {getMcpServerStatus, initMcpServer, setMcpServerEnabled} from './mcp';
import {listAgentTools, setToolEntry, AgentEnv} from './mcp/agent-config';
import {openUrl} from './protocol-handler';
import {AppUpdater} from './app-updater';
import {getSavedWindowState, trackWindowState} from './window-state';
import electronDebug from 'electron-debug';
import log, {initCrashHandlers, initLogging} from './logging';
import {injectHostIntoCsp} from './csp';
import {isOpenableUrl} from './url-validation';
import {runAgent, cancelAgent, killAgentOnQuit} from './agent-runner';
import {initAgentTerminal, killAgentTerminal} from './agent-terminal';
import {wireWebviewSecurity} from './webview-registry';
import {getTitleBarOptions} from './titlebar';

initLogging();
initCrashHandlers();

let windowShownOnOpen = false;
let mainWindow: BrowserWindow | null = null;
let urlToOpen: string | undefined =
  cli.input[0] !== undefined && !cli.input[0].includes('electronmon') && isOpenableUrl(cli.input[0])
    ? cli.input[0]
    : undefined;

const normalizeProtocolUrl = (url: string): string => {
  let actualURL = url.replace(`${PROTOCOL}://`, '');
  if (actualURL.indexOf('//') !== -1 && actualURL.indexOf('://') === -1) {
    // This hack is needed because the URL from the extension is missing the colon for some reason.
    actualURL = actualURL.replace('//', '://');
  }
  return actualURL;
};

// A second launch focuses the running instance instead of spawning a second
// window (which would also silently lose the MCP/browser-sync port races).
// The lock is keyed on userData, so parallel E2E workers with isolated
// E2E_USER_DATA_DIRs are unaffected.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', (_event, argv) => {
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
  // On Windows/Linux, protocol deep links and CLI URLs arrive on the second
  // instance's argv rather than through 'open-url'.
  const deepLink = argv.find(
    (arg) =>
      arg.startsWith(`${PROTOCOL}://`) ||
      arg.startsWith('http://') ||
      arg.startsWith('https://') ||
      arg.startsWith('file://')
  );
  if (deepLink !== undefined && mainWindow !== null && !mainWindow.isDestroyed()) {
    const actualURL = normalizeProtocolUrl(deepLink);
    if (isOpenableUrl(actualURL)) {
      windowShownOnOpen = false;
      openUrl(actualURL, mainWindow);
    } else {
      log.warn('[deep-link] rejected URL from second instance', deepLink);
    }
  }
});

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// One-time process-level wiring: IPC handlers and app-level listeners live
// here (never inside createWindow) so macOS close→reopen cannot register
// duplicates. Anything window-dependent receives the getter.
const getMainWindow = () => mainWindow;

initAppMetaHandlers();
initWebviewContextMenu();
initScreenshotHandlers();
initWebviewStorageManagerHandlers();
initNativeFunctionHandlers();
initAgentTerminal();
initMcpServer(getMainWindow);
initHttpBasicAuthHandlers(getMainWindow);
const webPermissionHandlers = WebPermissionHandlers(getMainWindow);

ipcMain.on(IPC_MAIN_CHANNELS.GET_BROWSER_SYNC_PORT, (event) => {
  event.returnValue = getBrowserSyncPort();
});

ipcMain.on(IPC_MAIN_CHANNELS.START_WATCHING_FILE, async (_event, fileInfo) => {
  let filePath = fileInfo.path.replace('file://', '');
  if (process.platform === 'win32') {
    filePath = filePath.replace(/^\//, '');
  }
  app.addRecentDocument(filePath);
  await stopWatchFiles();
  watchFiles(filePath);
});

ipcMain.on(IPC_MAIN_CHANNELS.STOP_WATCHER, async () => {
  await stopWatchFiles();
});

ipcMain.handle(IPC_MAIN_CHANNELS.MCP_STATUS, async () => getMcpServerStatus());

ipcMain.handle(IPC_MAIN_CHANNELS.MCP_SET_ENABLED, async (_event, {enabled}: {enabled: boolean}) =>
  setMcpServerEnabled(enabled)
);

const agentEnv = (): AgentEnv => ({
  homeDir: app.getPath('home'),
  platform: process.platform,
  appData: process.env.APPDATA,
  execPath: process.execPath,
  bridgePath: path.join(app.getPath('userData'), 'mcp', 'cli.js'),
});

ipcMain.handle(IPC_MAIN_CHANNELS.MCP_LIST_TOOLS, async () => listAgentTools(agentEnv()));

/**
 * AnnotatorBar "send to agent": spawn a user-configured agent CLI
 * (e.g. `hermes -z {prompt}`, `claude -p {prompt}`, `codex exec {prompt}`)
 * with the annotations as the prompt. Runs without any gateway; the prompt
 * travels as a single argv entry (no shell); output is returned to the bar.
 */
ipcMain.handle(
  IPC_MAIN_CHANNELS.BA_AGENT_RUN,
  async (
    _event,
    request: {command: string; cwd?: string; prompt: string}
  ): Promise<{
    ok: boolean;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    output: string;
    stderrTail: string;
    error?: string;
    cancelled?: boolean;
    durationMs: number;
    truncated?: boolean;
  }> => {
    const command = typeof request?.command === 'string' ? request.command.trim() : '';
    if (command.length === 0 || command.length > 1024) {
      return {
        ok: false,
        exitCode: null,
        signal: null,
        output: '',
        stderrTail: '',
        error: 'Agent command is not set (see Annotator settings)',
        durationMs: 0,
      };
    }
    return runAgent({
      command,
      cwd: typeof request.cwd === 'string' ? request.cwd : undefined,
      prompt: typeof request.prompt === 'string' ? request.prompt : '',
    });
  }
);

ipcMain.handle(IPC_MAIN_CHANNELS.BA_AGENT_CANCEL, async () => ({cancelled: cancelAgent()}));

ipcMain.handle(IPC_MAIN_CHANNELS.BA_PICK_DIRECTORY, async () => {
  const parent = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
  const result = await dialog.showOpenDialog(parent as BrowserWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select the project folder the agent should work in',
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle(
  IPC_MAIN_CHANNELS.MCP_SET_TOOL,
  async (_event, {toolId, add}: {toolId: string; add: boolean}) => {
    const result = setToolEntry(agentEnv(), toolId, add);
    if ('error' in result) {
      log.warn('[mcp] agent config update failed', result.error);
    }
    return {tools: listAgentTools(agentEnv()), result};
  }
);

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

// Suppress the launch card during E2E tests (specs opt back in by resetting
// these keys and reloading).
if (process.env.E2E_TEST === 'true') {
  store.set('ui.announcements', {
    seenVersion: app.getVersion(),
    supportShownAt: Date.now(),
    supportHidden: false,
  });
}

const isDebug = process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';

if (isDebug) {
  // showDevTools: false — electron-debug's default opens DevTools on every
  // window at launch, which read as "the app starts with DevTools open".
  electronDebug({showDevTools: false});

  // Electron warns about Chrome extension permissions it doesn't implement
  // (e.g. Redux DevTools' 'contextMenus'). Node prints warnings through a
  // default 'warning' listener, so swap it for one that drops just those.
  const defaultWarningListeners = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (warning) => {
    if (warning.name === 'ExtensionLoadWarning') {
      return;
    }
    defaultWarningListeners.forEach((listener) => listener.call(process, warning));
  });
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  // Only extensions relevant to this codebase; electron-devtools-installer@4
  // dropped some previously referenced ones (e.g. APOLLO_DEVELOPER_TOOLS), and
  // Ember Inspector's MV3 background crashes under Electron.
  const {REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS} = installer;
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;

  // electron-devtools-installer@4 still calls the deprecated session.loadExtension
  // and session.getAllExtensions APIs; silence just those deprecation logs.
  const previousNoDeprecation = process.noDeprecation;
  process.noDeprecation = true;
  try {
    return await installer
      .default([REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS], {forceDownload})
      .catch((error: unknown) => log.warn('DevTools extension install failed', error));
  } finally {
    process.noDeprecation = previousNoDeprecation;
  }
};

// Session-level wiring runs once, after app ready (the session does not exist
// before that).
const wireSessionOnce = () => {
  // Allow the BrowserSync host (the event-mirroring transport injected into
  // every preview) through page CSPs — every header value, exact directive
  // names only.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders;
    if (headers) {
      const bsHost = getBrowserSyncHost();
      Object.keys(headers)
        .filter((key) => key.toLowerCase() === 'content-security-policy')
        .forEach((key) => {
          headers[key] = headers[key].map((policy) => injectHostIntoCsp(policy, bsHost));
        });
    }
    callback({responseHeaders: headers});
  });

  webPermissionHandlers.init();
};

let appUpdater: AppUpdater | null = null;
let isBrowserSyncInitiated = false;

const createWindow = async () => {
  windowShownOnOpen = false;
  // The devtools-installer extensions (notably REDUX_DEVTOOLS) auto-open a
  // detached DevTools window on every launch in dev mode, which confused
  // users into thinking the app opens with DevTools. Opt back in with
  // ENABLE_DEVTOOLS_EXTENSIONS=1 yarn start.
  if (process.env.ENABLE_DEVTOOLS_EXTENSIONS === '1' && process.env.E2E_TEST !== 'true') {
    await installExtensions();
  }

  const isBuiltApp = app.isPackaged || process.env.E2E_TEST === 'true';
  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  const windowState = getSavedWindowState();

  mainWindow = new BrowserWindow({
    show: false,
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    icon: getAssetPath('icon.png'),
    ...getTitleBarOptions(),
    webPreferences: {
      preload: isBuiltApp
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
      webviewTag: true,
    },
  });
  if (windowState.isMaximized) {
    mainWindow.maximize();
  }
  trackWindowState(mainWindow);
  initDevtoolsHandlers(mainWindow);
  wireWebviewSecurity(mainWindow.webContents, {
    openInPreview: (url) => openUrl(url, getMainWindow()),
    openExternal: (url) => {
      if (isSafeExternalUrl(url)) shell.openExternal(url);
    },
    onShortcut: (channel) => {
      getMainWindow()?.webContents.send(IPC_MAIN_CHANNELS.SHORTCUT_TRIGGERED, channel);
    },
  });

  mainWindow.loadURL(
    `${resolveHtmlPath('index.html')}${urlToOpen ? `?urlToOpen=${encodeURI(urlToOpen)}` : ''}`
  );

  const isWindows = process.platform === 'win32';
  let needsFocusFix = false;
  let triggeringProgrammaticBlur = false;

  mainWindow.on('blur', () => {
    if (!triggeringProgrammaticBlur) {
      needsFocusFix = true;
    }
  });

  mainWindow.on('focus', () => {
    if (isWindows && needsFocusFix) {
      needsFocusFix = false;
      triggeringProgrammaticBlur = true;
      setTimeout(function () {
        mainWindow!.blur();
        mainWindow!.focus();
        setTimeout(function () {
          triggeringProgrammaticBlur = false;
        }, 100);
      }, 100);
    }
  });

  mainWindow.on('ready-to-show', async () => {
    if (!isBrowserSyncInitiated) {
      await initInstance();
      isBrowserSyncInitiated = true;
    }

    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else if (process.env.E2E_TEST === 'true' && process.env.E2E_HEADLESS === 'true') {
      windowShownOnOpen = true;
    } else if (process.env.E2E_TEST === 'true') {
      mainWindow.showInactive();
      windowShownOnOpen = true;
    } else {
      mainWindow.showInactive();
      if (!windowShownOnOpen) {
        windowShownOnOpen = true;
        mainWindow.show();
      } else {
        mainWindow.showInactive();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow, appUpdater!);
  menuBuilder.buildMenu();

  // Open urls in the user's browser
  mainWindow.webContents.setWindowOpenHandler((edata) => {
    if (isSafeExternalUrl(edata.url)) {
      shell.openExternal(edata.url);
    } else {
      log.warn('Blocked openExternal for unsafe URL', edata.url);
    }
    return {action: 'deny'};
  });
};

app.on('open-url', async (event, url) => {
  const actualURL = normalizeProtocolUrl(url);
  if (!isOpenableUrl(actualURL)) {
    log.warn('[deep-link] rejected URL', url);
    return;
  }
  if (mainWindow == null) {
    // Will be handled by opened window
    urlToOpen = actualURL;
    await createWindow();
    return;
  }
  windowShownOnOpen = false;
  openUrl(actualURL, mainWindow);
});

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('certificate-error', (event, _, url, __, ___, callback) => {
  // Only the browser-sync companion origin may bypass TLS validation, and
  // only on an exact host+port match — a substring check would also trust
  // attacker URLs that merely contain the substring (e.g. in the path).
  try {
    const requestUrl = new URL(url);
    const syncUrl = new URL(`https://${getBrowserSyncHost()}`);
    if (requestUrl.hostname === syncUrl.hostname && requestUrl.port === syncUrl.port) {
      event.preventDefault();
      return callback(true);
    }
  } catch {
    // Unparseable URL — fall through to the user's insecure-connections setting.
  }
  log.info('certificate-error event', url, getBrowserSyncHost());
  return callback(store.get('userPreferences.allowInsecureSSLConnections'));
});

app.on('will-quit', () => {
  killAgentOnQuit();
  killAgentTerminal();
});

app
  .whenReady()
  .then(() => {
    // Dev builds ship the Electron binary, so the dock shows the default icon/name.
    // Point both at Pokefix (real builds take the icon/name from electron-builder).
    if (process.platform === 'darwin' && app.dock) {
      const getDockAssetPath = (...paths: string[]): string =>
        path.join(__dirname, '../../assets', ...paths);
      app.setName('Pokefix');
      try {
        app.dock.setIcon(getDockAssetPath('icon.png'));
      } catch (iconError) {
        log.error('[app-icon]', iconError);
      }
    }
    wireSessionOnce();
    appUpdater = new AppUpdater();
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch((error) => log.error('Failed to start app', error));
