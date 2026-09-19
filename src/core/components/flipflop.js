import { defineSymbol } from './defineSymbol.js';

const BODY = Object.freeze({ x: -40, y: -80, w: 80, h: 160 });
const BUBBLE_RADIUS = 13.5;

/** Build a compact D flip-flop or level-sensitive latch with optional active-low pins. */
function makeSequential(type, description, { latch = false, invertedClock = false, invertedReset = false, complementaryOutput = false } = {}) {
  const data = latch ? 'L' : 'D';
  const clock = latch
    ? (invertedClock ? 'ENB' : 'EN')
    : (invertedClock ? 'CLKB' : 'CLK');
  const reset = invertedReset ? 'RSTB' : 'RST';
  const terminals = [
    { name: data, x: -80, y: -40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: clock, x: -80, y: 40, direction: 'input', dir: { x: -1, y: 0 } },
    { name: 'Q', x: 80, y: -40, direction: 'output', dir: { x: 1, y: 0 } },
    ...(complementaryOutput
      ? [{ name: 'QB', x: 80, y: 40, direction: 'output', dir: { x: 1, y: 0 } }]
      : []),
    { name: reset, x: 0, y: 120, direction: 'input', dir: { x: 0, y: 1 } },
  ];

  const graphics = [
    { kind: 'rect', x: BODY.x, y: BODY.y, w: BODY.w, h: BODY.h, style: 'emph' },
    { kind: 'path', d: 'M -80 -40 L -40 -40', style: 'symbol' },
    { kind: 'path', d: 'M -80 40 L -40 40', style: 'symbol' },
    { kind: 'path', d: 'M 40 -40 L 80 -40', style: 'symbol' },
    ...(complementaryOutput ? [{ kind: 'path', d: 'M 40 40 L 80 40', style: 'symbol' }] : []),
    { kind: 'path', d: 'M 0 80 L 0 120', style: 'symbol' },
    ...(!latch ? [
      // Rising-edge clock marker, with both ends on the body edge so it remains
      // part of the symbol when the component is transformed.
      { kind: 'path', d: 'M -40 24 L -8 40 L -40 56', style: 'symbol' },
    ] : []),
    { kind: 'text', x: 0, y: -40, text: data, anchor: 'middle', font: 'label', keepUpright: true },
  ];

  if (invertedClock) graphics.push({ kind: 'circle', cx: -54, cy: 40, r: BUBBLE_RADIUS, style: 'emph' });
  if (invertedReset) graphics.push({ kind: 'circle', cx: 0, cy: 94, r: BUBBLE_RADIUS, style: 'emph' });
  if (complementaryOutput) graphics.push({ kind: 'circle', cx: 54, cy: 40, r: BUBBLE_RADIUS, style: 'emph' });

  return defineSymbol({
    type,
    description,
    refPrefix: 'U',
    terminals,
    bbox: { x: -80, y: -80, w: 160, h: 200 },
    graphics,
    textPos: null,
    refPos: null,
    labelOffset: { x: 0, y: -120 },
    defaultValue: '',
  });
}

export const dff = makeSequential('dff', 'D flip-flop', {});
export const dff_qb = makeSequential('dff_qb', 'D flip-flop with complementary output', { complementaryOutput: true });
export const dff_clkb = makeSequential('dff_clkb', 'D flip-flop with inverted clock', { invertedClock: true });
export const dff_clkb_qb = makeSequential('dff_clkb_qb', 'D flip-flop with inverted clock and complementary output', { invertedClock: true, complementaryOutput: true });
export const dff_rstb = makeSequential('dff_rstb', 'D flip-flop with inverted reset', { invertedReset: true });
export const dff_rstb_qb = makeSequential('dff_rstb_qb', 'D flip-flop with inverted reset and complementary output', { invertedReset: true, complementaryOutput: true });
export const dff_clkb_rstb = makeSequential('dff_clkb_rstb', 'D flip-flop with inverted clock and reset', { invertedClock: true, invertedReset: true });
export const dff_clkb_rstb_qb = makeSequential('dff_clkb_rstb_qb', 'D flip-flop with inverted clock and reset and complementary output', { invertedClock: true, invertedReset: true, complementaryOutput: true });

export const latch = makeSequential('latch', 'L latch', { latch: true });
export const latch_qb = makeSequential('latch_qb', 'L latch with complementary output', { latch: true, complementaryOutput: true });
export const latch_enb = makeSequential('latch_enb', 'L latch with inverted enable', { latch: true, invertedClock: true });
export const latch_enb_qb = makeSequential('latch_enb_qb', 'L latch with inverted enable and complementary output', { latch: true, invertedClock: true, complementaryOutput: true });
export const latch_rstb = makeSequential('latch_rstb', 'L latch with inverted reset', { latch: true, invertedReset: true });
export const latch_rstb_qb = makeSequential('latch_rstb_qb', 'L latch with inverted reset and complementary output', { latch: true, invertedReset: true, complementaryOutput: true });
export const latch_enb_rstb = makeSequential('latch_enb_rstb', 'L latch with inverted enable and reset', { latch: true, invertedClock: true, invertedReset: true });
export const latch_enb_rstb_qb = makeSequential('latch_enb_rstb_qb', 'L latch with inverted enable and reset and complementary output', { latch: true, invertedClock: true, invertedReset: true, complementaryOutput: true });
