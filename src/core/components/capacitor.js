import { defineSymbol } from './defineSymbol.js';

/**
 * Capacitor (Razavi style): two thick parallel plates between a (left) and
 * b (right). Four squares wide (160) with the plates centered on the midpoint.
 */
export const capacitor = defineSymbol({
  type: 'capacitor',
  description: 'Capacitor',
  refPrefix: 'C',
  terminals: [
    { name: 'a', x: -80, y: 0, direction: 'passive', dir: { x: -1, y: 0 } },
    { name: 'b', x: 80, y: 0, direction: 'passive', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -80, y: -40, w: 160, h: 80 },
  graphics: [
    { kind: 'path', d: 'M -80 0 L -12.94 0', style: 'symbol' },
    { kind: 'path', d: 'M -12.94 -32.2 L -12.94 32.2', style: 'emph' },
    { kind: 'path', d: 'M 12.94 -32.2 L 12.94 32.2', style: 'emph' },
    { kind: 'path', d: 'M 12.94 0 L 80 0', style: 'symbol' },
  ],
  textPos: { x: 0, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 0, y: 80 },
  defaultValue: '',
});
