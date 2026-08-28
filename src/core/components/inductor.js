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
    { name: 'b', x: 160, y: 0 },
  ],
  bbox: { x: 0, y: -40, w: 160, h: 80 },
  graphics: [
    {
      kind: 'path',
      d: 'M 0 0 L 40 0 A 5 10 0 0 0 60 0 A 5 10 0 0 0 80 0 A 5 10 0 0 0 100 0 A 5 10 0 0 0 120 0 L 160 0',
    },
  ],
  textPos: { x: 80, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 80, y: 80 },
  defaultValue: '',
});
