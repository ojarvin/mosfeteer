import { defineSymbol } from './defineSymbol.js';

const SOURCE_TERMINALS = [
  { name: 'a', x: 0, y: -80, direction: 'positive', dir: { x: 0, y: -1 } },
  { name: 'b', x: 0, y: 80, direction: 'negative', dir: { x: 0, y: 1 } },
];

function source(type, description, refPrefix, graphics) {
  return defineSymbol({
    type,
    description,
    refPrefix,
    terminals: SOURCE_TERMINALS,
    bbox: { x: -40, y: -80, w: 80, h: 160 },
    graphics,
    textPos: { x: 0, y: -52, anchor: 'middle' },
    refPos: null,
    labelOffset: { x: -80, y: 0 },
    defaultValue: '',
  });
}

/** A current source's arrow, centered: the stem runs into the head, so its
 *  butt end never meets the head's base and leaves an anti-aliased seam. */
export const CURRENT_ARROW = Object.freeze([
  { kind: 'path', d: 'M 0 -18 L 0 2', style: 'symbol' },
  { kind: 'polygon', points: [{ x: 0, y: 18 }, { x: -11, y: -4 }, { x: 11, y: -4 }], fill: 'foreground' },
]);

export const current_source = source('current_source', 'Current Source', 'I', [
    { kind: 'circle', cx: 0, cy: 0, r: 35, style: 'symbol' },
    ...CURRENT_ARROW.map((item) => ({ ...item, ...(item.points ? { points: item.points.map((p) => ({ ...p })) } : {}) })),
    { kind: 'path', d: 'M 0 -35 L 0 -80', style: 'symbol' },
    { kind: 'path', d: 'M 0 35 L 0 80', style: 'symbol' },
]);

export const voltage_source = source('voltage_source', 'Voltage Source', 'V', [
    { kind: 'circle', cx: 0, cy: 0, r: 35, style: 'symbol' },
    { kind: 'path', d: 'M -80.23 -58.14 L -47.67 -58.14', style: 'symbol' },
    { kind: 'path', d: 'M -63.95 -74.42 L -63.95 -41.86', style: 'symbol' },
    { kind: 'path', d: 'M -80.23 53.49 L -47.67 53.49', style: 'symbol' },
    { kind: 'path', d: 'M 0 -35 L 0 -80', style: 'symbol' },
    { kind: 'path', d: 'M 0 35 L 0 80', style: 'symbol' },
]);

/**
 * What a voltage source may show inside its circle (ComponentInstance#waveform):
 * a period of a sine, a pulse, or a noise squiggle -- drawn only, it changes
 * nothing the analysis reads. None leaves the circle empty.
 */
export const SOURCE_WAVEFORMS = Object.freeze({
  sine: [{ kind: 'path', d: 'M -22 0 C -14.7 -17 -7.3 -17 0 0 C 7.3 17 14.7 17 22 0', style: 'line' }],
  pulse: [{ kind: 'path', d: 'M -22 12 L -10 12 L -10 -12 L 10 -12 L 10 12 L 22 12', style: 'line' }],
  noise: [{ kind: 'path', d: 'M -23 1 L -16 -9 L -10 6 L -4 -13 L 2 10 L 8 -6 L 14 12 L 23 -2', style: 'line', miterLimit: 1 }],
});
export const WAVEFORM_TYPES = new Set(['voltage_source']);
