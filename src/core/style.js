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
 *   annotation visual lines/arrows (round ends)
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
  red: '#df4d59',
  orange: '#e98f54',
  yellow: '#e8bb52',
  green: '#83d269',
  teal: '#3dc1aa',
  blue: '#509ce1',
  indigo: '#726bd7',
  purple: '#a969ce',
  pink: '#dd6baa',
  cyan: '#2cb6de',
  lime: '#b2d731',
  magenta: '#c654d6',
  emerald: '#32c174',
  crimson: '#cd2a46',
  cobalt: '#346dd8',
  brown: '#bd7134',
  slate: '#9aa7b8',
  gray: '#7a7d85',
};

/** Earlier values of the palette tokens. A document stores a picked color as
 * its literal value when it predates tokens, so the old values still resolve to
 * their token and pick up its current value. */
const PREVIOUS_PALETTE_VALUES = {
  '#d96c75': 'red',
  '#e59f71': 'orange',
  '#e4c16f': 'yellow',
  '#9acb8a': 'green',
  '#62b5a7': 'teal',
  '#6fa8dc': 'blue',
  '#8f8bd1': 'indigo',
  '#b08ac6': 'purple',
  '#d889b5': 'pink',
  '#4cb8d8': 'cyan',
  '#b3cf52': 'lime',
  '#c475cf': 'magenta',
  '#4fbd82': 'emerald',
  '#c9485e': 'crimson',
  '#5580d0': 'cobalt',
  '#b98052': 'brown',
};

const VALUE_TOKENS = new Map([
  ...Object.entries(PREVIOUS_PALETTE_VALUES),
  ...Object.entries(COLOR_PALETTE).map(([name, value]) => [value, name]),
]);

/** The palette token a stored color names -- a token, `$token`, or a current
 * or earlier palette value -- or null for any other color. */
export function colorToken(value) {
  if (typeof value !== 'string' || !value) return null;
  const token = value.startsWith('$') ? value.slice(1) : value;
  if (Object.prototype.hasOwnProperty.call(COLOR_PALETTE, token)) return token;
  return VALUE_TOKENS.get(value.toLowerCase()) || null;
}

export function resolveColor(value) {
  if (typeof value !== 'string' || !value) return DEFAULT_INK;
  const token = colorToken(value);
  return token ? COLOR_PALETTE[token] : value;
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

/** Resolve the painted stroke width for a style role, including explicit
 * thin/thick overrides. Consumers that position filled geometry next to a
 * stroked body should use this instead of duplicating the role table. */
export function strokeWidth(style = {}, base = 'line') {
  if (style.width === 'thin') return 3;
  if (style.width === 'thick') return 9;
  return STROKES[base]?.width ?? STROKES.line.width;
}

/** Label text size (world units) by label `style.width`. A capital with a
 * subscript (V_{IN}) sits comfortably in the two-cell minimum label box. */
export const LABEL_FONT_SIZES = Object.freeze({ thin: 40, normal: 46, thick: 52 });
export const labelFontSize = (width) => LABEL_FONT_SIZES[width] || LABEL_FONT_SIZES.normal;

/** Text styles for schematic labels, keyed by `fontAttrs` kind. */
const FONTS = {
  instance: { size: LABEL_FONT_SIZES.normal, fill: DEFAULT_INK, weight: 'bold', italic: true },
  label: { size: LABEL_FONT_SIZES.normal, fill: DEFAULT_INK, weight: 'bold', italic: true },
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
