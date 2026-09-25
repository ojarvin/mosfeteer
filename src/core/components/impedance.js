import { defineSymbol } from './defineSymbol.js';

/**
 * Generic impedance: the textbook box that stands for any two-terminal
 * network (`Z_1`) where the drawing does not commit to R, L, or C. It shares
 * the resistor's pins and footprint so the two swap in place.
 */
export const impedance = defineSymbol({
  type: 'impedance',
  description: 'Impedance',
  refPrefix: 'Z',
  terminals: [
    { name: 'a', x: -80, y: 0, direction: 'passive', dir: { x: -1, y: 0 } },
    { name: 'b', x: 80, y: 0, direction: 'passive', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -80, y: -40, w: 160, h: 80 },
  graphics: [
    { kind: 'path', d: 'M -40 -20 L 40 -20 L 40 20 L -40 20 Z', style: 'symbol' },
    { kind: 'path', d: 'M -80 0 L -40 0', style: 'symbol' },
    { kind: 'path', d: 'M 40 0 L 80 0', style: 'symbol' },
  ],
  textPos: { x: 0, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 0, y: -80 },
  defaultValue: '',
});
