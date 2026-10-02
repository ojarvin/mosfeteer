import { defineSymbol } from './defineSymbol.js';

const ADC_BODY = 'M 120 -100 L -40 -100 L -120 0 L -40 100 L 120 100 Z';
const DAC_BODY = 'M -120 -100 L 40 -100 L 120 0 L 40 100 L -120 100 Z';

// A differential analog side keeps the single-ended body: its two pins at
// y=-40 and y=40 meet the pointed end, marked + (top) and - (bottom) as the
// op-amp's inputs are.
// The pointed end runs from its tip at x=+-120 back to x=+-40 at y=+-100.
const leadEnd = (x, y) => Math.sign(x) * (120 - 0.8 * Math.abs(y));

function polarityMarks(x) {
  return [
    { kind: 'path', d: `M ${x} -54 L ${x} -26`, style: 'symbol' },
    { kind: 'path', d: `M ${x - 14} -40 L ${x + 14} -40`, style: 'symbol' },
    { kind: 'path', d: `M ${x - 14} 40 L ${x + 14} 40`, style: 'symbol' },
  ];
}

function converter(type, description, text, terminals, body, { analogSide = 0, textX = type.startsWith('adc') ? 20 : -20 } = {}) {
  return defineSymbol({
    type,
    description,
    refPrefix: 'U',
    terminals,
    bbox: { x: -200, y: -120, w: 400, h: 240 },
    graphics: [
      ...terminals.map(({ x, y }) => ({
        kind: 'path',
        // A pin off the pointed end's tip stops where it meets its slant.
        d: `M ${x} ${y} L ${Math.sign(x) === analogSide && y ? leadEnd(x, y) : x < 0 ? -120 : 120} ${y}`,
        style: 'symbol',
      })),
      { kind: 'path', d: body, style: 'emph' },
      // Set in from the slant as far as an op-amp's marks are from its back edge.
      ...(analogSide ? polarityMarks(analogSide * 50) : []),
      { kind: 'text', x: textX, y: 0, text, anchor: 'middle', font: 'label', keepUpright: true },
    ],
    textPos: null,
    refPos: null,
    labelOffset: { x: 0, y: -160 },
    defaultValue: '',
  });
}

export const adc = converter(
  'adc',
  'Analog-to-Digital Converter',
  'ADC',
  [{ name: 'ain', x: -200, y: 0, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'd', x: 200, y: 0, direction: 'output', dir: { x: 1, y: 0 } }],
  ADC_BODY,
);

export const dac = converter(
  'dac',
  'Digital-to-Analog Converter',
  'DAC',
  [{ name: 'd', x: -200, y: 0, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'aout', x: 200, y: 0, direction: 'output', dir: { x: 1, y: 0 } }],
  DAC_BODY,
);

export const adcDiff = converter(
  'adc_diff',
  'Analog-to-Digital Converter, differential input',
  'ADC',
  [{ name: 'aip', x: -200, y: -40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'aim', x: -200, y: 40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'd', x: 200, y: 0, direction: 'output', dir: { x: 1, y: 0 } }],
  ADC_BODY,
  { analogSide: -1, textX: 40 },
);

export const dacDiff = converter(
  'dac_diff',
  'Digital-to-Analog Converter, differential output',
  'DAC',
  [{ name: 'd', x: -200, y: 0, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'aop', x: 200, y: -40, direction: 'output', dir: { x: 1, y: 0 } },
    { name: 'aom', x: 200, y: 40, direction: 'output', dir: { x: 1, y: 0 } }],
  DAC_BODY,
  { analogSide: 1, textX: -40 },
);
