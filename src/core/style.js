/**
 * Centralized schematic line styles.
 *
 * LINE  — general wiring and component linework. The default; use unless a
 *         symbol part explicitly says otherwise. Rounded caps/joins keep
 *         routing intersections and corners from looking jagged.
 * THICK — heavier linework (~1.75x the default) for selected features of some
 *         symbols (e.g. a MOSFET gate bar, bold power/ground rails).
 *
 * A symbol graphic selects the thick style with `style: 'thick'`; anything
 * else uses LINE.
 */
export const LINE = {
  stroke: '#111',
  width: 6,
  cap: 'round',
  join: 'round',
};

export const THICK = {
  stroke: '#111',
  width: Math.round(LINE.width * 1.4),
  cap: 'flat',
  join: 'round',
};

const STYLES = { thick: THICK };

/** SVG stroke attribute string for a graphic; defaults to the LINE style. */
export function strokeAttrs(styleName) {
  const s = STYLES[styleName] || LINE;
  return `stroke="${s.stroke}" stroke-width="${s.width}" stroke-linecap="${s.cap}" stroke-linejoin="${s.join}"`;
}
