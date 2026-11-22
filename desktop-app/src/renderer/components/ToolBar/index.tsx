import {IPC_MAIN_CHANNELS} from 'common/constants';
import {useDispatch, useSelector} from 'react-redux';
import {
  selectIsCapturingScreenshot,
  selectIsInspecting,
  selectRotate,
  setIsCapturingScreenshot,
  setIsInspecting,
  setRotate,
} from 'renderer/store/features/renderer';
import {setDevtoolsClose, selectIsDevtoolsOpen} from 'renderer/store/features/devtools';
import {setAnnotatorOpen, selectIsAnnotatorOpen} from 'renderer/store/features/annotator';
import {Icon} from '@iconify/react';
import {useCallback} from 'react';
import {ScreenshotAllArgs} from 'main/screenshot';
import {selectActiveSuite} from 'renderer/store/features/device-manager';
import {getDevicesMap} from 'common/deviceList';
import {
  FULL_PAGE_SETTLE_MS,
  prepareFullPageCapture,
  useShutterSound,
} from 'renderer/hooks/useScreenshot';
import {APP_VIEWS, setAppView} from 'renderer/store/features/ui';
import NavigationControls from './NavigationControls';
import Menu from './Menu';
import AddressBar from './AddressBar';
import {IconButton, ToolbarAction, ToolbarDivider, ToolbarGroup} from './primitives';
import ColorSchemeToggle from './ColorSchemeToggle';
import ModalLoader from '../ModalLoader';
import {PreviewSuiteSelector} from './PreviewSuiteSelector';
import useKeyboardShortcut, {
  SHORTCUT_CHANNEL,
} from '../KeyboardShortcutsManager/useKeyboardShortcut';
import McpPanel from './McpPanel';
import {ColorBlindnessControls} from './ColorBlindnessControls';

