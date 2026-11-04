/**
 * The analysis window's busy dots (busy-indicator.js), beside its title
 * while a Derive runs, whichever mode's: `deriving(work)` shows them, runs
 * `work` once they are on screen, and leaves them up a moment past a quick
 * one, so a Derive reads as one even when it is fast.
 */

import { afterPaint, busyIndicator } from './busy-indicator.js';

const SHOWN_AT_LEAST = 250; // ms

const busy = busyIndicator({ label: 'Deriving' });
let pending = 0;

/** Run a Derive's `work` with the dots shown. */
export function deriving(work) {
  if (!busy.el.isConnected) document.getElementById('analysis-dialog-title')?.after(busy.el);
  const run = ++pending;
  busy.set('derive', true);
  const shown = performance.now();
  afterPaint(() => {
    try {
      work();
    } finally {
      // A newer Derive keeps them up until it is done.
      setTimeout(() => { if (run === pending) busy.set('derive', false); }, Math.max(0, SHOWN_AT_LEAST - (performance.now() - shown)));
    }
  });
}
