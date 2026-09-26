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

/**
 * The two or three keys that matter right now, as [keys, action] pairs, for
 * the footer's key strip. Picked from the armed tool, then the selection,
 * then what is under the pointer, then the empty editor. `ctx`:
 *   tool: 'move' | 'copy' | 'delete' | null   (armed tools without a hint)
 *   selection: { parts: [type...], labels, nets }
 *   hover: { pin: { connected } | null, part: type | null }
 *   repeat: label of the edit `.` repeats, or null
 *   empty: the drawing has nothing in it
 */
export function contextKeyHints({ tool = null, selection = {}, hover = {}, repeat = null, empty = false } = {}) {
  const hints = [];
  const add = (keys, action) => { if (hints.length < 3) hints.push([keys, action]); };
  if (tool === 'move') {
    add('click', 'pick up / drop');
    add('r', 'rotate while moving');
    add('Esc', 'exit');
    return hints;
  }
  if (tool === 'copy') {
    add('click', 'pick / place a copy');
    add('hold Alt', 'mirrored twin');
    add('Esc', 'exit');
    return hints;
  }
  if (tool === 'delete') {
    add('click', 'delete');
    add('Shift+drag', 'knife');
    add('Esc', 'exit');
    return hints;
  }
  const parts = selection.parts || [];
  const selected = parts.length + (selection.labels || 0) + (selection.nets || 0);
  if (selected && repeat) add('.', `repeat ${repeat}`);
  if (parts.length === 1 && !selection.labels && !selection.nets) {
    if (/^switch_/.test(parts[0])) add('s', 'open / close its phase');
    add('q', 'change type');
    add('r', 'rotate');
    add('Space', 'wire stubs');
    return hints;
  }
  if (parts.length > 1) {
    add('m', 'move');
    add('q', 'change type');
    add('Shift+T', 'tidy');
    return hints;
  }
  if (selection.labels) {
    add('t', 'edit text');
    add('Shift+←/→', 'align text');
    add('arrows', 'nudge');
    return hints;
  }
  if (selection.nets) {
    add('Shift+T', 'tidy');
    add('Shift+L', 'net label');
    add('dd', 'delete');
    return hints;
  }
  if (hover.pin) {
    add('drag', 'wire from this pin');
    if (!hover.pin.connected) add('g / v', 'ground / supply');
    add('w', 'wire tool');
    return hints;
  }
  if (hover.part) {
    add('t', 'edit its label');
    add('q', 'change type');
    add('right-drag', 'quick actions');
    return hints;
  }
  if (empty) {
    add('i', 'insert a part');
    add('double-click', 'insert here');
    add('?', 'every key');
    return hints;
  }
  add('i', 'insert');
  add('w', 'wire');
  add('?', 'every key');
  return hints;
}
