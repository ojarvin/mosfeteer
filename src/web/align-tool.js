/**
 * Align to (Shift+A) and the side panel's align and distribute controls.
 */

import { snap } from '../core/grid.js';
import { alignCompatible, alignFeatureAt, alignFeatures, alignToDelta, componentLayoutItem, labelLayoutItem, outlineOf } from './layout.js';
import { alignPanelEl } from './elements.js';
import { editor } from './editor-state.js';
import { hintLine } from './status-bar-ui.js';
import { annotationEndpointAt, annotationGeometryAt, annotationTextAt, applyEditorSelection, applyLayoutPlan, beginMarqueeSelection, beginObjectMove, canvasMouseMove, canvasMouseUp, layoutPlan, layoutSelection, paneSize, pickAt, pickLabel, render, renderCanvas, scheduleInteractionRender, selectedComps, selectedLabels, setLabelSelection, setSelection, updateAlignControls, worldToClient } from './main.js';

// ----- Align to -------------------------------------------------------------
// Shift+A: the selection moves as one rigid piece. The first click picks an
// edge or point of the selection's outline, the second a matching edge or
// point of another object. Nothing is stored: the selection is the group.

export const ALIGN_SOURCE_HINT = 'ALIGN: click an edge or point of the selection (click objects to change it); Esc exits';
const ALIGN_POINT_PX = 10;

/** World units per screen pixel, for hit radii that keep their on-screen size. */
export function worldPerPixel() {
  const p = paneSize();
  return p ? editor.view.w / p.w : 1;
}

/** The selection's outline: parts and free or owned text, not wires, which
 * follow their parts. */
function alignOutline() {
  const labels = selectedLabels().filter((label) => !label.owner || !editor.multi.has(label.owner));
  return outlineOf([...selectedComps().map(componentLayoutItem), ...labels.map(labelLayoutItem)]);
}

/** Objects the selection can align to: every part and label outside it. A
 * selected part's own labels and a selected shape's captions move with it. */
function alignTargets() {
  const out = [];
  for (const c of editor.circuit.components.values()) {
    if (!editor.multi.has(c.refdes) && c.type !== 'solder') out.push({ id: c.refdes, bbox: c.bboxWorld() });
  }
  for (const label of editor.circuit.labels.values()) {
    if (label.selectable === false || editor.selLabels.has(label.id) || editor.selLabels.has(label.parent) || editor.multi.has(label.owner)) continue;
    out.push({ id: label.id, bbox: label.bbox() });
  }
  return out;
}

function alignSourceFeatures() {
  const outline = alignOutline();
  return outline ? alignFeatures(outline, null) : [];
}

function alignTargetFeatures() {
  const source = editor.alignTool?.source;
  return alignTargets().flatMap((target) => alignFeatures(target.bbox, target.id))
    .filter((feature) => alignCompatible(source, feature));
}

const sameFeature = (a, b) => (!a && !b) || (!!a && !!b && a.kind === b.kind && a.name === b.name && a.owner === b.owner);

export function updateAlignHover(w) {
  const tolerance = ALIGN_POINT_PX * worldPerPixel();
  const hover = editor.alignTool.source
    ? alignFeatureAt(alignTargetFeatures(), w, tolerance) || alignFeatureAt(alignSourceFeatures(), w, tolerance)
    : alignFeatureAt(alignSourceFeatures(), w, tolerance);
  const focus = editor.alignTool.source && !hover?.owner
    ? alignTargets().filter(({ bbox }) => w.x >= bbox.x - tolerance && w.x <= bbox.x + bbox.w + tolerance && w.y >= bbox.y - tolerance && w.y <= bbox.y + bbox.h + tolerance)
      .sort((a, b) => a.bbox.w * a.bbox.h - b.bbox.w * b.bbox.h)[0]?.id || null
    : hover?.owner || null;
  if (sameFeature(hover, editor.alignTool.hover) && focus === editor.alignTool.focus) return;
  editor.alignTool.hover = hover;
  editor.alignTool.focus = focus;
  scheduleInteractionRender();
}

/** A picked source and its matching features on the object under the pointer,
 * with the landing outline previewed. Interaction only. */
export function alignOverlay() {
  if (!editor.alignTool) return null;
  const outline = alignOutline();
  if (!outline) return null;
  const { source, hover } = editor.alignTool;
  const target = source && hover?.owner ? hover : null;
  const focus = target?.owner || editor.alignTool.focus;
  const focusTarget = focus ? alignTargets().find((candidate) => candidate.id === focus) : null;
  const delta = target ? alignToDelta(source, target) : null;
  return {
    outline,
    source,
    hover,
    features: source
      ? [...alignFeatures(outline, null).filter((feature) => feature.kind === 'point'),
        ...(focusTarget ? alignFeatures(focusTarget.bbox, focusTarget.id).filter((feature) => alignCompatible(source, feature)) : [])]
      : alignFeatures(outline, null).filter((feature) => feature.kind === 'point'),
    focus: focusTarget?.bbox || null,
    preview: delta ? { x: outline.x + delta.dx, y: outline.y + delta.dy, w: outline.w, h: outline.h } : null,
    target,
  };
}

