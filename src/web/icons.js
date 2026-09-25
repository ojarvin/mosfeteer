/**
 * Toolbar icons and tool cursors: the line icons buttons carry, and the
 * select arrow badged with the active tool's icon.
 */

import { canvasEl } from './elements.js';
import { editor } from './editor-state.js';
import { interactionState } from './main.js';

// Small line icons keep the compact tool rail scannable without a dependency.
// Button text and existing aria labels remain the accessible names.
export const ICON_PATHS = {
  'folder-open': '<path d="M3 6.5h6l2 2h10v9H3z"/><path d="M3 6.5V5h7l2 2h9"/>',
  folder: '<path d="M3 6.5h6l2 2h10v10H3z" fill="currentColor" fill-opacity=".16"/><path d="M3 6.5V5h7l2 2"/>',
  workspace: '<path d="M4 5h16v14H4z" fill="currentColor" fill-opacity=".16"/><path d="M4 9h16"/>',
  replace: '<path d="M4 8h12m0 0-3-3m3 3-3 3M20 16H8m0 0 3-3m-3 3 3 3"/>',
  sidebar: '<path d="M4 5h16v14H4z"/><path d="M14 5h6v14h-6z" fill="currentColor" fill-opacity=".16"/>',
  'file-plus': '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M12 11v6M9 14h6"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4.5h5v2"/><path d="M6.5 6.5l1 13h9l1-13" fill="currentColor" fill-opacity=".16"/><path d="M10.5 10.5v6M13.5 10.5v6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  analysis: '<path d="M4 19h16M6 16l4-5 3 3 5-7"/><path d="M6 19V5m6 14V9m6 10V4"/>',
  save: '<path d="M5 4h12l3 3v13H4V4zM8 4v6h8V4M8 20v-6h8v6"/>',
  download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M4 20h16"/>',
  grid: '<path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16"/>',
  crosshair: '<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  guides: '<path d="M5 4v16M12 4v16M19 4v16" stroke-dasharray="3 2.4"/><path d="M5 12h7M12 12h7"/><path d="M5 9.5v5M12 9.5v5M19 9.5v5"/>',
  moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  'align-left': '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  'align-center': '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  'align-right': '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  'align-parent': '<path d="M3 7h11M7 12h7M3 17h11"/><path d="M18 4v16" stroke-width="3"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  pin: '<path d="M9 4h6l-1 6 3 3H7l3-3zM12 13v7"/>',
  rotate: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M20 4v5h-5"/>',
  'page-guide': '<path d="M5 3v18M19 3v18" stroke-dasharray="2.5 2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  graduation: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v6"/>',
  lightbulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
  trackpad: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 15h17M12 15v4"/>',
  'mirror-x': '<path d="M12 3v18" stroke-dasharray="2 2.4"/><path d="M9 7 4 17h5zM15 7l5 10h-5z"/>',
  'mirror-y': '<path d="M3 12h18" stroke-dasharray="2 2.4"/><path d="M7 9 17 4v5zM7 15l10 5v-5z"/>',
  'route-orthogonal': '<path d="M4 18h8V6h8"/>',
  'route-diagonal': '<path d="M4 18h5l6-12h5"/>',
  cursor: '<path d="M6 3.5 18.5 12l-5.8 1.4L9.5 19.5z" fill="currentColor" fill-opacity=".16"/>',
  plus: '<rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="currentColor" fill-opacity=".16"/><path d="M12 8v8M8 12h8"/>',
  'wire-diagonal': '<path d="M5 18h4l6-12h4"/><circle cx="5" cy="18" r="2.2" fill="currentColor" stroke="none"/><circle cx="19" cy="6" r="2.2" fill="currentColor" stroke="none"/>',
  wire: '<path d="M5 18h6V6h8"/><circle cx="5" cy="18" r="2.2" fill="currentColor" stroke="none"/><circle cx="19" cy="6" r="2.2" fill="currentColor" stroke="none"/>',
  'box-select': '<rect x="3.5" y="3.5" width="14" height="14" rx="2" stroke-dasharray="3 2.4"/><path d="m12.5 12.5 8 3-3.4 1.2-1.2 3.4z" fill="currentColor" stroke="none"/>',
  move: '<path d="M12 5v14M5 12h14"/><path d="m12 2 3.2 3.8H8.8zM12 22l-3.2-3.8h6.4zM2 12l3.8-3.2v6.4zM22 12l-3.8 3.2V8.8z" fill="currentColor" stroke="none"/>',
  detach: '<rect x="8" y="6.5" width="8" height="11" rx="1.8" fill="currentColor" fill-opacity=".16"/><path d="M2.5 12H5M19 12h2.5"/><path d="m5.5 9-1 6M19.5 9l-1 6"/>',
  copy: '<rect x="3.5" y="3.5" width="11" height="11" rx="2"/><rect x="9.5" y="9.5" width="11" height="11" rx="2" fill="currentColor" fill-opacity=".16"/>',
  tag: '<path d="M3.5 4.5v7l9 9 8-8-9-9h-7z" fill="currentColor" fill-opacity=".16"/><circle cx="8" cy="8.5" r="1.6" fill="currentColor" stroke="none"/>',
  highlight: '<path d="M14.5 4.5l5 5-8 8H6.5v-5z" fill="currentColor" fill-opacity=".16"/><path d="M12 7l5 5"/><path d="M3.5 20.5h8"/>',
  text: '<path d="M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6"/>',
  arrow: '<path d="M5 19 16 8"/><path d="M20 4l-1.6 9-7.4-7.4z" fill="currentColor" stroke="none"/>',
  rectangle: '<rect x="3.5" y="5.5" width="17" height="13" rx="2" fill="currentColor" fill-opacity=".16"/>',
  line: '<path d="M6 18 18 6"/><circle cx="5" cy="19" r="2" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="2" fill="currentColor" stroke="none"/>',
  front: '<rect x="3.5" y="3.5" width="11" height="11" rx="2" stroke-dasharray="2.6 2.2"/><rect x="9.5" y="9.5" width="11" height="11" rx="2" fill="currentColor" fill-opacity=".45"/>',
  back: '<rect x="9.5" y="9.5" width="11" height="11" rx="2" stroke-dasharray="2.6 2.2"/><rect x="3.5" y="3.5" width="11" height="11" rx="2" fill="currentColor" fill-opacity=".45"/>',
  beats: '<rect x="3.5" y="7.5" width="11" height="11" rx="1.5"/><path d="M7.5 5.5v-2h13v11h-2"/>',
  timing: '<path d="M3 16h4V8h6v8h6V8h2"/>',
  stub: '<path d="M4.5 12h6"/><circle cx="4" cy="12" r="2.2" fill="currentColor" stroke="none"/><path d="M11 8.5h6.5l3 3.5-3 3.5H11z" fill="currentColor" fill-opacity=".16"/>',
  align: '<path d="M4 3v18"/><rect x="7" y="6" width="11" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/><path d="m20 12-2-2m2 2-2 2"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor" fill-opacity=".18"/>',
  'x-circle': '<circle cx="12" cy="12" r="8"/><path d="m9 9 6 6m0-6-6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.2.8-1.5 1.3-1.5 2.5M12 17h.01"/>',
  // Line-style choices are shown as the pattern itself, using the same
  // dash ratios as styleAttrs() in core/style.js, scaled to the icon grid.
  'line-solid': '<path d="M2 12h20"/>',
  'line-dashed': '<path d="M2 12h20" stroke-dasharray="5 4"/>',
  'line-dash-dot': '<path d="M2 12h20" stroke-dasharray="6 3 1 3"/>',
  'line-dotted': '<path d="M2 12h20" stroke-linecap="round" stroke-dasharray="0.1 4"/>',
  'width-thin': '<path d="M3 12h18" stroke-width="2"/>',
  'width-normal': '<path d="M3 12h18" stroke-width="3.5"/>',
  'width-thick': '<path d="M3 12h18" stroke-width="5.5"/>',
  'arrow-start': '<path d="M20 12H7"/><path d="M4 12l5.5-4v8z" fill="currentColor" stroke="none"/>',
  'arrow-end': '<path d="M4 12h13"/><path d="M20 12l-5.5-4v8z" fill="currentColor" stroke="none"/>',
};

