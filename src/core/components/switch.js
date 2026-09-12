import { defineSymbol } from './defineSymbol.js';

/**
 * SPST switch (textbook style). Two terminals a (left) / b (right), 4 grid
 * squares wide (same footprint as the resistor). The origin is at the symbol
 * midpoint. Open blade angles up clear of the contact; closed blade rests on
 * the contact.
 */
function makeSwitch(type, description, bladeD, contact1X, contact2X) {
  return defineSymbol({
    type,
    description,
    refPrefix: 'S',
    terminals: [
      { name: 'a', x: -80, y: 0, direction: 'passive', dir: { x: -1, y: 0 } },
      { name: 'b', x: 80, y: 0, direction: 'passive', dir: { x: 1, y: 0 } },
    ],
    bbox: { x: -80, y: -40, w: 160, h: 80 },
    graphics: [
      { kind: 'path', d: 'M -80 0 L -36.17 0', style: 'symbol' },
      { kind: 'circle', cx: contact1X - 80, cy: 0, r: 8.53, style: 'symbol' },
      { kind: 'path', d: bladeD, style: 'symbol' },
      { kind: 'circle', cx: contact2X - 80, cy: 0, r: 8.53, style: 'symbol' },
      { kind: 'path', d: 'M 36.18 0 L 80 0', style: 'symbol' },
    ],
    textPos: { x: -20, y: -30, anchor: 'middle' },
    refPos: null,
    labelOffset: { x: 0, y: 40 },
    defaultValue: '',
  });
}

export const switch_open = makeSwitch('switch_open', 'Switch (open)', 'M -18.54 -6.45 L 17.08 -34.15', 52.36, 107.64);

export const switch_closed = makeSwitch('switch_closed', 'Switch (closed)', 'M -19.16 -3.99 L 36.29 -12.52', 52.36, 107.64);
