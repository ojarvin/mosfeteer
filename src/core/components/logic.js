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
    // Input polarity (im - top, ip + bottom), centered on the input rows y=+-40
    // to match the opamp_diff's output marks.
    { kind: 'path', d: 'M -76 26 L -76 54', style: 'symbol' },
    { kind: 'path', d: 'M -90 40 L -62 40', style: 'symbol' },
    { kind: 'path', d: 'M -90 -40 L -62 -40', style: 'symbol' },
  ],
  textPos: null,
  refPos: null,
  labelOffset: { x: 0, y: 160 },
  defaultValue: '',
});

const opampDiff = defineSymbol({
  type: 'opamp_diff',
  description: 'Fully Differential Op-Amp',
  refPrefix: 'U',
  terminals: [
    { name: 'ip', x: -200, y: 40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'im', x: -200, y: -40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'op', x: 160, y: -40, direction: 'output', dir: { x: 1, y: 0 } },
    { name: 'om', x: 160, y: 40, direction: 'output', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -200, y: -120, w: 360, h: 240 },
  graphics: [
    { kind: 'path', d: 'M -200 -40 L -107.81 -40', style: 'symbol' },
    { kind: 'path', d: 'M -200 40 L -107.19 40', style: 'symbol' },
    // Two output leads exit the triangle's slanted edges at the input rows and
    // run out to the same x=160 as the plain opamp's single output.
    { kind: 'path', d: 'M 12.8 -40 L 160 -40', style: 'symbol' },
    { kind: 'path', d: 'M 12.81 40 L 160 40', style: 'symbol' },
    { kind: 'path', d: 'M -107.19 -99.99 L -107.19 100 L 92.81 0 Z', style: 'emph' },
    // Polarity marks: all four the same 28-unit size, centered on the input/
    // output rows (y=+-40) so the pairs line up. They sit clear of the body's
    // slanted edges (inputs at x=-76, outputs at x=-38, away from the apex).
    // The outputs are FLIPPED relative to the inputs: im (-) top / ip (+)
    // bottom, but op (+) top / om (-) bottom (crossed-output convention).
    { kind: 'path', d: 'M -76 26 L -76 54', style: 'symbol' },
    { kind: 'path', d: 'M -90 40 L -62 40', style: 'symbol' },
    { kind: 'path', d: 'M -90 -40 L -62 -40', style: 'symbol' },
    { kind: 'path', d: 'M -38 -54 L -38 -26', style: 'symbol' },
    { kind: 'path', d: 'M -52 -40 L -24 -40', style: 'symbol' },
    { kind: 'path', d: 'M -52 40 L -24 40', style: 'symbol' },
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
    { kind: 'path', d: 'M 36.09 0 L -58.91 -60 L -58.91 54.99 Z', style: 'emph' },
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
    { kind: 'path', d: 'M 36.09 0 L -58.91 60 L -58.91 -55 Z', style: 'emph' },
    { kind: 'path', d: 'M 36.09 0 L 80 0', style: 'symbol' },
  ],
  textPos: null,
  refPos: null,
  labelOffset: { x: 0, y: 120 },
  defaultValue: '',
});

const AND_BODY = [
  // One continuous CLOSED outline: top edge meets the curved front side at the
  // same point (no seam or kink), down the front, across the bottom, back up
  // the flat back edge.
  { kind: 'path', d: 'M -75.63 -60.94 L 0.62 -60.94 C 0.62 -60.94 0.62 -60.94 1.25 -60.78 C 1.87 -60.62 3.12 -60.31 3.75 -60.16 C 4.37 -59.99 4.37 -59.99 7.08 -59.58 C 9.79 -59.16 15.21 -58.33 20.05 -56.93 C 24.89 -55.52 29.16 -53.54 33.8 -50.36 C 38.43 -47.19 43.44 -42.81 47.29 -38.22 C 51.14 -33.64 53.85 -28.86 55.94 -23.95 C 58.02 -19.06 59.48 -14.06 60.26 -8.85 C 61.04 -3.65 61.15 1.77 60.62 6.83 C 60.1 11.88 58.96 16.57 56.82 21.72 C 54.69 26.88 51.56 32.51 47.97 37.14 C 44.38 41.78 40.31 45.42 36.98 48.12 C 33.64 50.84 31.04 52.61 28.28 54.01 C 25.52 55.42 22.6 56.47 20 57.3 C 17.39 58.13 15.1 58.76 13.07 59.11 C 11.03 59.48 9.27 59.59 7.44 59.64 C 5.62 59.69 3.75 59.69 1.77 59.69 C -0.21 59.69 -2.29 59.69 -3.33 59.69 C -4.38 59.69 -4.38 59.69 -4.38 59.69 L -75.63 59.69 Z', style: 'emph' },
];

const OR_BODY = [
  // Shifted left (-8) from the original so the concave back overlaps the input
  // lead tips (which end at x=-76.88 on the input rows).
  { kind: 'path', d: 'M 45.64 0.01 C 45.64 0.01 45.64 0.01 36.11 8.86 C 26.57 17.71 7.5 35.4 -16.33 47.32 C -40.17 59.24 -68.79 65.38 -83.09 68.46 C -97.39 71.53 -97.39 71.53 -97.39 71.53 C -97.39 71.53 -97.39 71.53 -89.94 59.15 C -82.49 46.76 -67.59 21.99 -67.59 -1.75 C -67.59 -25.5 -82.49 -48.22 -89.94 -59.59 C -97.39 -70.94 -97.39 -70.94 -97.39 -70.94 C -97.39 -70.94 -97.39 -70.94 -83.09 -67.96 C -68.79 -64.99 -40.17 -59.03 -16.33 -47.2 C 7.5 -35.38 26.57 -17.68 36.11 -8.83 C 45.64 0.01 45.64 0.01 45.64 0.01 Z', style: 'emph' },
];

const XOR_BODY = [
  // Shifted left (-22) from the original so the extra input-side line (below)
  // lands on the input wire tips; the wires stop there and never extend into
  // the gap between the two curves. Closed with Z like the other gate bodies.
  { kind: 'path', d: 'M 72.55 0.01 C 72.55 0.01 72.55 0.01 63.01 8.86 C 53.48 17.7 34.41 35.4 10.56 47.32 C -13.27 59.23 -41.88 65.38 -56.18 68.45 C -70.49 71.52 -70.49 71.52 -70.49 71.52 C -70.49 71.52 -70.49 71.52 -63.04 59.14 C -55.59 46.76 -40.69 21.99 -40.69 -1.76 C -40.69 -25.51 -55.59 -48.23 -63.04 -59.59 C -70.49 -70.95 -70.49 -70.95 -70.49 -70.95 C -70.49 -70.95 -70.49 -70.95 -56.18 -67.97 C -41.88 -64.99 -13.27 -59.03 10.56 -47.21 C 34.41 -35.38 53.48 -17.69 63.01 -8.84 C 72.55 0.01 72.55 0.01 72.55 0.01 Z', style: 'emph' },
];

const XOR_FRONT = [
  // Extra input-side curve, shifted with the body (-22) so it touches the input
  // wire tips at x≈-77 on the input rows; the gap to the body back stays fixed.
  { kind: 'path', d: 'M -96.6 -70.94 C -96.6 -70.94 -96.6 -70.94 -89.32 -59.64 C -82.02 -48.34 -67.44 -25.73 -67.38 -1.93 C -67.34 21.87 -81.82 46.87 -89.05 59.37 C -96.29 71.88 -96.29 71.88 -96.29 71.88', style: 'emph' },
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
export const or_gate = gate('or_gate', 'OR Gate', OR_BODY, { outputLead: 45.64 });
export const nor_gate = gate('nor_gate', 'NOR Gate', OR_BODY, { outputLead: 75.27, bubbleAt: [62.47, -0.48] });
export const xor_gate = gate('xor_gate', 'XOR Gate', [...XOR_BODY, ...XOR_FRONT], { output: 160, outputLead: 72.55, width: 280 });
export const xnor_gate = gate('xnor_gate', 'XNOR Gate', [...XOR_BODY, ...XOR_FRONT], { output: 160, outputLead: 102.87, bubbleAt: [89.37, 0.01], width: 280 });

export { opamp, opampDiff, inverter, buffer };