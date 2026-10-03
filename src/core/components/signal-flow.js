import { defineSymbol } from './defineSymbol.js';
import { defaultTransferFunction } from '../transfer-function.js';

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

/**
 * Filter blocks: a block diagram's box with the filter's magnitude response
 * sketched inside in straight lines -- flat where it passes, a slope where
 * it rolls off -- for the input on the left and the output on the right.
 */
const FILTER_SHAPES = {
  lpf: ['Low-pass filter', 'M -48 -24 L 4 -24 L 48 28'],
  hpf: ['High-pass filter', 'M -48 28 L -4 -24 L 48 -24'],
  bpf: ['Band-pass filter', 'M -48 28 L -16 -24 L 16 -24 L 48 28'],
  notch: ['Notch (band-stop) filter', 'M -48 -24 L -20 -24 L 0 28 L 20 -24 L 48 -24'],
};

function filterBlock(kind) {
  const [description, shape] = FILTER_SHAPES[kind];
  return defineSymbol({
    type: `filter_${kind}`,
    description,
    refPrefix: 'F',
    terminals: [
      { name: 'in', x: -80, y: 0, direction: 'input', dir: { x: -1, y: 0 } },
      { name: 'out', x: 80, y: 0, direction: 'output', dir: { x: 1, y: 0 } },
    ],
    bbox: { x: -80, y: -80, w: 160, h: 160 },
    graphics: [
      { kind: 'rect', x: -80, y: -80, w: 160, h: 160, style: 'emph' },
      { kind: 'path', d: shape, style: 'symbol' },
    ],
    textPos: null,
    refPos: null,
    labelOffset: { x: 0, y: -120 },
    defaultValue: '',
  });
}

export const filter_lpf = filterBlock('lpf');
export const filter_hpf = filterBlock('hpf');
export const filter_bpf = filterBlock('bpf');
export const filter_notch = filterBlock('notch');

/**
 * Transfer-function blocks: a box holding H(s) or H(z) as math, input on the
 * left and output on the right. The value is the MATLAB-style definition
 * (transfer-function.js); each instance sizes its box to the equation
 * (ComponentInstance#bodySize), so this footprint is only the smallest one.
 */
function transferFunctionBlock(type, variable) {
  return defineSymbol({
    type,
    description: `Transfer function H(${variable})`,
    refPrefix: 'H',
    terminals: [
      { name: 'in', x: -80, y: 0, direction: 'input', signalRole: 'input', dir: { x: -1, y: 0 } },
      { name: 'out', x: 80, y: 0, direction: 'output', signalRole: 'output', dir: { x: 1, y: 0 } },
    ],
    bbox: { x: -80, y: -80, w: 160, h: 160 },
    graphics: [
      { kind: 'rect', x: -80, y: -80, w: 160, h: 160, style: 'emph' },
      { kind: 'text', x: 0, y: 14, text: `H(${variable})`, anchor: 'middle', font: 'label' },
    ],
    textPos: null,
    refPos: null,
    labelOffset: null,
    defaultValue: defaultTransferFunction(type),
    allowFloatingTerminals: true,
  });
}

export const tf_s = transferFunctionBlock('tf_s', 's');
export const tf_z = transferFunctionBlock('tf_z', 'z');

/**
 * A gain: the block-diagram triangle, pointing the way the signal goes, its
 * tip on the output pin and its centroid on the origin, so a coefficient
 * centred on the part sits in the middle of the triangle at any rotation.
 * A short coefficient (`k`, `b_1`, `0.5`) is drawn inside it, a longer one
 * (`-c_1`, `2*g_m`) beside it (Circuit#_syncTransferFunctionLabel). Its shape
 * already shows the direction, so its input wire takes no automatic arrowhead.
 */
export const gain = defineSymbol({
  type: 'gain',
  description: 'Gain',
  refPrefix: 'K',
  terminals: [
    { name: 'in', x: -80, y: 0, direction: 'input', signalRole: 'input', dir: { x: -1, y: 0 } },
    { name: 'out', x: 80, y: 0, direction: 'output', signalRole: 'output', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -80, y: -80, w: 160, h: 160 },
  graphics: [
    { kind: 'path', d: 'M -80 0 L -40 0', style: 'symbol', terminalLead: true },
    { kind: 'path', d: 'M 80 0 L -40 -60 L -40 60 Z', style: 'emph' },
  ],
  textPos: null,
  refPos: null,
  labelOffset: null,
  defaultValue: 'k',
  allowFloatingTerminals: true,
});
