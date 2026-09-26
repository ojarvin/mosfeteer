/**
 * Copy and paste: the copied set, the copy ghost that follows the pointer
 * (and its mirrored twin), pasting, and the system clipboard exchange that
 * carries objects between editor windows. Which objects a copy takes is
 * core/selection.js; the clipboard format is core/object-clipboard.js.
 */

import { Circuit, transformWorldPoints } from '../core/model.js';
import { snap } from '../core/grid.js';
import { resolveCopySelection } from '../core/selection.js';
import { encodeObjectClipboard, decodeObjectClipboard } from '../core/object-clipboard.js';
import { copyableLabelPayload } from './selection.js';
import { logLine } from './status-bar-ui.js';
import { selectedStyleSource, pasteStyle } from './style-controls.js';
import { beginNetLabelPaste } from './annotation-tools.js';
import { editor } from './editor-state.js';
import { captureNetGeometry, captureRouteGeometry, cloneFixedPaths, commit, keyToWire, markModelChanged, recordHistoryEntry, render, selectedComps, selectedLabel, selectedLabels, setLabelSelection, setSelection, setSymmetry, snapshot, syncSelectedWire, syncSymmetryOperation, transformMixedSelection, translateNetGeometry, validateSelectedWires } from './main.js';

export function copySelectionSource() {
  const wireKeys = new Set(editor.selectedWires);
  if (editor.selectedWire) wireKeys.add(`${editor.selectedWire.netId}:${editor.selectedWire.branch}:${editor.selectedWire.segment}`);
  return {
    refs: editor.multi, labels: selectedLabels(), netIds: editor.selectedNets, wireKeys,
  };
}

function mirroredCopyGhostOperation(operation) {
  if (operation === 'rotate') return 'rotateCCW';
  if (operation === 'rotateCCW') return 'rotate';
  return operation;
}

/** Keep the secondary copy as the exact symmetric image of a transformed
 * primary copy. Keyboard transforms do not pass through moveCopyGhost(), so
 * the mirror must be transformed in the same event instead of waiting for a
 * later pointer move to rebuild it. */
function refreshCopyGhostMirror({ operation = null, pivot = null, translation = null } = {}) {
  const ghost = editor.drag?.ghost;
  const mirror = ghost?.mirror;
  if (!ghost || !mirror || !editor.symmetry?.operation) return true;
  if (translation) {
    const dx = editor.symmetry.operation === 'mirrorX' ? -translation.dx : translation.dx;
    const dy = editor.symmetry.operation === 'mirrorY' ? -translation.dy : translation.dy;
    translateCopyGhost(mirror, dx, dy);
  } else if (operation && pivot) {
    const mirrorPivot = transformWorldPoints([pivot], editor.symmetry.pin, editor.symmetry.operation)[0];
    restoreCopyGhostSelection(mirror);
    const changed = transformMixedSelection(mirroredCopyGhostOperation(operation), {
      recordHistory: false,
      center: mirrorPivot,
    });
    restoreCopyGhostSelection(ghost);
    if (!changed) return false;
  }
  mirror.baseGeometry = captureCopyGhostGeometry(mirror);
  return true;
}

export function refreshCopyGhostBase(transform = {}) {
  if (editor.drag?.mode === 'copyghost' && editor.drag.ghost) {
    refreshCopyGhostMirror(transform);
    editor.drag.ghost.baseSnapshot = snapshot();
    editor.drag.ghost.baseGeometry = captureCopyGhostGeometry(editor.drag.ghost);
    // The base snapshot now already contains the ghost at the current cursor.
    // Reset the translation origin so the next mousemove applies only its
    // incremental delta instead of translating from the old copy start.
    editor.drag.startWorld = { x: snap(editor.cursor.x), y: snap(editor.cursor.y) };
    editor.drag.ghost.startWorld = { ...editor.drag.startWorld };
  }
}

