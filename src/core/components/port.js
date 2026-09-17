import { defineSymbol } from './defineSymbol.js';

function boxedPort(type, description, refPrefix, outline, options = {}) {
  return defineSymbol({
    type,
    description,
    refPrefix,
    ...options,
    terminals: [{ name: 'p', x: 0, y: 0, direction: 'port' }],
    bbox: { x: -80, y: -40, w: 80, h: 80 },
    graphics: [
      { kind: 'path', d: 'M 0 0 L -20 0', style: 'symbol' },
      { kind: 'path', d: outline, style: 'symbol' },
    ],
    textPos: null,
    refPos: null,
    labelOffset: { x: -120, y: 0 },
    defaultValue: '',
  });
}

export const portInput = boxedPort(
  'input',
  'Input Port',
  'VI',
  'M -20 0 L -40 -20 L -80 -20 L -80 20 L -40 20 L -20 0',
);
export const portOutput = boxedPort(
  'output',
  'Output Port',
  'VO',
  'M -20 0 L -20 -20 L -60 -20 L -80 0 L -60 20 L -20 20 L -20 0',
  { defaultMirrorX: true },
);
export const portInputOutput = boxedPort(
  'inputoutput',
  'Input/Output Port',
  'VIO',
  'M -20 0 L -40 -20 L -60 -20 L -80 0 L -60 20 L -40 20 L -20 0',
);


/**
 * Textbook terminal marker: a small open circle on a lead. It is an interface
 * pin like the boxed ports, with an owned name label that names its net.
 */
export const port = defineSymbol({
  type: 'port',
  description: 'Port',
  refPrefix: 'P',
  terminals: [{ name: 'p', x: 0, y: 0, direction: 'port' }],
  bbox: { x: -80, y: -40, w: 80, h: 80 },
  graphics: [
    { kind: 'circle', cx: -68.35, cy: 0, r: 9.92, style: 'symbol' },
    { kind: 'path', d: 'M 0 0 L -58.4 0', style: 'symbol' },
  ],
  textPos: null,
  refPos: null,
  labelOffset: { x: -120, y: 0 },
  defaultValue: '',
});
