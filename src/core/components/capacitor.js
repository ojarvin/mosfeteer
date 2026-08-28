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
    { name: 'b', x: 160, y: 0 },
  ],
  bbox: { x: 0, y: -40, w: 160, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 70 0' },
    { kind: 'path', d: 'M 70 -30 L 70 30', style: 'thick' },
    { kind: 'path', d: 'M 90 -30 L 90 30', style: 'thick' },
    { kind: 'path', d: 'M 90 0 L 160 0' },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 80, y: 80 },
  defaultValue: '',
});
