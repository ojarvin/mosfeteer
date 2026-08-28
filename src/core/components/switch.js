import { defineSymbol } from './defineSymbol.js';

/**
 * SPST switch. Two terminals on the left/right edges, 4 grid squares wide
 * (same footprint as the resistor). The blade either angles up (open) or
 * rests on the contact (closed).
 */
export const switch_open = defineSymbol({
  type: 'switch_open',
  description: 'Switch (open)',
  refPrefix: 'S',
  terminals: [
    { name: 'a', x: 0, y: 0 },
    { name: 'b', x: 160, y: 0 },
  ],
  bbox: { x: 0, y: -40, w: 160, h: 80 },
  graphics: [
    // Left wire to the blade root
    { kind: 'path', d: 'M 0 0 L 50 0' },
    // Open blade: angles up, clear of the contact
    { kind: 'path', d: 'M 50 0 L 78 -30' },
    // Right wire from the contact
    { kind: 'path', d: 'M 100 0 L 160 0' },
    // Contact dot
    { kind: 'circle', cx: 100, cy: 0, r: 4 },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 80, y: 80 },
  defaultValue: 'open',
});

export const switch_closed = defineSymbol({
  type: 'switch_closed',
  description: 'Switch (closed)',
  refPrefix: 'S',
  terminals: [
    { name: 'a', x: 0, y: 0 },
    { name: 'b', x: 160, y: 0 },
  ],
  bbox: { x: 0, y: -40, w: 160, h: 80 },
  graphics: [
    // Left wire to the blade root
    { kind: 'path', d: 'M 0 0 L 50 0' },
    // Closed blade: rests on the contact
    { kind: 'path', d: 'M 50 0 L 100 0' },
    // Right wire from the contact
    { kind: 'path', d: 'M 100 0 L 160 0' },
    // Contact dot
    { kind: 'circle', cx: 100, cy: 0, r: 4 },
  ],
  textPos: { x: 60, y: -30, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: 80, y: 80 },
  defaultValue: 'closed',
});