// The canvas pointer is the select arrow, badged with the active tool's rail
// icon so the current mode reads where the eye already is. Cursors are data
// URIs built from the same ICON_PATHS the rail draws, cached per icon/theme.
const CURSOR_ARROW = 'M1.5 1 1.5 18.5 6.1 14.3 9 20.6 11.9 19.2 9.1 13.2 15 12.7Z';

const TOOL_CURSOR_ICONS = {
  normal: null,
  place: 'plus',
  visual: 'box-select',
  move: 'move',
  'detached-move': 'detach',
  copy: 'copy',
  delete: 'trash',
  align: 'align',
  'net-label': 'tag',
  highlight: 'highlight',
  annotation: 'text',
  equation: 'text',
  arrow: 'arrow',
  box: 'rectangle',
  line: 'line',
};

const toolCursorCache = new Map();

/** One `cursor` value: arrow plus optional tool badge, outlined so it stays
 * legible on light paper, dark paper, and over drawn ink. */
function toolCursorValue(icon, { dark = false, danger = false } = {}) {
  const key = `${icon || ''}|${dark}|${danger}`;
  const cached = toolCursorCache.get(key);
  if (cached) return cached;
  const ink = dark ? '#f4f5f7' : '#16181d';
  const halo = dark ? '#16181d' : '#ffffff';
  const badgeInk = danger ? (dark ? '#ff8f85' : '#c33b2e') : ink;
  const glyph = ICON_PATHS[icon] || '';
  const badge = glyph
    ? `<g transform="translate(14 14) scale(.7)" fill="none" stroke-linecap="round" stroke-linejoin="round">`
      + `<g style="color:${halo}" stroke="${halo}" stroke-width="4.8">${glyph}</g>`
      + `<g style="color:${badgeInk}" stroke="${badgeInk}" stroke-width="2.2">${glyph}</g></g>`
    : '';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
    + `<path d="${CURSOR_ARROW}" fill="${ink}" stroke="${halo}" stroke-width="1.4" stroke-linejoin="round"/>`
    + `${badge}</svg>`;
  // The hotspot is the arrow tip, so the pointer still picks the exact grid point.
  const value = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 1, default`;
  toolCursorCache.set(key, value);
  preloadToolCursorImage(value);
  return value;
}

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

function preloadToolCursorImage(value) {
  const image = new Image();
  image.src = value.slice(value.indexOf('"') + 1, value.lastIndexOf('"'));
  toolCursorImages.push(image);
}

/** Build (and so fetch) every cursor the editor can switch to, in both themes. */
function preloadToolCursors() {
  const icons = new Set([...Object.values(TOOL_CURSOR_ICONS), 'wire', 'wire-diagonal']);
  for (const dark of [false, true]) {
    for (const icon of icons) toolCursorValue(icon, { dark });
    toolCursorValue(TOOL_CURSOR_ICONS.delete, { dark, danger: true });
  }
}

function installButtonIcons() {
  for (const button of document.querySelectorAll('button[data-icon], .tip-card-mark[data-icon]')) {
    const path = ICON_PATHS[button.dataset.icon];
    if (!path || button.querySelector('.button-icon')) continue;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add('button-icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.innerHTML = path;
    button.prepend(icon);
  }
}

export function installIcons() {
  installButtonIcons();
  preloadToolCursors();
}
