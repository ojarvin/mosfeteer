import { defineSymbol } from './defineSymbol.js';

/**
 * P-channel MOSFET (Razavi style). Same body as NMOS; only the source arrow
 * differs — it points INTO the channel (reverse of NMOS). `defaultMirrorY`
 * flips the symbol vertically so the source points up by default (NMOS source
 * points down).
 */
export const pmos = defineSymbol({
  type: 'pmos',
  description: 'PMOS Transistor',
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
    // Source stub with filled arrow pointing INTO the channel (PMOS)
    { kind: 'path', d: 'M 65.35 27.91 L 120 27.91 L 120 80', style: 'symbol' },
    { kind: 'polygon', points: [{ x: 65.35, y: 28.49 }, { x: 102.56, y: 12.21 }, { x: 102.56, y: 44.77 }], fill: 'foreground' },
  ],
  textPos: { x: 94, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label sits on the bulk side (opposite the gate), one square clear.
  labelOffset: { x: 160, y: 0 },
  // Source points up by default (mirror of NMOS down).
  defaultMirrorY: true,
  defaultValue: '',
});