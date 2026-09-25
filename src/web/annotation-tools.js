/**
 * Placing things with the label tools: net labels on wires and pins, free
 * text and equation annotations, lines, arrows, boxes, and net highlights.
 */

import { INTERFACE_PIN_TYPES, NET_HIGHLIGHT_COLORS, isReferenceMarker, referenceMarkerInfo } from '../core/model.js';
import { cycleBeatHighlight, highlightsAt, setHighlightFrom } from '../core/beats.js';
import { snap } from '../core/grid.js';
import { pointOnPath } from '../core/wiring.js';
import { netLabelPasteKind } from '../core/selection.js';
import { confirmChoice } from './file-dialog.js';
import { constrainAxis } from './interaction.js';
import { noteTip } from './onboarding.js';
import { logLine, hintLine } from './status-bar-ui.js';
import { inlineEditLabel } from './label-editor.js';
import { activeBeatIndex } from './beats-ui.js';
import { editor } from './editor-state.js';
import { activateNetLabel, activateSelect, commit, markModelChanged, nearestTerminal, pickAt, pickLabel, pickWire, render, setLabelSelection, setSelection, snappedWorld, snapshot } from './main.js';

/** Return the drawable wire candidates under a label-placement click.  A
 * snapped crossing may belong to several physical nets; keep those identities
 * separate so the selected/highlighted-net rule below can resolve it without
 * relying on render order. */
function netLabelCandidatesAt(world) {
  const point = { x: snap(world.x), y: snap(world.y) };
  const candidates = new Map();
  const onSegment = (a, b) => pointOnPath(point, [a, b]);
  for (const net of editor.circuit.nets.values()) {
    for (const path of net.paths()) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        if ((a.x === b.x && a.y === b.y) || !onSegment(a, b)) continue;
        candidates.set(net.id, { net, point });
        break;
      }
      if (candidates.has(net.id)) break;
    }
  }
  return [...candidates.values()];
}

function netLabelTargetAt(world) {
  const candidates = netLabelCandidatesAt(world);
  if (candidates.length <= 1) return candidates[0] || null;
  const highlighted = new Set([...editor.selectedNets, ...editor.diagnosticSelection.nets]);
  const selected = candidates.filter(({ net }) => highlighted.has(net.id));
  if (selected.length === 1) return selected[0];
  return { ambiguous: true, candidates };
}

export function moveLabelSafely(label, x, y) {
  try {
    if (label?.isNetLabel?.()) {
      const net = editor.circuit.nets.get(label.netId);
      const attachment = net ? editor.circuit._nearestNetPathAttachment(net, { x, y }) : null;
      if (!attachment) throw new Error('net label has no drawable path');
      x = attachment.point.x;
      y = attachment.point.y;
      label.netSide = attachment.side;
    }
    label.moveTo(x, y);
    label._moveErrorShown = false;
    return true;
  } catch (err) {
    if (!label._moveErrorShown) {
      logLine(`cannot move label: ${err.message}`, 'error');
      label._moveErrorShown = true;
    }
    return false;
  }
}

/** Place a label through the persistent Virtuoso label tools. */
export function placeAnnotationAt(world) {
  let label;
  const point = { x: snap(world.x), y: snap(world.y) };
  commit(() => { label = editor.circuit.addLabel({ text: 'label', x: point.x, y: point.y, align: 'center' }); });
  setSelection([]);
  setLabelSelection([label.id]);
  editor.labelMode = null;
  logLine(`placed annotation @ (${point.x},${point.y})`);
  render();
  inlineEditLabel(label);
}

/** Place a math-capable ordinary label and open its editor with the caret
 * between the two dollar delimiters. The persisted object remains a normal
 * LabelInstance, with only `math:true` changing its renderer. */
export function placeEquationAt(world) {
  const point = { x: snap(world.x), y: snap(world.y) };
  let label;
  commit(() => { label = editor.circuit.addLabel({ text: '$$', x: point.x, y: point.y, align: 'center', math: true }); });
  setSelection([]);
  setLabelSelection([label.id]);
  editor.labelMode = null;
  logLine(`placed equation @ (${point.x},${point.y})`);
  render();
  inlineEditLabel(label, { equationDraft: true });
}

/** The next point of a line or arrow draft under `world`. Shift locks the
 * leg from the previous point to horizontal or vertical, as it locks a move. */
export function draftPointAt(world, shiftKey) {
  const point = snappedWorld(world);
  const previous = editor.annotationPoints.at(-1) || editor.annotationStart;
  return shiftKey && previous && (editor.labelMode === 'line' || editor.labelMode === 'arrow') ? constrainAxis(previous, point) : point;
}

/** A drafted line or arrow's points. Enter commits at the cursor, as it does
 * for wires, so the cursor is the final point unless it repeats the last
 * click (a double-click has already added it). */
function draftAnnotationPoints(includeCursor) {
  const points = editor.annotationPoints.map((point) => ({ ...point }));
  const tail = points.at(-1);
  if (includeCursor && tail && (tail.x !== editor.cursor.x || tail.y !== editor.cursor.y)) points.push({ ...editor.cursor });
  return points;
}

