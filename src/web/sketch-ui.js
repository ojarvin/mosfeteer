/**
 * The Sketch tool (j): marker strokes over the design while it is
 * discussed (core/sketch.js). Arming it shows the sketch layer; Esc (or
 * another tool) leaves it and hides the layer again, and arming it again
 * brings the strokes back. A drag draws in the chosen color; Shift-drag,
 * or the eraser, removes the strokes it crosses. The sketch is saved with
 * the design but is no drawing edit: Ctrl/Cmd+Z in the tool steps back
 * through the sketch's own changes, and the design never becomes unsaved
 * for it (document-session.js writes it with the windows' state).
 */

import { SKETCH_COLORS, SKETCH_WIDTH, eraseStrokes, simplifyStroke, strokeSvg } from '../core/sketch.js';
import { runCommand } from '../core/commands.js';
import { COLOR_PALETTE } from '../core/style.js';
import { editor } from './editor-state.js';
import { persistDraft } from './document-session.js';
import { logLine, hintLine } from './status-bar-ui.js';
import { render, scheduleInteractionRender } from './main.js';

const UNDO_LIMIT = 200;
// Screen pixels the eraser reaches either side of the pointer.
const ERASER_PX = 8;

let visible = false;
let color = SKETCH_COLORS[0];
let eraser = false;
let revision = 0;
// The stroke being drawn, or the eraser's last point.
let live = null;
// The sketch's earlier states, for undo in the tool; per document.
let undo = { circuit: null, states: [] };

const sketch = () => editor.circuit.sketch;
const barEl = () => document.getElementById('sketch-bar');

/** Whether the sketch layer is on show. */
export const sketchShown = () => visible;
/** A number that changes whenever the sketch does: the canvas redraws on it. */
export const sketchRevision = () => revision;

function undoStates() {
  if (undo.circuit !== editor.circuit.sketch) undo = { circuit: editor.circuit.sketch, states: [] };
  return undo.states;
}

/** Remember the sketch as it is, before a change. */
function rememberSketch() {
  const states = undoStates();
  states.push(sketch().strokes.slice());
  if (states.length > UNDO_LIMIT) states.shift();
}

/** The sketch changed: draw it again, and keep it in the window's draft. */
function sketchChanged() {
  revision += 1;
  persistDraft();
  render();
}

/** Show or hide the sketch layer (the tool arms and disarms it). */
export function setSketchVisible(on) {
  if (visible === on) return;
  visible = on;
  live = null;
  revision += 1;
  syncSketchBar();
}

/** Ctrl/Cmd+Z in the tool: the sketch as it was before its last change. */
export function undoSketch() {
  const states = undoStates();
  if (!states.length) {
    hintLine('SKETCH: nothing to undo');
    return;
  }
  undo.circuit.strokes = states.pop();
  sketchChanged();
}

/** Remove every stroke (one step undoes it). */
export function clearSketch() {
  const count = sketch().strokes.length;
  if (!count) {
    hintLine('SKETCH: the sketch is empty');
    return;
  }
  rememberSketch();
  sketch().strokes = [];
  logLine(`cleared ${count} sketch stroke${count === 1 ? '' : 's'}`);
  sketchChanged();
}

/** `sketch ...` typed on the command line: the sketch's own change, never a
 *  drawing edit. Returns the error message when it fails. */
export function runSketchLine(line) {
  let result;
  rememberSketch();
  const before = sketch().strokes.length;
  try {
    result = runCommand(editor.circuit, line);
  } catch (err) {
    undoStates().pop();
    const message = String(err.message || err);
    logLine(message);
    return message;
  }
  if (result?.text) logLine(result.text);
  if (result?.mutated || sketch().strokes.length !== before) sketchChanged();
  else undoStates().pop();
  return undefined;
}

/** The eraser's reach in world units at this zoom. */
function eraserRadius() {
  const pane = document.querySelector('.canvas-pane')?.getBoundingClientRect();
  return pane?.width ? (ERASER_PX * editor.view.w) / pane.width : ERASER_PX;
}

/** A press in the tool: a stroke starts, or (Shift, or the eraser) erasing.
 *  `radius`: the eraser's reach in world units (the editor's at its zoom by
 *  default; the presenter gives its own). */
export function sketchDown(world, { shiftKey = false, radius = null } = {}) {
  rememberSketch();
  if (eraser || shiftKey) {
    live = { erase: true, last: world, erased: 0, radius };
    sketchMove(world);
    return;
  }
  live = { erase: false, points: [world] };
  scheduleInteractionRender();
}

/** The pointer moved while pressed. Returns how many strokes the eraser
 *  took on the way (0 while drawing). */
export function sketchMove(world) {
  if (!live) return 0;
  if (live.erase) {
    const gone = eraseStrokes(sketch(), live.last, world, live.radius ?? eraserRadius());
    live.last = world;
    if (gone) {
      live.erased += gone;
      revision += 1;
      render();
    }
    return gone;
  }
  const last = live.points[live.points.length - 1];
  if (Math.hypot(world.x - last.x, world.y - last.y) < 0.5) return 0;
  live.points.push(world);
  scheduleInteractionRender();
  return 0;
}

/** The points of the stroke being drawn (none while erasing). */
export const liveSketchPoints = () => (live && !live.erase ? live.points : null);
/** The marker's color now. */
export const sketchColor = () => color;

/** The press let go: the stroke is kept, smoothed. */
export function sketchUp() {
  if (!live) return;
  const done = live;
  live = null;
  if (done.erase) {
    if (!done.erased) undoStates().pop();
    else sketchChanged();
    return;
  }
  sketch().strokes.push({ color, width: SKETCH_WIDTH, points: simplifyStroke(done.points) });
  sketchChanged();
}

/** The stroke being drawn, as overlay markup in world units. */
export function liveSketchSvg() {
  if (!live || live.erase || !live.points.length) return '';
  return `<g class="sketch-live" opacity="0.8" pointer-events="none">${strokeSvg({ color, width: SKETCH_WIDTH, points: live.points })}</g>`;
}

/** The bar over the drawing while the tool is armed: colors, eraser, clear. */
export function syncSketchBar() {
  const bar = barEl();
  if (!bar) return;
  bar.hidden = !visible;
  for (const button of bar.querySelectorAll('[data-sketch-color]')) {
    button.setAttribute('aria-checked', String(!eraser && button.dataset.sketchColor === color));
  }
  bar.querySelector('#sketch-eraser')?.setAttribute('aria-pressed', String(eraser));
}

export function installSketchUi() {
  const bar = barEl();
  if (!bar) return;
  const swatches = bar.querySelector('.sketch-colors');
  for (const token of SKETCH_COLORS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.setAttribute('role', 'radio');
    button.dataset.sketchColor = token;
    const name = token[0].toUpperCase() + token.slice(1);
    button.setAttribute('aria-label', name);
    button.title = name;
    button.style.setProperty('--swatch', COLOR_PALETTE[token]);
    swatches?.append(button);
  }
  bar.addEventListener('click', (ev) => {
    const swatch = ev.target.closest('[data-sketch-color]');
    if (swatch) {
      color = swatch.dataset.sketchColor;
      eraser = false;
    } else if (ev.target.closest('#sketch-eraser')) eraser = !eraser;
    else if (ev.target.closest('#sketch-clear')) clearSketch();
    else return;
    syncSketchBar();
    document.getElementById('canvas')?.focus({ preventScroll: true });
  });
  syncSketchBar();
}
