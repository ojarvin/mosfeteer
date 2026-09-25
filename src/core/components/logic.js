import { defineSymbol } from './defineSymbol.js';

/**
 * Digital logic symbols and op-amp (textbook style). Gates use a filled-in body
 * with a rounded output side and an optional negation bubble. Two-input gates
 * all share input terminals at x=-120 (a top, b bottom) for a consistent grid;
 * three-input variants add the middle `b` pin and shift the lower pin to `c`.
 */
const opamp = defineSymbol({
  type: 'opamp',
  description: 'Operational Amplifier',
  refPrefix: 'U',
  terminals: [
    { name: 'ip', x: -200, y: -40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'im', x: -200, y: 40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'o', x: 160, y: 0, direction: 'output', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -200, y: -120, w: 360, h: 240 },
  graphics: [
    { kind: 'path', d: 'M -200 40 L -107.81 40', style: 'symbol' },
    { kind: 'path', d: 'M -200 -40 L -107.19 -40', style: 'symbol' },
    { kind: 'path', d: 'M 92.81 0 L 160 0', style: 'symbol' },
    { kind: 'path', d: 'M -107.19 99.99 L -107.19 -100 L 92.81 0 Z', style: 'emph' },
    // Input polarity (ip + top, im - bottom), centered on the input rows y=+-40
    // to match the opamp_diff's output marks.
    { kind: 'path', d: 'M -76 -54 L -76 -26', style: 'symbol' },
    { kind: 'path', d: 'M -90 -40 L -62 -40', style: 'symbol' },
    { kind: 'path', d: 'M -90 40 L -62 40', style: 'symbol' },
  ],
  textPos: null,
  refPos: null,
  labelOffset: { x: 0, y: -160 },
  defaultValue: '',
});

const opampDiff = defineSymbol({
  type: 'opamp_diff',
  description: 'Fully Differential Op-Amp',
  refPrefix: 'U',
  terminals: [
    { name: 'ip', x: -200, y: -40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'im', x: -200, y: 40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'op', x: 160, y: 40, direction: 'output', dir: { x: 1, y: 0 } },
    { name: 'om', x: 160, y: -40, direction: 'output', dir: { x: 1, y: 0 } },
  ],
  bbox: { x: -200, y: -120, w: 360, h: 240 },
  graphics: [
    { kind: 'path', d: 'M -200 40 L -107.81 40', style: 'symbol' },
    { kind: 'path', d: 'M -200 -40 L -107.19 -40', style: 'symbol' },
    // Two output leads exit the triangle's slanted edges at the input rows and
    // run out to the same x=160 as the plain opamp's single output.
    { kind: 'path', d: 'M 12.8 40 L 160 40', style: 'symbol' },
    { kind: 'path', d: 'M 12.81 -40 L 160 -40', style: 'symbol' },
    { kind: 'path', d: 'M -107.19 99.99 L -107.19 -100 L 92.81 0 Z', style: 'emph' },
    // Polarity marks: all four the same 28-unit size, centered on the input/
    // output rows (y=+-40) so the pairs line up. They sit clear of the body's
    // slanted edges (inputs at x=-76, outputs at x=-38, away from the apex).
    // The outputs are FLIPPED relative to the inputs: ip (+) top / im (-)
    // bottom, but om (-) top / op (+) bottom (crossed-output convention).
    { kind: 'path', d: 'M -76 -54 L -76 -26', style: 'symbol' },
    { kind: 'path', d: 'M -90 -40 L -62 -40', style: 'symbol' },
    { kind: 'path', d: 'M -90 40 L -62 40', style: 'symbol' },
    { kind: 'path', d: 'M -38 26 L -38 54', style: 'symbol' },
    { kind: 'path', d: 'M -52 40 L -24 40', style: 'symbol' },
    { kind: 'path', d: 'M -52 -40 L -24 -40', style: 'symbol' },
  ],
  textPos: null,
  refPos: null,
  labelOffset: { x: 0, y: -160 },
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
  labelOffset: { x: 0, y: -120 },
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
  labelOffset: { x: 0, y: -120 },
  defaultValue: '',
});

// Tri-state gates reuse the ordinary inverter/buffer body and horizontal pins.
// The enable pin drops from the lower edge at the body's vertical centre.
function triStateGate(base, type, description) {
  return defineSymbol({
    ...base,
    type,
    description,
    terminals: [
      ...base.terminals,
      { name: 'en', x: 0, y: 80, direction: 'input', dir: { x: 0, y: 1 } },
    ],
    bbox: { ...base.bbox },
    graphics: [
      ...base.graphics,
      { kind: 'path', d: 'M 0 22.79 L 0 80', style: 'symbol' },
    ],
  });
}

const tristateInverter = triStateGate(inverter, 'tristate_inverter', 'Tri-state Inverter');
const tristateBuffer = triStateGate(buffer, 'tristate_buffer', 'Tri-state Buffer');

const AND_BODY = [
  // One continuous CLOSED outline: top edge meets the curved front side at the
  // same point (no seam or kink), down the front, across the bottom, back up
  // the flat back edge.
  { kind: 'path', d: 'M -75.63 -60 L 0 -60 C 33.14 -60 60 -33.14 60 0 C 60 33.14 33.14 60 0 60 L -75.63 60 Z', style: 'emph' },
];

const OR_XOR_BODY_SHIFT = 26.91;

// OR/NOR and XOR/XNOR share the same body. XOR/XNOR are shifted right so the
// extra input-side curve can meet the input wire tips without entering the
// gap; the body itself must stay identical apart from that translation.
function orXorBody(shift = 0) {
  const x = (value) => Number((value + shift).toFixed(2));
  return {
    kind: 'path',
    // One cubic forms each outer side; the rear endpoint is reached with a
    // horizontal tangent. The concave return is kept close to XOR_FRONT.
    d: `M ${x(72.55)} 0 C ${x(55.5)} 18.5 ${x(6.5)} 70 ${x(-70.09)} 70 C ${x(-61.5)} 58 ${x(-40.75)} 35 ${x(-40.75)} 0 C ${x(-40.75)} -35 ${x(-61.5)} -58 ${x(-70.09)} -70 C ${x(6.5)} -70 ${x(55.5)} -18.5 ${x(72.55)} 0 Z`,
    style: 'emph',
  };
}

const OR_BODY = [orXorBody(-OR_XOR_BODY_SHIFT)];
const XOR_BODY = [orXorBody()];

const XOR_FRONT = [
  // Extra input-side curve. It touches the input wire tips at x≈-77 on the
  // input rows; the gap to the shared body back stays visually even.
  { kind: 'path', d: 'M -96.6 70 C -88 58 -67 35 -67 0 C -67 -35 -88 -58 -96.6 -70', style: 'emph' },
];

function gate(type, description, body, { inputs = [-120, -120], inputNames = ['a', 'b'], inputLeadEnds = null, output = 120, outputLead = 63.13, bubbleAt = null, width = 240 } = {}) {
  const inputRows = inputNames.length === 3 ? [-40, 0, 40] : [-40, 40];
  const gfx = [
    ...inputRows.map((y, index) => ({ kind: 'path', d: `M ${inputs[index]} ${y} L ${inputLeadEnds?.[index] ?? inputs[index] + 43.12} ${y}`, style: 'symbol' })),
    ...body,
  ];
  if (bubbleAt) gfx.push({ kind: 'circle', cx: bubbleAt[0], cy: bubbleAt[1], r: 13.5, style: 'emph' });
  gfx.push({ kind: 'path', d: `M ${outputLead} 0 L ${output} 0`, style: 'symbol' });
  return defineSymbol({
    type,
    description,
    refPrefix: 'U',
    terminals: [
      ...inputNames.map((name, index) => ({ name, x: inputs[index], y: inputRows[index], direction: 'input', dir: { x: -1, y: 0 } })),
      { name: 'y', x: output, y: 0, direction: 'output', dir: { x: 1, y: 0 } },
    ],
    bbox: { x: inputs[0], y: -80, w: width, h: 160 },
    graphics: gfx,
    textPos: null,
    refPos: null,
    labelOffset: { x: (inputs[0] + output) / 2, y: -120 },
    defaultValue: '',
  });
}

export const and2_gate = gate('and2_gate', '2-input AND Gate', AND_BODY, { outputLead: 63.13 });
export const nand2_gate = gate('nand2_gate', '2-input NAND Gate', AND_BODY, { outputLead: 88.5, bubbleAt: [75, 0] });
export const or2_gate = gate('or2_gate', '2-input OR Gate', OR_BODY, { outputLead: 45.64 });
export const nor2_gate = gate('nor2_gate', '2-input NOR Gate', OR_BODY, { outputLead: 75.97, bubbleAt: [62.47, 0] });
export const xor2_gate = gate('xor2_gate', '2-input XOR Gate', [...XOR_BODY, ...XOR_FRONT], { output: 160, outputLead: 72.55, width: 280 });
export const xnor2_gate = gate('xnor2_gate', '2-input XNOR Gate', [...XOR_BODY, ...XOR_FRONT], { output: 160, outputLead: 102.87, bubbleAt: [89.37, 0], width: 280 });

export const and3_gate = gate('and3_gate', '3-input AND Gate', AND_BODY, { inputs: [-120, -120, -120], inputNames: ['a', 'b', 'c'], outputLead: 63.13 });
export const nand3_gate = gate('nand3_gate', '3-input NAND Gate', AND_BODY, { inputs: [-120, -120, -120], inputNames: ['a', 'b', 'c'], outputLead: 88.5, bubbleAt: [75, 0] });
export const or3_gate = gate('or3_gate', '3-input OR Gate', OR_BODY, { inputs: [-120, -120, -120], inputNames: ['a', 'b', 'c'], inputLeadEnds: [-76.88, -67.66, -76.88], outputLead: 45.64 });
export const nor3_gate = gate('nor3_gate', '3-input NOR Gate', OR_BODY, { inputs: [-120, -120, -120], inputNames: ['a', 'b', 'c'], inputLeadEnds: [-76.88, -67.66, -76.88], outputLead: 75.97, bubbleAt: [62.47, 0] });
export const xor3_gate = gate('xor3_gate', '3-input XOR Gate', [...XOR_BODY, ...XOR_FRONT], { inputs: [-120, -120, -120], inputNames: ['a', 'b', 'c'], inputLeadEnds: [-76.88, -67, -76.88], output: 160, outputLead: 72.55, width: 280 });
export const xnor3_gate = gate('xnor3_gate', '3-input XNOR Gate', [...XOR_BODY, ...XOR_FRONT], { inputs: [-120, -120, -120], inputNames: ['a', 'b', 'c'], inputLeadEnds: [-76.88, -67, -76.88], output: 160, outputLead: 102.87, bubbleAt: [89.37, 0], width: 280 });

export { opamp, opampDiff, inverter, buffer, tristateInverter, tristateBuffer };
