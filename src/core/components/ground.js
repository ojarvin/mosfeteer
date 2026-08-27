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
  bbox: { x: -40, y: 0, w: 80, h: 40 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 0 12' },
    { kind: 'path', d: 'M -30 12 L 30 12' },
    { kind: 'path', d: 'M -20 24 L 20 24' },
    { kind: 'path', d: 'M -10 36 L 10 36' },
  ],
  textPos: null,
  refPos: null,
  defaultValue: '',
});