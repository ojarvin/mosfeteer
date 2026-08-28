import { defineSymbol } from './defineSymbol.js';

/**
 * PNP bipolar transistor. Same footprint as NPN; emitter arrow points inward
 * (toward the base). Dummy graphics (replace later).
 */
export const pnp = defineSymbol({
  type: 'pnp',
  description: 'PNP Transistor',
  refPrefix: 'Q',
  terminals: [
    { name: 'b', x: 0, y: 0, direction: 'base', dir: { x: -1, y: 0 } },
    { name: 'c', x: 120, y: -40, direction: 'collector', dir: { x: 0, y: -1 } },
    { name: 'e', x: 120, y: 40, direction: 'emitter', dir: { x: 0, y: 1 } },
  ],
  bbox: { x: 0, y: -40, w: 120, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 52 0' },
    { kind: 'path', d: 'M 52 -40 L 52 40' },
    { kind: 'path', d: 'M 52 -40 L 120 -40' },
    { kind: 'path', d: 'M 52 40 L 120 40' },
    { kind: 'path', d: 'M 113 33 L 105 40 L 113 47 Z' },
  ],
  textPos: { x: 94, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 40, y: 80 },
  defaultValue: '',
});