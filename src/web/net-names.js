/**
 * Naming nets in the editor: the picker that asks which name a short between
 * differently named nets keeps (and whether a rail marker renames its net),
 * and the checks that keep a label or port name from silently joining or
 * clashing with another net or part.
 */

import { Circuit, INTERFACE_PIN_TYPES, normalizeComponentRefdes, referenceMarkerNameConflicts } from '../core/model.js';
import { loadDocument } from '../core/document.js';
import { confirmChoice } from './file-dialog.js';
import { componentContextMenuEl } from './elements.js';
import { logLine } from './status-bar-ui.js';
import { worldToClient } from './canvas-view.js';
import { closeComponentContextMenu, appendContextItem } from './context-menu.js';
import { playCommitFeedback } from './commit-flash.js';
import { appendMarkupText } from './side-panel.js';
import { editor } from './editor-state.js';
import { applyJson, markModelChanged, render, snapshot } from './main.js';

export function renameLabelThroughModel(label, text) {
  if (label?.isNetLabel?.()) return editor.circuit.renameNetLabel(label, text);
  return label.setText(text);
}

export function interfacePortNet(component) {
  if (!component || !INTERFACE_PIN_TYPES.has(component.type)) return null;
  try { return editor.circuit.netOfTerminal({ comp: component.refdes, term: 'p' }); }
  catch { return null; }
}

function sameNamedConnection(left, right) {
  const a = String(left ?? '').trim();
  const b = String(right ?? '').trim();
  return !!a && !!b && (a === b || normalizeComponentRefdes(a) === normalizeComponentRefdes(b));
}

