import { defineSymbol } from './defineSymbol.js';

/**
 * Radius of a solder dot (junction annotation). Shared by the `solder` symbol
 * and the router's automatic junction marking in render.js, so a junction
 * marked by the auto-routing always renders at the same size as an explicit
 * solder component.
 */
export const SOLDER_DOT_RADIUS = 12;

/**
 * Solder dot — a plain black dot marking a connection at a wire crossing.
 * Pure annotation: no terminals, no labels. Exempt from the overlap /
 * wire-through-bbox checks in `evaluate()`.
 */
export const solder = defineSymbol({
  type: 'solder',
  description: 'Solder dot (junction annotation)',
  refPrefix: 'J',
  terminals: [],
  // The bbox is exactly the drawn dot: solder is placed directly on a grid
  // point (the junction) and selected there, so it must not shadow a whole
  // grid cell or count as a routing obstacle.
  bbox: { x: -SOLDER_DOT_RADIUS, y: -SOLDER_DOT_RADIUS, w: 2 * SOLDER_DOT_RADIUS, h: 2 * SOLDER_DOT_RADIUS },
  graphics: [{ kind: 'dot', cx: 0, cy: 0, r: SOLDER_DOT_RADIUS }],
  textPos: null,
  refPos: null,
  defaultValue: '',
});
