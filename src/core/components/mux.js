import { defineSymbol } from './defineSymbol.js';

/** Compact two-input, one-select multiplexer. */
export const mux2 = defineSymbol({
  type: 'mux2',
  description: '2:1 Multiplexer',
  refPrefix: 'U',
  terminals: [
    { name: 'a', x: -80, y: -40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'b', x: -80, y: 40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'y', x: 80, y: 0, direction: 'output', dir: { x: 1, y: 0 } },
    { name: 's', x: 0, y: 160, direction: 'input', dir: { x: 0, y: 1 } },
  ],
  // The body is two squares wide. Its left side is six squares tall and its
  // right side is four squares tall, leaving a shallow taper at each end.
  bbox: { x: -80, y: -120, w: 160, h: 280 },
  graphics: [
    { kind: 'path', d: 'M -80 -40 L -40 -40', style: 'symbol' },
    { kind: 'path', d: 'M -80 40 L -40 40', style: 'symbol' },
    { kind: 'path', d: 'M 40 0 L 80 0', style: 'symbol' },
    { kind: 'path', d: 'M 0 100 L 0 160', style: 'symbol' },
    { kind: 'path', d: 'M -40 -120 L 40 -80 L 40 80 L -40 120 Z', style: 'emph' },
    { kind: 'text', x: 0, y: -40, text: '0', anchor: 'middle', font: 'label', keepUpright: true },
    { kind: 'text', x: 0, y: 40, text: '1', anchor: 'middle', font: 'label', keepUpright: true },
  ],
  textPos: null,
  refPos: null,
  labelOffset: { x: 0, y: -160 },
  defaultValue: '',
});
