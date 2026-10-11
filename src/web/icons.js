/**
 * Toolbar icons and tool cursors in the page: the line icons (icon-paths.js)
 * put on buttons, and the canvas cursor for the live tool (tool-cursor.js).
 */

import { canvasEl } from './elements.js';
import { editor } from './editor-state.js';
import { interactionState } from './main.js';
import { ICON_PATHS } from './icon-paths.js';
import { TOOL_CURSOR_ICONS, allToolCursors, toolCursorValue } from './tool-cursor.js';

export { ICON_PATHS } from './icon-paths.js';

function cursorIconFor(state) {
  if (state.key === 'wire') return editor.routeMode === 'diagonal' ? 'wire-diagonal' : 'wire';
  return TOOL_CURSOR_ICONS[state.key] ?? null;
}

let appliedToolCursor = null;

/** Point `.canvas` at the cursor for the live tool; CSS inherits it into the SVG. */
export function syncToolCursor(state = interactionState()) {
  const dark = document.documentElement.classList.contains('dark');
  const value = toolCursorValue(cursorIconFor(state), { dark, danger: state.key === 'delete' });
  if (value === appliedToolCursor) return; // every render calls this; only real changes touch style
  appliedToolCursor = value;
  canvasEl?.style.setProperty('--tool-cursor', value);
}

// Chromium paints an image cursor only once its bitmap has loaded, so every
// variant is fetched up front and its Image kept alive to hold the decoded
// bitmap in the memory cache: a swap never waits on a fetch. This does not
// make a tool change visible under a parked pointer — the compositor repaints
// the cursor on the next pointer motion — which is out of the page's reach.
const toolCursorImages = [];

function preloadToolCursors() {
  for (const value of allToolCursors()) {
    const image = new Image();
    image.src = value.slice(value.indexOf('"') + 1, value.lastIndexOf('"'));
    toolCursorImages.push(image);
  }
}

/** One line icon (ICON_PATHS) as an inline SVG, for a button built in code. */
export function buttonIcon(name) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('button-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  icon.innerHTML = ICON_PATHS[name] || '';
  return icon;
}

function installButtonIcons() {
  for (const button of document.querySelectorAll('button[data-icon], .tip-card-mark[data-icon]')) {
    if (!ICON_PATHS[button.dataset.icon] || button.querySelector('.button-icon')) continue;
    button.prepend(buttonIcon(button.dataset.icon));
  }
}

export function installIcons() {
  installButtonIcons();
  preloadToolCursors();
}
