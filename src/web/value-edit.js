/**
 * q: one field for the value of what is selected, else of what the cursor
 * points at, applied to all of it as one undo step. A part's value is its
 * value (10k, a gain's coefficient, a block's transfer function), a
 * transistor's its size (2u/180n x4), and a port's, rail's, or switch's its
 * name or phase; a label's is its text: a net label's names its net, a
 * part's name label renames the part, a value or size label sets the
 * part's. A name that joins nets asks first, saying what it would short.
 */

import { INTERFACE_PIN_TYPES, componentNameIdentity, isReferenceMarker } from '../core/model.js';
import { partKind } from '../core/parts-table.js';
import { setPartValue } from '../core/part-moves.js';
import { TRANSFER_FUNCTION_ROLE, isSignalBlock } from '../core/transfer-function.js';
import { switchState } from '../core/beats.js';
import { PART_VALUE_ROLE } from '../core/part-value.js';
import { MOS_SIZE_ROLE, formatMosSize } from '../core/mos-size.js';
import { confirmChoice } from './file-dialog.js';
import { promptText } from './annotation-tools.js';
import { interfacePortNet, namedConnectionConflicts, partsBetween, renameLabelThroughModel, shortedPartsWarning } from './net-names.js';
import { logLine, hintLine } from './status-bar-ui.js';
import { editor } from './editor-state.js';
import { applyJson, compUnderCursor, markModelChanged, pickLabel, recordHistoryEntry, render, selectedComps, selectedLabels, snapshot } from './main.js';

/** What a part's q edits: `{ kind, text, apply(v), refdes?, net? }`, or null. */
function partItem(part) {
  if (!part || part.type === 'solder') return null;
  const circuit = editor.circuit;
  if (partKind(part) === 'size') {
    return { kind: 'size', text: part.size ? formatMosSize(part.size) : '', apply: (v) => circuit.setComponentSize(part.refdes, v) };
  }
  if (partKind(part) === 'value' || isSignalBlock(part) || part.type === 'block') {
    return { kind: 'value', text: part.value || '', apply: (v) => setPartValue(circuit, part.refdes, v) };
  }
  // A port, a rail, or a switch: its name label is what it says.
  if (INTERFACE_PIN_TYPES.has(part.type) || isReferenceMarker(part) || switchState(part)) {
    const label = circuit.labelOf(part.refdes);
    return label ? labelItem(label) : null;
  }
  return null;
}

/** What a label's q edits, by what the label is; null for one it cannot. */
function labelItem(label) {
  const circuit = editor.circuit;
  if (!label || label.role === 'signal-input-sign' || label.figure || label.plot || label.table || label.image) return null;
  // A box's or an arrow's text is its child label.
  if (label.kind && label.kind !== 'label') {
    const child = [...circuit.labels.values()].find((candidate) => candidate.parent === label.id);
    return child ? labelItem(child) : null;
  }
  const owner = label.owner ? circuit.components.get(label.owner) : null;
  if (owner && (label.role === PART_VALUE_ROLE || label.role === TRANSFER_FUNCTION_ROLE || label.role === MOS_SIZE_ROLE)) return partItem(owner);
  if (label.isNetLabel?.()) return { kind: 'net', text: label.text, net: circuit.nets.get(label.netId), apply: (v) => renameLabelThroughModel(label, v) };
  if (owner && INTERFACE_PIN_TYPES.has(owner.type)) return { kind: 'port', text: label.text, refdes: owner.refdes, net: interfacePortNet(owner), apply: (v) => renameLabelThroughModel(label, v) };
  // A part's name: its identity, one per part.
  if (owner && !label.role && !isReferenceMarker(owner) && !switchState(owner) && !label.math) {
    return { kind: 'name', text: label.text, refdes: owner.refdes, apply: (v) => renameLabelThroughModel(label, v) };
  }
  return { kind: 'text', text: label.text, apply: (v) => renameLabelThroughModel(label, v) };
}

/** The items q edits: the selection's, else what the cursor points at. */
function editItems() {
  const items = [];
  const seen = new Set();
  const add = (item, key) => { if (item && !seen.has(key)) { seen.add(key); items.push(item); } };
  for (const part of selectedComps()) add(partItem(part), `part:${part.refdes}`);
  for (const label of selectedLabels()) {
    const item = labelItem(label);
    add(item, item?.refdes ? `part:${item.refdes}` : `label:${label.id}`);
  }
  // A selected net with no label selected: its first label.
  if (!items.length) {
    for (const netId of editor.selectedNets) {
      const label = editor.circuit.netLabels(netId)[0];
      if (label) add(labelItem(label), `label:${label.id}`);
    }
  }
  if (items.length || selectedComps().length || selectedLabels().length) return items;
  const pointed = pickLabel(editor.cursor);
  if (pointed) return [labelItem(pointed)].filter(Boolean);
  return [partItem(compUnderCursor())].filter(Boolean);
}

