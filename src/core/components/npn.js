import { defineSymbol } from './defineSymbol.js';

/**
 * NPN bipolar transistor (textbook style). The local x origin is the collector /
 * emitter channel; b = base (left), c = collector (top), e = emitter (bottom).
 * Emitter arrow is a filled triangle pointing OUT of the base (conventional
 * +current C->E).
 */
export const npn = defineSymbol({
  type: 'npn',
  description: 'NPN Transistor',
  refPrefix: 'Q',
  terminals: [
    { name: 'b', x: -160, y: 0, direction: 'base', dir: { x: -1, y: 0 } },
    { name: 'c', x: 0, y: -120, direction: 'collector', dir: { x: 0, y: -1 } },
    { name: 'e', x: 0, y: 120, direction: 'emitter', dir: { x: 0, y: 1 } },
  ],
  bbox: { x: -160, y: -120, w: 160, h: 240 },
  graphics: [
    { kind: 'path', d: 'M -160 0 L -67.48 0', style: 'symbol' },
    { kind: 'path', d: 'M -67.48 -53.38 L -67.48 53.32', style: 'emph' },
    { kind: 'path', d: 'M -67.48 -25.61 L 0 -53.52 L 0 -120', style: 'symbol' },
    { kind: 'path', d: 'M -67.48 25.61 L -29.2 41.43', style: 'symbol' },
    { kind: 'path', d: 'M -3.74 51.96 L 0 53.51 L 0 120', style: 'symbol' },
    { kind: 'polygon', points: [{ x: -26.54, y: 27.17 }, { x: -39.81, y: 53.51 }, { x: 0, y: 53.51 }], fill: 'foreground' },
  ],
  textPos: { x: -66, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label one square right of the body edge — like the MOS devices.
  labelOffset: { x: 40, y: 0 },
  defaultValue: '',
});
