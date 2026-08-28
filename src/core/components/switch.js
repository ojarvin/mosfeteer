import { defineSymbol } from './defineSymbol.js';

/**
 * SPST switch (Razavi style). Two terminals a (left) / b (right), 4 grid
 * squares wide (same footprint as the resistor). Open blade angles up clear of
 * the contact; closed blade rests on the contact.
 */
function makeSwitch(type, description, bladeD, contact1X, contact2X) {
  return defineSymbol({
    type,
    description,
    refPrefix: 'S',
    terminals: [
      { name: 'a', x: 0, y: 0, direction: 'passive', dir: { x: -1, y: 0 } },
      { name: 'b', x: 160, y: 0, direction: 'passive', dir: { x: 1, y: 0 } },
    ],
    bbox: { x: 0, y: -40, w: 160, h: 80 },
    graphics: [
      { kind: 'path', d: 'M 0 0 L 43.83 0', style: 'symbol' },
      { kind: 'circle', cx: contact1X, cy: 0, r: 8.53, style: 'symbol' },
      { kind: 'path', d: bladeD, style: 'symbol' },
      { kind: 'circle', cx: contact2X, cy: 0, r: 8.53, style: 'symbol' },
      { kind: 'path', d: 'M 116.18 0 L 160 0', style: 'symbol' },
    ],
    textPos: { x: 60, y: -30, anchor: 'middle' },
    refPos: null,
    labelOffset: { x: 80, y: 40 },
    defaultValue: '',
  });
}

export const switch_open = makeSwitch('switch_open', 'Switch (open)', 'M 61.46 -6.45 L 97.08 -34.15', 52.36, 107.64);

export const switch_closed = makeSwitch('switch_closed', 'Switch (closed)', 'M 60.84 -3.99 L 116.29 -12.52', 52.36, 107.64);