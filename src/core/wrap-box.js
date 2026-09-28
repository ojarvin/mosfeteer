/**
 * A box annotation drawn around a set of objects: the parts (with their own
 * labels), labels and annotations, and nets (their wires and net labels).
 * It frames what is drawn -- symbol strokes, wires, and label text, as an
 * export does -- not the grid-rounded boxes, and stays on the grid at least
 * half a cell clear of it on every side.
 */

import { GRID } from './grid.js';

/** The grid rectangle around what everything in `selection` draws
 *  ({ refs, labelIds, netIds }), or null when it names nothing drawn. */
export function boxAroundRect(circuit, { refs = [], labelIds = [], netIds = [] } = {}) {
  const rects = [];
  const labels = new Set(labelIds);
  for (const ref of refs) {
    const component = circuit.components.get(ref);
    if (!component) continue;
    rects.push(component.inkRectWorld());
    for (const label of circuit.labels.values()) if (label.owner === ref) labels.add(label.id);
  }
  for (const id of netIds) {
    const net = circuit.nets.get(id);
    if (!net) continue;
    for (const path of net.paths()) for (const p of path) rects.push({ x: p.x, y: p.y, w: 0, h: 0 });
    for (const label of circuit.labels.values()) if (label.netId === id) labels.add(label.id);
  }
  for (const id of labels) {
    const label = circuit.labels.get(id);
    if (!label || label.selectable === false) continue;
    rects.push(label.inkRect());
  }
  if (!rects.length) return null;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  const clear = GRID / 2;
  const x = Math.floor((x0 - clear) / GRID) * GRID;
  const y = Math.floor((y0 - clear) / GRID) * GRID;
  return { x, y, w: Math.ceil((x1 + clear) / GRID) * GRID - x, h: Math.ceil((y1 + clear) / GRID) * GRID - y };
}

/** Add a box annotation around `selection` (see boxAroundRect), captioned
 *  `text` when given. Returns the box; throws when the selection is empty. */
export function addBoxAround(circuit, selection, { text = '' } = {}) {
  const rect = boxAroundRect(circuit, selection);
  if (!rect) throw new Error('nothing to put a box around');
  return circuit.addAnnotation('box', { x: rect.x, y: rect.y, end: { x: rect.x + rect.w, y: rect.y + rect.h }, text });
}
