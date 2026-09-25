// Contextual tips: one short line in a corner of the canvas, offered when the
// user is doing something a faster way exists for. They are deliberately
// scarce. A tip waits until its situation has come up a few times, is retired
// for good once the user uses the feature (or dismisses it), is shown at most
// twice ever, and only a few tips appear per session, several minutes apart.
// Everything here is pure; the editor supplies the clock and the storage.

export const TIPS = Object.freeze([
  {
    id: 'wire-alt',
    trigger: 'wire-start',
    after: 2,
    retiredBy: 'terminal-snap',
    text: 'Hold Alt while wiring: the cursor jumps to the nearest terminal or free wire end, so there is no need to aim.',
  },
  {
    id: 'pin-drag',
    trigger: 'wire-tool-start',
    after: 3,
    retiredBy: 'pin-drag',
    text: 'Wiring works without the Wire tool too: drag from any pin. Drop in empty space to add a part there.',
  },
  {
    id: 'place-symmetry',
    trigger: 'place-repeat',
    after: 2,
    retiredBy: 'symmetry',
    text: 'Hold Alt while placing to add a mirrored twin about an axis, which suits differential pairs and mirrors.',
  },
  {
    id: 'radial',
    trigger: 'move-start',
    after: 3,
    retiredBy: 'radial',
    text: 'Hold the right button on a part, or right-drag it, for a quick move, copy, and rotate menu.',
  },
  {
    id: 'knife',
    trigger: 'delete-click',
    after: 4,
    retiredBy: 'knife',
    text: 'In Delete, Shift-drag a stroke to remove every wire and part it crosses.',
  },
  {
    id: 'net-highlight',
    trigger: 'wire-commit',
    after: 6,
    retiredBy: 'net-highlight',
    text: 'Press 9 and click a net to color it through the whole drawing; 8 clears all highlights.',
  },
]);

export const TIP_COOLDOWN_MS = 4 * 60 * 1000;
export const TIPS_PER_SESSION = 3;
export const TIP_MAX_SHOWS = 2;

const TIP_EVENTS = new Set(TIPS.flatMap((tip) => [tip.trigger, tip.retiredBy]));

/** The persisted part of the tip state, normalized from whatever was stored. */
export function loadTipState(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const ids = new Set(TIPS.map((tip) => tip.id));
  const counts = (value, keys) => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
    .filter(([key, n]) => keys.has(key) && Number.isFinite(n) && n > 0));
  return {
    off: data.off === true,
    retired: [...new Set((Array.isArray(data.retired) ? data.retired : []).filter((id) => ids.has(id)))],
    shown: counts(data.shown, ids),
    seen: counts(data.seen, TIP_EVENTS),
  };
}

/** Tip bookkeeping for one editor session over a persisted state. */
export class TipBook {
  constructor(state = {}) {
    this.state = loadTipState(state);
    this.sessionShown = [];
    this.lastShownAt = -Infinity;
  }

  /** Record that `event` happened at `now` (ms). Returns the tip to show, or
   *  null. Using a feature retires its tip before anything else is decided. */
  note(event, now) {
    if (!TIP_EVENTS.has(event)) return null;
    const { state } = this;
    state.seen[event] = (state.seen[event] || 0) + 1;
    for (const tip of TIPS) if (tip.retiredBy === event) this.retire(tip.id);
    if (state.off || this.sessionShown.length >= TIPS_PER_SESSION || now - this.lastShownAt < TIP_COOLDOWN_MS) return null;
    const tip = TIPS.find((candidate) => candidate.trigger === event
      && !state.retired.includes(candidate.id)
      && !this.sessionShown.includes(candidate.id)
      && (state.shown[candidate.id] || 0) < TIP_MAX_SHOWS
      && state.seen[event] >= candidate.after);
    if (!tip) return null;
    state.shown[tip.id] = (state.shown[tip.id] || 0) + 1;
    this.sessionShown.push(tip.id);
    this.lastShownAt = now;
    return tip;
  }

  retire(id) {
    if (!this.state.retired.includes(id)) this.state.retired.push(id);
  }

  setOff(off) {
    this.state.off = !!off;
  }

  toJSON() {
    return { ...this.state, retired: [...this.state.retired], shown: { ...this.state.shown }, seen: { ...this.state.seen } };
  }
}
