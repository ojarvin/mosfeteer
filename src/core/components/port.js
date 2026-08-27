import { defineSymbol } from './defineSymbol.js';

/**
 * Port symbols. A labeled box with a single terminal on its right edge.
 * Direction (input/output/inputoutput) is drawn as an arrow inside the box.
 * The port name is stored as the component value (e.g. "IN"/"OUT").
 * Input arrows point right (signal emitted into the circuit); output arrows
 * point left (signal enters the port); IO shows a double-headed arrow.
 */
function port(type, description, defaultValue, arrowGraphics) {
  return defineSymbol({
    type,
    description,
    refPrefix: '',
    terminals: [{ name: 'p', x: 0, y: 0, direction: 'port' }],
    bbox: { x: -40, y: -40, w: 40, h: 80 },
    graphics: [
      { kind: 'rect', x: -36, y: -16, w: 32, h: 32 },
      { kind: 'path', d: 'M -4 0 L 0 0' },
      ...arrowGraphics,
    ],
    textPos: { x: -20, y: 10, anchor: 'middle' },
    refPos: null,
    defaultValue,
  });
}

export const portInput = port('input', 'Input Port', 'IN', [
  { kind: 'path', d: 'M -26 -4 L -18 0 L -26 4 Z' },
]);

export const portOutput = port('output', 'Output Port', 'OUT', [
  { kind: 'path', d: 'M -16 -4 L -24 0 L -16 4 Z' },
]);

export const portInputOutput = port('inputoutput', 'Input/Output Port', 'IO', [
  { kind: 'path', d: 'M -30 -4 L -22 0 L -30 4 Z' },
  { kind: 'path', d: 'M -16 -4 L -24 0 L -16 4 Z' },
]);