export function keptAlignSelection() {
  const refs = [...editor.multi];
  const labels = [...editor.selLabels];
  return () => {
    setSelection(refs.filter((ref) => editor.circuit.components.has(ref)));
    setLabelSelection(labels.filter((id) => editor.circuit.labels.has(id)));
  };
}

export function alignMouseDown(startWorld, startClient, ev) {
  const tolerance = ALIGN_POINT_PX * worldPerPixel();
  if (editor.alignTool.source) {
    const target = alignFeatureAt(alignTargetFeatures(), startWorld, tolerance);
    if (target) {
      alignSelectionTo(editor.alignTool.source, target);
      return;
    }
  }
  const source = alignFeatureAt(alignSourceFeatures(), startWorld, tolerance);
  if (source) {
    editor.alignTool = { source, hover: null };
    hintLine(`ALIGN: click a ${source.kind === 'edge' ? `${source.axis === 'x' ? 'vertical' : 'horizontal'} edge` : 'point'} of another object to align to; Esc picks again`);
    render();
    return;
  }
  if (editor.alignTool.source) {
    hintLine('ALIGN: click a highlighted edge or point of another object; Esc picks again');
    return;
  }
  // Before a source is picked, clicks shape the selection as in Select.
  const extend = ev.shiftKey || ev.ctrlKey || ev.metaKey;
  const label = pickLabel(startWorld) || annotationTextAt(startWorld) || annotationGeometryAt(startWorld) || annotationEndpointAt(startWorld)?.label;
  const hit = label ? null : pickAt(startWorld);
  const target = label?.owner && editor.circuit.components.has(label.owner) ? { kind: 'component', id: label.owner }
    : label ? { kind: 'label', id: label.id }
      : hit?.refdes && editor.circuit.components.has(hit.refdes) ? { kind: 'component', id: hit.refdes } : null;
  if (!target) {
    beginMarqueeSelection(startWorld, startClient, ev);
    return;
  }
  // A near miss on a handle must not shrink the set to the part under it.
  if (!extend && (target.kind === 'component' ? editor.multi : editor.selLabels).has(target.id)) {
    hintLine(ALIGN_SOURCE_HINT);
    return;
  }
  applyEditorSelection(target, extend);
  hintLine(ALIGN_SOURCE_HINT);
  render();
}

/** Move the whole selection so `source` lands on `target`, through the same
 * drag path as the Move tool: wires inside the set translate, wires to the
 * rest reroute, and the edit is one undo entry. */
function alignSelectionTo(source, target) {
  const { dx, dy, exact } = alignToDelta(source, target);
  editor.alignTool = { source: null, hover: null };
  if (!dx && !dy) {
    hintLine('already aligned');
    render();
    return;
  }
  const start = { x: snap(editor.cursor.x), y: snap(editor.cursor.y) };
  const from = worldToClient(start.x, start.y);
  const to = worldToClient(start.x + dx, start.y + dy);
  beginObjectMove([...editor.multi], [...editor.selLabels], start, from);
  editor.drag.moved = true;
  canvasMouseMove({ clientX: to.x, clientY: to.y, shiftKey: false });
  canvasMouseUp({ clientX: to.x, clientY: to.y, button: 0, shiftKey: false });
  hintLine(exact ? 'aligned the selection; pick another edge or point, or Esc'
    : 'aligned to the nearest grid point; exact alignment falls between grid points');
}

function previewLayoutPlan(plan) {
  const items = layoutSelection().items;
  editor.layoutPreviewRects = plan.ok ? plan.deltas.filter(({ dx, dy }) => dx || dy).map(({ id, dx, dy }) => {
    const item = items.find((candidate) => candidate.id === id);
    return item && { x: item.bbox.x + dx, y: item.bbox.y + dy, w: item.bbox.w, h: item.bbox.h };
  }).filter(Boolean) : [];
  renderCanvas(editor.previewTransaction ? `${editor.modelRevision}:preview:${editor.previewRevision}` : editor.modelRevision);
}

export function installAlignPanel() {
  alignPanelEl?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-layout-align], [data-layout-distribute]');
    if (!button || button.disabled) return;
    const action = button.dataset.layoutAlign || button.dataset.layoutDistribute;
    const measure = document.getElementById('align-measure')?.value || 'gaps';
    applyLayoutPlan(layoutPlan(action, measure));
  });
  alignPanelEl?.addEventListener('pointerover', (event) => {
    const button = event.target.closest('[data-layout-align], [data-layout-distribute]');
    if (!button || button.disabled) return;
    previewLayoutPlan(layoutPlan(button.dataset.layoutAlign || button.dataset.layoutDistribute,
      document.getElementById('align-measure')?.value || 'gaps'));
  });
  alignPanelEl?.addEventListener('pointerout', (event) => {
    if (!event.target.closest('[data-layout-align], [data-layout-distribute]')) return;
    editor.layoutPreviewRects = [];
    renderCanvas(editor.previewTransaction ? `${editor.modelRevision}:preview:${editor.previewRevision}` : editor.modelRevision);
  });
  alignPanelEl?.querySelector('#align-measure')?.addEventListener('change', () => {
    editor.layoutPreviewRects = [];
    updateAlignControls();
    render();
  });
}
