import { defineSymbol } from './defineSymbol.js';

/**
 * N-channel MOSFET (Razavi style). Terminals g (left), d (top-right),
 * s (bottom-right). The gate is drawn as two filled bars (thin lead-in bar and
 * thicker main bar); drain/source stubs exit the channel to the right, and the
 * source arrow points OUT of the channel (down-right).
 */
export const nmos = defineSymbol({
  type: 'nmos',
  description: 'NMOS Transistor',
  refPrefix: 'M',
  terminals: [
    { name: 'g', x: 0, y: 0, direction: 'gate', dir: { x: -1, y: 0 } },
    { name: 'd', x: 120, y: -80, direction: 'drain', dir: { x: 0, y: -1 } },
    { name: 's', x: 120, y: 80, direction: 'source', dir: { x: 0, y: 1 } },
  ],
  bbox: { x: 0, y: -80, w: 120, h: 160 },
  graphics: [
    // Gate lead
    { kind: 'path', d: 'M 0 0 L 44.42 0', style: 'symbol' },
    // Gate bars (filled)
    { kind: 'polygon', points: [{ x: 32.79, y: -38.37 }, { x: 44.42, y: -38.37 }, { x: 44.42, y: 38.37 }, { x: 32.79, y: 38.37 }], fill: 'foreground' },
    { kind: 'polygon', points: [{ x: 53.72, y: -50 }, { x: 65.36, y: -50 }, { x: 65.36, y: 50 }, { x: 53.72, y: 50 }], fill: 'foreground' },
    // Drain stub
    { kind: 'path', d: 'M 63.02 -27.91 L 120 -27.91 L 120 -80', style: 'symbol' },
    // Source stub with filled arrow pointing OUT of the channel
    { kind: 'path', d: 'M 65.35 27.91 L 120 27.91 L 120 80', style: 'symbol' },
    { kind: 'polygon', points: [{ x: 122.32, y: 27.91 }, { x: 85.12, y: 11.63 }, { x: 85.12, y: 44.19 }], fill: 'foreground' },
  ],
  textPos: { x: 94, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label sits on the bulk side (opposite the gate), one square clear.
  labelOffset: { x: 160, y: 0 },
  defaultValue: '',
});