/**
 * Tool cursors: the select arrow badged with the active tool's icon, as CSS
 * `cursor` values. Plain strings, so code without a page can build them.
 */

import { ICON_PATHS } from './icon-paths.js';

// The canvas pointer is the select arrow, badged with the active tool's rail
// icon so the current mode reads where the eye already is. Cursors are data
// URIs built from the same ICON_PATHS the rail draws, cached per icon/theme.
const CURSOR_ARROW = 'M1.5 1 1.5 18.5 6.1 14.3 9 20.6 11.9 19.2 9.1 13.2 15 12.7Z';

export const TOOL_CURSOR_ICONS = {
  normal: null,
  place: 'plus',
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
export function toolCursorValue(icon, { dark = false, danger = false } = {}) {
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
  return value;
}

/** Every cursor the editor can switch to, in both themes: the bare arrow,
 *  each tool's badge, both wire shapes, and Delete's danger badge. */
export function allToolCursors() {
  const icons = new Set([...Object.values(TOOL_CURSOR_ICONS), 'wire', 'wire-diagonal']);
  const values = [];
  for (const dark of [false, true]) {
    for (const icon of icons) values.push(toolCursorValue(icon, { dark }));
    values.push(toolCursorValue(TOOL_CURSOR_ICONS.delete, { dark, danger: true }));
  }
  return values;
}
