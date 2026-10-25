// Contextual tips: one short line in a corner of the canvas, offered when the
// user is doing something a faster way exists for. They are deliberately
// scarce. A tip waits until its situation has come up a few times, is retired
// for good once the user uses the feature (or dismisses it), is shown at most
// twice ever, and at most one an hour.
// Everything here is pure; the editor supplies the clock and the storage.

export const TIPS = Object.freeze([
  {
    id: 'wire-alt',
    trigger: 'wire-start',
    after: 2,
    retiredBy: 'terminal-snap',
    text: 'Hold Alt while wiring to snap to the nearest terminal or wire end.',
  },
  {
    id: 'pin-drag',
    trigger: 'wire-tool-start',
    after: 3,
    retiredBy: 'pin-drag',
    text: 'Drag from any pin to draw a wire. Drop it in empty space to add a part there.',
  },
  {
    id: 'place-symmetry',
    trigger: 'place-repeat',
    after: 2,
    retiredBy: 'symmetry',
    text: 'Hold Alt while placing to add a mirrored twin, for differential pairs and mirrors.',
  },
  {
    id: 'radial',
    trigger: 'move-start',
    after: 3,
    retiredBy: 'radial',
    text: 'Right-hold and flick to add a part. On a pin, part, or wire, the ring offers what fits there.',
  },
  {
    id: 'knife',
    trigger: 'delete-click',
    after: 4,
    retiredBy: 'knife',
    text: 'In Delete, Shift-drag a stroke to remove the wires and parts it crosses.',
  },
  {
    id: 'net-highlight',
    trigger: 'wire-commit',
    after: 6,
    retiredBy: 'net-highlight',
    text: 'Press 9 and click a net to color it through the whole drawing; 8 clears all highlights.',
  },
  {
    id: 'switch-phase',
    trigger: 'switch-phase-set',
    after: 2,
    retiredBy: 'phase-menu',
    text: 'Right-click a switch → Phase sets its phase. s flips a whole phase.',
  },
  {
    id: 'timing-diagram',
    trigger: 'switch-phase-set',
    after: 4,
    retiredBy: 'timing-open',
    text: 'Shift+K opens the timing diagram of the switch phases.',
  },
  {
    id: 'timing-beats',
    trigger: 'timing-drawn',
    after: 2,
    retiredBy: 'phase-beats',
    text: 'Make beats in the timing diagram adds one beat per clock state.',
  },
  {
    id: 'symmetry-axis',
    trigger: 'mirrored-pair',
    after: 1,
    retiredBy: 'symmetry-axis',
    text: 'Press k to hold a symmetry axis: what you draw on one side is drawn on the other.',
  },
  {
    id: 'arrange-like',
    trigger: 'cell-selected',
    after: 1,
    retiredBy: 'arrange',
    text: 'Shift+Q draws the selected parts as your other drawings of them do.',
  },
  {
    id: 'arrange-suggestions',
    trigger: 'arrange',
    after: 1,
    retiredBy: 'arrange-suggestions-on',
    text: 'Settings → Arrange suggestions: as you complete a mirror or pair, Tab draws it as you drew it before.',
  },
  {
    id: 'built-in-drawings',
    trigger: 'arrange-built-in',
    after: 1,
    retiredBy: 'built-in-drawings-open',
    text: 'Learn → Symbols → Built-in drawings shows the cells Shift+Q knows when your designs have none.',
  },
]);

export const TIP_COOLDOWN_MS = 60 * 60 * 1000;
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
