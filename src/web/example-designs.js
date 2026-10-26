/**
 * Designs bundled with the editor (Learn's report example,
 * examples/report-example.js). Opening the example writes no file: its
 * first design opens unsaved, and the others are known -- to links, peeks,
 * notes, and reports -- from the bundle while the workspace has no design
 * of their name. Saving a design that names one (a part's link, a design
 * link or section in its notes) saves that one beside it, so the links
 * keep working from the files.
 */

import { noteDesignLinks, noteFigures } from '../core/notes.js';
import { reportExampleDesigns } from './examples/report-example.js';
import { persistence } from './document-session.js';

const PREFIX = 'example:';

/** The bundled designs no known document is named like, as document
 *  records whose `path` reads from the bundle (`loadDesign`). */
export function exampleDocuments(known = []) {
  const names = new Set(known.map((doc) => String(doc.name).toLowerCase()));
  return reportExampleDesigns()
    .filter((design) => !names.has(design.name.toLowerCase()))
    .map((design) => ({ name: design.name, path: `${PREFIX}${design.name}`, kind: 'circuit', example: true }));
}

/** Whether a document path reads from the bundle. */
export const isExamplePath = (path) => String(path ?? '').startsWith(PREFIX);

/** A known design's saved contents, `{ state }`: from its file, or from the
 *  bundle for an example not in the workspace. */
export async function loadDesign(doc, options) {
  if (!isExamplePath(doc?.path)) return persistence.load(doc.path, options);
  const design = reportExampleDesigns().find((entry) => entry.name === doc.path.slice(PREFIX.length));
  if (!design) throw new Error(`no bundled design "${doc.path.slice(PREFIX.length)}"`);
  return { state: design.state };
}

/** The bundled designs `circuit` names -- its parts' links, its notes' design
 *  links and sections -- that `known` (document records) has none of. */
export function namedExamples(circuit, known = []) {
  const named = new Set([
    ...[...circuit.components.values()].map((part) => part.link).filter(Boolean),
    ...noteDesignLinks(circuit.notes),
    ...noteFigures(circuit.notes).map((entry) => entry.name),
  ].map((name) => name.toLowerCase()));
  return exampleDocuments(known).filter((doc) => named.has(doc.name.toLowerCase()));
}
