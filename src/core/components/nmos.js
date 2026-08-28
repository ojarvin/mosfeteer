import { defineSymbol } from './defineSymbol.js';

/**
 * N-channel MOSFET. Terminals g (left), d (top-right), s (bottom-right).
 * Source arrow points outward (away from channel).
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
    // Gate wire
    { kind: 'path', d: 'M 0 0 L 40 0' },
    // Gate bar
    { kind: 'path', d: 'M 40 -40 L 40 40', style: 'thick' },
    // Source-drain bar
    { kind: 'path', d: 'M 60 -50 L 60 50', style: 'thick' },
    // Drain wires
    { kind: 'path', d: 'M 60 -30 L 120 -30' },
    { kind: 'path', d: 'M 120 -30 L 120 -80' },
    // Source wires
    { kind: 'path', d: 'M 60 30 L 120 30' },
    { kind: 'path', d: 'M 120 30 L 120 80' },
    // Source arrow (points outward, away from channel) sits on the horizontal
    // source wire at y=30, its tip aligned to the vertical source wire (x=120).
    { kind: 'path', d: 'M 110 30 L 90 22 L 90 38 Z', style: 'thick'},
  ],
  textPos: { x: 94, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label (dedicated label object) sits on the bulk side (opposite the
  // gate), vertically centered at the gate height, one square clear of the body.
  labelOffset: { x: 160, y: 0 },
  defaultValue: '',
});
