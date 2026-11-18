import {ipcRenderer} from 'electron';
import {IPC_MAIN_CHANNELS} from 'common/constants';

window.onerror = function logError(errorMsg, url, lineNumber) {
  console.log(`Unhandled error: ${errorMsg} ${url} ${lineNumber}`);
};

// Scroll/wheel mirroring can fire every frame on every preview — coalesce to
// one host message per animation frame. Wheel deltas are summed so the total
// mirrored scroll distance is preserved.
let wheelDelta: {x: number; y: number} | null = null;
let scrollPending = false;
let flushRequested = false;

const flushScrollData = () => {
  flushRequested = false;
  if (wheelDelta !== null) {
    ipcRenderer.sendToHost('pass-scroll-data', {
      coordinates: {
        x: wheelDelta.x,
        y: wheelDelta.y,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      innerHeight: document.body.scrollHeight,
      innerWidth: window.innerWidth,
    });
  } else if (scrollPending) {
    ipcRenderer.sendToHost('pass-scroll-data', {
      coordinates: {
        x: 0,
        y: 0,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      innerHeight: document.body.scrollHeight,
      innerWidth: window.innerWidth,
    });
  }
  wheelDelta = null;
  scrollPending = false;
};

const requestFlush = () => {
  if (!flushRequested) {
    flushRequested = true;
    window.requestAnimationFrame(flushScrollData);
  }
};

const documentBodyInit = () => {
  // Browser Sync
  const bsPort = ipcRenderer.sendSync(IPC_MAIN_CHANNELS.GET_BROWSER_SYNC_PORT);
  const bsScript = window.document.createElement('script');
  bsScript.src = `https://localhost:${bsPort}/browser-sync/browser-sync-client.js?v=2.27.10`;
  bsScript.async = true;
  window.document.body.appendChild(bsScript);

  // Context Menu
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    ipcRenderer.send('show-context-menu', {
      contextMenuMeta: {x: e.x, y: e.y},
    });
  });

  window.addEventListener('wheel', (e) => {
    // Pinches (reported as ctrl+wheel) zoom the previews, they don't scroll.
    if (e.ctrlKey) {
      return;
    }
    wheelDelta = {
      x: (wheelDelta?.x ?? 0) + e.deltaX,
      y: (wheelDelta?.y ?? 0) + e.deltaY,
    };
    requestFlush();
  });

  // Trackpad pinch arrives as a ctrl+wheel event. The host zooms the preview
  // container, so the guest page must neither scroll nor zoom itself — and the
  // host never sees input over a webview, hence the forward.
  window.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) {
        return;
      }
      e.preventDefault();
      ipcRenderer.sendToHost('pass-pinch-data', {
        deltaY: e.deltaY,
        x: e.clientX,
        y: e.clientY,
      });
    },
    {passive: false}
  );

  window.addEventListener('scroll', () => {
    scrollPending = true;
    requestFlush();
  });

  // To detect if user is typing in an input field
  const isUserTyping = () => {
    const el = document.activeElement;
    if (!el) return false;

    return (
      el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable
    );
  };

  // Handle F key for fullscreen toggle
  window.addEventListener('keydown', (e) => {
    // Prevent fullscreen if user is typing
    if (isUserTyping()) return;

    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();

      // Check if already in fullscreen
      if (document.fullscreenElement) {
        // Exit fullscreen
        document.exitFullscreen().catch((err) => {
          console.error('Error exiting fullscreen:', err);
        });
      } else {
        // Request fullscreen
        document.documentElement.requestFullscreen().catch((err) => {
          console.error('Error requesting fullscreen:', err);
        });
      }
    }
  });

  // Report the full page height to the host once the page (and its assets,
  // which affect layout) has loaded.
  window.addEventListener('load', () => {
    const {body} = document;
    const html = document.documentElement;

    const height = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      html.clientHeight,
      html.scrollHeight,
      html.offsetHeight
    );

    ipcRenderer.sendToHost('pass-scroll-data', {
      coordinates: {x: 0, y: 0},
      innerHeight: height,
      innerWidth: window.innerWidth,
    });
  });
};

ipcRenderer.on('context-menu-command', (_, command) => {
  ipcRenderer.sendToHost('context-menu-command', command);
});

const init = () => {
  try {
    documentBodyInit();
  } catch (err) {
    console.log('Error in documentBodyInit:', err);
  }
};

// Preload scripts run before the document is parsed; body exists by
// DOMContentLoaded. (Replaces a 300ms polling loop.)
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ==================== ANNOTATOR OVERLAY ====================
// Reviewer marks elements in this webview: Cmd/Ctrl+Shift+. toggles annotate
// mode, Alt+click marks an element (optionally with a feedback note). The
// agent collects marks later via the get_annotations MCP tool, which runs
// window.baAnnotationApi.get()/clear() here through webview.executeJavaScript.
interface BaAnnotationItem {
  index: number;
  tag: string;
  text: string;
  selector: string;
  feedback: string;
}

