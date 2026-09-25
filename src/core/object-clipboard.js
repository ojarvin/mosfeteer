import { symbolTypes } from './components/index.js';

// Copied objects travel between editors (tabs, windows, other workspaces) as
// tagged JSON text on the system clipboard. The editor's in-memory copy buffer
// is the payload itself; this module only frames and checks it. Anything read
// back is untrusted: another app, an older editor, or a hand-edited paste may
// have put it there, so a payload that is not wholly well-formed is refused
// before any of it reaches the model.

export const OBJECT_CLIPBOARD_FORMAT = 'mosfeteer/objects';
export const OBJECT_CLIPBOARD_VERSION = 1;

/** The clipboard text for a copy buffer. */
export function encodeObjectClipboard(buffer) {
  return JSON.stringify({ format: OBJECT_CLIPBOARD_FORMAT, version: OBJECT_CLIPBOARD_VERSION, ...buffer });
}

/**
 * The copy buffer in clipboard `text`, or null when the text is not copied
 * Mosfeteer objects at all. Throws when it is tagged as Mosfeteer objects but
 * cannot be pasted (a newer version, or a damaged payload).
 */
export function decodeObjectClipboard(text) {
  if (typeof text !== 'string' || !text.trimStart().startsWith('{') || !text.includes(OBJECT_CLIPBOARD_FORMAT)) return null;
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!isObject(data) || data.format !== OBJECT_CLIPBOARD_FORMAT) return null;
  if (data.version !== OBJECT_CLIPBOARD_VERSION) {
    throw new Error(`copied objects are from a different Mosfeteer version (format ${data.version})`);
  }
  const problem = bufferProblem(data);
  if (problem) throw new Error(`copied objects could not be read: ${problem}`);
  const { format, version, ...buffer } = data;
  return buffer;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const point = (value) => isObject(value) && finite(value.x) && finite(value.y);
const path = (value) => Array.isArray(value) && value.every(point);
const optional = (value, check) => value === undefined || value === null || check(value);
const text = (value) => typeof value === 'string';
const endpoint = (value) => isObject(value) && text(value.comp) && text(value.term);

function componentProblem(comp) {
  if (!isObject(comp)) return 'a part is not an object';
  if (!text(comp.type) || !Object.hasOwn(symbolTypes, comp.type)) return `unknown part type ${JSON.stringify(comp.type)}`;
  if (!text(comp.origRef)) return 'a part has no name';
  if (!finite(comp.x) || !finite(comp.y) || !finite(comp.rotation)) return `part ${comp.origRef} has no position`;
  if (!optional(comp.negativeInputs, (inputs) => Array.isArray(inputs) && inputs.every(text))) return `part ${comp.origRef} has bad inputs`;
  if (!optional(comp.style, isObject)) return `part ${comp.origRef} has a bad style`;
  return null;
}

function labelProblem(label) {
  if (!isObject(label)) return 'a label is not an object';
  if (!['label', 'arrow', 'box', 'line'].includes(label.kind)) return `unknown label kind ${JSON.stringify(label.kind)}`;
  if (!finite(label.x) || !finite(label.y)) return 'a label has no position';
  if (label.kind === 'label' && !text(label.text)) return 'a text label has no text';
  if (label.kind !== 'label' && !point(label.end)) return `a ${label.kind} has no end`;
  if (label.kind === 'line' && !optional(label.points, path)) return 'a line has bad points';
  if (!optional(label.style, isObject)) return 'a label has a bad style';
  return null;
}

const netLabelsValid = (labels) => Array.isArray(labels) && labels.every((label) => isObject(label) && finite(label.x) && finite(label.y));

function netProblem(net) {
  if (!isObject(net)) return 'a net is not an object';
  if (!text(net.id)) return 'a net has no id';
  if (!optional(net.name, text)) return `net ${net.id} has a bad name`;
  if (!Array.isArray(net.terminals) || !net.terminals.every(endpoint)) return `net ${net.id} has bad terminals`;
  if (net.routingMode === 'fixed') {
    const entries = net.fixedPaths;
    if (!Array.isArray(entries) || !entries.every((entry) => isObject(entry) && path(entry.points)
      && optional(entry.start, endpoint) && optional(entry.end, endpoint))) return `net ${net.id} has bad wires`;
  } else {
    if (!optional(net.route, path) || !optional(net.branches, (branches) => Array.isArray(branches) && branches.every(path))) return `net ${net.id} has bad wires`;
    if (!Array.isArray(net.junctions) || !net.junctions.every(point)) return `net ${net.id} has bad junctions`;
  }
  if (!optional(net.netLabels, netLabelsValid)) return `net ${net.id} has bad labels`;
  return null;
}

function fragmentProblem(fragment) {
  if (!isObject(fragment)) return 'a wire is not an object';
  if (!Array.isArray(fragment.paths) || !fragment.paths.length || !fragment.paths.every(path)) return 'a wire has bad points';
  if (!Array.isArray(fragment.junctions) || !fragment.junctions.every(point)) return 'a wire has bad junctions';
  if (!optional(fragment.name, text)) return 'a wire has a bad net name';
  if (!optional(fragment.netLabels, netLabelsValid)) return 'a wire has bad labels';
  return null;
}

function bufferProblem(data) {
  if (!point(data.anchor)) return 'no anchor';
  for (const key of ['comps', 'labels', 'nets', 'fragments']) {
    if (!Array.isArray(data[key])) return `no ${key} list`;
  }
  if (!optional(data.style, isObject)) return 'a bad style';
  return data.comps.map(componentProblem).find(Boolean)
    || data.labels.map(labelProblem).find(Boolean)
    || data.nets.map(netProblem).find(Boolean)
    || data.fragments.map(fragmentProblem).find(Boolean)
    || null;
}
