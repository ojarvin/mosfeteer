import { defineSymbol } from './defineSymbol.js';

/**
 * Solder dot — a plain black dot placed manually to mark a connection at a
 * wire crossing. Pure annotation: no terminals, no labels. Exempt from the
 * overlap / wire-through-bbox checks in `evaluate()`.
 */
export const solder = defineSymbol({
  type: 'solder',
  description: 'Solder dot (junction annotation)',
  refPrefix: 'J',
  terminals: [],
  bbox: { x: -40, y: -40, w: 80, h: 80 },
  graphics: [{ kind: 'dot', cx: 0, cy: 0, r: 4 }],
  textPos: null,
  refPos: null,
  defaultValue: '',
});