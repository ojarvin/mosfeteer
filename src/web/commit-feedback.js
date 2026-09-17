/**
 * Commit feedback: what visibly "landed" between two committed documents.
 *
 * The editor flashes these regions briefly after an undoable edit. The diff is
 * geometric rather than per-tool, so placement, wiring, moves, copies, pastes,
 * label edits, and console commands all get the same feedback without each
 * tool describing its own result. Undo/redo never call this.
 */

import { GRID } from '../core/grid.js';
import { componentShapeSvg, labelShapeSvg } from '../core/render.js';

// A huge edit (select-all move, loading a template through a command) should
// still acknowledge the commit without building thousands of SVG nodes.
const MAX_RECTS = 80;
const MAX_PIECES = 1500;
const MAX_POINTS = 60;

const pointKey = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;

function componentKey(json) {
  return JSON.stringify(json);
}

/** Split a drawable path into grid-length pieces so re-segmented but
 * geometrically unchanged wires (a junction split, collinear merge) compare
 * equal. Diagonal segments stay whole. */
function wirePieces(paths) {
  const pieces = new Map();
  for (const { netId, pts } of paths) {
    if (!pts || pts.length < 2) continue;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const steps = (dx === 0 || dy === 0) ? Math.max(1, Math.round(Math.abs(dx + dy) / GRID)) : 1;
      for (let s = 0; s < steps; s++) {
        const p = { x: a.x + (dx * s) / steps, y: a.y + (dy * s) / steps };
        const q = { x: a.x + (dx * (s + 1)) / steps, y: a.y + (dy * (s + 1)) / steps };
        const [lo, hi] = pointKey(p) < pointKey(q) ? [p, q] : [q, p];
        // Keyed per net: a wire moved onto another net's wire is still new.
        pieces.set(`${netId}|${pointKey(lo)}|${pointKey(hi)}`, { a: lo, b: hi });
      }
    }
  }
  return pieces;
}

function circuitWirePieces(circuit) {
  const paths = [];
  for (const net of circuit.nets.values()) {
    try { paths.push(...net.paths().map((pts) => ({ netId: net.id, pts }))); } catch { /* unroutable net: nothing drawn */ }
  }
  return wirePieces(paths);
}

function connectedTerminalKeys(circuit) {
  const keys = new Set();
  for (const net of circuit.nets.values()) {
    if ((net.terminals?.length || 0) < 2 && !(net.junctions?.length)) continue;
    for (const t of net.terminals || []) keys.add(`${t.comp}.${t.term}`);
  }
  return keys;
}

function labelKey(label) {
  let box = null;
  try { box = label.bbox(); } catch { /* no drawable box */ }
  // Owned labels store a local offset, so compare the world box as well.
  return JSON.stringify([label.toJSON ? label.toJSON() : label, box]);
}

/**
 * Compare the committed `before` circuit with `after`. Returns world geometry:
 * - components/labels: added or changed objects (from `after`);
 * - pieces: added wire pieces ({a,b});
 * - points: new connections (new solder junctions, newly connected pins,
 *   and pins touched by a new wire piece) — where the edit "clicked" in;
 * - removedComponents/removedLabels/removedPieces: what a deletion removed
 *   (from `before`). A deletion that reroutes the remaining wires is still a
 *   deletion: its reroute is not flashed as an addition.
 */
