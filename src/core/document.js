import { Circuit } from './model.js';
import { svgString } from './render.js';

export function documentKind(data) {
  if (data?.kind === 'block') throw new Error('block diagram documents are no longer supported');
  return 'circuit';
}
export function documentKindLabel() { return 'Schematic'; }
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
export function saveDocument(document) { return document.toJSON(); }
export function isDocument(value) { return value instanceof Circuit; }
