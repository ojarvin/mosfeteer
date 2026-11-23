import { defineSymbol } from './defineSymbol.js';
import { inductor } from './inductor.js';

/** The inductor's coil turned vertical, its axis at x = `axis`, running from
 *  y = -80 down to y = 80: `side` -1 is the inductor turned clockwise (as an
 *  inductor at `r` 1 draws), 1 its mirror image about the axis. */
function verticalCoil(axis, side) {
  const numbers = inductor.graphics[0].d.match(/-?\d*\.?\d+/g).map(Number);
  let i = 0;
  return inductor.graphics[0].d.replace(/-?\d*\.?\d+\s+-?\d*\.?\d+/g, () => {
    const x = numbers[i++];
    const y = numbers[i++];
    return `${+(axis + side * y).toFixed(2)} ${x}`;
  });
}

/** Radius of a polarity dot. */
export const TRANSFORMER_DOT_RADIUS = 7;

/**
 * Transformer (textbook style): two of the inductor's coils side by side, the
 * secondary the primary's mirror image, two core lines between them, and a
 * dot at each a-end. The primary
 * runs a1 (top) to b1 (bottom) on the left, the secondary a2 to b2 on the
 * right. Drawing only: no analysis models it.
 */
export const transformer = defineSymbol({
  type: 'transformer',
  description: 'Transformer',
  refPrefix: 'T',
  terminals: [
    { name: 'a1', x: -80, y: -80, direction: 'passive', dir: { x: 0, y: -1 } },
    { name: 'b1', x: -80, y: 80, direction: 'passive', dir: { x: 0, y: 1 } },
    { name: 'a2', x: 80, y: -80, direction: 'passive', dir: { x: 0, y: -1 } },
    { name: 'b2', x: 80, y: 80, direction: 'passive', dir: { x: 0, y: 1 } },
  ],
  bbox: { x: -120, y: -80, w: 240, h: 160 },
  graphics: [
    { kind: 'path', d: verticalCoil(-80, -1), style: 'symbol' },
    { kind: 'path', d: verticalCoil(80, 1), style: 'symbol' },
    { kind: 'path', d: 'M -12 -44 L -12 44', style: 'symbol' },
    { kind: 'path', d: 'M 12 -44 L 12 44', style: 'symbol' },
    { kind: 'dot', cx: -58, cy: -54, r: TRANSFORMER_DOT_RADIUS },
    { kind: 'dot', cx: 58, cy: -54, r: TRANSFORMER_DOT_RADIUS },
  ],
  textPos: null,
  refPos: null,
  labelOffset: { x: 0, y: -120 },
  defaultValue: '',
});
