/**
 * A busy indicator: three dots at a triangle's corners, each in turn
 * crossing the line through the other two, while some work runs -- beside
 * a window's title (the Plots window's, the analysis window's, the run
 * window's). The dots move by transform alone (style.css), so the browser
 * keeps them going even while a simulation holds the page's thread.
 */

import { element as el } from './dom.js';

/**
 * A new indicator, hidden until busy. `set(key, on)` marks one piece of
 * work (`'spectrum'`, `'swing'`) running or done; the dots show while any
 * is running, so overlapping work needs no counting. Returns `{ el, set,
 * busy() }`.
 */
export function busyIndicator({ label = 'Simulating' } = {}) {
  const node = el('span', { class: 'busy-dots', role: 'status', 'aria-label': label, title: label, hidden: true }, [
    el('span'), el('span'), el('span'),
  ]);
  const running = new Set();
  return {
    el: node,
    set(key, on) {
      if (on) running.add(key);
      else running.delete(key);
      node.hidden = !running.size;
    },
    busy: () => running.size > 0,
  };
}

/** Run `work` once the page has painted: what was just shown (the dots)
 *  is on screen before work that holds the thread starts. */
export function afterPaint(work) {
  requestAnimationFrame(() => setTimeout(work, 0));
}
