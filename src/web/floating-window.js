/**
 * Floating windows: the beats, the timing diagram editor, and the
 * small-signal analysis float over the drawing, where the side panel docks
 * beside it. Each is a `.floating-window` in the canvas pane with one title
 * bar: the title to drag it by, then a close × at the right. A window stays
 * where it was put (per window, in this browser) and inside the pane.
 */

const PLACE_KEY = (key) => `mosfeteer.window.${key}`;
const MARGIN = 8;


/** Where a window of `size` ({ w, h }) goes in a pane of `pane` ({ w, h }):
 *  `stored` ({ x, y }) when there is one, else `place`'s default, clamped so
 *  the whole window stays in the pane (or its top-left, when it cannot). */
export function floatingWindowPosition(pane, size, stored, place) {
  const at = stored && Number.isFinite(stored.x) && Number.isFinite(stored.y) ? stored : place(pane, size);
  const x = Math.min(Math.max(MARGIN, at.x), Math.max(MARGIN, pane.w - size.w - MARGIN));
  const y = Math.min(Math.max(MARGIN, at.y), Math.max(MARGIN, pane.h - size.h - MARGIN));
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

/**
 * Make `el` a floating window. `onClose` runs for its ×; `place` gives its
 * default position; `resizable` keeps the size the user drags its corner to.
 * Returns { place() }, to call after showing it (it also comes to the
 * front), and dispose(), for a window that is removed rather than hidden.
 */
export function floatingWindow(el, { key, onClose, place = PLACE.topRight, resizable = false }) {
  const pane = el.closest('.canvas-pane') || el.parentElement;
  const header = el.querySelector('.floating-window-header');
  el.querySelector('.floating-window-close')?.addEventListener('click', () => onClose?.());
  let stored = readPlace(key);
  if (resizable && stored?.w && stored?.h) {
    el.style.width = `${stored.w}px`;
    el.style.height = `${stored.h}px`;
  }

  const paneSize = () => ({ w: pane.clientWidth, h: pane.clientHeight });
  const apply = () => {
    if (el.hidden) return;
    const size = { w: el.offsetWidth, h: el.offsetHeight };
    const at = floatingWindowPosition(paneSize(), size, stored, place);
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
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
    const start = { x: ev.clientX, y: ev.clientY, left: el.offsetLeft, top: el.offsetTop };
    header.setPointerCapture(ev.pointerId);
    el.classList.add('dragging');
    const move = (e) => {
      stored = { ...stored, x: start.left + e.clientX - start.x, y: start.top + e.clientY - start.y };
      apply();
    };
    const end = () => {
      header.removeEventListener('pointermove', move);
      el.classList.remove('dragging');
      stored = { ...stored, x: el.offsetLeft, y: el.offsetTop };
      writePlace(key, stored);
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end, { once: true });
    header.addEventListener('pointercancel', end, { once: true });
  });
  // Double-clicking the title bar puts the window back in its default place.
  header?.addEventListener('dblclick', (ev) => {
    if (ev.target.closest('button, input, select, textarea, a')) return;
    stored = resizable && stored?.w ? { w: stored.w, h: stored.h } : null;
    writePlace(key, stored);
    apply();
  });

  // A smaller pane (a docked side panel, a narrower window) pulls it back in;
  // its own new size (content, or the corner grip) may push it out too.
  const observers = typeof ResizeObserver === 'function'
    ? [new ResizeObserver(apply), new ResizeObserver(() => {
      if (resizable && !el.hidden && el.style.width) {
        stored = { ...stored, w: el.offsetWidth, h: el.offsetHeight };
        writePlace(key, stored);
      }
      apply();
    })]
    : [];
  observers[0]?.observe(pane);
  observers[1]?.observe(el);
  return {
    place: () => { raise(); apply(); },
    dispose: () => observers.forEach((observer) => observer.disconnect()),
  };
}
