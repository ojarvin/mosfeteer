/**
 * The brief flash over what an undoable edit changed. What changed is
 * worked out in commit-feedback.js; this queues and plays it. A new wire
 * draws itself in: a stroke of the paper over each new run (`.landing-reveal`)
 * pulls back from end to end, uncovering it. That stroke, the ripples, and
 * the dots are on a layer of their own over the drawing (`svg.landing-layer`,
 * framed as the drawing is), so as they move nothing of the drawing is
 * painted again.
 */

import { Circuit } from '../core/model.js';
import { commitFeedbackDiff, commitFeedbackSvg, isEmptyFeedback } from './commit-feedback.js';
import { editor } from './editor-state.js';
import { frameLike } from './canvas-view.js';
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
    for (const el of editor.canvasSvgEl?.parentNode?.querySelectorAll(`[data-burst="${burst.id}"]`) || []) el.remove();
    if (!commitFeedbackBursts.length) landingLayer(false)?.remove();
    syncSolders();
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

/** The layer the feedback moves on, over the drawing (made when `make`). */
function landingLayer(make = true) {
  const canvas = editor.canvasSvgEl?.parentNode;
  if (!canvas) return null;
  let layer = canvas.querySelector(':scope > svg.landing-layer');
  if (!layer && make) {
    layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    layer.setAttribute('class', 'landing-layer');
    layer.setAttribute('aria-hidden', 'true');
    canvas.appendChild(layer);
  }
  if (layer) frameLike(layer);
  return layer;
}

export function mountCommitFeedback(force = false) {
  if (!editor.canvasSvgEl) return;
  const underlay = editor.canvasSvgEl.querySelector(':scope > .editor-underlay');
  if (!commitFeedbackBursts.length) {
    landingLayer(false)?.remove();
    underlay?.replaceChildren();
    syncSolders();
    return;
  }
  const layer = landingLayer();
  // Kept above the drawing's other layers (the math labels), never moved
  // needlessly: re-inserting a node restarts its CSS animations.
  if (layer.parentNode.lastElementChild !== layer) layer.parentNode.appendChild(layer);
  if (force || !layer.firstChild) {
    // Negative delays resume each burst where it was if the canvas was rebuilt.
    const now = performance.now();
    const groups = (part) => commitFeedbackBursts
      .map((b) => `<g data-burst="${b.id}" style="--landing-elapsed:${-Math.round(now - b.start)}ms">${part === 'over' ? `${b.reveal || ''}${b.over}` : b[part]}</g>`)
      .join('');
    layer.innerHTML = groups('over');
    if (underlay) underlay.innerHTML = groups('under');
  }
  syncSolders();
}

/** Each new solder dot hidden until its wire reaches it, then popping in. */
function syncSolders() {
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
}