const TITLES = { value: 'Value', size: 'Size', net: 'Net name', port: 'Port name', name: 'Name', text: 'Text' };

/** Why `v` cannot go to these items, or null. Names are identities: two
 *  parts or two ports never share one. */
function nameProblem(items, v) {
  const named = items.filter((item) => item.kind === 'name' || item.kind === 'port');
  if (named.length > 1) return `${named.map((item) => item.refdes).join(', ')} cannot share the name ${v}: each part's name is its own`;
  const [item] = named;
  if (!item) return null;
  const canonical = componentNameIdentity(v);
  if (item.kind === 'name' && !/^[A-Za-z][A-Za-z0-9_]*$/.test(canonical)) return `"${v}" is not a part name`;
  if (canonical !== item.refdes && editor.circuit.components.has(canonical)) return `the name ${canonical} is already in use`;
  if (item.kind === 'port') {
    const port = namedConnectionConflicts(v, { ownerRefdes: item.refdes }).find((conflict) => conflict.kind === 'port');
    if (port) return `port ${port.component.refdes} is already named ${v}: name the net with a stub instead`;
  }
  return null;
}

/** The nets that naming these items `v` joins: the items' own nets, when
 *  more than one, and nets already named so. Asks; resolves whether to go on. */
async function confirmJoins(items, v) {
  const owned = items.filter((item) => (item.kind === 'net' || item.kind === 'port') && item.net);
  if (!owned.length) return true;
  const nets = [...new Map(owned.map((item) => [item.net.id, item.net])).values()];
  const ids = new Set(nets.map((net) => net.id));
  const outside = owned.flatMap((item) => namedConnectionConflicts(v, { netId: item.net.id, ownerRefdes: item.kind === 'port' ? item.refdes : null }))
    .filter((conflict) => !conflict.net || !ids.has(conflict.net.id));
  const shorts = [];
  for (let i = 0; i < nets.length; i++) for (let j = i + 1; j < nets.length; j++) shorts.push({ shorts: partsBetween(nets[i], nets[j]) });
  if (nets.length < 2 && !outside.length) return true;
  const count = nets.length + new Set(outside.map((conflict) => conflict.net?.id).filter(Boolean)).size;
  return confirmChoice({
    title: 'Connect named nets?',
    message: `Naming ${nets.length > 1 ? `these ${nets.length} nets` : 'this net'} ${v} connects ${count} nets virtually${outside.length ? `, ${outside.length === 1 ? 'one' : 'some'} already named ${v}` : ''}.${shortedPartsWarning([...shorts, ...outside])}`,
    confirmLabel: 'Connect',
    cancelLabel: 'Keep separate',
  });
}

/** q: ask for the value, then set it on every item as one undo step. */
export async function editValues() {
  const items = editItems();
  if (!items.length) {
    hintLine('q edits a value or a label: select parts or labels, or point at one');
    return;
  }
  const kinds = new Set(items.map((item) => item.kind));
  const texts = new Set(items.map((item) => item.text));
  const title = `${kinds.size === 1 ? TITLES[[...kinds][0]] : 'Value'}${items.length > 1 ? ` (${items.length})` : ''}`;
  const v = await promptText({ title, value: texts.size === 1 ? [...texts][0] : '', placeholder: texts.size === 1 ? '' : 'they differ: type one for all' });
  // Esc, an empty field, or a press elsewhere: nothing changes.
  if (!v) return;
  const problem = nameProblem(items, v);
  if (problem) {
    logLine(problem, 'error');
    return;
  }
  if (!await confirmJoins(items, v)) return;
  const before = snapshot();
  try {
    for (const item of items) if (item.text !== v) item.apply(v);
  } catch (err) {
    // All or none: one that does not take it leaves every item as it was.
    applyJson(before);
    logLine(`${v}: ${err.message || err}`, 'error');
    render();
    return;
  }
  if (snapshot() !== before) {
    recordHistoryEntry(before, true);
    markModelChanged();
    logLine(`${items.length === 1 ? TITLES[items[0].kind].toLowerCase() : `${items.length} values`} set to ${v}`);
  }
  render();
}
