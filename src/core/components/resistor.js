import { defineSymbol } from './defineSymbol.js';

/**
 * Resistor (textbook style): a centered horizontal zigzag between a (left) and
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
    { kind: 'path', d: 'M -80 0 L -30 0 L -25 20 L -15 -20 L -5 20 L 5 -20 L 15 20 L 25 -20 L 30 0 L 80 0', style: 'symbol', miterLimit: 5 },
  ],
  textPos: { x: 0, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label sits below the body (mirror the symbol so the label is above
  // when there is open space above).
  labelOffset: { x: 0, y: 80 },
  defaultValue: '',
});