export function commitLineAnnotation(includeCursor = true) {
  const points = draftAnnotationPoints(includeCursor);
  if (points.length < 2) return false;
  let annotation;
  commit(() => { annotation = editor.circuit.addAnnotation('line', { points }); });
  if (!annotation) return false; // rejected (too short); keep drafting
  setSelection([]);
  setLabelSelection([annotation.id]);
  logLine(`placed line annotation with ${points.length} points`);
  editor.annotationPoints = [];
  editor.lastLineClick = null;
  // Like every annotation tool, a line is placed once, then back to selection.
  editor.labelMode = null;
  render();
  return true;
}

export function commitArrowAnnotation(includeCursor = true) {
  const points = draftAnnotationPoints(includeCursor);
  if (points.length < 2) return false;
  let annotation;
  commit(() => { annotation = editor.circuit.addAnnotation('arrow', { points, text: 'label' }); });
  if (!annotation) return false; // rejected (too short); keep drafting
  setSelection([]);
  setLabelSelection([annotation.id]);
  logLine(`placed arrow with ${points.length} points`);
  editor.annotationPoints = [];
  editor.annotationStart = null;
  editor.labelMode = null;
  render();
  const annotationLabel = [...editor.circuit.labels.values()].find((label) => label.parent === annotation.id);
  inlineEditLabel(annotationLabel, { removeOnEmpty: true });
  return true;
}

export function placeShapeAnnotation(world, endOverride = null) {
  const point = { x: snap(world.x), y: snap(world.y) };
  let annotation;
  let annotationLabel;
  if (editor.labelMode === 'arrow') {
    if (!editor.annotationStart) {
      editor.annotationStart = point;
      editor.annotationPoints = [point];
      hintLine('ARROW: click intermediate points; Enter ends at the cursor');
      render();
      return false;
    }
    if (!editor.annotationPoints.length) editor.annotationPoints = [editor.annotationStart];
    const next = endOverride || point;
    const previous = editor.annotationPoints.at(-1);
    if (!previous || previous.x !== next.x || previous.y !== next.y) editor.annotationPoints.push(next);
    hintLine(`arrow point ${editor.annotationPoints.length}; Enter ends at the cursor, Backspace removes a point`);
    render();
    return false;
  }
  if (!editor.annotationStart) {
    editor.annotationStart = point;
    hintLine(`${editor.labelMode.toUpperCase()}: choose the end point`);
    render();
    return;
  }
  const end = endOverride || point;
  commit(() => {
    annotation = editor.circuit.addAnnotation(editor.labelMode, {
      x: editor.annotationStart.x,
      y: editor.annotationStart.y,
      end,
      text: 'label',
    });
    annotationLabel = [...editor.circuit.labels.values()].find((label) => label.parent === annotation.id);
  });
  setSelection([]);
  setLabelSelection([annotation.id]);
  logLine(`placed ${editor.labelMode} from (${editor.annotationStart.x},${editor.annotationStart.y}) to (${end.x},${end.y})`);
  editor.annotationStart = null;
  editor.labelMode = null;
  render();
  inlineEditLabel(annotationLabel, { removeOnEmpty: true });
  return true;
}

/** The net under a highlight click: a pin, a wire, a net label, or a part
 * that stands for a net (ground/supply/VCM marker or interface port). */
function highlightTargetAt(world) {
  const terminal = nearestTerminal(world);
  if (terminal) {
    const net = editor.circuit.netOfTerminal({ comp: terminal.refdes, term: terminal.term });
    if (net) return net;
  }
  const wireNet = pickWire(world)?.net;
  if (wireNet) return wireNet;
  const label = pickLabel(world);
  if (label?.netId) return editor.circuit.nets.get(label.netId) || null;
  const hit = pickAt(world);
  const component = hit?.refdes ? editor.circuit.components.get(hit.refdes) : null;
  if (isReferenceMarker(component)) {
    const info = referenceMarkerInfo(component.type);
    return editor.circuit.netOfTerminal({ comp: component.refdes, term: info.terminal });
  }
  if (INTERFACE_PIN_TYPES.has(component?.type)) {
    return editor.circuit.netOfTerminal({ comp: component.refdes, term: component.terminalDefs[0]?.name });
  }
  return null;
}

/** Cycle the clicked net's electrical group to its next free highlight color. */
export function highlightNetAt(world) {
  const net = highlightTargetAt(world);
  if (!net) {
    hintLine('HIGHLIGHT: click a wire, pin, net label, rail marker, or port');
    return false;
  }
  let color = null;
  // On a beat, the highlight belongs to that beat and the ones after it.
  const beatIndex = activeBeatIndex();
  try {
    commit(() => {
      color = beatIndex === null ? editor.circuit.cycleNetHighlight(net) : cycleBeatHighlight(editor.circuit, beatIndex, net, NET_HIGHLIGHT_COLORS);
    });
    noteTip('net-highlight');
  } catch (err) {
    logLine(`HIGHLIGHT: ${err.message}`, 'error');
    return false;
  }
  const name = net.name || net.id;
  const where = beatIndex === null ? '' : ` from beat ${beatIndex + 1}`;
  logLine(color ? `net ${name} highlighted ${color}${where}` : `net ${name} highlight removed${where}`);
  render();
  return true;
}

