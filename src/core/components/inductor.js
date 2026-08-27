import { defineSymbol } from './defineSymbol.js';

/**
 * Inductor. Four coil arcs. Dummy graphics (replace later).
 */
export const inductor = defineSymbol({
  type: 'inductor',
  description: 'Inductor',
  refPrefix: 'L',
  terminals: [
    { name: 'a', x: 0, y: 0 },
    { name: 'b', x: 120, y: 0 },
  ],
  bbox: { x: 0, y: -40, w: 120, h: 80 },
  graphics: [
    {
      kind: 'path',
      d: 'M 0 0 L 30 0 A 9 9 0 0 0 48 0 A 9 9 0 0 0 66 0 A 9 9 0 0 0 84 0 A 9 9 0 0 0 102 0 L 120 0',
    },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: { x: 60, y: 32, anchor: 'middle' },
  defaultValue: '',
});