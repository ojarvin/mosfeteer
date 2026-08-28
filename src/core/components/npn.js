import { defineSymbol } from './defineSymbol.js';

/**
 * NPN bipolar transistor (Razavi style). b = base (left), c = collector
 * (top-right), e = emitter (bottom-right). Emitter arrow is a filled triangle
 * pointing OUT of the base (conventional +current C->E).
 */
export const npn = defineSymbol({
  type: 'npn',
  description: 'NPN Transistor',
  refPrefix: 'Q',
  terminals: [
    { name: 'b', x: 0, y: 0, direction: 'base', dir: { x: -1, y: 0 } },
    { name: 'c', x: 160, y: -120, direction: 'collector', dir: { x: 0, y: -1 } },
    { name: 'e', x: 160, y: 120, direction: 'emitter', dir: { x: 0, y: 1 } },
  ],
  bbox: { x: 0, y: -120, w: 160, h: 240 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 92.52 0', style: 'symbol' },
    { kind: 'path', d: 'M 92.52 -53.38 L 92.52 53.32', style: 'emph' },
    { kind: 'path', d: 'M 92.52 -25.61 L 160 -53.52 L 160 -120', style: 'symbol' },
    { kind: 'path', d: 'M 92.52 25.61 L 130.8 41.43', style: 'symbol' },
    { kind: 'path', d: 'M 156.26 51.96 L 160 53.51 L 160 120', style: 'symbol' },
    { kind: 'polygon', points: [{ x: 133.46, y: 27.17 }, { x: 120.19, y: 53.51 }, { x: 160, y: 53.51 }], fill: 'foreground' },
  ],
  textPos: { x: 94, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 80, y: 160 },
  defaultValue: '',
});