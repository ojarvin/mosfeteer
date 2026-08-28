import { defineSymbol } from './defineSymbol.js';

/**
 * Digital logic symbols and op-amp (Razavi style). Gates use a filled-in body
 * with a rounded output side and an optional negation bubble. Two-input gates
 * all share input terminals at x=-120 (a top, b bottom) for a consistent grid.
 */
const opamp = defineSymbol({
  type: 'opamp',
  description: 'Operational Amplifier',
  refPrefix: 'U',
  terminals: [
    { name: 'ip', x: -200, y: 40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'im', x: -200, y: -40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'o', x: 160, y: 0, direction: 'output', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -200, y: -120, w: 360, h: 240 },
  graphics: [
    { kind: 'path', d: 'M -200 -40 L -107.81 -40', style: 'symbol' },
    { kind: 'path', d: 'M -200 40 L -107.19 40', style: 'symbol' },
    { kind: 'path', d: 'M 92.81 0 L 160 0', style: 'symbol' },
    { kind: 'path', d: 'M -107.19 -99.99 L -107.19 100 L 92.81 0 Z', style: 'emph' },
    { kind: 'path', d: 'M -72.19 35 L -72.19 65', style: 'symbol' },
    { kind: 'path', d: 'M -87.18 50 L -57.18 50', style: 'symbol' },
    { kind: 'path', d: 'M -87.18 -50 L -57.18 -50', style: 'symbol' },
  ],
  textPos: null,
  refPos: null,
  labelOffset: { x: 0, y: 160 },
  defaultValue: '',
});

const inverter = defineSymbol({
  type: 'inverter',
  description: 'Inverter (NOT gate)',
  refPrefix: 'U',
  terminals: [
    { name: 'a', x: -120, y: 0, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'y', x: 120, y: 0, direction: 'output', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -120, y: -80, w: 240, h: 160 },
  graphics: [
    { kind: 'path', d: 'M -120 0 L -58.91 0', style: 'symbol' },
    { kind: 'path', d: 'M 36.09 0 L -58.91 -60 L -58.91 54.99 L 36.09 0', style: 'emph' },
    { kind: 'circle', cx: 51.18, cy: 0.04, r: 15, style: 'emph' },
    { kind: 'path', d: 'M 66.1 0 L 120 0', style: 'symbol' },
  ],
  textPos: null,
  refPos: null,
  labelOffset: { x: 0, y: 120 },
  defaultValue: '',
});

const buffer = defineSymbol({
  type: 'buffer',
  description: 'Buffer',
  refPrefix: 'U',
  terminals: [
    { name: 'a', x: -120, y: 0, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'y', x: 80, y: 0, direction: 'output', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -120, y: -80, w: 200, h: 160 },
  graphics: [
    { kind: 'path', d: 'M -120 0 L -58.91 0', style: 'symbol' },
    { kind: 'path', d: 'M 36.09 0 L -58.91 60 L -58.91 -55 L 36.09 0', style: 'emph' },
    { kind: 'path', d: 'M 36.09 0 L 80 0', style: 'symbol' },
  ],
  textPos: null,
  refPos: null,
  labelOffset: { x: 0, y: 120 },
  defaultValue: '',
});

const AND_BODY = [
  { kind: 'path', d: 'M 0.62 -60.31 L -75.63 -60.31 L -75.63 59.69 L -4.07 59.69', style: 'emph' },
  { kind: 'path', d: 'M 0.62 -60.94 C 0.62 -60.94 0.62 -60.94 1.25 -60.78 C 1.87 -60.62 3.12 -60.31 3.75 -60.16 C 4.37 -59.99 4.37 -59.99 7.08 -59.58 C 9.79 -59.16 15.21 -58.33 20.05 -56.93 C 24.89 -55.52 29.16 -53.54 33.8 -50.36 C 38.43 -47.19 43.44 -42.81 47.29 -38.22 C 51.14 -33.64 53.85 -28.86 55.94 -23.95 C 58.02 -19.06 59.48 -14.06 60.26 -8.85 C 61.04 -3.65 61.15 1.77 60.62 6.83 C 60.1 11.88 58.96 16.57 56.82 21.72 C 54.69 26.88 51.56 32.51 47.97 37.14 C 44.38 41.78 40.31 45.42 36.98 48.12 C 33.64 50.84 31.04 52.61 28.28 54.01 C 25.52 55.42 22.6 56.47 20 57.3 C 17.39 58.13 15.1 58.76 13.07 59.11 C 11.03 59.48 9.27 59.59 7.44 59.64 C 5.62 59.69 3.75 59.69 1.77 59.69 C -0.21 59.69 -2.29 59.69 -3.33 59.69 C -4.38 59.69 -4.38 59.69 -4.38 59.69', style: 'emph' },
];

const OR_BODY = [
  { kind: 'path', d: 'M 53.64 0.01 C 53.64 0.01 53.64 0.01 44.11 8.86 C 34.57 17.71 15.5 35.4 -8.33 47.32 C -32.17 59.24 -60.79 65.38 -75.09 68.46 C -89.39 71.53 -89.39 71.53 -89.39 71.53 C -89.39 71.53 -89.39 71.53 -81.94 59.15 C -74.49 46.76 -59.59 21.99 -59.59 -1.75 C -59.59 -25.5 -74.49 -48.22 -81.94 -59.59 C -89.39 -70.94 -89.39 -70.94 -89.39 -70.94 C -89.39 -70.94 -89.39 -70.94 -75.09 -67.96 C -60.79 -64.99 -32.17 -59.03 -8.33 -47.2 C 15.5 -35.38 34.57 -17.68 44.11 -8.83 C 53.64 0.01 53.64 0.01 53.64 0.01', style: 'emph' },
];

const XOR_BODY = [
  { kind: 'path', d: 'M 94.55 0.01 C 94.55 0.01 94.55 0.01 85.01 8.86 C 75.48 17.7 56.41 35.4 32.56 47.32 C 8.73 59.23 -19.88 65.38 -34.18 68.45 C -48.49 71.52 -48.49 71.52 -48.49 71.52 C -48.49 71.52 -48.49 71.52 -41.04 59.14 C -33.59 46.76 -18.69 21.99 -18.69 -1.76 C -18.69 -25.51 -33.59 -48.23 -41.04 -59.59 C -48.49 -70.95 -48.49 -70.95 -48.49 -70.95 C -48.49 -70.95 -48.49 -70.95 -34.18 -67.97 C -19.88 -64.99 8.73 -59.03 32.56 -47.21 C 56.41 -35.38 75.48 -17.69 85.01 -8.84 C 94.55 0.01 94.55 0.01 94.55 0.01', style: 'emph' },
];

const XOR_FRONT = [
  { kind: 'path', d: 'M -74.6 -70.94 C -74.6 -70.94 -74.6 -70.94 -67.32 -59.64 C -60.02 -48.34 -45.44 -25.73 -45.38 -1.93 C -45.34 21.87 -59.82 46.87 -67.05 59.37 C -74.29 71.88 -74.29 71.88 -74.29 71.88', style: 'emph' },
];

function gate(type, description, body, { inputs = [-120, -120], output = 120, outputLead = 63.13, bubbleAt = null, width = 240 } = {}) {
  const gfx = [
    { kind: 'path', d: `M ${inputs[0]} -40 L ${inputs[0] + 43.12} -40`, style: 'symbol' },
    { kind: 'path', d: `M ${inputs[1]} 40 L ${inputs[1] + 43.12} 40`, style: 'symbol' },
    ...body,
  ];
  if (bubbleAt) gfx.push({ kind: 'circle', cx: bubbleAt[0], cy: bubbleAt[1], r: 13.5, style: 'emph' });
  gfx.push({ kind: 'path', d: `M ${outputLead} 0 L ${output} 0`, style: 'symbol' });
  return defineSymbol({
    type,
    description,
    refPrefix: 'U',
    terminals: [
      { name: 'a', x: inputs[0], y: -40, direction: 'input', dir: { x: -1, y: 0 } },
      { name: 'b', x: inputs[1], y: 40, direction: 'input', dir: { x: -1, y: 0 } },
      { name: 'y', x: output, y: 0, direction: 'output', dir: { x: 1, y: 0 } },
    ],
    bbox: { x: inputs[0], y: -80, w: width, h: 160 },
    graphics: gfx,
    textPos: null,
    refPos: null,
    labelOffset: { x: (inputs[0] + output) / 2, y: 120 },
    defaultValue: '',
  });
}

export const and_gate = gate('and_gate', 'AND Gate', AND_BODY, { outputLead: 63.13 });
export const nand_gate = gate('nand_gate', 'NAND Gate', AND_BODY, { outputLead: 78.13, bubbleAt: [66.11, 0.04] });
export const or_gate = gate('or_gate', 'OR Gate', OR_BODY, { outputLead: 53.64 });
export const nor_gate = gate('nor_gate', 'NOR Gate', OR_BODY, { outputLead: 83.27, bubbleAt: [70.47, -0.48] });
export const xor_gate = gate('xor_gate', 'XOR Gate', [...XOR_BODY, ...XOR_FRONT], { output: 160, outputLead: 94.55, width: 280 });
export const xnor_gate = gate('xnor_gate', 'XNOR Gate', [...XOR_BODY, ...XOR_FRONT], { output: 160, outputLead: 124.87, bubbleAt: [111.37, 0.01], width: 280 });

export { opamp, inverter, buffer };