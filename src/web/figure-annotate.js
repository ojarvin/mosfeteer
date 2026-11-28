/**
 * Annotating a tool's table on the drawing (core/math-figure.js), then
 * placing it again once the browser has measured it. The analyses' equation
 * tables, the signal-flow coefficients table, and the kT/C noise table are
 * these.
 */

import { arrangeFigures, placeFigure, settlePlaced } from '../core/figures.js';
import { writeMathFigure as writeCoreMathFigure } from '../core/math-figure.js';
import { editor } from './editor-state.js';
import { alignLabelColumn, commit, render, selectedComps, selectedLabels, setLabelSelection, setSelection } from './main.js';
import { logLine } from './status-bar-ui.js';

/** What is selected, as figures.js chooseFigure takes it: label ids and part names. */
export const selectedFigureMembers = () => [...selectedLabels().map((label) => label.id), ...selectedComps().map((component) => component.refdes)];

/**
 * Write the table `text` (TeX lines, `columns` their alignment) as the
 * figure `{ kind, source, key }`, or rewrite the one there; inside a
 * commit. `create: false` only rewrites one there. Returns { label,
 * updated, settle }: `settle()`, after the commit, places it once the
 * browser has measured it.
 */
export function writeMathFigure({ kind, source, key = null, text, columns = null, create = true }) {
  const { label, updated, corner, repack } = writeCoreMathFigure(editor.circuit, { kind, source, key, text, columns, create, selected: selectedFigureMembers() });
  if (!label) return { label: null, updated: false, settle: () => {} };
  // Its size is an estimate until the browser measures it. Moved by hand,
  // it keeps its corner; else it and the figures packing placed are packed
  // again at its measured size.
  const id = label.figure.id;
  const settle = () => {
    const place = repack ? ([measured]) => placeFigure(editor.circuit, kind, { size: measured.bbox(), except: id }) : null;
    const settled = repack ? () => settlePlaced(editor.circuit, id) : null;
    alignLabelColumn([label.id], { left: corner.x, top: corner.y, place, settled });
  };
  return { label, updated, settle };
}

/**
 * Put the table `text` (TeX lines, `columns` their alignment) on the drawing
 * as the figure `{ kind, source, key }`, or rewrite the one there. One undo
 * step. Returns { label, updated }.
 */
export function annotateMathFigure(spec) {
  let written = null;
  commit(() => { written = writeMathFigure(spec); });
  if (!written?.label) return { label: null, updated: false };
  written.settle();
  setSelection([]);
  setLabelSelection([written.label.id]);
  render();
  return { label: written.label, updated: written.updated };
}

/** More → Arrange figures: every figure where a new one goes
 *  (figures.js arrangeFigures), one undo step. */
export function installArrangeFigures() {
  document.getElementById('btn-arrange-figures')?.addEventListener('click', () => {
    let moved = 0;
    commit(() => { moved = arrangeFigures(editor.circuit); });
    render();
    logLine(moved ? `arranged the annotations: ${moved} moved` : 'the annotations are where they go already');
  });
}
