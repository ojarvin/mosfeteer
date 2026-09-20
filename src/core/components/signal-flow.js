import { defineSymbol } from './defineSymbol.js';

const SIGNAL_TERMINALS = [
  { name: 'n', x: 0, y: -40, direction: 'passive', signalRole: 'input', dir: { x: 0, y: -1 } },
  { name: 'e', x: 40, y: 0, direction: 'passive', signalRole: 'output', dir: { x: 1, y: 0 } },
  { name: 's', x: 0, y: 40, direction: 'passive', signalRole: 'input', dir: { x: 0, y: 1 } },
  { name: 'w', x: -40, y: 0, direction: 'passive', signalRole: 'input', dir: { x: -1, y: 0 } },
];

const SIGNAL_COMMON = {
  terminals: SIGNAL_TERMINALS,
  bbox: { x: -40, y: -40, w: 80, h: 80 },
  textPos: null,
  refPos: null,
  labelOffset: null,
  defaultValue: '',
  // Signal-flow operators are useful while a drawing is being composed. An
  // unconnected arm is intentional until the surrounding signal path exists.
  allowFloatingTerminals: true,
};

function signalOperator(type, description, refPrefix, mark) {
  return defineSymbol({
    ...SIGNAL_COMMON,
    type,
    description,
    refPrefix,
    graphics: [
      { kind: 'circle', cx: 0, cy: 0, r: 40, style: 'emph' },
      ...mark,
    ],
  });
}

export const signal_sum = signalOperator('signal_sum', 'Signal-flow sum', 'SUM', [
  { kind: 'path', d: 'M -20 0 L 20 0', style: 'symbol' },
  { kind: 'path', d: 'M 0 -20 L 0 20', style: 'symbol' },
]);

export const signal_multiply = signalOperator('signal_multiply', 'Signal-flow multiply', 'MUL', [
  { kind: 'path', d: 'M -20 -20 L 20 20', style: 'symbol' },
  { kind: 'path', d: 'M -20 20 L 20 -20', style: 'symbol' },
]);