/** Find named nets or interface ports that a new name would virtually join. */
export function namedConnectionConflicts(name, { netId = null, ownerRefdes = null } = {}) {
  const wanted = String(name ?? '').trim();
  if (!wanted) return [];
  const owner = ownerRefdes ? editor.circuit.components.get(ownerRefdes) : null;
  const targetNet = netId ? editor.circuit.nets.get(netId) : interfacePortNet(owner);
  const targetMembers = new Set(targetNet?.terminals?.map((terminal) => terminal.comp) || []);
  const conflicts = [];
  const seen = new Set();
  for (const component of editor.circuit.components.values()) {
    if (!INTERFACE_PIN_TYPES.has(component.type) || component.refdes === ownerRefdes) continue;
    const label = editor.circuit.labelOf(component.refdes);
    const portName = label?.text || component.refdes;
    if (!sameNamedConnection(portName, wanted)) continue;
    const portNet = interfacePortNet(component);
    if (targetNet && portNet?.id === targetNet.id) continue;
    const key = `port:${component.refdes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({ kind: 'port', component, net: portNet });
  }
  for (const net of editor.circuit.nets.values()) {
    if (net.id === targetNet?.id || !net.name || !sameNamedConnection(net.name, wanted)) continue;
    if (net.terminals.some((terminal) => targetMembers.has(terminal.comp))) continue;
    const key = `net:${net.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conflicts.push({ kind: 'net', net });
  }
  return conflicts;
}

/** A port's label is its identity, exactly like every other component's, so a
 * name another port already carries is a collision rather than a connection.
 * Nets are joined virtually by naming the NET, not by repeating a port name. */
export function portNameConflict(conflicts, ownerRefdes) {
  const owner = ownerRefdes ? editor.circuit.components.get(ownerRefdes) : null;
  if (!owner || !INTERFACE_PIN_TYPES.has(owner.type)) return null;
  return conflicts.find((conflict) => conflict.kind === 'port' && conflict.component) || null;
}

export function reportPortNameConflict(conflict, name) {
  logLine(`Port name "${name}" is already used by ${conflict.component.refdes}. `
    + 'Draw a stub and name that net instead of repeating a port name.', 'error');
}

export async function confirmNamedConnection(name, conflicts) {
  const port = conflicts.find((conflict) => conflict.kind === 'port')?.component;
  const target = port ? `port ${port.refdes}` : 'an existing named net';
  return confirmChoice({
    title: 'Connect named nets?',
    message: `The name ${name} is already used by ${target}. Connect this net virtually to the existing name?`,
    confirmLabel: 'Connect',
    cancelLabel: 'Keep separate',
  });
}

export function restoreProvisionalLabel(label, initialName = '') {
  const net = label?.netId ? editor.circuit.nets.get(label.netId) : null;
  if (label && editor.circuit.labels.has(label.id)) editor.circuit.removeLabel(label.id);
  if (net && net.name !== initialName) {
    try { editor.circuit.renameNet(net.id, initialName); }
    catch (err) { logLine(`could not restore provisional net: ${err.message}`, 'error'); }
  }
}

/** Short the nets crossing at a just-placed solder dot. Returns true when the
 * short is waiting for a net-name choice (the picker opens after render). */
export function shortNetsAtPlacedSolder(comp) {
  const point = { x: comp.transform.x, y: comp.transform.y };
  try {
    const net = editor.circuit.shortNetsAt(point);
    if (net) logLine(`solder joined nets at (${point.x},${point.y}) into ${net.name || net.id}`);
    return false;
  } catch (err) {
    if (err.code !== 'net-name-choice') throw err;
    const historyLength = editor.history.length;
    askNetNameChoice({
      point,
      names: err.names,
      pick(name) {
        const before = snapshot();
        const net = editor.circuit.shortNetsAt(point, { name });
        markModelChanged();
        playCommitFeedback(before);
        logLine(`solder joined nets at (${point.x},${point.y}) into ${net?.name || net?.id}`);
      },
      cancel() {
        if (editor.history.length === historyLength) {
          // The placement was the latest commit: undo it without a redo entry.
          editor.circuit = Circuit.fromJSON(JSON.parse(editor.history.pop()));
        } else {
          editor.circuit.components.delete(comp.refdes);
          editor.circuit.syncJunctionSolders();
        }
        markModelChanged();
        logLine('solder cancelled: no net name chosen');
      },
    });
    return true;
  }
}

/** Every edit that shorts nets carrying different given names (a solder dot
 * on a crossing, a wire or pin drag onto another named net, a splice, a move
 * onto a pin) asks which name the merged net keeps. The question is one menu
 * at the short: a pick applies the name, Escape or an outside click cancels
 * the whole edit. `choice` is { point, names, pick(name), cancel(), heading? }. */
function askNetNameChoice(choice) {
  editor.pendingNetNameChoice = choice;
  requestAnimationFrame(openNetNameChoiceMenu);
}

/** A commit that shorts two given names asks which one survives; a cancel
 * restores the pre-commit document. */
export function askNameForNewNetNameConflict(startSnapshot) {
  if (editor.pendingNetNameChoice || editor.suppressNetNameChoice) return;
  if (askForNewNetNameWarning(startSnapshot)) return;
  askForNewReferenceShort(startSnapshot);
}

/** Model merges that allow name conflicts keep one name and leave a
 * netNameWarnings entry. A commit that adds one asks the user instead: the
 * pick renames the merged net. */
function askForNewNetNameWarning(startSnapshot) {
  const warnings = editor.circuit.netNameWarnings || [];
  if (!warnings.length) return false;
  let previous = [];
  try { previous = JSON.parse(startSnapshot).netNameWarnings || []; } catch { return false; }
  const key = (warning) => `${warning.netId}:${warning.names.join('|')}`;
  const known = new Set(previous.map(key));
  const warning = warnings.find((entry) => !known.has(key(entry)) && editor.circuit.nets.has(entry.netId));
  if (!warning) return false;
  const historyLength = editor.history.length;
  const netId = warning.netId;
  askNetNameChoice({
    point: { ...editor.cursor },
    names: [...warning.names],
    pick(name) {
      const net = editor.circuit.nets.get(netId);
      if (!net) return;
      editor.circuit.renameNet(net, name);
      markModelChanged();
      logLine(`merged net ${net.id} keeps the name ${name}`);
    },
    cancel() {
      if (editor.history.length === historyLength) editor.history.pop();
      applyJson(startSnapshot);
      logLine('connection cancelled: no net name chosen');
    },
  });
  return true;
}

/** An unnamed ground, supply, or VCM marker joined to a named net ties that
 * name into the shared rail without any model warning. A commit that makes
 * such a join asks to rename the net to the rail; a cancel reverts the edit. */
function askForNewReferenceShort(startSnapshot) {
  const conflicts = referenceMarkerNameConflicts(editor.circuit);
  if (!conflicts.length) return false;
  let known;
  try {
    known = new Set(referenceMarkerNameConflicts(loadDocument(JSON.parse(startSnapshot)))
      .map((entry) => `${entry.refdes}:${entry.name}`));
  } catch { return false; }
  const conflict = conflicts.find((entry) => !known.has(`${entry.refdes}:${entry.name}`));
  if (!conflict) return false;
  const historyLength = editor.history.length;
  const marker = editor.circuit.components.get(conflict.refdes);
  askNetNameChoice({
    point: marker ? { x: marker.transform.x, y: marker.transform.y } : { ...editor.cursor },
    heading: 'Rename net to',
    names: [conflict.railName],
    pick(name) {
      const net = editor.circuit.nets.get(conflict.netId);
      if (!net) return;
      editor.circuit.renameNet(net, name);
      markModelChanged();
      logLine(`net ${conflict.name} joins ${conflict.refdes} and is renamed ${name}`);
    },
    cancel() {
      if (editor.history.length === historyLength) editor.history.pop();
      applyJson(startSnapshot);
      logLine(`connection cancelled: ${conflict.name} stays off the ${conflict.railName} rail`);
    },
  });
  return true;
}

function openNetNameChoiceMenu() {
  const choice = editor.pendingNetNameChoice;
  if (!choice || !componentContextMenuEl) return;
  closeComponentContextMenu();
  const menu = componentContextMenuEl;
  menu.hidden = false;
  const at = worldToClient(choice.point.x, choice.point.y);
  menu.style.left = `${Math.max(4, Math.min(at.x + 18, window.innerWidth - 220))}px`;
  menu.style.top = `${Math.max(4, at.y - 12)}px`;
  const heading = document.createElement('div');
  heading.className = 'context-menu-heading';
  heading.textContent = choice.heading || 'Keep net name';
  menu.appendChild(heading);
  for (const name of choice.names) {
    const item = appendContextItem(menu, '', () => {
      editor.contextMenuDismiss = null;
      editor.pendingNetNameChoice = null;
      try {
        choice.pick(name);
      } catch (err) {
        logLine(`net name choice failed: ${err.message}`, 'error');
        choice.cancel();
      }
      render();
    });
    const text = document.createElement('span');
    appendMarkupText(text, name);
    item.prepend(text);
  }
  editor.contextMenuDismiss = () => {
    editor.pendingNetNameChoice = null;
    choice.cancel();
    render();
  };
  const rect = menu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 4) menu.style.top = `${Math.max(4, window.innerHeight - 4 - rect.height)}px`;
  menu.querySelector('button')?.focus();
}
