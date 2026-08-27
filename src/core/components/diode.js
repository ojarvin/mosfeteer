import { defineSymbol } from './defineSymbol.js';

/**
 * Diode. Anode = terminal a (left, triangle), cathode = terminal b (right, bar).
 * Dummy graphics (replace later).
 */
export const diode = defineSymbol({
  type: 'diode',
  description: 'Diode',
  refPrefix: 'D',
  terminals: [
    { name: 'a', x: 0, y: 0, direction: 'anode' },
    { name: 'b', x: 120, y: 0, direction: 'cathode' },
  ],
  bbox: { x: 0, y: -40, w: 120, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 44 0' },
    { kind: 'path', d: 'M 44 -12 L 44 12 L 62 0 Z' },
    { kind: 'path', d: 'M 66 -16 L 66 16' },
    { kind: 'path', d: 'M 66 0 L 120 0' },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: { x: 60, y: 32, anchor: 'middle' },
  defaultValue: '',
});