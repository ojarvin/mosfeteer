/**
 * The symmetry axis (`k`, `:symmetry-axis`): an axis held until released,
 * about which every edit is mirrored (core/symmetry.js mirrorEdit). It goes
 * through the middle of the selection, or the cursor, on a grid or a
 * half-grid line, so mirror images stay on the grid. While it is held a
 * part being placed shows its twin, as with Alt, and each finished edit is
 * made on the other side too, in the same undo step. The axis is view
 * state: never saved, never an edit.
 */

import { noteTip } from './onboarding.js';
import { loadDocument } from '../core/document.js';
import { GRID } from '../core/grid.js';
import { mirrorEdit } from '../core/symmetry.js';
import { worldPerPixel } from './align-tool.js';
import { editor } from './editor-state.js';
import { clearSymmetry, markModelChanged, render, selectedComps } from './main.js';
import { hintLine, logLine } from './status-bar-ui.js';

let axis = null;
let layerEl = null;
let layerKey = '';

/** The axis held: `{ operation, pin }`, or null. */
export function symmetryAxis() {
  return axis;
}

/** The axis in the drawing's own terms, e.g. `x=400`. */
export function symmetryAxisLabel(held = axis) {
  if (!held) return '';
  return held.operation === 'mirrorX' ? `x=${held.pin.x}` : `y=${held.pin.y}`;
}

/** k: hold a vertical axis, then turn it horizontal (about the same
 *  point), then release it. */
export function cycleSymmetryAxis() {
  if (!axis) return setSymmetryAxis('mirrorX');
  if (axis.operation === 'mirrorX') return setSymmetryAxis('mirrorY', axis.pin);
  return setSymmetryAxis(null);
}

/** Hold an axis ('mirrorX': vertical, 'mirrorY': horizontal) through `pin`,
 *  else the middle of the selected parts, else the cursor; null releases it. */
export function setSymmetryAxis(operation, pin = null) {
  clearSymmetry();
  if (!operation) {
    axis = null;
    hintLine('symmetry axis released');
    render();
    return false;
  }
  noteTip('symmetry-axis');
  if (pin) {
    axis = { operation, pin: { ...pin } };
    logLine(`symmetry axis at ${symmetryAxisLabel()} · k releases`);
    render();
    return true;
  }
  const parts = selectedComps();
  let center = editor.cursor;
  if (parts.length) {
    const boxes = parts.map((c) => c.bboxWorld());
    const x0 = Math.min(...boxes.map((b) => b.x));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    center = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }
  // On a grid or half-grid line: a grid point's mirror image is on the grid.
  const half = GRID / 2;
  axis = { operation, pin: { x: Math.round(center.x / half) * half, y: Math.round(center.y / half) * half } };
  logLine(`symmetry axis at ${symmetryAxisLabel()}: what is drawn on one side is drawn on the other · k turns it, then releases it`);
  render();
  return true;
}

/** The axis as a part being placed takes it (main.js `symmetry`). */
export function axisPlacement() {
  return axis ? { pin: { ...axis.pin }, operation: axis.operation, settled: true } : null;
}

/** After an edit is recorded (as of `startSnapshot`): make it on the other
 *  side of the axis too, in the same undo step. */
export function mirrorRecordedEdit(startSnapshot) {
  if (!axis || !startSnapshot) return;
  const held = axis;
  const circuit = editor.circuit;
  // After the handler that recorded the edit has finished making it.
  queueMicrotask(() => {
    if (axis !== held || editor.circuit !== circuit) return;
    const done = mirrorEdit(loadDocument(JSON.parse(startSnapshot)), circuit, held);
    if (!done.added.length && !done.moved.length && !done.removed.length && !done.changed.length && !done.wires) return;
    markModelChanged();
    render();
  });
}

/** The status bar's line while an axis is held, or null. */
export function symmetryAxisHint() {
  return axis ? `AXIS ${symmetryAxisLabel()}: edits are mirrored · k ${axis.operation === 'mirrorX' ? 'turns it' : 'releases'}` : null;
}

/** A fresh layer in a newly built canvas, under the editor overlay. */
export function mountSymmetryAxis(svgEl) {
  layerEl = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  layerEl.setAttribute('class', 'symmetry-axis held');
  layerEl.setAttribute('pointer-events', 'none');
  svgEl.appendChild(layerEl);
  layerKey = '';
}

/** Draw the held axis across the view, or clear it. */
export function syncSymmetryAxis() {
  if (!layerEl) return;
  const view = editor.view;
  let svg = '';
  if (axis && view) {
    const px = worldPerPixel();
    const d = axis.operation === 'mirrorX'
      ? `M ${axis.pin.x} ${view.y - view.h} V ${view.y + 2 * view.h}`
      : `M ${view.x - view.w} ${axis.pin.y} H ${view.x + 2 * view.w}`;
    svg = `<path d="${d}" fill="none" stroke="#0ea5e9" stroke-width="${2 * px}" stroke-dasharray="${14 * px} ${5 * px} ${3 * px} ${5 * px}"/>`;
  }
  if (svg === layerKey) return;
  layerKey = svg;
  layerEl.innerHTML = svg;
}
