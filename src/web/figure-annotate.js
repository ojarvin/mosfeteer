/**
 * Annotating a tool's table on the drawing: one math label, a table in TeX
 * (`&` between columns, `\hline` a rule: render.js mathTableHtml), known
 * by its figure identity (core/figures.js). Annotating again rewrites the
 * table there -- the selected one of that identity, else the only one --
 * keeping its top-left corner; with none, a new one goes where its kind
 * goes (figureSpot). The analyses' equation tables and the kT/C noise
 * table are these.
 */

import { arrangeFigures, chooseFigure, coreBounds, figureBounds, figureSpot, listFigures, newFigureId } from '../core/figures.js';
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
 * Put the table `text` (TeX lines, `columns` their alignment) on the drawing
 * as the figure `{ kind, source, key }`, or rewrite the one there. One undo
 * step. Returns { label, updated }.
 */
export function annotateMathFigure({ kind, source, key = null, text, columns = null }) {
  const circuit = editor.circuit;
  const identity = { kind, source, ...(key ? { key } : {}) };
  const target = chooseFigure(circuit, identity, selectedFigureMembers())?.labels.find((label) => label.math && !label.parent) || null;
  let label = null;
  let corner = null;
  commit(() => {
    if (target) {
      const box = target.bbox();
      corner = { x: box.x, y: box.y };
      // The same table again changes nothing (not even its measured size).
      if (target.text !== text) target.setText(text);
      target.columns = columns;
      label = target;
    } else {
      label = circuit.addLabel({ text, math: true, align: 'left', columns, x: 0, y: 0, figure: { id: newFigureId(circuit), ...identity } });
      corner = figureSpot(circuit, kind, { size: label.bbox(), except: label.figure.id });
    }
    const box = label.bbox();
    label.moveTo(snap(corner.x + box.w / 2), snap(corner.y + box.h / 2));
  });
  if (!label) return { label: null, updated: false };
  // Its size is an estimate until the browser measures it: an updated table
  // keeps its corner; a new one is packed again at its measured size if
  // that no longer fits where it was put.
  const id = label.figure.id;
  const place = target ? null : ([measured]) => {
    const box = measured.bbox();
    const others = listFigures(editor.circuit).filter((figure) => figure.id !== id).map((figure) => figureBounds(editor.circuit, figure));
    const core = coreBounds(editor.circuit);
    const at = { x: corner.x, y: corner.y, w: box.w, h: box.h };
    const overlaps = (r) => r && at.x < r.x + r.w && r.x < at.x + at.w && at.y < r.y + r.h && r.y < at.y + at.h;
    return [core, ...others].some(overlaps) ? figureSpot(editor.circuit, kind, { size: box, except: id }) : corner;
  };
  alignLabelColumn([label.id], { left: corner.x, top: corner.y, place });
  setSelection([]);
  setLabelSelection([label.id]);
  render();
  return { label, updated: !!target };
}

/** More → Arrange annotations: every figure where a new one goes
 *  (figures.js arrangeFigures), one undo step. */
export function installArrangeFigures() {
  document.getElementById('btn-arrange-figures')?.addEventListener('click', () => {
    let moved = 0;
    commit(() => { moved = arrangeFigures(editor.circuit); });
    render();
    logLine(moved ? `arranged the annotations: ${moved} moved` : 'the annotations are where they go already');
  });
}
