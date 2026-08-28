import { defineSymbol } from './defineSymbol.js';

/**
 * Port symbols. A labeled box with a single terminal on its right edge.
 * Direction (input/output/inputoutput) is drawn as an arrow inside the box.
 * The port name is the component's refdes and is rendered as a dedicated
 * owned LabelInstance (I1 / O1 / IO1 by default, or a custom name such as
 * VINP). No font-12 value text is drawn — identifiers use label objects.
 * Input arrows point right (signal emitted into the circuit); output arrows
 * point left (signal enters the port); IO shows a double-headed arrow.
 */
function makePort(type, description, prefix, arrowGraphics) {
  return defineSymbol({
    type,
    description,
    refPrefix: prefix,
    terminals: [{ name: 'p', x: 0, y: 0, direction: 'port' }],
    bbox: { x: -40, y: -40, w: 40, h: 80 },
    graphics: [
      { kind: 'rect', x: -36, y: -16, w: 32, h: 32 },
      { kind: 'path', d: 'M -4 0 L 0 0' },
      ...arrowGraphics,
    ],
    textPos: null,
    refPos: null,
    // Instance label sits one square below the port box; the offset mirrors
    // with mirrorX (ports mirrored on the right edge keep their label on the
    // outer side), and the label always lands in open space under the pin.
    labelOffset: { x: 0, y: 80 },
    defaultValue: '',
  });
}

export const portInput = makePort('input', 'Input Port', 'I', [
  { kind: 'path', d: 'M -26 -4 L -18 0 L -26 4 Z' },
]);

export const portOutput = makePort('output', 'Output Port', 'O', [
  { kind: 'path', d: 'M -16 -4 L -24 0 L -16 4 Z' },
]);

export const portInputOutput = makePort('inputoutput', 'Input/Output Port', 'IO', [
  { kind: 'path', d: 'M -30 -4 L -22 0 L -30 4 Z' },
  { kind: 'path', d: 'M -16 -4 L -24 0 L -16 4 Z' },
]);

/**
 * Razavi-style terminal markers: a small circle (open or filled) on a lead,
 * used as a generic node/pin stub (no label box).
 */
const marker = (type, description, filled) =>
  defineSymbol({
    type,
    description,
    refPrefix: '',
    terminals: [{ name: 'p', x: 0, y: 0, direction: 'port' }],
    bbox: { x: -80, y: -40, w: 80, h: 80 },
    graphics: [
      filled
        ? { kind: 'dot', cx: -68.35, cy: 0, r: 9.92 }
        : { kind: 'circle', cx: -68.35, cy: 0, r: 9.92, style: 'symbol' },
      { kind: 'path', d: 'M 0 0 L -58.4 0', style: 'symbol' },
    ],
    textPos: null,
    refPos: null,
    defaultValue: '',
  });

export const port = marker('port', 'Port (terminal)', false);
export const port_filled = marker('port_filled', 'Port (filled terminal)', true);