import { defineSymbol } from './defineSymbol.js';

/**
 * Resistor. Two terminals on the left/right edges.
 * Body: leads + 4-segment zigzag. Dummy graphics (replace later).
 */
export const resistor = defineSymbol({
  type: 'resistor',
  description: 'Resistor',
  refPrefix: 'R',
  terminals: [
    { name: 'a', x: 0, y: 0 },
    { name: 'b', x: 160, y: 0 },
  ],
  bbox: { x: 0, y: -40, w: 160, h: 80 },
  graphics: [
    // Left wire
    { kind: 'path', d: 'M 0 0 L 50 0' },
    // Zigzag
    { kind: 'path', d: 'M 50 0 L 55 -20 L 65 20 L 75 -20 L 85 20 L 95 -20 L 105 20 L 110 0' },
    // Right wire
    { kind: 'path', d: 'M 110 0 L 160 0' },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 80, y: 80 },
  defaultValue: '',
});
