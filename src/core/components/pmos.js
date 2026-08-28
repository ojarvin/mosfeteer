import { defineSymbol } from './defineSymbol.js';

/**
 * P-channel MOSFET. Body is a copy of NMOS (no gate bubble); only the source
 * arrow differs — it points INTO the channel (toward the body), the reverse of
 * the NMOS arrow. `defaultMirrorY` flips the symbol vertically so the source
 * points up by default (NMOS source points down).
 */
export const pmos = defineSymbol({
  type: 'pmos',
  description: 'PMOS Transistor',
  refPrefix: 'M',
  terminals: [
    { name: 'g', x: 0, y: 0, direction: 'gate' },
    { name: 'd', x: 120, y: -80, direction: 'drain' },
    { name: 's', x: 120, y: 80, direction: 'source' },
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
    // Source arrow (points INTO the channel, reverse of NMOS)
    { kind: 'path', d: 'M 67 38 L 60 30 L 67 22 Z' },
  ],
  textPos: { x: 94, y: -30, anchor: 'middle' },
  refPos: null,
  // Instance label (dedicated label object) sits on the bulk side (opposite the
  // gate), vertically centered at the gate height.
  labelOffset: { x: 120, y: 0 },
  // Source points up by default (mirror of NMOS down).
  defaultMirrorY: true,
  defaultValue: '',
});