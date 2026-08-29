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
    { name: 'a', x: -80, y: 0, direction: 'anode', dir: { x: -1, y: 0 } },
    { name: 'b', x: 80, y: 0, direction: 'cathode', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -80, y: -40, w: 160, h: 80 },
  graphics: [
    { kind: 'path', d: 'M -80 0 L -25 0', style: 'symbol' },
    { kind: 'path', d: 'M -25 -20.25 L -25 20.25 L 17.5 0 Z', style: 'symbol' },
    { kind: 'path', d: 'M 20 -22 L 20 22', style: 'emph' },
    { kind: 'path', d: 'M 20 0 L 80 0', style: 'symbol' },
  ],
  textPos: { x: 0, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 0, y: 80 },
  defaultValue: '',
});