export function commitFeedbackDiff(before, after) {
  const components = [];
  const labels = [];
  const removedComponents = [];
  const removedLabels = [];
  const points = new Map();

  const beforeComps = new Map([...before.components.values()].map((c) => [c.refdes, c]));
  for (const c of after.components.values()) {
    const old = beforeComps.get(c.refdes);
    beforeComps.delete(c.refdes);
    if (c.type === 'solder') {
      if (!old || old.transform.x !== c.transform.x || old.transform.y !== c.transform.y) points.set(pointKey(c.transform), { x: c.transform.x, y: c.transform.y });
      continue;
    }
    if (old && componentKey(old.toJSON()) === componentKey(c.toJSON())) continue;
    components.push(c);
  }
  for (const c of beforeComps.values()) {
    if (c.type !== 'solder') removedComponents.push(c);
  }

  const beforeLabels = new Map(before.labels);
  for (const label of after.labels.values()) {
    const old = beforeLabels.get(label.id);
    beforeLabels.delete(label.id);
    if (old && labelKey(old) === labelKey(label)) continue;
    labels.push(label);
  }
  removedLabels.push(...beforeLabels.values());

  const oldPieces = circuitWirePieces(before);
  const newPieces = circuitWirePieces(after);
  const pieces = [];
  for (const [key, piece] of newPieces) if (!oldPieces.has(key)) pieces.push(piece);
  const removedPieces = [];
  for (const [key, piece] of oldPieces) if (!newPieces.has(key)) removedPieces.push(piece);

  // A deletion removed objects, or removed wire without drawing any. Moving or
  // shortening a wire removes more pieces than it adds, but is not a deletion.
  const deletion = !components.length && !labels.length
    && (removedComponents.length || removedLabels.length || (removedPieces.length && !pieces.length));
  if (deletion) {
    return {
      components: [], labels: [], pieces: [], points: [],
      removedComponents: removedComponents.slice(0, MAX_RECTS),
      removedLabels: removedLabels.slice(0, MAX_RECTS),
      removedPieces: removedPieces.slice(0, MAX_PIECES),
    };
  }

  // Pins that gained a connection, or sit at an end of a freshly drawn wire.
  const pieceEnds = new Map();
  for (const { a, b } of pieces) {
    for (const p of [a, b]) {
      const key = pointKey(p);
      pieceEnds.set(key, (pieceEnds.get(key) || 0) + 1);
    }
  }
  const wasConnected = connectedTerminalKeys(before);
  const isConnected = connectedTerminalKeys(after);
  for (const c of after.components.values()) {
    if (c.type === 'solder') continue;
    for (const t of c.worldTerminals()) {
      const id = `${c.refdes}.${t.name}`;
      if (!isConnected.has(id)) continue;
      const key = pointKey(t);
      if (!wasConnected.has(id) || pieceEnds.get(key) === 1) points.set(key, { x: t.x, y: t.y });
    }
  }

  return {
    components: components.slice(0, MAX_RECTS),
    labels: labels.slice(0, MAX_RECTS),
    pieces: pieces.slice(0, MAX_PIECES),
    points: [...points.values()].slice(0, MAX_POINTS),
    removedComponents: [],
    removedLabels: [],
    removedPieces: [],
  };
}

export function isEmptyFeedback(diff) {
  return !diff || Object.values(diff).every((list) => !list.length);
}

const f = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

/** One label's traced shape; a math label (HTML) falls back to a soft box. */
function labelTrace(label, boxClass) {
  const shape = labelShapeSvg(label);
  if (shape) return shape;
  try {
    const r = label.bbox();
    return `<rect class="${boxClass}" x="${f(r.x)}" y="${f(r.y)}" width="${f(r.w)}" height="${f(r.h)}" rx="6"/>`;
  } catch {
    return '';
  }
}

/** SVG markup for one feedback burst: `under` glows behind the drawing (the
 * objects' own shapes, restyled by CSS), `over` sits on top (connection
 * ripples, and the trailing red halo of deleted objects). */
export function commitFeedbackSvg(diff) {
  const piecePath = (list) => list.map(({ a, b }) => `M ${f(a.x)} ${f(a.y)} L ${f(b.x)} ${f(b.y)}`).join(' ');
  const under = [];
  const over = [];
  const glow = [
    ...diff.components.map((c) => componentShapeSvg(c)),
    ...diff.labels.map((label) => labelTrace(label, 'landing-box')),
  ].join('');
  if (glow) under.push(`<g class="landing-glow">${glow}</g>`);
  if (diff.pieces.length) under.push(`<path class="landing-wire" d="${piecePath(diff.pieces)}"/>`);
  for (const p of diff.points) {
    over.push(`<circle class="landing-ripple" cx="${f(p.x)}" cy="${f(p.y)}" r="18"/>`);
    over.push(`<circle class="landing-dot" cx="${f(p.x)}" cy="${f(p.y)}" r="6"/>`);
  }
  const removed = [
    ...diff.removedComponents.map((c) => componentShapeSvg(c)),
    ...diff.removedLabels.map((label) => labelTrace(label, 'landing-box')),
    diff.removedPieces.length ? `<path d="${piecePath(diff.removedPieces)}" fill="none"/>` : '',
  ].join('');
  if (removed) over.push(`<g class="landing-removed">${removed}</g>`);
  return { under: under.join(''), over: over.join('') };
}
