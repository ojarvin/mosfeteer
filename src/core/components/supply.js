import { defineSymbol } from './defineSymbol.js';

/**
 * Supply rail symbol (VCC/VDD/+5V/...). Single terminal on the bottom edge;
 * body sits above it. Name is stored as the component value. Dummy graphics.
 */
export const supply = defineSymbol({
  type: 'supply',
  description: 'Supply (VCC/VDD/+)',
  refPrefix: '',
  terminals: [{ name: 'p', x: 0, y: 0, direction: 'supply' }],
  bbox: { x: -40, y: -40, w: 80, h: 40 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 0 -40' },
    { kind: 'path', d: 'M -30 -40 L 30 -40', style: 'thick' },
  ],
  textPos: { x: 0, y: -30, anchor: 'middle' },
  refPos: null,
  defaultValue: '',
});
