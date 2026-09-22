import { Circuit } from './model.js';
import { svgString } from './render.js';

const FORBIDDEN_NAME_CHARS = /[/\\:*?"<>|\u0000-\u001f\u007f]/;

/** Validate a portable document name shared by the server and browser adapters. */
export function validDocumentName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 120 || name.startsWith('.') || FORBIDDEN_NAME_CHARS.test(name)) return null;
  return name;
}

export function documentKind(data) {
  if (data?.kind === 'block') throw new Error('block diagram documents are no longer supported');
  return 'circuit';
}
export function createDocument(kind = 'circuit') {
  if (kind === 'circuit' || kind === 'schematic') return new Circuit();
  throw new Error(`unknown document kind "${kind}"`);
}
/** Load a saved document. Schematics are normalized to the app's single wire
 * model: legacy fixed nets become managed nets with protected diagonals. */
export function loadDocument(data) {
  documentKind(data);
  const circuit = Circuit.fromJSON(data);
  circuit.convertFixedNets();
  return circuit;
}
export function renderDocument(document, options = {}) { return svgString(document, options); }