const ToolBar = () => {
  const rotateDevices = useSelector(selectRotate);
  const isInspecting = useSelector(selectIsInspecting);
  const isDevtoolsOpen = useSelector(selectIsDevtoolsOpen);
  const isCapturingScreenshot = useSelector(selectIsCapturingScreenshot);
  const activeSuite = useSelector(selectActiveSuite);
  const dispatch = useDispatch();
  const playShutter = useShutterSound();
  const isAnnotating = useSelector(selectIsAnnotatorOpen);

  // Annotate mode is forced ON or OFF in every mounted webview (not toggled,
  // so previews never desync); macOS may swallow the in-webview shortcut.
  // Previews whose guest predates the annotator (no API) need a reload to
  // arm it — never reload silently: unsaved page state would be lost.
  const handleAnnotateToggle = async () => {
    const next = !isAnnotating;
    if (next && isInspecting) {
      // The CDP point-to-inspect overlay intercepts preview clicks at the
      // Chromium level, so it must not run together with annotate mode.
      dispatch(setIsInspecting(false));
    }
    const webViews = Array.from(document.querySelectorAll<Electron.WebviewTag>('webView'));

    if (next) {
      const missing: Electron.WebviewTag[] = [];
      await Promise.all(
        webViews.map(async (webview) => {
          let hasApi = false;
          try {
            hasApi = await webview
              .executeJavaScript('Boolean(window.baAnnotatorSetEnabled)', true)
              .catch(() => false);
          } catch {
            hasApi = false;
          }
          if (!hasApi) {
            missing.push(webview);
          }
        })
      );
      if (missing.length > 0) {
        const proceed = window.confirm(
          `${missing.length} preview(s) were opened before Annotate was ready and need a reload to enable it.\n\n` +
            'Reload now? Any unsaved page state (forms, editors) will be lost.'
        );
        if (!proceed) {
          return;
        }
        await Promise.all(
          missing.map(
            (webview) =>
              new Promise<void>((resolve) => {
                const onLoaded = () => {
                  window.clearTimeout(timer);
                  webview.removeEventListener('did-finish-load', onLoaded);
                  resolve();
                };
                const timer = window.setTimeout(() => {
                  webview.removeEventListener('did-finish-load', onLoaded);
                  resolve();
                }, 8000);
                webview.addEventListener('did-finish-load', onLoaded);
                try {
                  webview.reload();
                } catch {
                  window.clearTimeout(timer);
                  resolve();
                }
              })
          )
        );
      }
    }
    webViews.forEach((webview) => {
      webview
        .executeJavaScript(
          `window.baAnnotatorSetEnabled ? window.baAnnotatorSetEnabled(${next}) : false`,
          true
        )
        .catch(() => undefined);
    });
    dispatch(setAnnotatorOpen(next));
  };

  const closeDevtoolsPanel = useCallback(() => {
    window.electron.ipcRenderer.invoke(IPC_MAIN_CHANNELS.CLOSE_DEVTOOLS);
    dispatch(setDevtoolsClose());
    dispatch(setIsInspecting(false));
  }, [dispatch]);

  useKeyboardShortcut(SHORTCUT_CHANNEL.DEVTOOLS_CLOSE, closeDevtoolsPanel);

  function handleInspectShortcut() {
    const next = !isInspecting;
    if (next && isAnnotating) {
      // Annotate alt-clicks and the CDP inspect overlay fight for the same
      // preview clicks — enabling inspect disables annotate first.
      const webViews = document.querySelectorAll<Electron.WebviewTag>('webView');
      webViews.forEach((webview) => {
        webview
          .executeJavaScript(
            'window.baAnnotatorSetEnabled ? window.baAnnotatorSetEnabled(false) : false',
            true
          )
          .catch(() => undefined);
      });
      dispatch(setAnnotatorOpen(false));
    }
    if (!next && isDevtoolsOpen) {
      // Turning inspect off while the devtools panel is showing closes the
      // whole panel — the tucked-away close icon in the dock header is hard
      // to spot (user report: the panel looked unclosable).
      closeDevtoolsPanel();
      return;
    }
    dispatch(setIsInspecting(next));
  }

  const screenshotCaptureHandler = async () => {
    if (isCapturingScreenshot) {
      return;
    }

    dispatch(setIsCapturingScreenshot(true));
    const webViews: NodeListOf<Electron.WebviewTag> = document.querySelectorAll('webView');
    const screens: Array<ScreenshotAllArgs> = [];
    const restores: Array<() => void> = [];
    const devices = activeSuite.devices.map((d) => getDevicesMap()[d]);
    // Sequential await: every webview must be measured and resized before the
    // capture fires (the old forEach(async) raced the capture call).
    for (const webview of Array.from(webViews)) {
      const device = devices.find((d) => d.name === webview.id);
      if (device != null) {
        const prep = await prepareFullPageCapture(webview);
        screens.push({
          webContentsId: webview.getWebContentsId(),
          device,
          previousHeight: prep.previousHeight,
          previousTransform: prep.previousTransform,
          pageHeight: prep.pageHeight,
        });
        restores.push(prep.restore);
      }
    }
    await new Promise((resolve) => {
      setTimeout(resolve, FULL_PAGE_SETTLE_MS);
    });
    await window.electron.ipcRenderer.invoke<Array<ScreenshotAllArgs>, unknown>(
      IPC_MAIN_CHANNELS.SCREENSHOT_ALL,
      screens
    );

    // reset webviews to original size
    restores.forEach((restore) => {
      restore();
    });

    dispatch(setIsCapturingScreenshot(false));
    playShutter();
  };

  const handleClose = () => {
    // Do nothing. Prevent Dialog from closing.
  };

  const handleRotate = () => {
    dispatch(setRotate(!rotateDevices));
  };

  useKeyboardShortcut(SHORTCUT_CHANNEL.ROTATE_ALL, handleRotate);
  useKeyboardShortcut(SHORTCUT_CHANNEL.SCREENSHOT_ALL, screenshotCaptureHandler);
  useKeyboardShortcut(SHORTCUT_CHANNEL.INSPECT_ELEMENTS, handleInspectShortcut);

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line-soft bg-panel px-[14px]">
      <NavigationControls />
      {/* Fill the available space while keeping the address input usable
          when the toolbar gets crowded. */}
      <div className="min-w-[220px] flex-1">
        <AddressBar />
      </div>
      <ToolbarGroup>
        <ToolbarAction onClick={handleRotate} isActive={rotateDevices} title="Rotate Devices">
          <Icon
            icon={rotateDevices ? 'mdi:phone-rotate-portrait' : 'mdi:phone-rotate-landscape'}
            fontSize={16}
          />
          Rotate
        </ToolbarAction>
        <ToolbarAction
          onClick={handleInspectShortcut}
          isActive={isInspecting}
          title="Inspect Elements"
        >
          <Icon icon="lucide:inspect" fontSize={15} />
          Inspect
        </ToolbarAction>
        <ToolbarAction
          onClick={screenshotCaptureHandler}
          isActive={isCapturingScreenshot}
          title="Screenshot All WebViews"
        >
          <Icon icon="lucide:camera" fontSize={15} />
          Capture
        </ToolbarAction>
        <ToolbarAction
          onClick={handleAnnotateToggle}
          isActive={isAnnotating}
          title="Annotate — Alt+click elements to mark them for the agent (get_annotations)"
        >
          <Icon icon="lucide:highlighter" fontSize={15} />
          Annotate
        </ToolbarAction>
        <ColorBlindnessControls />
        <ColorSchemeToggle />
      </ToolbarGroup>
      <ToolbarDivider />
      <McpPanel />
      <PreviewSuiteSelector />
      <IconButton
        onClick={() => {
          dispatch(setAppView(APP_VIEWS.DEVICE_MANAGER));
        }}
        title="Device Manager"
      >
        <Icon icon="lucide:plus" width={16} />
      </IconButton>
      <Menu />
      <ModalLoader isOpen={isCapturingScreenshot} onClose={handleClose} title="Screenshot" />
    </div>
  );
};

export default ToolBar;
