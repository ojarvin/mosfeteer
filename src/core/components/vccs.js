import { defineSymbol } from './defineSymbol.js';

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
  terminals: [
    { name: 'a', x: 0, y: -80, direction: 'positive', dir: { x: 0, y: -1 } },
    { name: 'b', x: 0, y: 80, direction: 'negative', dir: { x: 0, y: 1 } },
  ],
  bbox: { x: -40, y: -80, w: 80, h: 160 },
  graphics: [
    // An 80x80 diamond: the same visual weight as the round sources beside it.
    { kind: 'path', d: 'M 0 -40 L 40 0 L 0 40 L -40 0 Z', style: 'symbol' },
    { kind: 'path', d: 'M 0 -26 L 0 -8', style: 'symbol' },
    { kind: 'polygon', points: [{ x: 0, y: 26 }, { x: -16, y: -8 }, { x: 16, y: -8 }], fill: 'foreground' },
    { kind: 'path', d: 'M 0 -40 L 0 -80', style: 'symbol' },
    { kind: 'path', d: 'M 0 40 L 0 80', style: 'symbol' },
  ],
  textPos: { x: 0, y: -52, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: -80, y: 0 },
  defaultValue: '',
});