function captureCopyGhostGeometry(ghost) {
  const comps = new Map();
  for (const ref of ghost.refs) {
    const comp = editor.circuit.components.get(ref);
    if (comp) comps.set(ref, { x: comp.transform.x, y: comp.transform.y });
  }
  const labels = new Map();
  for (const id of ghost.labels) {
    const label = editor.circuit.labels.get(id);
    if (!label || label.owner) continue;
    labels.set(id, {
      anchor: { ...label.anchor },
      end: label.end ? { ...label.end } : null,
      points: label.points ? label.points.map((point) => ({ ...point })) : null,
      textAnchor: label.textAnchor ? { ...label.textAnchor } : null,
    });
  }
  const nets = new Map();
  for (const id of ghost.netIds) {
    const net = editor.circuit.nets.get(id);
    if (net) nets.set(id, captureNetGeometry(net));
  }
  return { comps, labels, nets };
}

function restoreCopyGhostGeometry(ghost) {
  for (const [ref, origin] of ghost.baseGeometry?.comps || []) {
    const comp = editor.circuit.components.get(ref);
    if (comp) {
      comp.transform.x = origin.x;
      comp.transform.y = origin.y;
    }
  }
  for (const [id, origin] of ghost.baseGeometry?.labels || []) {
    const label = editor.circuit.labels.get(id);
    if (!label || label.owner) continue;
    label.anchor = { ...origin.anchor };
    if (origin.end) label.end = { ...origin.end };
    if (origin.points) label.points = origin.points.map((point) => ({ ...point }));
    if (origin.textAnchor) label.textAnchor = { ...origin.textAnchor };
  }
  for (const [id, origin] of ghost.baseGeometry?.nets || []) {
    const net = editor.circuit.nets.get(id);
    if (net) translateNetGeometry(net, origin, 0, 0);
  }
  editor.circuit.invalidateRoutingCache();
}

