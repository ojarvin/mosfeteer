import { defineSymbol } from './defineSymbol.js';

/**
 * Capacitor. Two parallel plates. Dummy graphics (replace later).
 */
export const capacitor = defineSymbol({
  type: 'capacitor',
  description: 'Capacitor',
  refPrefix: 'C',
  terminals: [
    { name: 'a', x: 0, y: 0 },
    { name: 'b', x: 120, y: 0 },
  ],
  bbox: { x: 0, y: -40, w: 120, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 48 0' },
    { kind: 'path', d: 'M 48 -14 L 48 14' },
    { kind: 'path', d: 'M 72 -14 L 72 14' },
    { kind: 'path', d: 'M 72 0 L 120 0' },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 60, y: 80 },
  defaultValue: '',
});