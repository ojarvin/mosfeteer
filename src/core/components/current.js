import { defineSymbol } from './defineSymbol.js';

const SOURCE_TERMINALS = [
  { name: 'a', x: 0, y: -80, direction: 'positive', dir: { x: 0, y: -1 } },
  { name: 'b', x: 0, y: 80, direction: 'negative', dir: { x: 0, y: 1 } },
];

function source(type, description, refPrefix, graphics) {
  return defineSymbol({
    type,
    description,
    refPrefix,
    terminals: SOURCE_TERMINALS,
    bbox: { x: -40, y: -80, w: 80, h: 160 },
    graphics,
    textPos: { x: 0, y: -52, anchor: 'middle' },
    refPos: null,
    labelOffset: { x: -80, y: 0 },
    defaultValue: '',
  });
}

export const current_source = source('current_source', 'Current Source', 'I', [
    { kind: 'circle', cx: 0, cy: 0, r: 35, style: 'symbol' },
    { kind: 'path', d: 'M 0 -24 L 0 -8', style: 'symbol' },
    { kind: 'polygon', points: [{ x: 0, y: 24 }, { x: -16, y: -8 }, { x: 16, y: -8 }], fill: 'foreground' },
    { kind: 'path', d: 'M 0 -35 L 0 -80', style: 'symbol' },
    { kind: 'path', d: 'M 0 35 L 0 80', style: 'symbol' },
]);

export const voltage_source = source('voltage_source', 'Voltage Source', 'V', [
    { kind: 'circle', cx: 0, cy: 0, r: 35, style: 'symbol' },
    { kind: 'path', d: 'M -80.23 -58.14 L -47.67 -58.14', style: 'symbol' },
    { kind: 'path', d: 'M -63.95 -74.42 L -63.95 -41.86', style: 'symbol' },
    { kind: 'path', d: 'M -80.23 53.49 L -47.67 53.49', style: 'symbol' },
    { kind: 'path', d: 'M 0 -35 L 0 -80', style: 'symbol' },
    { kind: 'path', d: 'M 0 35 L 0 80', style: 'symbol' },
]);
