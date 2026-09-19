import { defineSymbol } from './defineSymbol.js';

const ADC_BODY = 'M 120 -100 L -40 -100 L -120 0 L -40 100 L 120 100 Z';
const DAC_BODY = 'M -120 -100 L 40 -100 L 120 0 L 40 100 L -120 100 Z';

function converter(type, description, text, terminals, body, signalMark) {
  return defineSymbol({
    type,
    description,
    refPrefix: 'U',
    terminals,
    bbox: { x: -200, y: -120, w: 400, h: 240 },
    graphics: [
      ...terminals.map(({ x, y }) => ({
        kind: 'path',
        d: `M ${x} ${y} L ${x < 0 ? -120 : 120} ${y}`,
        style: 'symbol',
      })),
      { kind: 'path', d: body, style: 'emph' },
      { kind: 'path', d: signalMark, style: 'symbol' },
      { kind: 'text', x: type === 'adc' ? 20 : -20, y: 0, text, anchor: 'middle', font: 'label', keepUpright: true },
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
  'M 154 -8 L 166 8',
);

export const dac = converter(
  'dac',
  'Digital-to-Analog Converter',
  'DAC',
  [{ name: 'd', x: -200, y: 0, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'aout', x: 200, y: 0, direction: 'output', dir: { x: 1, y: 0 } }],
  DAC_BODY,
  'M -166 8 L -154 -8',
);
