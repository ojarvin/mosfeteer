/**
 * Floating windows: the beats, the timing diagram editor, the small-signal
 * analysis, and reference windows float over the drawing, where the side
 * panel docks beside it. Each is a `.floating-window` in the canvas pane with
 * one title bar: the title to drag it by, then a dock button and a close ×
 * at the right. A window stays where it was put (per window, in this
 * browser), inside the pane and clear of the tool rail -- or, docked, in
 * the side panel as one of its sections.
 */

const PLACE_KEY = (key) => `mosfeteer.window.${key}`;
const MARGIN = 8;


/** Where a window of `size` ({ w, h }) goes in a pane of `pane` ({ w, h }):
 *  `stored` ({ x, y }) when there is one, else `place`'s default, clamped so
 *  the whole window stays in the pane (or its top-left, when it cannot) and
 *  off `avoid` ({ x, y, w, h }, the tool rail): beside it when the window
 *  is level with it -- or, with no room beside it, below it. */
export function floatingWindowPosition(pane, size, stored, place, avoid = null) {
  const at = stored && Number.isFinite(stored.x) && Number.isFinite(stored.y) ? stored : place(pane, size);
  const clampX = (x, left = MARGIN) => Math.min(Math.max(left, x), Math.max(left, pane.w - size.w - MARGIN));
  const clampY = (y, top = MARGIN) => Math.min(Math.max(top, y), Math.max(top, pane.h - size.h - MARGIN));
  let x = clampX(at.x);
  let y = clampY(at.y);
  if (avoid) {
    const right = avoid.x + avoid.w + MARGIN;
    const bottom = avoid.y + avoid.h + MARGIN;
    const level = y < bottom && y + size.h > avoid.y - MARGIN;
    if (level && x < right) {
      // Beside the rail when the window fits there, else under it.
      if (pane.w - right - MARGIN >= size.w || pane.h - bottom - MARGIN < size.h) x = clampX(x, right);
      else y = clampY(bottom, bottom);
    }
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** Default placements. */
export const PLACE = Object.freeze({
  topRight: (pane, size) => ({ x: pane.w - size.w - 52, y: MARGIN }),
  topCenter: (pane, size) => ({ x: (pane.w - size.w) / 2, y: 56 }),
  bottomCenter: (pane, size) => ({ x: (pane.w - size.w) / 2, y: pane.h - size.h - 12 }),
});

function readPlace(key) {
  try {
    const value = JSON.parse(localStorage.getItem(PLACE_KEY(key)) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

function writePlace(key, value) {
  try { localStorage.setItem(PLACE_KEY(key), JSON.stringify(value)); } catch { /* per-session only */ }
}

/** Within this many pixels of the pane's right edge, a dragged window docks. */
const DOCK_EDGE = 28;
/** A docked window's title bar dragged this far pulls it out to float. */
const UNDOCK_DRAG = 8;

function iconSvg(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('button-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}

// A window into the panel's column, or out of it.
const DOCK_ICON = '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/><path d="M15 8h4M15 11h4" stroke-width="1.2"/>';

/**
 * Make `el` a floating window. `onClose` runs for its ×; `place` gives its
 * default position; `resizable` keeps the size the user drags its corner to.
 * Every window can also dock: its dock button (or a drag against the pane's
 * right edge) puts it in the side panel as a section, full width and sharing
 * the column's height; the button again, or dragging its title bar out,
 * floats it where it was. A click on a docked window's title bar folds it
 * to that bar. Where a window is, docked or not, is kept per window in this
 * browser. Returns { place() }, to call after showing it (it also comes to
 * the front), and dispose(), for a window that is removed rather than hidden.
 */
export function floatingWindow(el, { key, onClose, place = PLACE.topRight, resizable = false }) {
  const pane = el.closest('.canvas-pane') || el.parentElement;
  const panel = document.getElementById('side-panel');
  const header = el.querySelector('.floating-window-header');
  const closeButton = el.querySelector('.floating-window-close');
  closeButton?.addEventListener('click', () => onClose?.());
  let stored = readPlace(key);
  const sizeFromStore = () => {
    if (resizable && stored?.w && stored?.h) {
      el.style.width = `${stored.w}px`;
      el.style.height = `${stored.h}px`;
    }
  };
  sizeFromStore();

  const docked = () => el.classList.contains('docked');
  const paneSize = () => ({ w: pane.clientWidth, h: pane.clientHeight });
  // Windows keep clear of the tool rail on the pane's left -- the rail
  // itself, not the paper under it: never placed or dragged over it.
  const rail = pane.querySelector('.mode-toolbar');
  const railRect = () => (rail && rail.offsetWidth
    ? { x: rail.offsetLeft, y: rail.offsetTop, w: rail.offsetWidth, h: rail.offsetHeight }
    : null);
  const apply = () => {
    if (el.hidden || docked()) return;
    const room = `${Math.max(0, paneSize().w - 2 * MARGIN)}px`;
    if (el.style.maxWidth !== room) el.style.maxWidth = room;
    const size = { w: el.offsetWidth, h: el.offsetHeight };
    const at = floatingWindowPosition(paneSize(), size, stored, place, railRect());
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
  };

  // ----- docking -----
  const dockButton = document.createElement('button');
  dockButton.type = 'button';
  dockButton.className = 'floating-window-dock';
  dockButton.append(iconSvg(DOCK_ICON));
  if (closeButton) header?.insertBefore(dockButton, closeButton);
  else header?.append(dockButton);
  const syncDockButton = () => {
    const on = docked();
    dockButton.setAttribute('aria-pressed', String(on));
    dockButton.setAttribute('aria-label', on ? 'Float over the drawing' : 'Dock in the side panel');
    dockButton.title = on ? 'Float this window over the drawing again (or drag its title bar out)' : 'Dock this window in the side panel (or drag it to the right edge)';
    header?.setAttribute('aria-expanded', String(!el.classList.contains('folded')));
  };
  // A docked window's height, when its top edge was dragged: a fixed share
  // of the column, the rest of which the panel's sections share.
  const dockHeight = () => {
    const h = docked() && !el.classList.contains('folded') ? stored?.dockH : null;
    if (h) {
      el.style.setProperty('--dock-height', `${h}px`);
      el.dataset.dockSized = '';
    } else {
      el.style.removeProperty('--dock-height');
      delete el.dataset.dockSized;
    }
  };
  const resizer = document.createElement('div');
  resizer.className = 'floating-window-dock-resizer';
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'horizontal');
  resizer.title = 'Drag to resize; double-click to reset';
  el.prepend(resizer);
  resizer.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !docked()) return;
    ev.preventDefault();
    resizer.setPointerCapture(ev.pointerId);
    const start = { y: ev.clientY, h: el.offsetHeight };
    // It grows by what the column's other sections can still give up.
    const spare = [...panel.children].reduce((sum, child) => {
      if (child === el || !child.offsetHeight) return sum;
      const style = getComputedStyle(child);
      if (style.position === 'absolute' || Number(style.flexShrink) === 0) return sum;
      return sum + Math.max(0, child.offsetHeight - (parseFloat(style.minHeight) || 0));
    }, 0);
    const max = start.h + spare;
    panel.classList.add('resizing');
    let frame = 0;
    let lastY = start.y;
    const step = () => {
      frame = 0;
      stored = { ...stored, dockH: Math.round(Math.min(max, Math.max(96, start.h - (lastY - start.y)))) };
      dockHeight();
    };
    const move = (e) => {
      lastY = e.clientY;
      if (!frame) frame = requestAnimationFrame(step);
    };
    const end = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        step();
      }
      resizer.removeEventListener('pointermove', move);
      resizer.removeEventListener('pointerup', end);
      resizer.removeEventListener('pointercancel', end);
      panel.classList.remove('resizing');
      writePlace(key, stored);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', end);
    resizer.addEventListener('pointercancel', end);
  });
  resizer.addEventListener('dblclick', () => {
    stored = { ...stored, dockH: undefined };
    writePlace(key, stored);
    dockHeight();
  });

  const setDocked = (on, { remember = true } = {}) => {
    if (!panel || on === docked()) return;
    if (on) {
      el.classList.add('docked');
      el.classList.toggle('folded', !!stored?.folded);
      for (const prop of ['left', 'top', 'width', 'height', 'maxWidth']) el.style[prop] = '';
      panel.appendChild(el);
    } else {
      el.classList.remove('docked', 'folded');
      pane.appendChild(el);
      sizeFromStore();
    }
    dockHeight();
    stored = { ...stored, docked: on || undefined };
    if (remember) writePlace(key, stored);
    syncDockButton();
    // The side panel shows what is docked in it (not when restoring a dock).
    if (remember) el.dispatchEvent(new CustomEvent('floating-window-dock', { bubbles: true, detail: { docked: on } }));
    apply();
  };
  dockButton.addEventListener('click', () => setDocked(!docked()));
  const setFolded = (on) => {
    el.classList.toggle('folded', on);
    stored = { ...stored, folded: on || undefined };
    dockHeight();
    writePlace(key, stored);
    syncDockButton();
  };

  // The window last opened or pressed comes to the front of the others.
  const raise = () => {
    if (el.classList.contains('front')) return;
    for (const other of document.querySelectorAll('.floating-window.front')) other.classList.remove('front');
    el.classList.add('front');
  };
  el.addEventListener('pointerdown', raise, true);

  header?.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.target.closest('button, input, select, textarea, a')) return;
    ev.preventDefault();
    header.setPointerCapture(ev.pointerId);
    const press = { x: ev.clientX, y: ev.clientY };
    // Floating, the title bar drags the window; docked, a click folds it and
    // a drag pulls it out, under the pointer, to go on dragging.
    // A drag moves the window by a transform, at most once a frame, from
    // geometry read once: moving it by left/top would lay its content out
    // again on every pointer move. Its place is committed on release.
    const begin = (x, y) => ({
      x, y, left: el.offsetLeft, top: el.offsetTop,
      size: { w: el.offsetWidth, h: el.offsetHeight }, pane: paneSize(), rail: railRect(),
      right: pane.getBoundingClientRect().right,
    });
    let start = docked() ? null : begin(ev.clientX, ev.clientY);
    let moved = false;
    let frame = 0;
    let pending = null;
    let at = null;
    const atEdge = (e) => !!panel && e.clientX >= (start?.right ?? pane.getBoundingClientRect().right) - DOCK_EDGE;
    const follow = () => {
      frame = 0;
      const e = pending;
      stored = { ...stored, x: start.left + e.clientX - start.x, y: start.top + e.clientY - start.y };
      at = floatingWindowPosition(start.pane, start.size, stored, place, start.rail);
      el.style.transform = `translate(${at.x - start.left}px, ${at.y - start.top}px)`;
      panel?.classList.toggle('dock-target', atEdge(e));
    };
    const settle = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (pending && start && moved) follow();
      el.style.transform = '';
      if (at) {
        el.style.left = `${at.x}px`;
        el.style.top = `${at.y}px`;
      }
    };
    const move = (e) => {
      if (!start) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < UNDOCK_DRAG) return;
        const grab = e.clientX - el.getBoundingClientRect().left;
        setDocked(false);
        // Moving the window between parents drops the pointer capture.
        header.setPointerCapture(e.pointerId);
        const paneRect = pane.getBoundingClientRect();
        const left = e.clientX - paneRect.left - Math.min(grab, el.offsetWidth / 2);
        const top = e.clientY - paneRect.top - header.offsetHeight / 2;
        stored = { ...stored, x: left, y: top };
        apply();
        start = begin(e.clientX, e.clientY);
      }
      moved = true;
      el.classList.add('dragging');
      pending = e;
      if (!frame) frame = requestAnimationFrame(follow);
    };
    const end = (e) => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', end);
      header.removeEventListener('pointercancel', end);
      settle();
      el.classList.remove('dragging');
      panel?.classList.remove('dock-target');
      if (!start) {
        // A click on a docked title bar folds the window to it, or unfolds it.
        if (e.type === 'pointerup') setFolded(!el.classList.contains('folded'));
        return;
      }
      if (moved && e.type === 'pointerup' && atEdge(e)) {
        stored = { ...stored, x: start.left, y: start.top };
        setDocked(true);
        return;
      }
      if (at) stored = { ...stored, x: at.x, y: at.y };
      writePlace(key, stored);
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
  });
  // Double-clicking the title bar puts a floating window back in its default place.
  header?.addEventListener('dblclick', (ev) => {
    if (docked() || ev.target.closest('button, input, select, textarea, a')) return;
    stored = resizable && stored?.w ? { w: stored.w, h: stored.h } : null;
    writePlace(key, stored);
    apply();
  });

  // A smaller pane (a docked side panel, a narrower window) pulls it back in;
  // its own new size (content, or the corner grip) may push it out too.
  // A size dragged from the corner is saved once it rests, not every frame.
  let saveTimer = 0;
  const observers = typeof ResizeObserver === 'function'
    ? [new ResizeObserver(apply), new ResizeObserver(() => {
      if (resizable && !el.hidden && !docked() && el.style.width) {
        stored = { ...stored, w: el.offsetWidth, h: el.offsetHeight };
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => writePlace(key, stored), 250);
      }
      apply();
    })]
    : [];
  observers[0]?.observe(pane);
  observers[1]?.observe(el);
  if (stored?.docked) setDocked(true, { remember: false });
  syncDockButton();
  return {
    place: () => { raise(); apply(); },
    docked,
    dispose: () => observers.forEach((observer) => observer.disconnect()),
  };
}
