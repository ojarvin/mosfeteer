import { defineSymbol } from './defineSymbol.js';

/**
 * PNP bipolar transistor (Razavi style). b = base (left), c = collector
 * (bottom-right), e = emitter (top-right). Emitter arrow is a filled triangle
 * pointing INTO the base.
 */
export const pnp = defineSymbol({
  type: 'pnp',
  description: 'PNP Transistor',
  refPrefix: 'Q',
  terminals: [
    { name: 'b', x: 0, y: 0, direction: 'base', dir: { x: -1, y: 0 } },
    { name: 'c', x: 160, y: 120, direction: 'collector', dir: { x: 0, y: 1 } },
    { name: 'e', x: 160, y: -120, direction: 'emitter', dir: { x: 0, y: -1 } },
  ],
  bbox: { x: 0, y: -120, w: 160, h: 240 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 92.52 0', style: 'symbol' },
    { kind: 'path', d: 'M 92.52 -53.33 L 92.52 53.37', style: 'emph' },
    { kind: 'path', d: 'M 125.7 -38.78 L 160 -53.52 L 160 -120', style: 'symbol' },
    { kind: 'path', d: 'M 92.52 25.61 L 160 53.51 L 160 120', style: 'symbol' },
    { kind: 'polygon', points: [{ x: 119.06, y: -51.95 }, { x: 132.34, y: -25.61 }, { x: 92.52, y: -25.61 }], fill: 'foreground' },
  ],
  textPos: { x: 94, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label one square right of the body edge — like the MOS devices.
  labelOffset: { x: 200, y: 0 },
  defaultValue: '',
});