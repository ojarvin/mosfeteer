/**
 * Centralized schematic line styles.
 *
 * LINE  — general wiring and component linework. The default; use unless a
 *         symbol part explicitly says otherwise. Rounded caps/joins keep
 *         routing intersections and corners from looking jagged.
 * THICK — heavier linework (~1.5x the default) for selected features of some
 *         symbols (e.g. a MOSFET gate bar, bold power/ground rails).
 *
 * Razavi-style symbol roles (butt caps / miter joins for the crisp textbook
 * look). Symbols select a role via `style`: 'symbol' (normal), 'emph'
 * (emphasis), 'ground', 'supply'. Filled body shapes use polygon fill.
 */
export const LINE = { stroke: '#111', width: 6, cap: 'round', join: 'round' };
export const THICK = { stroke: '#111', width: Math.round(LINE.width * 1.5), cap: 'flat', join: 'flat' };
export const SYMBOL = { stroke: '#111', width: 6, cap: 'butt', join: 'miter' };
export const EMPH = { stroke: '#111', width: 9.6, cap: 'butt', join: 'miter' };
export const GROUND = { stroke: '#111', width: 11.6, cap: 'butt', join: 'miter' };
export const SUPPLY = { stroke: '#111', width: 7.2, cap: 'butt', join: 'miter' };

export const STYLE_COLORS = Object.freeze([
  '#d96c75', '#e59f71', '#e4c16f', '#9acb8a', '#62b5a7',
  '#6fa8dc', '#8f8bd1', '#b08ac6', '#d889b5', '#9aa7b8',
]);
export const LINE_STYLES = Object.freeze(['solid', 'dashed', 'dash-dot', 'dotted']);

const STYLES = { thick: THICK, symbol: SYMBOL, emph: EMPH, ground: GROUND, supply: SUPPLY };
export function strokeAttrs(styleName) {
  const s = STYLES[styleName] || LINE;
  return `stroke="${s.stroke}" stroke-width="${s.width}" stroke-linecap="${s.cap}" stroke-linejoin="${s.join}"`;
}
export function fontAttrs(kind) {
  const f = kind === 'instance' ? INSTANCE_FONT : kind === 'label' ? LABEL_FONT : null;
  if (!f) return '';
  const parts = [`font-size="${f.size}"`, `fill="${f.fill}"`];
  if (f.weight) parts.push(`font-weight="${f.weight}"`);
  if (f.italic) parts.push(`font-style="italic"`);
  return parts.join(' ');
}
export function styleAttrs(style = {}, base = 'symbol') {
  let attrs = strokeAttrs(base).replace('stroke="#111"', `stroke="${style.color || '#111'}"`);
  if (style.width === 'thin' || style.width === 'thick') {
    attrs = attrs.replace(/stroke-width="[^"]+"/, `stroke-width="${style.width === 'thin' ? 3 : 9}"`);
  }
  const dash = style.lineStyle && style.lineStyle !== 'solid'
    ? { dashed: '12 8', 'dash-dot': '14 7 3 7', dotted: '2 8' }[style.lineStyle]
    : null;
  return dash ? `${attrs} stroke-dasharray="${dash}"` : attrs;
}

/** Text styles for schematic labels. */
export const INSTANCE_FONT = { size: 38, fill: '#111', weight: 'bold', italic: true };
export const LABEL_FONT = { size: 38, fill: '#111', weight: 'bold', italic: true };
