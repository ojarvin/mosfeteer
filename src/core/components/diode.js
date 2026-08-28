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
    { name: 'b', x: 160, y: 0, direction: 'cathode' },
  ],
  bbox: { x: 0, y: -40, w: 160, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 60 0' },
    { kind: 'path', d: 'M 60 -25 L 60 25 L 100 0 Z' },
    { kind: 'path', d: 'M 100 -25 L 100 25', style: 'thick' },
    { kind: 'path', d: 'M 100 0 L 160 0' },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 80, y: 80 },
  defaultValue: '',
});