interface BaAnnotationApi {
  active: () => boolean;
  get: () => BaAnnotationItem[];
  clear: () => void;
  count: () => number;
}

const BA_WINDOW_KEY = 'baAnnotationState' as const;

interface BaAnnotationState {
  active: boolean;
  items: BaAnnotationItem[];
}

const baReadState = (): BaAnnotationState => {
  const existing = (window as unknown as Record<string, unknown>)[BA_WINDOW_KEY] as
    BaAnnotationState | undefined;
  if (existing && Array.isArray(existing.items)) {
    return existing;
  }
  // Survive page reloads within the same webview session.
  try {
    const persisted = JSON.parse(
      window.sessionStorage.getItem(BA_WINDOW_KEY) ?? 'null'
    ) as BaAnnotationState | null;
    if (persisted && Array.isArray(persisted.items)) {
      persisted.active = false;
      return persisted;
    }
  } catch {
    // sessionStorage unavailable (sandboxed page) — memory-only mode.
  }
  return {active: false, items: []};
};

const baWriteState = (state: BaAnnotationState) => {
  (window as unknown as Record<string, unknown>)[BA_WINDOW_KEY] = state;
  try {
    window.sessionStorage.setItem(
      BA_WINDOW_KEY,
      JSON.stringify({active: false, items: state.items})
    );
  } catch {
    // Memory-only mode.
  }
};

const baShowToggleBadge = (state: BaAnnotationState) => {
  let badge = document.getElementById('ba-annotator-badge');
  if (!state.active) {
    badge?.remove();
    return;
  }
  if (badge === null) {
    badge = document.createElement('div');
    badge.id = 'ba-annotator-badge';
    badge.style.cssText =
      'position:fixed;bottom:12px;right:12px;z-index:2147483647;background:#1e1e24;' +
      'color:#ffd166;font:600 12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;' +
      'padding:6px 12px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.45);' +
      'cursor:pointer;user-select:none;letter-spacing:.4px;';
    badge.textContent = 'ANNOTATE ON — Alt+click';
    badge.addEventListener('click', () => baToggleMode());
    document.documentElement.appendChild(badge);
  }
};

const baToggleMode = () => {
  const state = baReadState();
  state.active = !state.active;
  baWriteState(state);
  if (state.active) {
    // Hostile pages may clear overlays; ensure the badge exists each toggle-on.
    baShowToggleBadge({active: true, items: state.items});
    baDrawMarks(state);
  } else {
    baShowToggleBadge(state);
    baHidePopover();
    baDrawMarks(state);
  }
  return state.active;
};

const baSetEnabled = (enabled: boolean): boolean => {
  const state = baReadState();
  state.active = enabled;
  baWriteState(state);
  if (state.active) {
    baShowToggleBadge({active: true, items: state.items});
  } else {
    baShowToggleBadge(state);
    baHidePopover();
  }
  baDrawMarks(state);
  return state.active;
};

let baPopover: HTMLElement | null = null;

const baHidePopover = () => {
  baPopover?.remove();
  baPopover = null;
};

const baBuildSelector = (element: Element): string => {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current !== null && current !== document.documentElement && depth < 5) {
    const currentRef: Element = current;
    let part = currentRef.tagName.toLowerCase();
    if (currentRef.id.length > 0) {
      const idPart = currentRef.id
        .split(/[\s,]+/)
        .filter((c) => /^[\w-]+$/u.test(c))
        .map((c) => `#${c}`)
        .join('');
      if (idPart.length > 0) {
        parts.unshift(idPart);
        break;
      }
    }
    const siblings = currentRef.parentElement
      ? Array.from(currentRef.parentElement.children).filter(
          (candidate: Element) => candidate.tagName === currentRef.tagName
        )
      : [currentRef];
    if (siblings.length > 1) {
      const nth = siblings.indexOf(currentRef) + 1;
      part += `:nth-of-type(${nth})`;
    }
    parts.unshift(part);
    current = currentRef.parentElement;
    depth += 1;
  }
  return parts.join(' >');
};

const baElementText = (element: Element): string => {
  const htmlElement = element as HTMLElement;
  const raw =
    htmlElement instanceof HTMLInputElement || htmlElement instanceof HTMLTextAreaElement
      ? htmlElement.value
      : (element.getAttribute('aria-label') ??
        element.getAttribute('placeholder') ??
        element.textContent ??
        '');
  return raw.replace(/\s+/g, ' ').trim().slice(0, 80);
};

