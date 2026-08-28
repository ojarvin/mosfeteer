import { defineSymbol } from './defineSymbol.js';

/**
 * Supply rail symbol (VDD/VCC/+5V...). Single terminal on the bottom edge; a
 * filled horizontal slab above it (Razavi style). Name is stored as the
 * component value and rendered as a free label where required.
 */
export const supply = defineSymbol({
  type: 'supply',
  description: 'Supply (VCC/VDD/+)',
  refPrefix: '',
  terminals: [{ name: 'p', x: 0, y: 0, direction: 'supply' }],
  bbox: { x: -40, y: -80, w: 80, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 0 -40', style: 'symbol' },
    { kind: 'polygon', points: [{ x: -40, y: -43.52 }, { x: 40, y: -43.52 }, { x: 40, y: -30.56 }, { x: -40, y: -30.56 }], fill: 'foreground' },
  ],
  textPos: { x: 0, y: -30, anchor: 'middle' },
  refPos: null,
  defaultValue: '',
});