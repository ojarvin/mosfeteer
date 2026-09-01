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
    { name: 'g', x: -120, y: 0, direction: 'gate', dir: { x: -1, y: 0 } },
    { name: 'd', x: 0, y: -80, direction: 'drain', dir: { x: 0, y: -1 } },
    { name: 's', x: 0, y: 80, direction: 'source', dir: { x: 0, y: 1 } },
  ],
  bbox: { x: -120, y: -80, w: 120, h: 160 },
  graphics: [
    // Keep a small clearance between the lead and the gate-bar edge so the
    // butt-capped lead cannot peek into the drain/source gap.
    { kind: 'path', d: 'M -120 0 L -76.88 0', style: 'symbol' },
    // Gate bars (filled)
    { kind: 'polygon', points: [{ x: -87.21, y: -38.37 }, { x: -75.58, y: -38.37 }, { x: -75.58, y: 38.37 }, { x: -87.21, y: 38.37 }], fill: 'foreground' },
    { kind: 'polygon', points: [{ x: -66.28, y: -50 }, { x: -54.64, y: -50 }, { x: -54.64, y: 50 }, { x: -66.28, y: 50 }], fill: 'foreground' },
    // Drain stub
    { kind: 'path', d: 'M -56.98 -27.91 L 0 -27.91 L 0 -80', style: 'symbol' },
    // Source stub with filled arrow pointing INTO the channel (PMOS)
    { kind: 'path', d: 'M -54.65 27.91 L 0 27.91 L 0 80', style: 'symbol' },
    { kind: 'polygon', points: [{ x: -54.65, y: 27.91 }, { x: -17.44, y: 11.63 }, { x: -17.44, y: 44.19 }], fill: 'foreground' },
  ],
  textPos: { x: -26, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label sits on the bulk side (opposite the gate), one square clear.
  labelOffset: { x: 40, y: 0 },
  // Source points up by default (mirror of NMOS down).
  defaultMirrorY: true,
  defaultValue: '',
});
