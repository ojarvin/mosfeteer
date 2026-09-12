import { defineSymbol } from './defineSymbol.js';

/**
 * Independent sources (textbook style). Circle bodies with a filled arrow
 * (current) or polarity marks (voltage). Terminals a (top, +) and b (bottom, -).
 */
export const current_source = defineSymbol({
  type: 'current_source',
  description: 'Current Source',
  refPrefix: 'I',
  terminals: [
    { name: 'a', x: 0, y: -80, direction: 'positive', dir: { x: 0, y: -1 } },
    { name: 'b', x: 0, y: 80, direction: 'negative', dir: { x: 0, y: 1 } },
  ],
  bbox: { x: -40, y: -80, w: 80, h: 160 },
  graphics: [
    { kind: 'circle', cx: 0, cy: 0, r: 35, style: 'symbol' },
    { kind: 'path', d: 'M 0 -24 L 0 -8', style: 'symbol' },
    { kind: 'polygon', points: [{ x: 0, y: 24 }, { x: -16, y: -8 }, { x: 16, y: -8 }], fill: 'foreground' },
    { kind: 'path', d: 'M 0 -35 L 0 -80', style: 'symbol' },
    { kind: 'path', d: 'M 0 35 L 0 80', style: 'symbol' },
  ],
  textPos: { x: 0, y: -52, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: -80, y: 0 },
  defaultValue: '',
});


export const voltage_source = defineSymbol({
  type: 'voltage_source',
  description: 'Voltage Source',
  refPrefix: 'V',
  terminals: [
    { name: 'a', x: 0, y: -80, direction: 'positive', dir: { x: 0, y: -1 } },
    { name: 'b', x: 0, y: 80, direction: 'negative', dir: { x: 0, y: 1 } },
  ],
  bbox: { x: -40, y: -80, w: 80, h: 160 },
  graphics: [
    { kind: 'circle', cx: 0, cy: 0, r: 35, style: 'symbol' },
    { kind: 'path', d: 'M -80.23 -58.14 L -47.67 -58.14', style: 'symbol' },
    { kind: 'path', d: 'M -63.95 -74.42 L -63.95 -41.86', style: 'symbol' },
    { kind: 'path', d: 'M -80.23 53.49 L -47.67 53.49', style: 'symbol' },
    { kind: 'path', d: 'M 0 -35 L 0 -80', style: 'symbol' },
    { kind: 'path', d: 'M 0 35 L 0 80', style: 'symbol' },
  ],
  textPos: { x: 0, y: -52, anchor: 'middle' },
  refPos: null,
  labelOffset: { x: -80, y: 0 },
  defaultValue: '',
});
