/**
 * The brief flash over what an undoable edit changed. What changed is
 * worked out in commit-feedback.js; this queues and plays it. A new wire
 * draws itself in: a mask over the wire ink hides each new run and uncovers
 * it from end to end.
 */

import { Circuit } from '../core/model.js';
import { commitFeedbackDiff, commitFeedbackSvg, isEmptyFeedback } from './commit-feedback.js';
import { editor } from './editor-state.js';
import { reducedMotion } from './motion.js';

/** A burst's life: a wire drawing in, then the ripple where it lands. */
const COMMIT_FEEDBACK_MS = 800;

let commitFeedbackBursts = [];

let commitFeedbackSeq = 0;

export function queueCommitFeedback(startSnapshot, when) {
  if (when === 'none') {
    // Wire drags already show the wire under the pointer the whole time; a
    // flash on drop only flickers.
    editor.pendingFeedbackSnapshot = null;
    return;
  }
  const base = editor.pendingFeedbackSnapshot || startSnapshot;
  if (when === 'defer') {
    editor.pendingFeedbackSnapshot = base;
    return;
  }
  editor.pendingFeedbackSnapshot = null;
  playCommitFeedback(base);
}

export function flushPendingCommitFeedback() {
  if (!editor.pendingFeedbackSnapshot || editor.drag || editor.previewTransaction) return;
  const base = editor.pendingFeedbackSnapshot;
  editor.pendingFeedbackSnapshot = null;
  playCommitFeedback(base);
}

export function playCommitFeedback(beforeSnapshot) {
  let diff;
  try {
    diff = commitFeedbackDiff(Circuit.fromJSON(JSON.parse(beforeSnapshot)), editor.circuit);
  } catch {
    return; // feedback is decoration; never let it break a commit
  }
  if (isEmptyFeedback(diff)) return;
  if (window.__commitFeedbackLog) window.__commitFeedbackLog.push(Object.fromEntries(Object.entries(diff).map(([key, list]) => [key, list.length])));
  const burst = { id: ++commitFeedbackSeq, ...commitFeedbackSvg(diff, { from: wireStart() }), start: performance.now() };
  commitFeedbackBursts.push(burst);
  if (reducedMotion()) {
    burst.reveal = '';
    burst.solders = [];
  }
  setTimeout(() => {
    commitFeedbackBursts = commitFeedbackBursts.filter((b) => b !== burst);
    for (const el of editor.canvasSvgEl?.querySelectorAll(`[data-burst="${burst.id}"]`) || []) el.remove();
    syncRevealMask();
  }, COMMIT_FEEDBACK_MS);
  mountCommitFeedback(true);
}

/** Where the wire being committed was begun (it is still the draft while
 *  its commit is recorded): its pin, or its free point. */
function wireStart() {
  const source = editor.wire?.source;
  if (!source) return null;
  if (source.refdes) return editor.circuit.components.get(source.refdes)?.terminalWorld(source.term) || null;
  return { x: source.x, y: source.y };
}

export function mountCommitFeedback(force = false) {
  if (!editor.canvasSvgEl) return;
  let layer = editor.canvasSvgEl.querySelector(':scope > .commit-feedback');
  const underlay = editor.canvasSvgEl.querySelector(':scope > .editor-underlay');
  if (layer && !force) {
    // Keep it above the overlay, but never move it needlessly: re-inserting a
    // node restarts its CSS animations, which flickered on every pointer move.
    if (editor.canvasSvgEl.lastElementChild !== layer) editor.canvasSvgEl.appendChild(layer);
    syncRevealMask();
    return;
  }
  if (!commitFeedbackBursts.length) {
    layer?.remove();
    underlay?.replaceChildren();
    syncRevealMask();
    return;
  }
  if (!layer) {
    layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('class', 'commit-feedback');
    layer.setAttribute('aria-hidden', 'true');
  }
  // Negative delays resume each burst where it was if the canvas was rebuilt.
  const now = performance.now();
  const groups = (part) => commitFeedbackBursts
    .map((b) => `<g data-burst="${b.id}" style="--landing-elapsed:${-Math.round(now - b.start)}ms">${b[part]}</g>`)
    .join('');
  layer.innerHTML = groups('over');
  if (underlay) underlay.innerHTML = groups('under');
  if (editor.canvasSvgEl.lastElementChild !== layer) editor.canvasSvgEl.appendChild(layer);
  syncRevealMask();
}

const REVEAL_MASK_ID = 'landing-reveal-mask';
/** What the reveal hides along a new wire: the painted wires and pin
 *  leads, and the editor's own layers over and under them (a hover's or a
 *  selection's glow), so nothing shows the wire before it is drawn. */
const WIRE_INK = '.wire-ink, .wire-managed:not([stroke-opacity="0"]), .wire-beat, .editor-overlay, .editor-underlay';

/** The one mask every burst's new runs share (an element takes one mask),
 *  on the wire ink while any is drawing in, and gone once none is; and each
 *  new solder dot hidden until its wire reaches it, then popping in. */
function syncRevealMask() {
  const svg = editor.canvasSvgEl;
  if (!svg) return;
  const now = performance.now();
  const waiting = new Map(commitFeedbackBursts.flatMap((b) => (b.solders || []).map((s) => [s.refdes, s.at - Math.round(now - b.start)])));
  for (const el of svg.querySelectorAll('.sym.landing-solder')) {
    if (!waiting.has(el.dataset.ref)) el.classList.remove('landing-solder');
  }
  for (const [refdes, delay] of waiting) {
    const el = svg.querySelector(`g.sym[data-ref="${CSS.escape(refdes)}"]`);
    if (!el || el.classList.contains('landing-solder')) continue;
    el.style.setProperty('--landing-solder-at', `${delay}ms`);
    el.classList.add('landing-solder');
  }
  const runs = commitFeedbackBursts.filter((b) => b.reveal)
    .map((b) => `<g style="--landing-elapsed:${-Math.round(now - b.start)}ms">${b.reveal}</g>`).join('');
  let mask = svg.querySelector(`#${REVEAL_MASK_ID}`);
  if (!runs) {
    mask?.remove();
    for (const el of svg.querySelectorAll(`[mask="url(#${REVEAL_MASK_ID})"]`)) el.removeAttribute('mask');
    return;
  }
  if (!mask) {
    mask = document.createElementNS('http://www.w3.org/2000/svg', 'mask');
    mask.id = REVEAL_MASK_ID;
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    // The whole plane: a mask's default region is its element's box, which a
    // straight wire's has no height.
    for (const [name, value] of Object.entries({ x: -1e6, y: -1e6, width: 2e6, height: 2e6 })) mask.setAttribute(name, value);
    svg.prepend(mask);
  }
  // Rewritten only when the bursts change, so their animations run on.
  const key = commitFeedbackBursts.filter((b) => b.reveal).map((b) => b.id).join(',');
  if (mask.dataset.bursts !== key) {
    mask.dataset.bursts = key;
    // White as a keyword: the theme repaints a canvas `#fff` fill as the
    // paper, dark in the dark theme, which would fade every wire under it.
    mask.innerHTML = `<rect x="-1000000" y="-1000000" width="2000000" height="2000000" fill="white"/>${runs}`;
  }
  for (const el of svg.querySelectorAll(WIRE_INK)) el.setAttribute('mask', `url(#${REVEAL_MASK_ID})`);
}
