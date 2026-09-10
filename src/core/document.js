import { Circuit } from './model.js';
import { BlockDiagram, isBlockDiagram } from './block-model.js';
import { svgString } from './render.js';
import { blockSvgString } from './block-render.js';

export { isBlockDiagram } from './block-model.js';

export function documentKind(data) { return data?.kind === 'block' ? 'block' : 'circuit'; }
export function documentKindLabel(value) {
  return documentKind(value) === 'block' ? 'Block diagram' : 'Schematic';
}
export function createDocument(kind = 'circuit') {
  if (kind === 'block') return new BlockDiagram();
  if (kind === 'circuit' || kind === 'schematic') return new Circuit();
  throw new Error(`unknown document kind "${kind}"`);
}
export function loadDocument(data) { return documentKind(data) === 'block' ? BlockDiagram.fromJSON(data) : Circuit.fromJSON(data); }
export function renderDocument(document, options = {}) { return isBlockDiagram(document) ? blockSvgString(document, options) : svgString(document, options); }
export function saveDocument(document) { return document.toJSON(); }
export function isDocument(value) { return value instanceof Circuit || value instanceof BlockDiagram; }
