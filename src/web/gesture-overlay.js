/**
 * The canvas's gesture layer: pin handles, the snap pulse on the terminal a
 * wire will land on, and the Delete tool's knife stroke with the cuts it
 * makes. The stroke geometry is in gestures.js.
 */

import { componentShapeSvg } from '../core/render.js';
import { GRID } from '../core/grid.js';
import { knifeCrossings, pinHandleRadius, strokeCrossesPolyline, strokeCrossesRect } from './gestures.js';
import { noteTip } from './onboarding.js';
import { logLine, hintLine } from './status-bar-ui.js';
import { paneSize } from './canvas-view.js';
import { netMarkerRefs } from './hover-preview.js';
import { editor } from './editor-state.js';
import { deleteSelection, keyToWire, nearestTerminal, netsTouching, placementJoinPoints, setLabelSelection, setSelection, splicePreviewTarget, syncSelectedWire } from './main.js';

/** A wire end that lands on a pin gets one small ripple at that pin; so does
 *  every pin of a part being placed, moved, or copied that will join a pin or
 *  a free wire end, with a ring that stays while it would. */
export function syncSnapPulse() {
  if (!editor.snapLayerEl) return;
  const source = (editor.wire || editor.directWire)?.source;
  let points = [];
  if (source) {
    const target = nearestTerminal(editor.cursor);
    if (target && target.x === editor.cursor.x && target.y === editor.cursor.y
        && !(target.refdes === source.refdes && target.term === source.term)) points = [target];
  } else {
    points = placementJoinPoints();
  }
  const key = points.map((p) => `${p.x},${p.y}`).sort().join(' ');
  if (key === editor.snapPulseKey) return;
  const before = new Set(editor.snapPulseKey ? editor.snapPulseKey.split(' ') : []);
  editor.snapPulseKey = key;
  // Only a newly reached point ripples; the rest keep their steady ring.
  editor.snapLayerEl.innerHTML = points.map(({ x, y }) => `<circle class="snap-ring" cx="${x}" cy="${y}" r="10"/>${
    before.has(`${x},${y}`) ? '' : `<circle class="snap-pulse" cx="${x}" cy="${y}" r="10"/>`}`).join('');
}

/** Every drawn wire path, fixed and managed, for knife hit tests. */
function allWirePaths() {
  return [...editor.circuit.nets.values()].flatMap((net) => net.paths().map((pts, branch) => ({ netId: net.id, branch, pts })));
}

/** The drawn outline of a box, line, or arrow annotation, or null for text. */
/** The part of an arrow or box its captions attach to: an arrow's start
 * point, where addAnnotation places the caption, or the box's rectangle. */
export function annotationReach(label) {
  if (label.kind === 'arrow' && label.points?.length) {
    const a = label.points[0];
    return { x0: a.x, x1: a.x, y0: a.y, y1: a.y };
  }
  if (label.kind !== 'box') return null;
  const b = label.bbox();
  return { x0: b.x, x1: b.x + b.w, y0: b.y, y1: b.y + b.h };
}

function annotationOutline(label) {
  if (['line', 'arrow'].includes(label.kind)) return label.points || null;
  if (label.kind !== 'box') return null;
  const x0 = Math.min(label.anchor.x, label.end.x); const x1 = Math.max(label.anchor.x, label.end.x);
  const y0 = Math.min(label.anchor.y, label.end.y); const y1 = Math.max(label.anchor.y, label.end.y);
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
}

/** Everything a knife stroke cuts: wire segments it crosses, parts whose body
 * it passes through, line/arrow/box annotations whose linework it crosses, and
 * free text or net labels it passes through. A part's box is inset a little so
 * cutting a wire at a pin does not take the part too. Owned name labels go
 * with their part, and solder dots follow the wires, so neither is a target. */
function knifeTargets(stroke) {
  const inset = GRID / 4;
  const refs = [];
  for (const c of editor.circuit.components.values()) {
    if (c.type === 'solder') continue;
    const r = c.bboxWorld();
    if (strokeCrossesRect(stroke, { x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - 2 * inset })) refs.push(c.refdes);
  }
  const labelIds = [];
  for (const label of editor.circuit.labels.values()) {
    if (label.owner || label.selectable === false) continue;
    const outline = annotationOutline(label);
    if (outline ? strokeCrossesPolyline(stroke, outline) : strokeCrossesRect(stroke, label.bbox())) labelIds.push(label.id);
  }
  return { wires: knifeCrossings(stroke, allWirePaths()), refs, labels: labelIds };
}

