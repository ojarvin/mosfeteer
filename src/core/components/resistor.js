import { defineSymbol } from './defineSymbol.js';

/**
 * Resistor (Razavi style): a horizontal five-tooth zigzag between a (left) and
 * b (right). The component origin is at the electrical midpoint so transforms
 * and placement keep the symbol centered.
 */
export const resistor = defineSymbol({
  type: 'resistor',
  description: 'Resistor',
  refPrefix: 'R',
  terminals: [
    { name: 'a', x: -80, y: 0, direction: 'passive', dir: { x: -1, y: 0 } },
    { name: 'b', x: 80, y: 0, direction: 'passive', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -80, y: -40, w: 160, h: 80 },
  graphics: [
    { kind: 'path', d: 'M -80 0 L -34.88 0 L -25.58 21.49 L -16.28 -18.42 L -4.65 21.49 L 6.98 -19.95 L 18.6 21.49 L 30.23 -18.42 L 34.88 0 L 80 0', style: 'symbol' },
  ],
  textPos: { x: 0, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label sits below the body (mirror the symbol so the label is above
  // when there is open space above).
  labelOffset: { x: 0, y: 80 },
  defaultValue: '',
});
