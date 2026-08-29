import { defineSymbol } from './defineSymbol.js';

/**
 * N-channel MOSFET (Razavi style). Terminals g (left), d (top), s (bottom).
 * The local x origin is the drain/source channel, so the gate sits at x=-120
 * and mirror transforms keep vertical connection intent fixed.
 * The gate is drawn as two filled bars (thin lead-in bar and thicker main bar);
 * drain/source stubs meet the channel at x=0, and the source arrow points OUT
 * of the channel (down-right).
 */
export const nmos = defineSymbol({
  type: 'nmos',
  description: 'NMOS Transistor',
  refPrefix: 'M',
  terminals: [
    { name: 'g', x: -120, y: 0, direction: 'gate', dir: { x: -1, y: 0 } },
    { name: 'd', x: 0, y: -80, direction: 'drain', dir: { x: 0, y: -1 } },
    { name: 's', x: 0, y: 80, direction: 'source', dir: { x: 0, y: 1 } },
  ],
  bbox: { x: -120, y: -80, w: 120, h: 160 },
  graphics: [
    // Gate lead
    { kind: 'path', d: 'M -120 0 L -75.58 0', style: 'symbol' },
    // Gate bars (filled)
    { kind: 'polygon', points: [{ x: -87.21, y: -38.37 }, { x: -75.58, y: -38.37 }, { x: -75.58, y: 38.37 }, { x: -87.21, y: 38.37 }], fill: 'foreground' },
    { kind: 'polygon', points: [{ x: -66.28, y: -50 }, { x: -54.64, y: -50 }, { x: -54.64, y: 50 }, { x: -66.28, y: 50 }], fill: 'foreground' },
    // Drain stub
    { kind: 'path', d: 'M -56.98 -27.91 L 0 -27.91 L 0 -80', style: 'symbol' },
    // Source stub with filled arrow pointing OUT of the channel
    { kind: 'path', d: 'M -54.65 27.91 L 0 27.91 L 0 80', style: 'symbol' },
    { kind: 'polygon', points: [{ x: 2.32, y: 27.91 }, { x: -34.88, y: 11.63 }, { x: -34.88, y: 44.19 }], fill: 'foreground' },
  ],
  textPos: { x: -26, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label sits on the bulk side (opposite the gate), one square clear.
  labelOffset: { x: 40, y: 0 },
  defaultValue: '',
});
