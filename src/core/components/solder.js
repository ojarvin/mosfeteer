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
  bbox: { x: -40, y: -40, w: 80, h: 80 },
  graphics: [{ kind: 'dot', cx: 0, cy: 0, r: SOLDER_DOT_RADIUS }],
  textPos: null,
  refPos: null,
  defaultValue: '',
});
