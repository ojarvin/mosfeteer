/** The Atlas desk's GPU reading of a design's export SVG (src/web/atlas-ink.js). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUTT, DISC, INK_FLOATS, JOINT, RING, ROUND, SEGMENT, SQUARE, TRIANGLE, flattenPath, mergeRuns, parseColor, parseTransform, svgInk, triangulate } from '../src/web/atlas-ink.js';
import { svgString } from '../src/core/render.js';
import { DRAWING_EXPORT_OPTIONS } from '../src/core/selection-drawing.js';
import { builtInDrawings } from '../src/core/arrange-builtins.js';

const drawing = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="-10 -20 200 100">${body}</svg>`;
const shapes = (ink) => Array.from({ length: ink.count }, (_, i) => Array.from(ink.data.subarray(i * INK_FLOATS, (i + 1) * INK_FLOATS)));
const near = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);

test('colors: hex, rgb, CSS variables by their fallback, and none', () => {
  assert.deepEqual(parseColor('#fff'), [1, 1, 1, 1]);
  assert.deepEqual(parseColor('#11223380').map((v) => Math.round(v * 255)), [17, 34, 51, 128]);
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), [1, 0, 0, 1]);
  assert.deepEqual(parseColor('rgba(0, 0, 255, 0.5)'), [0, 0, 1, 0.5]);
  assert.deepEqual(parseColor('var(--paper, #000)'), [0, 0, 0, 1]);
  assert.equal(parseColor('none'), null);
  assert.equal(parseColor('transparent'), null);
});

test('transforms compose as SVG reads them', () => {
  assert.ok(near(parseTransform('translate(10 20) scale(1 -1)'), [1, 0, 0, -1, 10, 20]));
  assert.ok(near(parseTransform('rotate(90 10 0)'), [0, 1, -1, 0, 10, -10]));
});

test('a path\'s curves and arcs end where they say, within the tolerance of the curve', () => {
  const [arc] = flattenPath('M 0 0 a 10 10 0 0 1 20 0');
  assert.ok(near(arc.points.at(-1), [20, 0]));
  // A half circle round (10, 0): every point 10 from it, on the side y < 0.
  for (const [x, y] of arc.points) assert.ok(Math.abs(Math.hypot(x - 10, y) - 10) < 0.1 && y <= 1e-9, `${x},${y}`);
  const [curve] = flattenPath('M 0 0 C 0 10 10 10 10 0 Z');
  assert.ok(near(curve.points.at(-1), [10, 0]));
  assert.equal(curve.closed, true);
  // Relative moves, H, V, and arc flags written without spaces.
  assert.deepEqual(flattenPath('m 5 5 h 10 v 10 H 0').map((s) => s.points), [[[5, 5], [15, 5], [15, 15], [0, 15]]]);
  assert.ok(near(flattenPath('M 0 0 a5 5 0 105 5')[0].points.at(-1), [5, 5]));
});

test('a fill is cut into triangles that cover it once, only its outline smoothed', () => {
  const square = triangulate([[0, 0], [10, 0], [10, 10], [0, 10]]);
  assert.equal(square.length, 2);
  const area = (t) => Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0])) / 2;
  assert.equal(square.reduce((sum, t) => sum + area(t), 0), 100);
  // Each outline edge is marked on exactly one triangle; the diagonal on neither.
  const outline = square.flatMap((t) => [0, 1, 2].filter((e) => t[3] & (1 << e)).map((e) => [t[e], t[(e + 1) % 3]].map((p) => p.join()).sort().join('|')));
  assert.equal(outline.length, 4);
  assert.equal(new Set(outline).size, 4);
  // A concave outline (an arrow's notch) is covered exactly too.
  const notch = triangulate([[0, 0], [20, 0], [20, 20], [10, 8], [0, 20]]);
  assert.ok(Math.abs(notch.reduce((sum, t) => sum + area(t), 0) - (400 - 120)) < 1e-9);
});

test('strokes become segments with their caps, a corner is cut across its mean direction, and hidden ink is left out', () => {
  const ink = svgInk(drawing(`
    <path d="M 0 0 L 100 0 L 100 50" stroke="#111" stroke-width="6" stroke-linecap="square" fill="none"/>
    <path d="M 0 0 L 9 9" stroke="#111" stroke-width="6" stroke-opacity="0" fill="none"><title>a hit area</title></path>
    <g transform="translate(10 10)" opacity="0.5"><line x1="0" y1="0" x2="10" y2="0" stroke="#000" stroke-width="2" stroke-linecap="round"/></g>`));
  const [first, second, line] = shapes(ink);
  assert.equal(ink.count, 3);
  // East then south: both cut across south-east (45°), where they meet in a miter.
  const corner = JOINT + 7 + Math.PI / 4;
  assert.ok(near(first.slice(0, 8), [0, 0, 100, 0, 3, SQUARE, corner, SEGMENT], 1e-5), String(first));
  assert.ok(near(second.slice(0, 8), [100, 0, 100, 50, 3, corner, SQUARE, SEGMENT], 1e-5), String(second));
  // Moved by its group and half as opaque, premultiplied.
  assert.deepEqual(line.slice(0, 8), [10, 10, 20, 10, 1, ROUND, ROUND, SEGMENT]);
  assert.ok(near(line.slice(8), [0, 0, 0, 0.5]));
  assert.deepEqual(ink.box, { x: -10, y: -20, w: 200, h: 100 });
});

test('a path\'s runs along one line that touch are one run: a wire and the pin lead it runs into', () => {
  // A wire ending at 120 and a lead from 123, both with square ends 3 wide: they overlap.
  const ink = svgInk(drawing('<path d="M 0 0 L 120 0 M 123 0 L 160 0 M 200 0 L 220 0" stroke="#111" stroke-width="6" stroke-linecap="square" fill="none"/>'));
  assert.deepEqual(shapes(ink).map((s) => s.slice(0, 7)), [[-3, 0, 163, 0, 3, BUTT, BUTT], [197, 0, 223, 0, 3, BUTT, BUTT]]);
  // A cut end (a corner's) and a round one stay; a run on another line is its own.
  assert.deepEqual(mergeRuns([[0, 0, 10, 0, JOINT, SQUARE], [12, 0, 20, 0, SQUARE, ROUND], [0, 5, 10, 5, BUTT, BUTT]], 3), [[0, 0, 20, 0, JOINT, ROUND], [0, 5, 10, 5, BUTT, BUTT]]);
  // A run drawn right to left comes out left to right: its corner's cut faces the other way.
  const [[, , , , cap0]] = mergeRuns([[20, 0, 12, 0, JOINT + 7 + Math.PI / 2, SQUARE], [0, 0, 10, 0, SQUARE, SQUARE]], 3);
  assert.equal(cap0, BUTT);
  const [[, , , , , cap1]] = mergeRuns([[20, 0, 12, 0, JOINT + 7 + Math.PI / 2, SQUARE], [0, 0, 13, 0, SQUARE, SQUARE]], 3);
  assert.ok(Math.abs(cap1 - (JOINT + 7 + 1.5 * Math.PI)) < 1e-9, String(cap1));
});

test('circles are discs and rings, dashes are cut, fills come before their strokes', () => {
  const ink = svgInk(drawing(`
    <circle cx="5" cy="5" r="4" fill="#fff" stroke="#111" stroke-width="2"/>
    <path d="M 0 0 L 30 0" stroke="#111" stroke-width="2" stroke-dasharray="10 5" fill="none"/>
    <rect x="0" y="0" width="10" height="10" fill="#111"/>`));
  const all = shapes(ink);
  assert.deepEqual(all.map((s) => s[7]), [DISC, RING, SEGMENT, SEGMENT, TRIANGLE, TRIANGLE]);
  assert.deepEqual(all[2].slice(0, 4), [0, 0, 10, 0]);
  assert.deepEqual(all[3].slice(0, 4), [15, 0, 25, 0]);
  assert.equal(all[2][5], BUTT);
});

test('the text drawing keeps text, math, and pictures, and only them', () => {
  const ink = svgInk(drawing(`
    <g transform="translate(1 2)"><path d="M 0 0 L 9 0" stroke="#111"><title>wire</title></path>
    <text x="0" y="0" font-size="20">R<tspan baseline-shift="sub">1</tspan></text></g>
    <foreignObject x="0" y="0" width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><math><mi>x</mi></math></div></foreignObject>`));
  assert.equal(ink.count, 1);
  assert.match(ink.textSvg, /<text x="0" y="0" font-size="20">R<tspan baseline-shift="sub">1<\/tspan><\/text>/);
  assert.match(ink.textSvg, /<foreignObject[^>]*><div[^>]*><math><mi>x<\/mi><\/math><\/div><\/foreignObject>/);
  assert.match(ink.textSvg, /<g transform="translate\(1 2\)">/);
  assert.doesNotMatch(ink.textSvg, /<path|<title/);
  assert.equal(svgInk(drawing('<path d="M 0 0 L 9 0" stroke="#111"/>')).textSvg, null);
});

test('every built-in drawing reads: its wires and parts as ink, its names as text', () => {
  for (const { circuit, name } of builtInDrawings()) {
    const ink = svgInk(svgString(circuit, { ...DRAWING_EXPORT_OPTIONS, background: false, emptyHint: false }));
    assert.ok(ink.count > 10, name);
    assert.ok(ink.data.every(Number.isFinite), name);
    assert.match(ink.textSvg, /<text/, name);
    assert.doesNotMatch(ink.textSvg, /<(path|circle|polygon|rect|line)\b/, name);
  }
});
