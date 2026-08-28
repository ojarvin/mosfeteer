import { defineSymbol } from './defineSymbol.js';

/**
 * Diode (Razavi style): open triangle (anode a, left) with a thick cathode bar
 * (cathode b, right).
 */
export const diode = defineSymbol({
  type: 'diode',
  description: 'Diode',
  refPrefix: 'D',
  terminals: [
    { name: 'a', x: 0, y: 0, direction: 'anode', dir: { x: -1, y: 0 } },
    { name: 'b', x: 120, y: 0, direction: 'cathode', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: 0, y: -40, w: 120, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 35 0', style: 'symbol' },
    { kind: 'path', d: 'M 35 -20.25 L 35 20.25 L 77.5 0 Z', style: 'symbol' },
    { kind: 'path', d: 'M 80 -22 L 80 22', style: 'emph' },
    { kind: 'path', d: 'M 80 0 L 120 0', style: 'symbol' },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 80, y: 80 },
  defaultValue: '',
});