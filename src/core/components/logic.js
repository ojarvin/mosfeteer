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
    { kind: 'path', d: 'M 36.09 0 L -58.91 -60 L -58.91 60 Z', style: 'emph' },
    { kind: 'circle', cx: 51.18, cy: 0, r: 15, style: 'emph' },
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
    { kind: 'path', d: 'M 36.09 0 L -58.91 60 L -58.91 -60 Z', style: 'emph' },
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
  { kind: 'path', d: 'M -75.63 -60 L 0 -60 C 33.14 -60 60 -33.14 60 0 C 60 33.14 33.14 60 0 60 L -75.63 60 Z', style: 'emph' },
];

const OR_BODY = [
  // Shifted left (-8) from the original so the concave back overlaps the input
  // lead tips (which end at x=-76.88 on the input rows).
  { kind: 'path', d: 'M 45.64 0 C 27.5 18.5 6 38.5 -16 50 C -38 61 -64 66 -83 68 C -90 69 -96 70 -97 70 C -89 58 -67 35 -67 0 C -67 -35 -89 -58 -97 -70 C -96 -70 -90 -69 -83 -68 C -64 -66 -38 -61 -16 -50 C 6 -38.5 27.5 -18.5 45.64 0 Z', style: 'emph' },
];

const XOR_BODY = [
  // Shifted left (-22) from the original so the extra input-side line (below)
  // lands on the input wire tips; the wires stop there and never extend into
  // the gap between the two curves. Closed with Z like the other gate bodies.
  { kind: 'path', d: 'M 72.55 0 C 54.41 18.5 32.91 38.5 10.91 50 C -11.09 61 -37.09 66 -56.09 68 C -63.09 69 -69.09 70 -70.09 70 C -62.09 58 -40.09 35 -40.09 0 C -40.09 -35 -62.09 -58 -70.09 -70 C -69.09 -70 -63.09 -69 -56.09 -68 C -37.09 -66 -11.09 -61 10.91 -50 C 32.91 -38.5 54.41 -18.5 72.55 0 Z', style: 'emph' },
];

const XOR_FRONT = [
  // Extra input-side curve, shifted with the body (-22) so it touches the input
  // wire tips at x≈-77 on the input rows; the gap to the body back stays fixed.
  { kind: 'path', d: 'M -96.6 70 C -88 58 -67 35 -67 0 C -67 -35 -88 -58 -96.6 -70', style: 'emph' },
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
export const nand_gate = gate('nand_gate', 'NAND Gate', AND_BODY, { outputLead: 88.5, bubbleAt: [75, 0] });
export const or_gate = gate('or_gate', 'OR Gate', OR_BODY, { outputLead: 45.64 });
export const nor_gate = gate('nor_gate', 'NOR Gate', OR_BODY, { outputLead: 75.97, bubbleAt: [62.47, 0] });
export const xor_gate = gate('xor_gate', 'XOR Gate', [...XOR_BODY, ...XOR_FRONT], { output: 160, outputLead: 72.55, width: 280 });
export const xnor_gate = gate('xnor_gate', 'XNOR Gate', [...XOR_BODY, ...XOR_FRONT], { output: 160, outputLead: 102.87, bubbleAt: [89.37, 0], width: 280 });

export { opamp, opampDiff, inverter, buffer };