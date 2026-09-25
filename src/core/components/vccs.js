import { defineSymbol } from './defineSymbol.js';

// An 80x80 diamond: the same visual weight as the round sources beside it.
const DIAMOND = { kind: 'path', d: 'M 0 -40 L 40 0 L 0 40 L -40 0 Z', style: 'symbol' };
const LEADS = [
  { kind: 'path', d: 'M 0 -40 L 0 -80', style: 'symbol' },
  { kind: 'path', d: 'M 0 40 L 0 80', style: 'symbol' },
];

const SOURCE_TERMINALS = [
  { name: 'a', x: 0, y: -80, direction: 'positive', dir: { x: 0, y: -1 } },
  { name: 'b', x: 0, y: 80, direction: 'negative', dir: { x: 0, y: 1 } },
];

/**
 * Voltage-controlled current source: the textbook diamond used to draw a
 * transconductance branch in a small-signal model. The controlling voltage is
 * carried by the instance label (`g_{m1} v_{gs1}`), not by a drawn pair of
 * control wires -- textbooks leave those out for the same reason, a hybrid-pi
 * figure with them is unreadable.
 */
export const vccs = defineSymbol({
  type: 'vccs',
  description: 'Controlled Current Source',
  refPrefix: 'G',
  terminals: SOURCE_TERMINALS,
  bbox: { x: -40, y: -80, w: 80, h: 160 },
  graphics: [
    DIAMOND,
    { kind: 'path', d: 'M 0 -26 L 0 -8', style: 'symbol' },
    { kind: 'polygon', points: [{ x: 0, y: 26 }, { x: -16, y: -8 }, { x: 16, y: -8 }], fill: 'foreground' },
    ...LEADS,
  ],
  textPos: { x: 0, y: -52, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: -80, y: 0 },
  defaultValue: '',
});

/**
 * Voltage-controlled voltage source, the VCCS's pair: the same diamond with
 * the voltage source's polarity marks inside it, `+` toward terminal `a`.
 * Its gain and controlling voltage live in the instance label (`A v_{in}`).
 */
export const vcvs = defineSymbol({
  type: 'vcvs',
  description: 'Controlled Voltage Source',
  refPrefix: 'E',
  terminals: SOURCE_TERMINALS,
  bbox: { x: -40, y: -80, w: 80, h: 160 },
  graphics: [
    DIAMOND,
    { kind: 'path', d: 'M -9 -15 L 9 -15', style: 'symbol' },
    { kind: 'path', d: 'M 0 -24 L 0 -6', style: 'symbol' },
    { kind: 'path', d: 'M -9 16 L 9 16', style: 'symbol' },
    ...LEADS,
  ],
  textPos: { x: 0, y: -52, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: -80, y: 0 },
  defaultValue: '',
});
