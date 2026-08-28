import { defineSymbol } from './defineSymbol.js';

/**
 * Capacitor (Razavi style): two thick parallel plates between a (left) and
 * b (right).
 */
export const capacitor = defineSymbol({
  type: 'capacitor',
  description: 'Capacitor',
  refPrefix: 'C',
  terminals: [
    { name: 'a', x: 0, y: 0, direction: 'passive', dir: { x: -1, y: 0 } },
    { name: 'b', x: 120, y: 0, direction: 'passive', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: 0, y: -40, w: 120, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 47.06 0', style: 'symbol' },
    { kind: 'path', d: 'M 47.06 -32.2 L 47.06 32.2', style: 'emph' },
    { kind: 'path', d: 'M 72.94 -32.2 L 72.94 32.2', style: 'emph' },
    { kind: 'path', d: 'M 72.94 0 L 120 0', style: 'symbol' },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 80, y: 80 },
  defaultValue: '',
});