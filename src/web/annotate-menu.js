/**
 * The analysis window's Annotate menu: one place for everything the
 * analysis on screen can put on the drawing -- its equation table, the
 * small-signal model, its graph, the kT/C noise table. Each mode
 * registers what it offers (`registerAnnotations`); an item marked ✓ is on
 * the drawing already, and choosing it updates that figure in place
 * (figures.js). Everything puts every one there at once, packed as one.
 */

import { listFigures } from '../core/figures.js';
import { appendContextItem, openMenuAt } from './context-menu.js';
import { editor } from './editor-state.js';

/** mode -> [() => items]; an item is { label, identity: { kind, source,
 *  key? }, available, run }. */
const providers = new Map();
let currentMode = () => 'circuit';

/** What `mode` can annotate: `provider()` lists its items as they are now. */
export function registerAnnotations(mode, provider) {
  if (!providers.has(mode)) providers.set(mode, []);
  providers.get(mode).push(provider);
}

/** Where the menu reads the window's mode from (signal-flow-ui.js). */
export function setAnnotationMode(getMode) {
  currentMode = getMode;
}

/** The items the window's mode offers now. */
export function annotationItems(mode = currentMode()) {
  return (providers.get(mode) || []).flatMap((provider) => provider());
}

/** Whether a figure of that identity is on the drawing. */
function onDrawing({ kind, source, key }) {
  return listFigures(editor.circuit).some((figure) => figure.kind === kind && (figure.source === null || figure.source === source)
    && (key === undefined || (key instanceof RegExp ? key.test(figure.key || '') : figure.key === key)));
}

/** Open the menu above `button`. */
export function openAnnotateMenu(button) {
  const items = annotationItems();
  const rect = button.getBoundingClientRect();
  const menu = openMenuAt(rect.left, rect.top, 'Annotate');
  if (!menu) return;
  const ready = items.filter((item) => item.available && item.identity);
  appendContextItem(menu, 'Everything', () => { for (const item of ready) item.run(); }, { disabled: ready.length < 2 });
  for (const item of items) appendContextItem(menu, item.label, item.run, { disabled: !item.available, active: !!item.identity && onDrawing(item.identity) });
  // A footer button: the menu opens upward.
  menu.style.top = `${Math.max(4, rect.top - menu.offsetHeight - 4)}px`;
}

/** Whether the window's mode has anything to annotate now. */
export const annotationsReady = () => annotationItems().some((item) => item.available);
