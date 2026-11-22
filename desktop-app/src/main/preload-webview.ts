import {contextBridge, ipcRenderer} from 'electron';
import {IPC_MAIN_CHANNELS} from 'common/constants';

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

const isLocalHostname = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '[::1]' ||
    h === '::1' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.test') ||
    h.endsWith('.lvh.me')
  );
};

const documentBodyInit = () => {
  // Browser Sync: only for local pages — a remote production site gains nothing
  // from the client and the request is pure noise (and breaks under CSP).
  if (isLocalHostname(window.location.hostname)) {
    const bsPort = ipcRenderer.sendSync(IPC_MAIN_CHANNELS.GET_BROWSER_SYNC_PORT);
    const bsScript = window.document.createElement('script');
    bsScript.src = `https://localhost:${bsPort}/browser-sync/browser-sync-client.js?v=2.27.10`;
    bsScript.async = true;
    window.document.body.appendChild(bsScript);
  }

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
  /** Key computed styles, only when the settings switch is on. */
  styles?: string;
  /** Keyed attributes that let an agent locate the element without searching. */
  attributes?: string;
  /** Short outerHTML snapshot (leading whitespace collapsed). */
  html?: string;
  /** Document-space bbox: the element is here on the page. */
  position?: {x: number; y: number; width: number; height: number};
}

interface BaAnnotationApi {
  active: () => boolean;
  get: () => BaAnnotationItem[];
  clear: () => void;
  /** Re-insert the marks from the last clear (undo of an agent hand-off). Returns how many were restored. */
  restore: () => number;
  canRestore: () => boolean;
  remove: (index: number) => void;
  configure: (partial: Partial<BaAnnotatorConfig>) => void;
  setHidden: (hidden: boolean) => void;
  isHidden: () => boolean;
  count: () => number;
  edit: (index: number, feedback: string) => void;
}

const BA_WINDOW_KEY = 'baAnnotationState' as const;

interface BaAnnotationState {
  active: boolean;
  items: BaAnnotationItem[];
  /** Overlay appearance/data switches — mirrors the MarkAgent settings panel. */
  config: BaAnnotatorConfig;
  /** Marks hidden via the AnnotatorBar eye toggle (runtime, not persisted UI). */
  hidden: boolean;
  /** Snapshot of the last clear, so a mis-sent batch can be restored. */
  clearedItems: BaAnnotationItem[];
}

interface BaAnnotatorConfig {
  /** Include element classes in the generated selector. */
  cssClasses: boolean;
  /** Capture the full element text (else truncated at 80 chars). */
  fullText: boolean;
  /** Record key computed styles of the marked element. */
  computedStyles: boolean;
  /** AnnotatorBar wipes marks right after Copy as Markdown. */
  clearAfterCopy: boolean;
}

const DEFAULT_CONFIG: BaAnnotatorConfig = {
  cssClasses: true,
  fullText: true,
  computedStyles: false,
  // Opt-in: copying marks should not wipe them unless the user asked for it.
  clearAfterCopy: false,
};

// Fast path for pages where annotations were never used: the mousemove
// handler must not pay for sessionStorage + JSON.parse on every event.
// Invalidated by baWriteState, so it is always coherent with real writes.
let baStateKnownAbsent = false;
const baBottomState = (): BaAnnotationState => ({
  active: false,
  items: [],
  config: {...DEFAULT_CONFIG},
  hidden: false,
  clearedItems: [],
});

const baReadState = (): BaAnnotationState => {
  if (baStateKnownAbsent) {
    const live = (window as unknown as Record<string, unknown>)[BA_WINDOW_KEY] as
      BaAnnotationState | undefined;
    if (!live) return baBottomState();
  }
  const merged = (state: BaAnnotationState): BaAnnotationState => {
    // Older persisted payloads miss the config keys; hidden stays runtime-only
    // so that after a reload marks always start visible.
    const fallback: BaAnnotationState = {
      active: false,
      items: [],
      config: {...DEFAULT_CONFIG},
      hidden: false,
      clearedItems: [],
    };
    return {
      ...fallback,
      ...state,
      config: {...DEFAULT_CONFIG, ...(state.config ?? {})},
      hidden: state.active ? state.hidden : false,
      clearedItems: Array.isArray(state.clearedItems) ? state.clearedItems : [],
    };
  };
  const existing = (window as unknown as Record<string, unknown>)[BA_WINDOW_KEY] as
    BaAnnotationState | undefined;
  if (existing && Array.isArray(existing.items)) {
    return merged(existing);
  }
  if (baStateKnownAbsent) {
    return baBottomState();
  }
  // Survive page reloads within the same webview session.
  try {
    const persisted = JSON.parse(
      window.sessionStorage.getItem(BA_WINDOW_KEY) ?? 'null'
    ) as BaAnnotationState | null;
    if (persisted && Array.isArray(persisted.items)) {
      persisted.active = false;
      baStateKnownAbsent = false;
      return merged(persisted);
    }
  } catch {
    // sessionStorage unavailable (sandboxed page) — memory-only mode.
  }
  baStateKnownAbsent = true;
  return baBottomState();
};

