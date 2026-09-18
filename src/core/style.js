/**
 * Centralized schematic line styles.
 *
 * Symbols and wires select a stroke role via `style`. Roles differ only in
 * width, cap, and join; filled body shapes use polygon fill instead.
 *
 *   line       legacy/default fallback (flat caps, miter joins)
 *   thick      heavier legacy linework (~1.5x default)
 *   symbol     normal textbook linework
 *   wire       projecting square caps, so the half-width extension at a
 *              terminal overlaps the pin lead inside the shared ink path and a
 *              wire meeting a lead at a right angle fills the corner square
 *   annotation visual lines/arrows and block-diagram connectors (round ends)
 *   emph       emphasis (MOSFET gate bar, BJT base bar)
 *   ground     ground bars
 *   supply     power slabs
 */
const STROKES = {
  line: { width: 6, cap: 'flat', join: 'miter' },
  thick: { width: 9, cap: 'flat', join: 'flat' },
  symbol: { width: 6, cap: 'butt', join: 'miter' },
  wire: { width: 6, cap: 'square', join: 'miter' },
  annotation: { width: 6, cap: 'round', join: 'miter' },
  emph: { width: 9.6, cap: 'butt', join: 'miter' },
  ground: { width: 11.6, cap: 'butt', join: 'miter' },
  supply: { width: 7.2, cap: 'butt', join: 'miter' },
};

const DEFAULT_INK = '#111';

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

const LEGACY_COLORS = new Map(Object.entries(COLOR_PALETTE).map(([name, value]) => [value, name]));
export function resolveColor(value) {
  if (typeof value !== 'string' || !value) return DEFAULT_INK;
  const token = value.startsWith('$') ? value.slice(1) : value;
  if (Object.prototype.hasOwnProperty.call(COLOR_PALETTE, token)) return COLOR_PALETTE[token];
  const legacyToken = LEGACY_COLORS.get(value.toLowerCase());
  return legacyToken ? COLOR_PALETTE[legacyToken] : value;
}

/** Editor rendering: default ink follows the page theme through CSS `color`.
 * Standalone exports keep literal colors and never use this. */
export function themeInkSvg(svg) {
  return String(svg).replace(/\b(stroke|fill)="(?:#111|#111111|#292929|#333)"/gi, '$1="currentColor"');
}

export function setColorToken(token, value) {
  if (!Object.prototype.hasOwnProperty.call(COLOR_PALETTE, token)) throw new Error(`unknown color token "${token}"`);
  if (typeof value !== 'string' || !value) throw new Error('color token value must be a CSS color');
  COLOR_PALETTE[token] = value;
  return value;
}

/** Escape a value for use in SVG text or a quoted attribute. */
export const escapeSvg = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function strokeParts(styleName, miterLimit, color = DEFAULT_INK, width) {
  const s = STROKES[styleName] || STROKES.line;
  const limit = Number.isFinite(miterLimit) && miterLimit > 0 ? ` stroke-miterlimit="${miterLimit}"` : '';
  return `stroke="${escapeSvg(color)}" stroke-width="${width ?? s.width}" stroke-linecap="${s.cap}" stroke-linejoin="${s.join}"${limit}`;
}

export function strokeAttrs(styleName, miterLimit) {
  return strokeParts(styleName, miterLimit);
}

/** Text styles for schematic labels, keyed by `fontAttrs` kind. */
const FONTS = {
  instance: { size: 38, fill: DEFAULT_INK, weight: 'bold', italic: true },
  label: { size: 38, fill: DEFAULT_INK, weight: 'bold', italic: true },
};

export function fontAttrs(kind) {
  const f = FONTS[kind];
  if (!f) return '';
  const parts = [`font-size="${f.size}"`, `fill="${escapeSvg(resolveColor(f.fill))}"`];
  if (f.weight) parts.push(`font-weight="${f.weight}"`);
  if (f.italic) parts.push(`font-style="italic"`);
  return parts.join(' ');
}

export function styleAttrs(style = {}, base = 'symbol', miterLimit) {
  const width = style.width === 'thin' ? 3 : style.width === 'thick' ? 9 : undefined;
  const attrs = strokeParts(base, miterLimit, resolveColor(style.color || DEFAULT_INK), width);
  const dash = style.lineStyle && style.lineStyle !== 'solid'
    ? { dashed: '12 12', 'dash-dot': '14 10 3 10', dotted: '2 10' }[style.lineStyle]
    : null;
  return dash ? `${attrs} stroke-dasharray="${dash}"` : attrs;
}