/** Delete everything a knife stroke cuts, as one undo entry. */
export function cutAlong(stroke) {
  noteTip('knife');
  const { wires, refs, labels: labelIds } = knifeTargets(stroke);
  if (!wires.length && !refs.length && !labelIds.length) {
    hintLine('knife: nothing crossed');
    return;
  }
  setSelection(refs);
  setLabelSelection(labelIds);
  editor.selectedNets.clear();
  editor.selectedWires = new Set(wires);
  syncSelectedWire();
  deleteSelection();
  const counts = [
    wires.length && `${wires.length} wire segment${wires.length === 1 ? '' : 's'}`,
    refs.length && `${refs.length} part${refs.length === 1 ? '' : 's'}`,
    labelIds.length && `${labelIds.length} label${labelIds.length === 1 ? '' : 's'}/annotation${labelIds.length === 1 ? '' : 's'}`,
  ].filter(Boolean);
  logLine(`knife cut ${counts.join(', ')}`);
}

/** Gesture feedback appended to the editor overlay's elements, in world units. */
export function withGestureOverlay(svg, ghost) {
  const parts = [];
  // Nets attached to the selected parts carry a faint tint of the selection.
  if (editor.multi.size && !editor.drag) {
    for (const id of netsTouching([...editor.multi])) {
      for (const pts of editor.circuit.nets.get(id)?.paths() || []) {
        if (pts.length > 1) parts.push(`<polyline class="selection-net-tint" points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" vector-effect="non-scaling-stroke"/>`);
      }
    }
  }
  if (editor.hoverTarget?.kind === 'net' && !editor.drag) {
    for (const id of editor.hoverTarget.ids) {
      for (const pts of editor.circuit.nets.get(id)?.paths() || []) {
        if (pts.length > 1) parts.push(`<polyline class="gesture-hover-net" points="${pts.map((p) => `${p.x},${p.y}`).join(' ')}" vector-effect="non-scaling-stroke"/>`);
      }
    }
    for (const ref of netMarkerRefs(editor.hoverTarget.ids.map((id) => editor.circuit.nets.get(id)))) {
      parts.push(`<g class="selection-glow gesture-hover-marker" pointer-events="none">${componentShapeSvg(editor.circuit.components.get(ref))}</g>`);
    }
  }
  const pinsComp = !editor.drag && editor.hoverPinsRef ? editor.circuit.components.get(editor.hoverPinsRef) : null;
  if (pinsComp) {
    const p = paneSize();
    const r = pinHandleRadius(p ? editor.view.w / p.w : 1);
    for (const t of pinsComp.worldTerminals()) parts.push(`<circle class="gesture-pin" cx="${t.x}" cy="${t.y}" r="${r}" vector-effect="non-scaling-stroke"/>`);
  }
  // The canvas already shows the part under the pointer; only a panel hover
  // needs to point at it.
  if (editor.hoverTarget?.kind === 'component' && editor.hoverFromPanel) {
    const box = editor.circuit.components.get(editor.hoverTarget.refdes)?.bboxWorld();
    if (box) parts.push(`<rect class="gesture-hover-comp" x="${box.x - 8}" y="${box.y - 8}" width="${box.w + 16}" height="${box.h + 16}" rx="10" vector-effect="non-scaling-stroke"/>`);
  }
  if (editor.drag?.mode === 'deletemarquee' && editor.drag.knife && editor.drag.moved) {
    const stroke = [...editor.drag.knife];
    const cut = knifeTargets(stroke);
    for (const key of cut.wires) {
      const { netId, branch, segment } = keyToWire(key);
      const pts = editor.circuit.nets.get(netId)?.paths()?.[branch];
      if (pts?.[segment]) parts.push(`<line class="gesture-cut" x1="${pts[segment - 1].x}" y1="${pts[segment - 1].y}" x2="${pts[segment].x}" y2="${pts[segment].y}" vector-effect="non-scaling-stroke"/>`);
    }
    for (const ref of cut.refs) {
      parts.push(`<g class="selection-glow gesture-cut-part" pointer-events="none">${componentShapeSvg(editor.circuit.components.get(ref))}</g>`);
    }
    for (const id of cut.labels) {
      const label = editor.circuit.labels.get(id);
      const outline = annotationOutline(label);
      if (outline) parts.push(`<polyline class="gesture-cut" fill="none" points="${outline.map((p) => `${p.x},${p.y}`).join(' ')}" vector-effect="non-scaling-stroke"/>`);
      else {
        const b = label.bbox();
        parts.push(`<rect class="gesture-cut-label" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3" vector-effect="non-scaling-stroke"/>`);
      }
    }
    parts.push(`<polyline class="gesture-knife" points="${stroke.map((p) => `${p.x},${p.y}`).join(' ')}" vector-effect="non-scaling-stroke"/>`);
  }
  const splice = splicePreviewTarget(ghost);
  if (splice) {
    parts.push(`<line class="gesture-splice" x1="${splice.a.x}" y1="${splice.a.y}" x2="${splice.b.x}" y2="${splice.b.y}" vector-effect="non-scaling-stroke"/>`);
  }
  if (!parts.length) return svg;
  return `${svg}\n<g class="gesture-overlay" pointer-events="none">${parts.join('')}</g>`;
}
