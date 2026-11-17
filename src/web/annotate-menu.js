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
import { setLabelSelection, setSelection } from './main.js';
import { logLine } from './status-bar-ui.js';

/** mode -> [() => items]; an item is { label, identity: { kind, source,
 *  key? }, available, run }; one of no identity (Update all plots) is no
 *  figure, and comes after the figures. */
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
  const items = (providers.get(mode) || []).flatMap((provider) => provider());
  return [...items.filter((item) => item.identity), ...items.filter((item) => !item.identity)];
}

/** Whether `figure` is one an item of identity { kind, source, key } draws. */
const drawnBy = (figure, { kind, source, key }) => figure.kind === kind && (figure.source === null || figure.source === source)
  && (key === undefined || (key instanceof RegExp ? key.test(figure.key || '') : figure.key === key));

/** Whether a figure of that identity is on the drawing. */
function onDrawing(identity) {
  return listFigures(editor.circuit).some((figure) => drawnBy(figure, identity));
}

/** What a figure is called in Update and the log, by kind (plots have Update plot). */
const FIGURE_NAMES = { equations: ['equations', true], coefficients: ['coefficients', true], noise: ['noise table'], model: ['model'], table: ['table'] };

/**
 * The right-click Update of the figure `member` (a label or part) is in:
 * `{ text, run }`, or null for one no tool's Annotate draws again. It draws
 * the figure again in place as its tool's Annotate does, with the settings
 * now; when the tool has nothing to draw it from, the log says to derive.
 */
export function figureUpdate(member) {
  const figure = listFigures(editor.circuit).find((candidate) => candidate.labels.includes(member) || candidate.components.includes(member));
  const name = figure && FIGURE_NAMES[figure.kind];
  if (!name) return null;
  const item = [...providers.values()].flat().flatMap((provider) => provider()).find((candidate) => candidate.identity && drawnBy(figure, candidate.identity));
  if (!item) return null;
  const [word, plural] = name;
  return {
    text: `Update ${word}`,
    run: () => {
      if (!item.available) {
        logLine(`left the ${word} as ${plural ? 'they were' : 'it was'}: derive first (Shift+S)`, 'error');
        return;
      }
      // Its tool updates the selected figure of its kind.
      setSelection(figure.components.map((component) => component.refdes));
      setLabelSelection(figure.labels.map((label) => label.id));
      item.run();
    },
  };
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
