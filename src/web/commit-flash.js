/**
 * The brief flash over what an undoable edit changed. What changed is
 * worked out in commit-feedback.js; this queues and plays it.
 */

import { Circuit } from '../core/model.js';
import { commitFeedbackDiff, commitFeedbackSvg, isEmptyFeedback } from './commit-feedback.js';
import { editor } from './editor-state.js';

const COMMIT_FEEDBACK_MS = 650;

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
  const burst = { id: ++commitFeedbackSeq, ...commitFeedbackSvg(diff), start: performance.now() };
  commitFeedbackBursts.push(burst);
  setTimeout(() => {
    commitFeedbackBursts = commitFeedbackBursts.filter((b) => b !== burst);
    for (const el of editor.canvasSvgEl?.querySelectorAll(`[data-burst="${burst.id}"]`) || []) el.remove();
  }, COMMIT_FEEDBACK_MS);
  mountCommitFeedback(true);
}

export function mountCommitFeedback(force = false) {
  if (!editor.canvasSvgEl) return;
  let layer = editor.canvasSvgEl.querySelector(':scope > .commit-feedback');
  const underlay = editor.canvasSvgEl.querySelector(':scope > .editor-underlay');
  if (layer && !force) {
    // Keep it above the overlay, but never move it needlessly: re-inserting a
    // node restarts its CSS animations, which flickered on every pointer move.
    if (editor.canvasSvgEl.lastElementChild !== layer) editor.canvasSvgEl.appendChild(layer);
    return;
  }
  if (!commitFeedbackBursts.length) {
    layer?.remove();
    underlay?.replaceChildren();
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
}
