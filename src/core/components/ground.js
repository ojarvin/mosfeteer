import { defineSymbol } from './defineSymbol.js';

/**
 * Ground symbol. Single terminal on the top edge; three tiered bars below.
 * Dummy graphics (replace later).
 */
export const ground = defineSymbol({
  type: 'ground',
  description: 'Ground',
  refPrefix: '',
  terminals: [{ name: 'gnd', x: 0, y: 0, direction: 'ground' }],
  bbox: { x: -40, y: 0, w: 80, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 0 40' },
    { kind: 'path', d: 'M -30 40 L 30 40', style: 'thick' },
    { kind: 'path', d: 'M -20 60 L 20 60', style: 'thick' },
    { kind: 'path', d: 'M -10 80 L 10 80', style: 'thick' },
  ],
  textPos: null,
  refPos: null,
  defaultValue: '',
});
