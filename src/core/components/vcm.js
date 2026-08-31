import { defineSymbol } from './defineSymbol.js';

/**
 * Common-mode / common-potential marker: a light, open triangle hanging below
 * its attachment point. Unlike ground, it has no heavy rail bars.
 */
export const vcm = defineSymbol({
  type: 'vcm',
  description: 'Common potential (VCM)',
  refPrefix: '',
  terminals: [{ name: 'vcm', x: 0, y: 0, direction: 'up', dir: { x: 0, y: -1 } }],
  bbox: { x: -40, y: 0, w: 80, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 0 24', style: 'symbol' },
    { kind: 'path', d: 'M -28 24 L 28 24 L 0 56 Z', style: 'symbol', fill: 'none' },
  ],
  textPos: null,
  refPos: null,
  defaultValue: '',
});
