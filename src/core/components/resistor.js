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
    { kind: 'path', d: 'M 0 0 L 40 0' },
    // Zigzag
    { kind: 'path', d: 'M 32 0 L 38 -20 L 52 20 L 66 -20 L 80 20 L 86 0' },
    // Right wire
    { kind: 'path', d: 'M 120 0 L 160 0' },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: { x: 60, y: 32, anchor: 'middle' },
  defaultValue: '',
});
