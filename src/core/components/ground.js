import { defineSymbol } from './defineSymbol.js';

/**
 * Ground symbol (Razavi style): vertical stub down to three tiered bars of
 * decreasing width, drawn with the heavy "ground" stroke.
 */
export const ground = defineSymbol({
  type: 'ground',
  description: 'Ground',
  refPrefix: '',
  terminals: [{ name: 'gnd', x: 0, y: 0, direction: 'ground' }],
  bbox: { x: -40, y: 0, w: 80, h: 120 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 0 40', style: 'symbol' },
    { kind: 'path', d: 'M -25.58 40 L 25.58 40', style: 'ground' },
    { kind: 'path', d: 'M -16.28 63.26 L 16.28 63.26', style: 'ground' },
    { kind: 'path', d: 'M -9.3 84.19 L 9.3 84.19', style: 'ground' },
  ],
  textPos: null,
  refPos: null,
  defaultValue: '',
});