import { defineSymbol } from './defineSymbol.js';

/**
 * Resistor (Razavi style): a horizontal five-tooth zigzag between a (left) and
 * b (right). Keeps the classic box symbol's a/b terminals on the 40-grid.
 */
export const resistor = defineSymbol({
  type: 'resistor',
  description: 'Resistor',
  refPrefix: 'R',
  terminals: [
    { name: 'a', x: 0, y: 0, direction: 'passive', dir: { x: -1, y: 0 } },
    { name: 'b', x: 160, y: 0, direction: 'passive', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: 0, y: -40, w: 160, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 45.12 0 L 54.42 21.49 L 63.72 -18.42 L 75.35 21.49 L 86.98 -19.95 L 98.6 21.49 L 110.23 -18.42 L 114.88 0 L 160 0', style: 'symbol' },
  ],
  textPos: { x: 80, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label sits below the body (mirror the symbol so the label is above
  // when there is open space above).
  labelOffset: { x: 80, y: 80 },
  defaultValue: '',
});