const baWriteState = (state: BaAnnotationState) => {
  baStateKnownAbsent = false;
  (window as unknown as Record<string, unknown>)[BA_WINDOW_KEY] = state;
  try {
    window.sessionStorage.setItem(
      BA_WINDOW_KEY,
      JSON.stringify({active: false, items: state.items, clearedItems: state.clearedItems})
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
  // Let the host bar mirror the in-guest toggle so it doesn't fight it.
  ipcRenderer.sendToHost('ba-annotate-toggled', state.active);
  if (state.active) {
    // Hostile pages may clear overlays; ensure the badge exists each toggle-on.
    baShowToggleBadge(state);
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
  if (state.active === enabled) {
    // Idempotent: the host poll re-asserts the mode every tick; no work and no
    // redraw when nothing changed (after a page reload state resets, so the
    // first call after a load still arms the mode).
    return state.active;
  }
  state.active = enabled;
  baWriteState(state);
  if (state.active) {
    baShowToggleBadge(state);
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

// ---------- DevTools-style hover highlight + picking signal ----------
// While annotate mode is on and Alt is held, the element under the cursor is
//outlined like a DevTools inspection; the host bar shows a picking hint.
const baHoverElement = document.createElement('div');
baHoverElement.id = 'ba-annotator-hover';
baHoverElement.style.cssText =
  'position:absolute;display:none;z-index:2147483645;border-radius:2px;' +
  'background:rgba(79,140,255,.22);border:2px solid #4f8cff;pointer-events:none;';

let baPicking = false;
const baSetPicking = (picking: boolean) => {
  if (baPicking === picking) {
    return;
  }
  baPicking = picking;
  ipcRenderer.sendToHost('ba-annotate-picking', picking);
};

const baIsOwnElement = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('#ba-annotator-popover, #ba-annotator-badge, #ba-annotator-hover') !== null;

const baAltHeld = (event: MouseEvent | KeyboardEvent): boolean =>
  event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;

const baHideHover = () => {
  baHoverElement.style.display = 'none';
};

const baHoverMove = (event: MouseEvent) => {
  const state = baReadState();
  const target = event.target instanceof Element ? event.target : null;
  if (!state.active || !baAltHeld(event) || !target || baIsOwnElement(target)) {
    baHideHover();
    baSetPicking(false);
    return;
  }
  baSetPicking(true);
  const rect = target.getBoundingClientRect();
  const style = baHoverElement.style;
  style.display = 'block';
  style.left = `${rect.left + window.scrollX}px`;
  style.top = `${rect.top + window.scrollY}px`;
  style.width = `${rect.width}px`;
  style.height = `${rect.height}px`;
};

const baHoverLeaveWindow = () => {
  baHideHover();
  baSetPicking(false);
};

const baBuildSelector = (element: Element): string => {
  const config = baReadState().config;
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current !== null && current !== document.documentElement && depth < 5) {
    const currentRef: Element = current;
    let part = currentRef.tagName.toLowerCase();
    if (config.cssClasses) {
      const classes = Array.from(currentRef.classList).filter((className) =>
        /^[\w-]+$/u.test(className)
      );
      if (classes.length > 0) {
        part += '.' + classes.slice(0, 2).join('.');
      }
    }
    if (currentRef.id.length > 0 && /^[\w-]+$/u.test(currentRef.id)) {
      // ids cannot contain whitespace/commas; an unusable one is just skipped.
      parts.unshift(`#${currentRef.id}`);
      break;
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
  return parts.join(' > ');
};

// Never capture what the page can't safely reveal: passwords, one-time codes
// and password-manager autocomplete hints. Everything else is the user's own
// data on their own screen, but credentials must never reach markdown exports.
const FORM_FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const isSensitiveField = (element: Element): boolean => {
  const type = (element.getAttribute('type') ?? '').toLowerCase();
  const autocomplete = (element.getAttribute('autocomplete') ?? '').toLowerCase();
  return (
    type === 'password' ||
    autocomplete.includes('password') ||
    autocomplete.includes('one-time-code')
  );
};

const baElementText = (element: Element): string => {
  const config = baReadState().config;
  const htmlElement = element as HTMLElement;
  if (isSensitiveField(element)) {
    return '[redacted]';
  }
  const raw =
    htmlElement instanceof HTMLInputElement || htmlElement instanceof HTMLTextAreaElement
      ? htmlElement.value
      : (element.getAttribute('aria-label') ??
        element.getAttribute('placeholder') ??
        element.textContent ??
        '');
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, config.fullText ? 400 : 80);
};

const STYLE_KEYS = [
  'display',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'color',
  'backgroundColor',
  'borderRadius',
  'padding',
  'margin',
] as const;

const baComputedStyles = (element: Element): string => {
  const computed = window.getComputedStyle(element);
  return STYLE_KEYS.map(
    (key) => `${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}: ${computed[key]}`
  ).join('; ');
};

// Agent-facing anchors: attributes that make the element findable without a
// search (links, images, form fields), a short markup snapshot and its bbox.
const BA_ATTRIBUTE_KEYS = [
  'id',
  'class',
  'href',
  'src',
  'alt',
  'title',
  'name',
  'type',
  'placeholder',
  'value',
  'role',
  'aria-label',
  'data-test',
  'data-testid',
] as const;

const baElementAttributes = (element: Element): string =>
  BA_ATTRIBUTE_KEYS.filter((key) => {
    if (!element.hasAttribute(key)) {
      return false;
    }
    // Typed values of form fields are not selectors — drop them entirely.
    // (Password values would leak through `value` and `html` otherwise.)
    if (key === 'value' && FORM_FIELD_TAGS.has(element.tagName)) {
      return false;
    }
    return true;
  })
    .map((key) => `${key}="${element.getAttribute(key)}"`)
    .join(' ');

const baElementHtml = (element: Element): string => {
  let html = element.outerHTML.replace(/\s+/gu, ' ').trim();
  if (FORM_FIELD_TAGS.has(element.tagName) || isSensitiveField(element)) {
    html = html
      // Strip value="..." / value='...' (unquoted values have no spaces by HTML rules).
      .replace(/(\svalue\s*=\s*)"[^"]*"/giu, '$1""')
      .replace(/(\svalue\s*=\s*)'[^']*'/giu, "$1''")
      .replace(/(\svalue\s*=\s*)[^\s>]+/giu, '$1""')
      // <textarea>secret</textarea> carries its value as inner text.
      .replace(/(<textarea[^>]*>)[\s\S]*?(<\/textarea>)/giu, '$1$2');
  }
  return html.slice(0, 300);
};

const baDrawMarks = (state: BaAnnotationState) => {
  document.querySelectorAll('ba-annotator-mark').forEach((mark) => mark.remove());
  if (!state.active || state.hidden) {
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
  // Clamp inside the viewport: a mark near the right or bottom edge must
  // never push the popover out of the visible guest area (it was cropped and
  // unusable there).
  const popoverWidth = 240 + 20;
  const popoverHeight = 170;
  const popLeft = Math.min(
    Math.max(4, rect.left + window.scrollX),
    Math.max(4, window.innerWidth + window.scrollX - popoverWidth)
  );
  const popTop = Math.min(
    rect.bottom + window.scrollY + 6,
    Math.max(4, window.innerHeight + window.scrollY - popoverHeight)
  );
  popover.style.cssText =
    'position:absolute;left:' +
    popLeft +
    'px;top:' +
    popTop +
    'px;z-index:2147483647;background:#1e1e24;color:#d7dce3;border-radius:10px;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.5);padding:10px;width:240px;pointer-events:auto;box-sizing:border-box;';
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
    const state = baReadState();
    const item: BaAnnotationItem = {
      // Number at save time, not at popover-open time, so the index can't go stale.
      index: state.items.length + 1,
      tag: element.tagName.toLowerCase(),
      text: baElementText(element),
      selector: baBuildSelector(element),
      feedback: textarea.value.replace(/\s+$/g, '').trim(),
    };
    if (state.config.computedStyles) {
      item.styles = baComputedStyles(element);
    }
    item.attributes = baElementAttributes(element);
    item.html = baElementHtml(element);
    const box = element.getBoundingClientRect();
    item.position = {
      x: Math.round(box.left + window.scrollX),
      y: Math.round(box.top + window.scrollY),
      width: Math.round(box.width),
      height: Math.round(box.height),
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
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (target.closest('#ba-annotator-popover, #ba-annotator-badge')) {
    return;
  }
  // Only Alt+click marks an element (user's explicit requirement): a plain
  // click must keep its native page behavior (navigation, links) and just
  // close a lingering popover.
  if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    const nextIndex = state.items.length + 1;
    const rect = target.getBoundingClientRect();
    baShowPopover(target, rect, nextIndex);
    return;
  }
  baHidePopover();
};

const baAnnotatorInit = () => {
  const api: BaAnnotationApi = {
    active: () => baReadState().active,
    get: () => baReadState().items,
    clear: () => {
      const state = baReadState();
      if (state.items.length > 0) {
        // Keep a restorable snapshot: clear is usually the agent picking the
        // batch up; a mis-sent batch must be undoable.
        state.clearedItems = state.items.map((item) => ({...item}));
      }
      state.items = [];
      baWriteState(state);
      baDrawMarks(state);
    },
    restore: () => {
      const state = baReadState();
      const backup = state.clearedItems ?? [];
      if (backup.length === 0) {
        return 0;
      }
      const base = state.items.length;
      state.items = [...state.items, ...backup.map((item, i) => ({...item, index: base + i + 1}))];
      state.clearedItems = [];
      baWriteState(state);
      baDrawMarks(state);
      return backup.length;
    },
    canRestore: () => (baReadState().clearedItems ?? []).length > 0,
    remove: (index: number) => {
      const state = baReadState();
      state.items = state.items.filter((item) => item.index !== index);
      state.items.forEach((item, position) => {
        item.index = position + 1;
      });
      baWriteState(state);
      baDrawMarks(state);
    },
    configure: (partial: Partial<BaAnnotatorConfig>) => {
      const state = baReadState();
      const next = {...state.config, ...partial};
      // No-op when nothing actually changed — the host re-applies config on a
      // poll, and unconditional writes/redraws would thrash every 1.5s.
      if (JSON.stringify(next) === JSON.stringify(state.config)) {
        return;
      }
      state.config = next;
      baWriteState(state);
      baDrawMarks(state);
    },
    setHidden: (hidden: boolean) => {
      const state = baReadState();
      if (state.hidden === hidden) {
        return;
      }
      state.hidden = hidden;
      baWriteState(state);
      baDrawMarks(state);
    },
    isHidden: () => baReadState().hidden,
    count: () => baReadState().items.length,
    edit: (index: number, feedback: string) => {
      const state = baReadState();
      const item = state.items.find((entry) => entry.index === index);
      if (item) {
        item.feedback = String(feedback ?? '');
        baWriteState(state);
        baDrawMarks(state);
      }
    },
  };
  // contextIsolation keeps this preload in an isolated world: its plain
  // window.* keys would be invisible to executeJavaScript (which runs in the
  // main world). contextBridge is the one legal path into the main-world
  // window object — expose only through it.
  contextBridge.exposeInMainWorld('baAnnotationApi', api);
  contextBridge.exposeInMainWorld('baAnnotatorSetEnabled', baSetEnabled);
  contextBridge.exposeInMainWorld('baAnnotatorToggle', baToggleMode);

  window.addEventListener('click', (event) => baAnnotateClick(event as MouseEvent), true);
  // Preload runs at document_start, where documentElement is still null —
  // append synchronously only when it exists, otherwise after DOMContentLoaded
  // (a null-documentElement throw killed init before the mousemove wiring).
  const attachHoverElement = () => {
    document.documentElement.appendChild(baHoverElement);
  };
  if (document.documentElement != null) {
    attachHoverElement();
  } else {
    window.addEventListener('DOMContentLoaded', attachHoverElement, {once: true});
  }
  window.addEventListener('mousemove', baHoverMove, {passive: true});
  window.addEventListener('keydown', (event) => {
    // event.code is layout-independent ('.' is ':>' = '.' with Shift on US),
    // and Ctrl must work too — metaKey alone is a no-op on Linux/Windows.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'Period') {
      event.preventDefault();
      baToggleMode();
      return;
    }
    if (event.key === 'Escape') {
      baHidePopover();
    }
    if (event.key === 'Alt' && baReadState().active) {
      baSetPicking(true);
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Alt') {
      baHideHover();
      baSetPicking(false);
    }
  });
  document.addEventListener('scroll', baHideHover, {passive: true, capture: true});
  window.addEventListener('mouseout', (event) => {
    if (!(event.relatedTarget instanceof Element)) {
      // Pointer left the guest viewport entirely.
      baHoverLeaveWindow();
    }
  });
  window.addEventListener('resize', () => baDrawMarks(baReadState()));
  window.addEventListener('resize', baHideHover);
};

baAnnotatorInit();
