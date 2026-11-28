/**
 * A tool's table on the drawing: one math label, a table in TeX (`&`
 * between columns, `\hline` a rule: render.js mathTableHtml), known by its
 * figure identity (figures.js). Writing it again rewrites the table there --
 * the selected one of that identity, else the only one -- keeping its
 * top-left corner; with none, a new one goes where its kind goes, packed
 * with the rest (placeFigure). The editor (web/figure-annotate.js) and the
 * analyze commands' --annotate both write through here.
 */

import { chooseFigure, newFigureId, packed, placeFigure, settlePlaced } from './figures.js';
import { snap } from './grid.js';

/**
 * Write the table `text` (TeX lines, `columns` their alignment) as the
 * figure `{ kind, source, key }` on `circuit`, or rewrite the one there.
 * `selected` (label ids and part names) picks among several of the
 * identity; `create: false` only rewrites one there. Returns { label,
 * updated, corner, repack }: its size is an estimate until a browser
 * measures it, so a caller that can measure packs it again from `corner`
 * when `repack` (it was placed by packing, not moved by hand).
 */
export function writeMathFigure(circuit, { kind, source, key = null, text, columns = null, create = true, selected = [] }) {
  const identity = { kind, source, ...(key ? { key } : {}) };
  const figure = chooseFigure(circuit, identity, selected);
  const target = figure?.labels.find((label) => label.math && !label.parent) || null;
  if (!target && !create) return { label: null, updated: false, corner: null, repack: false };
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
  return { label, updated: !!target, corner, repack };
}
