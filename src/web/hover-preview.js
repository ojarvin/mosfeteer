/**
 * What the pointer is over: the part, net, pin, or annotation a hover (on the
 * canvas or a side panel row) previews, which the renderer then glows.
 */

import { INTERFACE_PIN_TYPES, isReferenceMarker } from '../core/model.js';
import { isPinDragCandidate } from './gestures.js';
import { canvasEl, componentsListEl, netsListEl } from './elements.js';
import { updateAlignHover } from './align-tool.js';
import { editor } from './editor-state.js';
import { annotationEndpointAt, annotationGeometryAt, annotationTextAt, namedGroupNets, nearestTerminal, pickAt, pickLabel, pickWire, removableVertexAt, scheduleInteractionRender } from './main.js';

let hoverMove = false; // pointer rests where a press moves a block or box

/** Parts that stand for a net itself: the reference markers (ground, supply,
 * VCM) and interface ports on it. A net highlight, selected or hovered, glows
 * them along with its wires. */
export function netMarkerRefs(nets) {
  const refs = new Set();
  for (const net of nets) {
    for (const terminal of net?.terminals || []) {
      const component = editor.circuit.components.get(terminal.comp);
      if (component && (isReferenceMarker(component) || INTERFACE_PIN_TYPES.has(component.type))) refs.add(component.refdes);
    }
  }
  return [...refs];
}

function sameHover(a, b) {
  if (!a || !b) return a === b;
  return a.kind === b.kind && (a.kind === 'net' ? a.ids.join(' ') === b.ids.join(' ') : a.refdes === b.refdes);
}

export function setHoverTarget(next, fromPanel = false) {
  if (sameHover(editor.hoverTarget, next)) return;
  editor.hoverTarget = next;
  editor.hoverFromPanel = !!next && fromPanel;
  const ids = new Set(next?.kind === 'net' ? next.ids : []);
  for (const row of netsListEl?.querySelectorAll('[data-net-ids]') || []) {
    row.classList.toggle('hover', row.dataset.netIds.split(' ').some((id) => ids.has(id)));
  }
  for (const row of componentsListEl?.querySelectorAll('[data-refdes]') || []) {
    row.classList.toggle('hover', next?.kind === 'component' && row.dataset.refdes === next.refdes);
  }
  scheduleInteractionRender();
}

export function bindHoverPreview(row, target) {
  row.addEventListener('mouseenter', () => setHoverTarget(target(), true));
  row.addEventListener('mouseleave', () => { if (editor.hoverFromPanel) setHoverTarget(null); });
}

export function updateCanvasHover(w) {
  if (editor.hoverFromPanel) return;
  if (editor.alignTool) {
    updateAlignHover(w);
    return;
  }
  const quiet = editor.mode === 'insert' || (editor.labelMode && editor.labelMode !== 'highlight') || editor.visual || editor.quickAdd;
  const selecting = !quiet && !editor.wire && !editor.directWire && !editor.moveMode && !editor.copyMode && !editor.deleteMode;
  const hit = selecting ? pickAt(w) : null;
  const hitComponent = hit?.refdes ? editor.circuit.components.get(hit.refdes) : null;
  // A selected block shows resize handles on its outline; pin handles there
  // would sit on top of them.
  const pinsRef = hitComponent && isPinDragCandidate(hitComponent.def) &&
    !(hitComponent.type === 'block' && editor.multi.has(hitComponent.refdes)) ? hitComponent.refdes : null;
  // Mirror canvasMouseDown's order: annotation drag points and outlines are
  // picked before labels and components.
  const annotation = selecting ? annotationEndpointAt(w)?.label || annotationGeometryAt(w) : null;
  // Delete shows a line's vertices while the pointer rests on one it can
  // remove alone.
  const deleteVertex = editor.deleteMode && !quiet ? removableVertexAt(w)?.label : null;
  const annotationId = deleteVertex?.id || (annotation && ['arrow', 'line'].includes(annotation.kind) ? annotation.id : null);
  if (pinsRef !== editor.hoverPinsRef || annotationId !== editor.hoverAnnotationId) {
    editor.hoverPinsRef = pinsRef;
    editor.hoverAnnotationId = annotationId;
    scheduleInteractionRender();
  }
  const move = annotation
    ? annotation.kind === 'box' && !annotationTextAt(w)
    : !!(hitComponent?.type === 'block' && !hit.term && !pickLabel(w));
  if (move !== hoverMove) {
    hoverMove = move;
    canvasEl.classList.toggle('hover-move', move);
  }
  let net = null;
  if (!quiet) {
    const terminal = nearestTerminal(w);
    net = terminal ? editor.circuit.netOfTerminal({ comp: terminal.refdes, term: terminal.term }) : pickWire(w)?.net || null;
  }
  // A pin or wire previews its net; a part body previews the part's own row.
  const body = !net && hit?.refdes && !hit.term ? editor.circuit.components.get(hit.refdes) : null;
  setHoverTarget(net
    ? { kind: 'net', ids: namedGroupNets(net).map((member) => member.id) }
    : body && body.type !== 'solder' ? { kind: 'component', refdes: body.refdes } : null);
}
