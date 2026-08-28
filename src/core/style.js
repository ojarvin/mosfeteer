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
 * (emphasis), 'ground', 'supply'. Filled body shapes (gate bars, arrowheads,
 * power slabs) use the 'polygon' primitive with fill:'foreground'.
 */
export const LINE = {
  stroke: '#111',
  width: 6,
  cap: 'round',
  join: 'round',
};

export const THICK = {
  stroke: '#111',
  width: Math.round(LINE.width * 1.5),
  cap: 'flat',
  join: 'flat',
};

export const SYMBOL = { stroke: '#111', width: 6, cap: 'butt', join: 'miter' };
export const EMPH = { stroke: '#111', width: 9.6, cap: 'butt', join: 'miter' };
export const GROUND = { stroke: '#111', width: 11.6, cap: 'butt', join: 'miter' };
export const SUPPLY = { stroke: '#111', width: 7.2, cap: 'butt', join: 'miter' };

/**
 * Text styles for schematic labels. `INSTANCE_FONT` is for component
 * identifiers (e.g. M1 on a transistor) — bold + italic, larger than plain
 * text. `LABEL_FONT` is for free-standing annotation labels.
 */
export const INSTANCE_FONT = { size: 36, fill: '#111', weight: 'bold', italic: true };
export const LABEL_FONT = { size: 36, fill: '#111' };

const STYLES = { thick: THICK, symbol: SYMBOL, emph: EMPH, ground: GROUND, supply: SUPPLY };

/** SVG stroke attribute string for a graphic; defaults to the LINE style. */
export function strokeAttrs(styleName) {
  const s = STYLES[styleName] || LINE;
  return `stroke="${s.stroke}" stroke-width="${s.width}" stroke-linecap="${s.cap}" stroke-linejoin="${s.join}"`;
}

/** SVG attributes for a label font style ("instance" | "label"). */
export function fontAttrs(kind) {
  const f = kind === 'instance' ? INSTANCE_FONT : kind === 'label' ? LABEL_FONT : null;
  if (!f) return '';
  const parts = [`font-size="${f.size}"`, `fill="${f.fill}"`];
  if (f.weight) parts.push(`font-weight="${f.weight}"`);
  if (f.italic) parts.push(`font-style="italic"`);
  return parts.join(' ');
}
