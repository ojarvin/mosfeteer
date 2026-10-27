/**
 * Annotating a tool's table on the drawing: one math label, a table in TeX
 * (`&` between columns, `\hline` a rule: render.js mathTableHtml), known
 * by its figure identity (core/figures.js). Annotating again rewrites the
 * table there -- the selected one of that identity, else the only one --
 * keeping its top-left corner; with none, a new one goes where its kind
 * goes, packed with the rest (placeFigure). The analyses' equation tables,
 * the signal-flow coefficients table, and the kT/C noise table are these.
 */

import { arrangeFigures, chooseFigure, newFigureId, packed, placeFigure, settlePlaced } from '../core/figures.js';
import { snap } from '../core/grid.js';
import { editor } from './editor-state.js';
import { alignLabelColumn, commit, render, selectedComps, selectedLabels, setLabelSelection, setSelection } from './main.js';
import { logLine } from './status-bar-ui.js';

/** What is selected, as figures.js chooseFigure takes it: label ids and part names. */
export const selectedFigureMembers = () => [...selectedLabels().map((label) => label.id), ...selectedComps().map((component) => component.refdes)];

/** Splits an equation at its first `=` outside braces: [left, '= right'],
 *  or ['', equation] without one -- the two columns of an equation table. */
export function equationCells(equation) {
  const text = String(equation);
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === '=' && depth === 0 && text[i - 1] !== '\\' && !'<>!'.includes(text[i - 1] || '') && text[i + 1] !== '=') {
      return [text.slice(0, i).trim(), `= ${text.slice(i + 1).trim()}`];
    }
  }
  return ['', text.trim()];
}

/**
 * Write the table `text` (TeX lines, `columns` their alignment) as the
 * figure `{ kind, source, key }`, or rewrite the one there; inside a
 * commit. `create: false` only rewrites one there. Returns { label,
 * updated, settle }: `settle()`, after the commit, places it once the
 * browser has measured it.
 */
export function writeMathFigure({ kind, source, key = null, text, columns = null, create = true }) {
  const circuit = editor.circuit;
  const identity = { kind, source, ...(key ? { key } : {}) };
  const figure = chooseFigure(circuit, identity, selectedFigureMembers());
  const target = figure?.labels.find((label) => label.math && !label.parent) || null;
  if (!target && !create) return { label: null, updated: false, settle: () => {} };
  // Placed by packing (new, or never moved by hand): packed again once its
  // size is known.
  const repack = !target || packed(circuit, figure);
  let label;
  let corner;
  if (target) {
    const box = target.bbox();
    corner = { x: box.x, y: box.y };
    // The same table again changes nothing (not even its measured size).
    if (target.text !== text) target.setText(text);
    target.columns = columns;
    label = target;
  } else {
    label = circuit.addLabel({ text, math: true, align: 'left', columns, x: 0, y: 0, figure: { id: newFigureId(circuit), ...identity } });
    corner = placeFigure(circuit, kind, { size: label.bbox(), except: label.figure.id });
  }
  const box = label.bbox();
  label.moveTo(snap(corner.x + box.w / 2), snap(corner.y + box.h / 2));
  if (repack) settlePlaced(circuit, label.figure.id);
  // Its size is an estimate until the browser measures it. Moved by hand,
  // it keeps its corner; else it and the figures packing placed are packed
  // again at its measured size.
  const id = label.figure.id;
  const settle = () => {
    const place = repack ? ([measured]) => placeFigure(editor.circuit, kind, { size: measured.bbox(), except: id }) : null;
    const settled = repack ? () => settlePlaced(editor.circuit, id) : null;
    alignLabelColumn([label.id], { left: corner.x, top: corner.y, place, settled });
  };
  return { label, updated: !!target, settle };
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
