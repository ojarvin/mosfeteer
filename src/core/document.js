import { Circuit, normalizeDesignLink } from './model.js';
import { svgString } from './render.js';
import { relinkNotes } from './notes.js';

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
/** Load a saved document. */
export function loadDocument(data) {
  documentKind(data);
  return Circuit.fromJSON(data);
}
export function renderDocument(document, options = {}) { return svgString(document, options); }

/**
 * Point every link in a document's saved state that names design `from` at
 * `to` instead (a design renamed): its parts' links and its notes' `[[design]]`
 * links. The state is changed in place; returns how many links were changed.
 */
export function relinkDocumentState(state, from, to) {
  const old = normalizeDesignLink(from);
  const next = normalizeDesignLink(to);
  if (!old || !next || old === next || !Array.isArray(state?.components)) return 0;
  let count = 0;
  for (const component of state.components) {
    if (component && normalizeDesignLink(component.link) === old) {
      component.link = next;
      count += 1;
    }
  }
  // The notes' [[design]] links too (notes.js).
  if (typeof state.notes === 'string') {
    const relinked = relinkNotes(state.notes, old, next);
    state.notes = relinked.text;
    count += relinked.count;
  }
  return count;
}
