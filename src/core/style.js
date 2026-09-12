/**
 * Centralized schematic line styles.
 *
 * LINE  — legacy/default fallback for wiring and component linework. Flat
 *         caps and miter joins keep fallback strokes aligned with the textbook
 *         look. Rendered managed wires use WIRE instead.
 * THICK — heavier linework (~1.5x the default) for selected features of some
 *         symbols (e.g. a MOSFET gate bar, bold power/ground rails).
 *
 * Textbook symbol roles (butt caps / miter joins for the crisp classic
 * look). Symbols select a role via `style`: 'symbol' (normal), 'wire',
 * 'emph' (emphasis), 'ground', or 'supply'. Filled body shapes use polygon
 * fill.
 */
export const LINE = { stroke: '#111', width: 6, cap: 'flat', join: 'miter' };
export const THICK = { stroke: '#111', width: Math.round(LINE.width * 1.5), cap: 'flat', join: 'flat' };
export const SYMBOL = { stroke: '#111', width: 6, cap: 'butt', join: 'miter' };
// Wires overlap their pin's terminal lead at the same coordinate. Round caps
// hide the anti-aliased seam without changing the electrical path.
export const WIRE = { stroke: '#111', width: 6, cap: 'round', join: 'miter' };
export const EMPH = { stroke: '#111', width: 9.6, cap: 'butt', join: 'miter' };
export const GROUND = { stroke: '#111', width: 11.6, cap: 'butt', join: 'miter' };
export const SUPPLY = { stroke: '#111', width: 7.2, cap: 'butt', join: 'miter' };

/** Named semantic colors. Values are intentionally mutable so a theme can
 * update a token and already-loaded drawings immediately pick it up. */
export const COLOR_PALETTE = {
  red: '#d96c75',
  orange: '#e59f71',
  yellow: '#e4c16f',
  green: '#9acb8a',
  teal: '#62b5a7',
  blue: '#6fa8dc',
  indigo: '#8f8bd1',
  purple: '#b08ac6',
  pink: '#d889b5',
  slate: '#9aa7b8',
  gray: '#7a7d85',
};
// Public aliases make the palette useful to callers without coupling them to
// the UI's control names.
export const SEMANTIC_COLORS = COLOR_PALETTE;
export const COLOR_TOKENS = COLOR_PALETTE;
export const STYLE_COLORS = Object.freeze(Object.values(COLOR_PALETTE));

const LEGACY_COLORS = new Map(Object.entries(COLOR_PALETTE).map(([name, value]) => [value, name]));
export function resolveColor(value) {
  if (typeof value !== 'string' || !value) return '#111';
  const token = value.startsWith('$') ? value.slice(1) : value;
  if (Object.prototype.hasOwnProperty.call(COLOR_PALETTE, token)) return COLOR_PALETTE[token];
  const legacyToken = LEGACY_COLORS.get(value.toLowerCase());
  return legacyToken ? COLOR_PALETTE[legacyToken] : value;
}
export function setColorToken(token, value) {
  if (!Object.prototype.hasOwnProperty.call(COLOR_PALETTE, token)) throw new Error(`unknown color token "${token}"`);
  if (typeof value !== 'string' || !value) throw new Error('color token value must be a CSS color');
  COLOR_PALETTE[token] = value;
  return value;
}

export const LEGACY_STYLE_COLORS = STYLE_COLORS;

const STYLES = { thick: THICK, symbol: SYMBOL, wire: WIRE, emph: EMPH, ground: GROUND, supply: SUPPLY };
const escapeSvgAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export function strokeAttrs(styleName) {
  const s = STYLES[styleName] || LINE;
  return `stroke="${escapeSvgAttr(s.stroke)}" stroke-width="${s.width}" stroke-linecap="${s.cap}" stroke-linejoin="${s.join}"`;
}
export function fontAttrs(kind) {
  const f = kind === 'instance' ? INSTANCE_FONT : kind === 'label' ? LABEL_FONT : null;
  if (!f) return '';
  const parts = [`font-size="${f.size}"`, `fill="${escapeSvgAttr(resolveColor(f.fill))}"`];
  if (f.weight) parts.push(`font-weight="${f.weight}"`);
  if (f.italic) parts.push(`font-style="italic"`);
  return parts.join(' ');
}
export function styleAttrs(style = {}, base = 'symbol') {
  let attrs = strokeAttrs(base).replace(`stroke="${escapeSvgAttr('#111')}"`, `stroke="${escapeSvgAttr(resolveColor(style.color || '#111'))}"`);
  if (style.width === 'thin' || style.width === 'thick') {
    attrs = attrs.replace(/stroke-width="[^"]+"/, `stroke-width="${style.width === 'thin' ? 3 : 9}"`);
  }
  const dash = style.lineStyle && style.lineStyle !== 'solid'
    ? { dashed: '12 12', 'dash-dot': '14 10 3 10', dotted: '2 10' }[style.lineStyle]
    : null;
  return dash ? `${attrs} stroke-dasharray="${dash}"` : attrs;
}

/** Text styles for schematic labels. */
export const INSTANCE_FONT = { size: 38, fill: '#111', weight: 'bold', italic: true };
export const LABEL_FONT = { size: 38, fill: '#111', weight: 'bold', italic: true };