const baDrawMarks = (state: BaAnnotationState) => {
  document.querySelectorAll('ba-annotator-mark').forEach((mark) => mark.remove());
  if (!state.active) {
    return;
  }
  state.items.forEach((item) => {
    try {
      const found = document.querySelector(item.selector);
      if (found === null) {
        return;
      }
      const rect = found.getBoundingClientRect();
      const mark = document.createElement('ba-annotator-mark');
      mark.style.cssText =
        'position:absolute;left:' +
        (rect.left + window.scrollX) +
        'px;top:' +
        (rect.top + window.scrollY) +
        'px;width:' +
        rect.width +
        'px;height:' +
        rect.height +
        'px;border:2px solid #ff4d4f;background:rgba(255,77,79,.14);' +
        'box-sizing:border-box;pointer-events:none;z-index:2147483646;';
      const chip = document.createElement('span');
      chip.style.cssText =
        'position:absolute;top:-20px;left:0;background:#ff4d4f;color:#fff;' +
        'font:700 11px/18px -apple-system,sans-serif;padding:0 6px;border-radius:4px;';
      chip.textContent = String(item.index);
      mark.appendChild(chip);
      document.documentElement.appendChild(mark);
    } catch {
      // Stale selector — skip this mark.
    }
  });
};

const baShowPopover = (element: Element, rect: DOMRect, nextIndex: number) => {
  baHidePopover();
  const popover = document.createElement('div');
  popover.id = 'ba-annotator-popover';
  popover.style.cssText =
    'position:absolute;left:' +
    Math.max(4, rect.left + window.scrollX) +
    'px;top:' +
    (rect.bottom + window.scrollY + 6) +
    'px;z-index:2147483647;background:#1e1e24;color:#d7dce3;border-radius:10px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.5);padding:10px;width:240px;pointer-events:auto;';
  const title = document.createElement('div');
  title.style.cssText =
    'font:600 11px/1.4 -apple-system,sans-serif;color:#8b94a1;margin-bottom:6px;';
  title.textContent = 'Mark #' + nextIndex + ' — feedback (optional)';
  const textarea = document.createElement('textarea');
  textarea.style.cssText =
    'width:100%;height:54px;background:#111318;color:#e8ecf1;border:1px solid #333a46;' +
    'border-radius:6px;padding:6px 8px;font:13px/1.4 -apple-system,sans-serif;resize:vertical;box-sizing:border-box;';
  textarea.placeholder = 'What about this element?';
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;margin-top:8px;justify-content:flex-end;';
  const saveButton = document.createElement('button');
  saveButton.style.cssText =
    'background:#2ecc7a;color:#0b2617;border:0;border-radius:6px;padding:5px 12px;' +
    'font:600 12px -apple-system,sans-serif;cursor:pointer;';
  saveButton.textContent = 'Save mark';
  const removeButton = document.createElement('button');
  removeButton.style.cssText =
    'background:#3a4250;color:#d7dce3;border:0;border-radius:6px;padding:5px 12px;' +
    'font:600 12px -apple-system,sans-serif;cursor:pointer;';
  removeButton.textContent = 'Remove';
  actions.appendChild(removeButton);
  actions.appendChild(saveButton);
  popover.appendChild(title);
  popover.appendChild(textarea);
  popover.appendChild(actions);
  document.documentElement.appendChild(popover);

  saveButton.addEventListener('click', () => {
    const item: BaAnnotationItem = {
      index: nextIndex,
      tag: element.tagName.toLowerCase(),
      text: baElementText(element),
      selector: baBuildSelector(element),
      feedback: textarea.value.replace(/\s+$/g, '').trim(),
    };
    const nextState = baReadState();
    nextState.items.push(item);
    baWriteState(nextState);
    baDrawMarks(nextState);
    baHidePopover();
  });
  removeButton.addEventListener('click', () => {
    baHidePopover();
    // Clicking outside a preview should not leak a stray mark.
  });
  baPopover = popover;
  textarea.focus();
};

const baAnnotateClick = (event: MouseEvent) => {
  const state = baReadState();
  if (!state.active) {
    return;
  }
  if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest('#ba-annotator-popover, #ba-annotator-badge')) {
      return;
    }
    const nextIndex = state.items.length + 1;
    const rect = target.getBoundingClientRect();
    baShowPopover(target, rect, nextIndex);
    return;
  }
};

const baAnnotatorInit = () => {
  const api: BaAnnotationApi = {
    active: () => baReadState().active,
    get: () => baReadState().items,
    clear: () => {
      const state = baReadState();
      state.items = [];
      baWriteState(state);
      baDrawMarks(state);
    },
    count: () => baReadState().items.length,
  };
  (window as unknown as Record<string, unknown>).baAnnotationApi = api;
  // Toolbar button drives every webview uniformly through executeJavaScript
  // (macOS may swallow the Cmd+Shift+. shortcut before it reaches the guest).
  (window as unknown as Record<string, unknown>).baAnnotatorSetEnabled = baSetEnabled;
  (window as unknown as Record<string, unknown>).baAnnotatorToggle = baToggleMode;

  window.addEventListener('click', (event) => baAnnotateClick(event as MouseEvent), true);
  window.addEventListener('keydown', (event) => {
    if (event.metaKey && event.shiftKey && event.key === '.') {
      event.preventDefault();
      baToggleMode();
      return;
    }
    if (event.key === 'Escape') {
      baHidePopover();
    }
  });
  window.addEventListener('resize', () => baDrawMarks(baReadState()));
};

baAnnotatorInit();
