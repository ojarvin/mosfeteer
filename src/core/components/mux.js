import { defineSymbol } from './defineSymbol.js';
import { GRID } from '../grid.js';

/** The fewest and most inputs a multiplexer takes. */
export const MUX_MIN_INPUTS = 2;
export const MUX_MAX_INPUTS = 8;
/** Input pin names, the first selected by 0. */
export const MUX_INPUT_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const shapes = new Map();

/**
 * A multiplexer with `inputs` data inputs two cells apart, numbered from 0
 * at the top, and one select `s` below (a bus of enough bits past two
 * inputs). The output stays centered; more inputs make the body taller, never
 * wider. Built once per count, so every mux of one count shares one
 * definition.
 */
export function muxSymbol(inputs = MUX_MIN_INPUTS) {
  if (!shapes.has(inputs)) {
    // The left side reaches two cells past the outer inputs, the right one
    // cell less, leaving a shallow taper at each end.
    const left = (inputs + 1) * GRID;
    const right = left - GRID;
    const ys = MUX_INPUT_NAMES.slice(0, inputs).map((_, i) => (2 * i - (inputs - 1)) * GRID);
    shapes.set(inputs, defineSymbol({
      type: 'mux',
      description: 'Multiplexer',
      refPrefix: 'U',
      terminals: [
        ...ys.map((y, i) => ({ name: MUX_INPUT_NAMES[i], x: -2 * GRID, y, direction: 'input', dir: { x: -1, y: 0 } })),
        { name: 'y', x: 2 * GRID, y: 0, direction: 'output', dir: { x: 1, y: 0 } },
        { name: 's', x: 0, y: left + GRID, direction: 'input', dir: { x: 0, y: 1 } },
      ],
      bbox: { x: -2 * GRID, y: -left, w: 4 * GRID, h: 2 * left + GRID },
      graphics: [
        ...ys.map((y) => ({ kind: 'path', d: `M ${-2 * GRID} ${y} L ${-GRID} ${y}`, style: 'symbol' })),
        { kind: 'path', d: `M ${GRID} 0 L ${2 * GRID} 0`, style: 'symbol' },
        { kind: 'path', d: `M 0 ${left - GRID / 2} L 0 ${left + GRID}`, style: 'symbol' },
        { kind: 'path', d: `M ${-GRID} ${-left} L ${GRID} ${-right} L ${GRID} ${right} L ${-GRID} ${left} Z`, style: 'emph' },
        ...ys.map((y, i) => ({ kind: 'text', x: 0, y, text: String(i), anchor: 'middle', font: 'label', keepUpright: true })),
      ],
      textPos: null,
      refPos: null,
      labelOffset: { x: 0, y: -left - GRID },
      defaultValue: '',
    }));
  }
  return shapes.get(inputs);
}

/** The multiplexer as placed: two inputs, one select. */
export const mux = muxSymbol(MUX_MIN_INPUTS);
