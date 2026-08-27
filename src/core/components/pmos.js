import { defineSymbol } from './defineSymbol.js';

/**
 * P-channel MOSFET. Same footprint as NMOS; gate bubble marks polarity.
 * Dummy graphics (replace later).
 */
export const pmos = defineSymbol({
  type: 'pmos',
  description: 'PMOS Transistor',
  refPrefix: 'M',
  terminals: [
    { name: 'g', x: 0, y: 0, direction: 'gate' },
    { name: 'd', x: 120, y: -40, direction: 'drain' },
    { name: 's', x: 120, y: 40, direction: 'source' },
  ],
  bbox: { x: 0, y: -40, w: 120, h: 80 },
  graphics: [
    { kind: 'path', d: 'M 0 0 L 30 0' },
    { kind: 'circle', cx: 34, cy: 0, r: 6 },
    { kind: 'path', d: 'M 40 0 L 44 0' },
    { kind: 'path', d: 'M 44 -24 L 44 24', style: 'thick' },
    { kind: 'path', d: 'M 76 -40 L 76 40' },
    { kind: 'path', d: 'M 76 -40 L 120 -40' },
    { kind: 'path', d: 'M 76 40 L 120 40' },
  ],
  textPos: { x: 94, y: -30, anchor: 'middle' },
  refPos: { x: 60, y: 48, anchor: 'middle' },
  defaultValue: '',
});