import { defineSymbol } from './defineSymbol.js';

/**
 * PNP bipolar transistor (Razavi style). The local x origin is the collector /
 * emitter channel; b = base (left), c = collector (bottom), e = emitter (top).
 * Emitter arrow is a filled triangle pointing INTO the base.
 */
export const pnp = defineSymbol({
  type: 'pnp',
  description: 'PNP Transistor',
  refPrefix: 'Q',
  terminals: [
    { name: 'b', x: -160, y: 0, direction: 'base', dir: { x: -1, y: 0 } },
    { name: 'c', x: 0, y: 120, direction: 'collector', dir: { x: 0, y: 1 } },
    { name: 'e', x: 0, y: -120, direction: 'emitter', dir: { x: 0, y: -1 } },
  ],
  bbox: { x: -160, y: -120, w: 160, h: 240 },
  graphics: [
    { kind: 'path', d: 'M -160 0 L -67.48 0', style: 'symbol' },
    { kind: 'path', d: 'M -67.48 -53.33 L -67.48 53.37', style: 'emph' },
    { kind: 'path', d: 'M -34.3 -38.78 L 0 -53.52 L 0 -120', style: 'symbol' },
    { kind: 'path', d: 'M -67.48 25.61 L 0 53.51 L 0 120', style: 'symbol' },
    { kind: 'polygon', points: [{ x: -40.94, y: -51.95 }, { x: -27.66, y: -25.61 }, { x: -67.48, y: -25.61 }], fill: 'foreground' },
  ],
  textPos: { x: -66, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label one square right of the body edge — like the MOS devices.
  labelOffset: { x: 40, y: 0 },
  defaultValue: '',
});
