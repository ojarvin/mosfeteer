/**
 * Status bar and log drawer state.
 *
 * The footer is one slim line: a mode pill, the current hint, and fixed chips.
 * The log and command line live in a drawer that overlays the canvas instead
 * of taking permanent layout space. Its open/close rules are a pure reducer so
 * hover peeks, error peeks, click-open, command entry, and pinning compose
 * without timers or DOM state leaking into each other.
 */

export const LOG_DRAWER_CLOSED = Object.freeze({ open: false, pinned: false, reason: null });

// Reasons that close by themselves when the pointer leaves the footer.
const TRANSIENT = new Set(['hover', 'peek']);

/** Next drawer state for one event. Events:
 *  toggle (message chip click), hover (pointer rests on the chip), leave
 *  (pointer leaves footer+drawer), error (an error was logged), peek-timeout
 *  ({ inside } says whether the pointer is over the footer), command (`:`),
 *  command-done (the command input lost focus), dismiss (Esc / outside
 *  click), pin (toggle pinning). */
export function logDrawerTransition(state, event) {
  const s = state || LOG_DRAWER_CLOSED;
  const close = () => (s.pinned ? s : LOG_DRAWER_CLOSED);
  switch (event?.type) {
    case 'toggle':
      if (s.open && !TRANSIENT.has(s.reason)) return LOG_DRAWER_CLOSED;
      return { open: true, pinned: s.pinned, reason: 'click' };
    case 'hover':
      return s.open ? s : { open: true, pinned: s.pinned, reason: 'hover' };
    case 'leave':
      return s.open && TRANSIENT.has(s.reason) ? close() : s;
    case 'error':
      return s.open ? s : { open: true, pinned: s.pinned, reason: 'peek' };
    case 'peek-timeout':
      if (!s.open || s.reason !== 'peek') return s;
      return event.inside ? { ...s, reason: 'hover' } : close();
    case 'command':
      return { open: true, pinned: s.pinned, reason: 'command' };
    case 'command-done':
      return s.open && s.reason === 'command' ? close() : s;
    case 'dismiss':
      return s.open ? close() : s;
    case 'pin':
      return s.pinned ? { ...s, pinned: false } : { open: true, pinned: true, reason: s.reason || 'click' };
    default:
      return s;
  }
}

/** Zoom as a percentage of the editor's default scale (`basePxPerUnit`). */
export function zoomPercent(view, paneWidth, basePxPerUnit) {
  if (!view?.w || !paneWidth || !basePxPerUnit) return 100;
  return Math.round(((paneWidth / view.w) / basePxPerUnit) * 100);
}

/** Split the legacy status parts into the pill, hint, and chip fields. Empty
 *  selection shows no chip rather than a placeholder dash. */
export function statusFields({ mode, selection, cursor, hints = [] }) {
  return {
    mode: String(mode || 'NORMAL'),
    selection: selection || '',
    cursor: cursor ? `${cursor.x}, ${cursor.y}` : '',
    hint: hints.filter(Boolean).join('  ·  '),
  };
}