export function copySelection({ quiet = false } = {}) {
  const parts = resolveCopySelection(editor.circuit, copySelectionSource());
  const { comps, freeLabels } = parts;
  if (!comps.length && !freeLabels.length && !parts.nets.length && !parts.fragments.length) {
    if (!parts.netLabels.length) {
      logLine('nothing selected to copy');
      return false;
    }
    // A net label on its own carries its net's name, which a paste attaches
    // to another wire. With several, the primary one's.
    const source = parts.netLabels.find((label) => label === selectedLabel()) || parts.netLabels[0];
    editor.clipboard = {
      comps: [], labels: [], nets: [], fragments: [],
      anchor: { ...source.anchorWorld() },
      netLabel: { text: source.text },
      style: null,
    };
    if (!quiet) logLine(`copied net label "${source.text}"; paste it on a wire to give that net the name`);
    return true;
  }
  if (parts.netLabels.length && !quiet) {
    logLine(`left out ${parts.netLabels.length} net label${parts.netLabels.length === 1 ? '' : 's'} copied without ${parts.netLabels.length === 1 ? 'its' : 'their'} wire`);
  }
  const netLabelPayload = (label) => ({
    netId: label.netId,
    text: label.text,
    align: label.align,
    netSide: label.netSide,
    x: label.anchorWorld().x,
    y: label.anchorWorld().y,
  });
  const nets = parts.nets.map((net) => ({
    id: net.id,
    name: net.name,
    routingMode: net.routingMode,
    drawOrder: net.drawOrder,
    terminals: net.terminals.map((t) => ({ comp: t.comp, term: t.term })),
    ...captureRouteGeometry(net),
    fixedPaths: net.routingMode === 'fixed' ? cloneFixedPaths(net.fixedPaths) : null,
    netLabels: editor.circuit.netLabels(net).map(netLabelPayload),
  }));
  const fragments = parts.fragments.map(({ net, paths, junctions, netLabels = [] }) => ({
    name: net.name, routingMode: net.routingMode, allowDiagonal: net.allowDiagonal,
    drawOrder: net.drawOrder, paths, junctions, netLabels: netLabels.map(netLabelPayload),
  }));
  // Grid-snapped anchor = bbox centre of the selection, so paste re-centres it
  // at the cursor without drifting off the grid.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const addRect = (r) => {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  };
  for (const c of comps) addRect(c.bboxWorld());
  for (const l of freeLabels) addRect(l.bbox());
  for (const net of [...nets, ...fragments]) {
    const paths = net.paths || (net.path ? [net.path] : (net.branches || net.fixedPaths?.map((e) => e.points) || (net.route ? [net.route] : [])));
    for (const path of paths) for (const p of path) addRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  if (!Number.isFinite(x0)) x0 = y0 = x1 = y1 = 0;
  const anchor = { x: snap((x0 + x1) / 2), y: snap((y0 + y1) / 2) };
  const styleSource = selectedStyleSource();
  editor.clipboard = {
    comps: comps.map((c) => ({
      origRef: c.refdes,
      type: c.type,
      x: c.transform.x,
      y: c.transform.y,
      rotation: c.transform.rotation,
      mirrorX: c.transform.mirrorX,
      mirrorY: c.transform.mirrorY,
      negativeInputs: c.negativeInputs ? [...c.negativeInputs] : [],
      joinBar: !!c.joinBar,
      style: { ...(c.style || {}) },
      // The value: a resistance, a switch's phase.
      value: c.value,
    })),
    labels: freeLabels.map(copyableLabelPayload),
    nets,
    fragments,
    anchor,
    style: styleSource?.style || null,
  };

  if (!quiet) logLine(`copied ${comps.length} component(s), ${freeLabels.length} label(s), ${nets.length} net(s), ${fragments.length} wire island(s)`);
  return true;
}

function copyGhostSelection() {
  return {
    refs: selectedComps().map((c) => c.refdes),
    labels: selectedLabels().map((l) => l.id),
    netIds: [...new Set([...editor.circuit.nets.keys()])],
    wireKeys: [...editor.selectedWires],
  };
}

function restoreCopyGhostSelection(ghost) {
  setSelection(ghost.refs, ghost.refs[0], true);
  setLabelSelection(ghost.labels, ghost.labels[0], true);
  editor.selectedNets = new Set(ghost.netIds.filter((id) => editor.circuit.nets.has(id)));
  editor.selectedWires = new Set(ghost.wireKeys);
  editor.selectedWire = editor.selectedWires.size ? keyToWire(editor.selectedWires.values().next().value) : null;
  validateSelectedWires();
}

function translateCopyGhost(ghost, dx, dy) {
  for (const ref of ghost.refs) {
    const comp = editor.circuit.components.get(ref);
    if (comp) {
      comp.transform.x += dx;
      comp.transform.y += dy;
    }
  }
  for (const id of ghost.labels) {
    const label = editor.circuit.labels.get(id);
    if (!label || label.owner) continue;
    label.anchor.x += dx;
    label.anchor.y += dy;
    if (['arrow', 'box', 'line'].includes(label.kind)) {
      label.end.x += dx;
      label.end.y += dy;
      if (label.points) label.points = label.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
      label.textAnchor.x += dx;
      label.textAnchor.y += dy;
    }
  }
  for (const id of ghost.netIds) {
    const net = editor.circuit.nets.get(id);
    if (!net) continue;
    const move = (p) => ({ x: p.x + dx, y: p.y + dy });
    if (net.routingMode === 'fixed') {
      for (const entry of net.fixedPaths) entry.points = entry.points.map(move);
    } else {
      if (net.route) net.route = net.route.map(move);
      if (net.branches) net.branches = net.branches.map((path) => path.map(move));
    }
    net.junctions = net.junctions.map(move);
  }
  editor.circuit.invalidateRoutingCache();
  editor.circuit.syncJunctionSolders();
}

export function startCopyGhost(startWorld, startClient, anchorShift = null) {
  if (!editor.clipboard) return false;
  if (editor.clipboard.netLabel) return beginNetLabelPaste(editor.clipboard.netLabel.text);
  const beforeSnapshot = snapshot();
  const existingNetIds = new Set(editor.circuit.nets.keys());
  const start = { x: snap(startWorld.x), y: snap(startWorld.y) };
  editor.cursor = start;
  pasteClipboard({ recordHistory: false, connect: false });
  const ghost = copyGhostSelection();
  ghost.netIds = ghost.netIds.filter((id) => !existingNetIds.has(id));
  // The source click is the placement anchor, not the clipboard set center.
  // Translate the freshly pasted set back by the same offset so the clicked
  // source point remains under the cursor while all relative geometry stays
  // unchanged.
  const shift = anchorShift || {
    x: editor.clipboard.anchor.x - start.x,
    y: editor.clipboard.anchor.y - start.y,
  };
  translateCopyGhost(ghost, shift.x, shift.y);
  ghost.anchorShift = { ...shift };
  markModelChanged();
  ghost.beforeSnapshot = beforeSnapshot;
  ghost.baseSnapshot = snapshot();
  ghost.baseGeometry = captureCopyGhostGeometry(ghost);
  ghost.startWorld = start;
  editor.drag = {
    mode: 'copyghost',
    startWorld: start,
    startClient,
    ghost,
    moved: false,
    rubber: null,
  };
  editor.copyPending = true;
  if (editor.altHeld) setSymmetry(true);
  render();
  return true;
}

export function moveCopyGhost(w) {
  if (!editor.drag?.ghost) return;
  const ghost = editor.drag.ghost;
  if (ghost.baseGeometry) {
    restoreCopyGhostGeometry(ghost);
  } else {
    editor.circuit = Circuit.fromJSON(JSON.parse(ghost.baseSnapshot));
  }
  // Aim the axis from the new cursor and, the first time it has a direction,
  // arm the mirror while the primary is still sitting at its base.
  if (editor.symmetry && !editor.symmetry.settled) {
    editor.cursor = { x: snap(w.x), y: snap(w.y) };
    if (editor.symmetry.waitingForMotion) {
      const armed = editor.symmetry.armedCursor || editor.symmetry.pin;
      if (editor.cursor.x !== armed.x || editor.cursor.y !== armed.y) editor.symmetry.waitingForMotion = false;
    }
    syncSymmetryOperation();
  }
  if (editor.symmetry?.operation && !ghost.mirror) armCopyGhostMirror();
  const dx = snap(w.x) - snap(editor.drag.startWorld.x);
  const dy = snap(w.y) - snap(editor.drag.startWorld.y);
  translateCopyGhost(ghost, dx, dy);
  if (ghost.mirror) {
    restoreCopyGhostGeometry(ghost.mirror);
    // Reflecting a translated set is the same as translating the reflected
    // one by the reflected delta, so the mirror never has to be rebuilt.
    translateCopyGhost(ghost.mirror,
      editor.symmetry?.operation === 'mirrorY' ? dx : -dx,
      editor.symmetry?.operation === 'mirrorY' ? -dy : dy);
  }
  restoreCopyGhostSelection(ghost);
  editor.cursor = { x: snap(w.x), y: snap(w.y) };
  markModelChanged();
}

/** Arm the mirrored half of a copy ghost. Duplicate the primary ghost's
 *  current state first, so an explicit rotate/mirror performed before Alt is
 *  preserved, then reflect that duplicate about the drag-selected axis.
 *  Keeping its own base geometry means every later pointer move is only a
 *  translation, since reflecting a translated set is the same as translating
 *  the reflected one by the reflected delta. */
function armCopyGhostMirror() {
  const ghost = editor.drag?.ghost;
  if (!ghost || !editor.symmetry?.operation || ghost.mirror || !editor.clipboard) return false;
  const beforeSnapshot = snapshot();
  const existingNets = new Set(editor.circuit.nets.keys());
  const existingComps = new Set(editor.circuit.components.keys());
  const existingLabels = new Set(editor.circuit.labels.keys());
  const savedCursor = { ...editor.cursor };
  const savedClipboard = editor.clipboard;
  // Re-copy the live primary ghost instead of using the original clipboard.
  // This carries its current component transforms, labels, and internal nets
  // into the new half before the symmetry transform is applied.
  restoreCopyGhostSelection(ghost);
  if (!copySelection()) {
    editor.clipboard = savedClipboard;
    editor.cursor = savedCursor;
    return false;
  }
  editor.cursor = { ...editor.clipboard.anchor };
  try {
    pasteClipboard({ recordHistory: false, connect: false });
  } finally {
    editor.clipboard = savedClipboard;
    editor.cursor = savedCursor;
  }
  const mirror = {
    refs: [...editor.circuit.components.keys()].filter((ref) => !existingComps.has(ref)),
    labels: [...editor.circuit.labels.keys()].filter((id) => !existingLabels.has(id)),
    netIds: [...editor.circuit.nets.keys()].filter((id) => !existingNets.has(id)),
    wireKeys: [],
    beforeSnapshot,
  };
  if (!mirror.refs.length && !mirror.labels.length) {
    editor.circuit = Circuit.fromJSON(JSON.parse(beforeSnapshot));
    editor.cursor = savedCursor;
    return false;
  }
  restoreCopyGhostSelection(mirror);
  const moved = transformMixedSelection(editor.symmetry.operation, { recordHistory: false, center: editor.symmetry.pin });
  editor.cursor = savedCursor;
  if (moved === false) {
    editor.circuit = Circuit.fromJSON(JSON.parse(beforeSnapshot));
    restoreCopyGhostSelection(ghost);
    logLine('mirrored copy: this selection cannot be reflected whole', 'error');
    return false;
  }
  mirror.baseGeometry = captureCopyGhostGeometry(mirror);
  ghost.mirror = mirror;
  restoreCopyGhostSelection(ghost);
  markModelChanged();
  return true;
}

/** Drop the mirrored half while preserving the primary ghost's current offset. */
export function dropCopyGhostMirror() {
  const ghost = editor.drag?.ghost;
  if (!ghost?.mirror) return;
  const dx = snap(editor.cursor.x) - snap(editor.drag.startWorld.x);
  const dy = snap(editor.cursor.y) - snap(editor.drag.startWorld.y);
  // Restore the pre-mirror topology without repairing the transient overlap;
  // translate the primary ghost before normal coincidence repair resumes.
  const beforeMirror = JSON.parse(ghost.mirror.beforeSnapshot);
  beforeMirror.topologyOnly = true;
  editor.circuit = Circuit.fromJSON(beforeMirror);
  ghost.mirror = null;
  translateCopyGhost(ghost, dx, dy);
  restoreCopyGhostSelection(ghost);
  markModelChanged();
}

export function commitCopyGhost() {
  if (!editor.drag?.ghost) return false;
  const ghost = editor.drag.ghost;
  // The mirror was pasted after `beforeSnapshot`, so both halves already sit
  // inside the one history entry recorded below.
  const refs = [...ghost.refs, ...(ghost.mirror?.refs || [])];
  editor.circuit.connectCoincident(refs);
  editor.circuit.reconnectCoincidentNets();
  editor.circuit.teeTerminalsOntoWires(refs);
  editor.circuit.ensureUniqueTerminals(refs);
  editor.circuit.syncJunctionSolders();
  recordHistoryEntry(ghost.beforeSnapshot);
  const anchorShift = ghost.anchorShift;
  const mirrored = !!ghost.mirror;
  editor.drag = null;
  editor.copyPending = false;
  startCopyGhost({ x: editor.cursor.x, y: editor.cursor.y }, { x: 0, y: 0 }, anchorShift);
  if (mirrored && editor.symmetry?.operation) armCopyGhostMirror();
  return true;
}

// The copy buffer also goes on the system clipboard as tagged JSON text, so
// objects copied in one editor paste into another (another tab, window, or
// workspace). Ctrl/Cmd+V reads it from the browser's paste event, which needs
// no clipboard permission; `p` pastes this editor's own buffer.
let objectClipboardText = null;

let objectPaste = null;

export function publishObjectClipboard() {
  if (!editor.clipboard) return;
  const text = encodeObjectClipboard(editor.clipboard);
  objectClipboardText = text;
  let copied = false;
  try { copied = document.execCommand('copy') && objectClipboardText === null; } catch { /* use the async API */ }
  objectClipboardText = null;
  if (!copied) globalThis.navigator?.clipboard?.writeText?.(text).catch(() => {});
}

/** Paste on the paste event that follows this Ctrl/Cmd+V, or from the editor's
 *  own buffer if the browser sends none. `kind` is 'objects' or 'style'. */
export function armObjectPaste(kind) {
  const armed = { kind };
  objectPaste = armed;
  setTimeout(() => {
    if (objectPaste !== armed) return;
    objectPaste = null;
    finishObjectPaste(kind);
  }, 100);
}

function finishObjectPaste(kind) {
  if (kind === 'style') pasteStyle();
  else pasteClipboard();
}

/** Paste the clipboard at the cursor (re-centred on the selection anchor). */
export function pasteClipboard({ recordHistory = true, connect = true } = {}) {
  if (!editor.clipboard) {
    logLine('nothing copied');
    return;
  }
  // A copied net label has no place of its own: the user picks its wire. Only
  // an interactive paste starts that; a paste inside another gesture skips it.
  if (editor.clipboard.netLabel) {
    if (recordHistory) beginNetLabelPaste(editor.clipboard.netLabel.text);
    return;
  }
  const dx = snap(editor.cursor.x) - editor.clipboard.anchor.x;
  const dy = snap(editor.cursor.y) - editor.clipboard.anchor.y;
  const addedComps = [];
  const addedLabels = [];
  const addedNetLabels = [];
  const apply = () => {
    const refMap = new Map();
    const wasLoading = editor.circuit._loading;
    // Do not let addComponent's coincidence hook create memberships before
    // the copied net records exist.  Otherwise a paste at an existing pin can
    // leave that terminal in both the old and the copied net.
    editor.circuit._loading = true;
    try {
      for (const c of editor.clipboard.comps) {
        const comp = editor.circuit.addComponent(c.type, {
          x: c.x + dx,
          y: c.y + dy,
          rotation: c.rotation,
          mirrorX: c.mirrorX,
          mirrorY: c.mirrorY,
          negativeInputs: c.negativeInputs,
          joinBar: c.joinBar,
          style: c.style,
          value: c.value,
        });
        refMap.set(c.origRef, comp.refdes);
        addedComps.push(comp.refdes);
      }
      const labelMap = new Map();
      for (const l of editor.clipboard.labels.filter((label) => ['arrow', 'box', 'line'].includes(label.kind))) {
        const shape = editor.circuit.addAnnotation(l.kind, {
          x: l.x + dx, y: l.y + dy, end: l.end && { x: l.end.x + dx, y: l.end.y + dy },
          points: l.points?.map((point) => ({ x: point.x + dx, y: point.y + dy })), style: l.style,
        });
        labelMap.set(l.id, shape.id);
        addedLabels.push(shape.id);
      }
      for (const l of editor.clipboard.labels.filter((label) => label.kind === 'label')) {
        const nl = editor.circuit.addLabel({ text: l.text, align: l.align, parent: l.parent ? labelMap.get(l.parent) : null, x: l.x + dx, y: l.y + dy, style: l.style, math: l.math, mathBox: l.mathBox || undefined });
        addedLabels.push(nl.id);
      }
      const netMap = new Map();
      for (const n of editor.clipboard.nets) {
      const fixedPaths = n.routingMode === 'fixed' ? n.fixedPaths.map((e) => ({
        points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        start: e.start && refMap.has(e.start.comp) ? { comp: refMap.get(e.start.comp), term: e.start.term } : null,
        end: e.end && refMap.has(e.end.comp) ? { comp: refMap.get(e.end.comp), term: e.end.term } : null,
      })) : null;
      const net = editor.circuit.createWireNet({ name: n.name, routingMode: n.routingMode, allowDiagonal: n.allowDiagonal, drawOrder: n.drawOrder, fixedPaths });
      netMap.set(n.id, net);
      for (const t of n.terminals) {
        const newRef = refMap.get(t.comp);
        if (newRef) net.terminals.push({ comp: newRef, term: t.term });
      }
        if (n.routingMode !== 'fixed') {
          net.route = n.route ? n.route.map((p) => ({ x: p.x + dx, y: p.y + dy })) : null;
          net.junctions = n.junctions.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          net.branches = n.branches ? n.branches.map((b) => b.map((p) => ({ x: p.x + dx, y: p.y + dy }))) : null;
        }
        for (const label of n.netLabels || []) {
          const anchor = { x: label.x + dx, y: label.y + dy };
          const targetNet = netMap.get(label.netId) || net;
          const pasted = targetNet.name
            ? editor.circuit.addNetLabel(targetNet.id, { anchor, align: label.align, netSide: label.netSide })
            : editor.circuit.addLabel({ text: '', netId: targetNet.id, netSide: label.netSide, x: anchor.x, y: anchor.y, align: label.align });
          addedNetLabels.push(pasted.id);
        }
      }
      const pastedWireKeys = [];
      for (const fragment of editor.clipboard.fragments || []) {
      const paths = fragment.paths.map((path) => path.map((p) => ({ x: p.x + dx, y: p.y + dy })));
      const net = editor.circuit.createWireNet(fragment.routingMode === 'fixed'
        ? { name: fragment.name, routingMode: 'fixed', drawOrder: fragment.drawOrder, fixedPaths: paths.map((path) => ({ points: path, start: null, end: null })), junctions: fragment.junctions.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
        : { name: fragment.name, routingMode: 'managed', allowDiagonal: fragment.allowDiagonal, drawOrder: fragment.drawOrder, branches: paths, route: paths[0], junctions: fragment.junctions.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
        for (let branch = 0; branch < paths.length; branch++) {
          for (let segment = 1; segment < paths[branch].length; segment++) {
            if (paths[branch][segment - 1].x === paths[branch][segment].x && paths[branch][segment - 1].y === paths[branch][segment].y) continue;
            pastedWireKeys.push(`${net.id}:${branch}:${segment}`);
          }
        }
        for (const label of fragment.netLabels || []) {
          const anchor = { x: label.x + dx, y: label.y + dy };
          const pasted = net.name
            ? editor.circuit.addNetLabel(net.id, { anchor, align: label.align, netSide: label.netSide })
            : editor.circuit.addLabel({ text: '', netId: net.id, netSide: label.netSide, x: anchor.x, y: anchor.y, align: label.align });
          addedNetLabels.push(pasted.id);
        }
      }
      editor.circuit._loading = wasLoading;
      // Coincidence is resolved once, against the complete copied topology.
      if (connect) {
        editor.circuit.connectCoincident(addedComps);
        editor.circuit.teeTerminalsOntoWires(addedComps);
      }
      editor.circuit.ensureUniqueTerminals(addedComps);
      editor.circuit.syncJunctionSolders();
      setSelection(addedComps, undefined, true);
      setLabelSelection([...addedLabels, ...addedNetLabels], undefined, true);
      editor.selectedWires = new Set(pastedWireKeys);
      syncSelectedWire();
    } finally {
      editor.circuit._loading = wasLoading;
    }
  };
  if (recordHistory) commit(apply);
  else apply();
  render();
}

export function installCopyPaste() {
  document.addEventListener('copy', (ev) => {
    if (objectClipboardText === null || !ev.clipboardData) return;
    ev.clipboardData.setData('text/plain', objectClipboardText);
    ev.preventDefault();
    objectClipboardText = null;
  });

  document.addEventListener('paste', (ev) => {
    const armed = objectPaste;
    if (!armed) return;
    objectPaste = null;
    ev.preventDefault();
    try {
      const buffer = decodeObjectClipboard(ev.clipboardData?.getData('text/plain') || '');
      if (buffer) editor.clipboard = buffer;
    } catch (err) {
      logLine(err.message, 'error');
      return;
    }
    finishObjectPaste(armed.kind);
  });
}