export function removeAllNetHighlights() {
  let count = 0;
  const beatIndex = activeBeatIndex();
  commit(() => {
    if (beatIndex === null) {
      count = editor.circuit.clearNetHighlights();
      return;
    }
    for (const key of highlightsAt(editor.circuit, beatIndex).keys()) {
      setHighlightFrom(editor.circuit, beatIndex, key, null);
      count += 1;
    }
  });
  logLine(count ? `removed ${count} net highlight${count === 1 ? '' : 's'}` : 'no net highlights to remove');
  render();
}

// The name a pasted net label carries while the net label tool places it.
// Cleared whenever a tool is picked, so plain Shift+L never inherits it.
let pastedNetName = null;

/** Paste a copied net label: the net label tool, carrying `name`, places it
 * on the wires clicked until Esc. `once` ends after one placement (a drag). */
export function beginNetLabelPaste(name, { once = false } = {}) {
  activateNetLabel();
  pastedNetName = { name, once };
  hintLine(`NET LABEL: click a wire to name its net ${name}; Esc ends`);
  render();
  return true;
}

export function clearNetLabelPaste() {
  pastedNetName = null;
}

export function pastingNetName() {
  return editor.labelMode === 'net' ? pastedNetName?.name || null : null;
}

/** Where the pasted name would land under `world`, for the overlay preview. */
export function netLabelPastePreview(world) {
  const name = pastingNetName();
  if (!name) return null;
  const target = netLabelTargetAt(world);
  const onWire = !!target && !target.ambiguous;
  return { text: name, x: onWire ? target.point.x : snap(world.x), y: onWire ? target.point.y : snap(world.y), onWire };
}

/** Attach the pasted name to the wire at `world`: an unnamed net takes it, a
 * net of that name gains another label, and a differently named net is
 * renamed only once the user confirms. */
async function pasteNetLabelAt(world, name) {
  const target = netLabelTargetAt(world);
  if (!target) {
    hintLine('NET LABEL: place a net label on a wire');
    return false;
  }
  if (target.ambiguous) {
    logLine('NET LABEL: wire crossing is ambiguous — select/highlight one net first');
    return false;
  }
  const { net, point } = target;
  const kind = netLabelPasteKind(net, name);
  if (kind === 'rename' && !await confirmChoice({
    title: 'Rename net?',
    message: `This wire is on net ${net.name}. Rename it to ${name}? Any net already named ${name} then connects to it.`,
    confirmLabel: 'Rename',
  })) return false;
  let label = null;
  commit(() => { label = editor.circuit.addNetLabel(net.id, { text: name, anchor: point }); });
  if (!label) return false;
  setSelection([]);
  setLabelSelection([label.id]);
  editor.selectedNets = new Set([net.id]);
  logLine(kind === 'rename' ? `renamed net to "${name}" and placed its label`
    : kind === 'name' ? `named ${net.id} "${name}" and placed its label` : `placed net label "${name}"`);
  render();
  return true;
}

export function placeNetLabelAt(world) {
  const name = pastingNetName();
  if (name) {
    // A dragged label places once, hit or miss, then hands back to Select.
    const once = !!pastedNetName.once;
    pasteNetLabelAt(world, name).then(() => {
      if (once) {
        activateSelect();
        render();
      }
    });
    return true;
  }
  const target = netLabelTargetAt(world);
  if (!target) {
    hintLine('NET LABEL: click a physical wire');
    return false;
  }
  if (target.ambiguous) {
    logLine('NET LABEL: wire crossing is ambiguous — select/highlight one net first');
    return false;
  }
  const point = target.point;
  const net = target.net;
  let label;
  const provisional = !net.name;
  try {
    if (provisional) {
      // Keep the provisional editor state out of undo history.  The original
      // snapshot is recorded here and becomes the one atomic history entry if
      // the user eventually supplies a name.
      const initialSnapshot = snapshot();
      label = editor.circuit.addLabel({ text: '', netId: net.id, x: point.x, y: point.y });
      label._provisionalInitialName = net.name || '';
      label._provisionalInitialSnapshot = initialSnapshot;
      markModelChanged(false);
    } else {
      commit(() => { label = editor.circuit.addNetLabel(net.id, { anchor: point }); });
    }
  } catch (err) {
    logLine(`NET LABEL: ${err.message}`, 'error');
    return false;
  }
  setSelection([]);
  setLabelSelection([label.id]);
  editor.selectedNets = new Set([net.id]);
  logLine(`${provisional ? 'provisional net label' : `placed net label "${net.name}"`} on ${net.id} @ (${point.x},${point.y})`);
  render();
  if (provisional) inlineEditLabel(label, { provisional: true, initialSnapshot: label._provisionalInitialSnapshot, initialName: label._provisionalInitialName });
  return true;
}
