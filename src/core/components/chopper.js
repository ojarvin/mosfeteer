import { defineSymbol } from './defineSymbol.js';
import { GRID } from '../grid.js';

const shapes = new Map();

/**
 * A chopper `w` wide and `h` tall: a box with its inputs on the top edge and
 * outputs on the bottom, each one cell in from a side, and its direct paths
 * and cross drawn as wire from pin to pin. Built once per size, so every chopper of one size
 * shares one definition. It carries no name label until it is named.
 */
export function chopperSymbol(w = 8 * GRID, h = 2 * GRID) {
  const key = `${w}x${h}`;
  if (!shapes.has(key)) {
    const x = w / 2 - GRID;
    const y = h / 2;
    shapes.set(key, defineSymbol({
      type: 'chopper',
      description: 'Chopper',
      refPrefix: 'CH',
      terminals: [
        { name: 'ip', x: -x, y: -y, direction: 'input', dir: { x: 0, y: -1 } },
        { name: 'im', x, y: -y, direction: 'input', dir: { x: 0, y: -1 } },
        { name: 'op', x: -x, y, direction: 'output', dir: { x: 0, y: 1 } },
        { name: 'om', x, y, direction: 'output', dir: { x: 0, y: 1 } },
      ],
      bbox: { x: -w / 2, y: -y, w, h },
      graphics: [
        { kind: 'rect', x: -w / 2, y: -y, w, h, style: 'emph' },
        { kind: 'path', d: `M ${-x} ${-y} L ${-x} ${y}`, style: 'wire' },
        { kind: 'path', d: `M ${x} ${-y} L ${x} ${y}`, style: 'wire' },
        { kind: 'path', d: `M ${-x} ${-y} L ${x} ${y}`, style: 'wire' },
        { kind: 'path', d: `M ${-x} ${y} L ${x} ${-y}`, style: 'wire' },
      ],
      textPos: null,
      refPos: null,
      labelOffset: { x: 0, y: -y - GRID },
      labelByDefault: false,
      defaultValue: '',
    }));
  }
  return shapes.get(key);
}

export const chopper = chopperSymbol();
