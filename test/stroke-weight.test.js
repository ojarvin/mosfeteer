import test from 'node:test';
import assert from 'node:assert/strict';
import { getSymbol } from '../src/core/components/index.js';
import { strokeWidth, styleAttrs } from '../src/core/style.js';
import { weightedGraphics } from '../src/core/stroke-weight.js';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';

const bars = (graphics) => graphics.filter((g) => g.fill === 'foreground' && g.points.length === 4);
const span = (g, axis) => [Math.min(...g.points.map((p) => p[axis])), Math.max(...g.points.map((p) => p[axis]))];

test('a line width scales every stroke role in proportion: a heavier role stays heavier', () => {
  for (const base of ['symbol', 'wire', 'annotation']) {
    assert.equal(strokeWidth({ width: 'thin' }, base), 3);
    assert.equal(strokeWidth({ width: 'thick' }, base), 9);
  }
  assert.equal(strokeWidth({ width: 'thin' }, 'emph'), 4.8);
  assert.equal(strokeWidth({ width: 'thin' }, 'ground'), 5.8);
  assert.equal(strokeWidth({ width: 'thick' }, 'ground'), 17.4);
  assert.equal(strokeWidth({}, 'ground'), 11.6);
  assert.match(styleAttrs({ width: 'thin' }, 'ground'), /stroke-width="5.8"/);
});

test('a MOSFET drawn thin or thick keeps its bars on its leads and its gate gap open', () => {
  const graphics = getSymbol('nmos').graphics;
  assert.equal(weightedGraphics(graphics, undefined), graphics, 'normal width is the symbol as drawn');
  const [gate, channel] = bars(graphics);
  for (const width of ['thin', 'thick']) {
    const [g, c] = bars(weightedGraphics(graphics, width));
    // The edges the gate lead and the drain and source meet stay put.
    assert.equal(span(g, 'x')[1], span(gate, 'x')[1], `${width} gate keeps its inner edge`);
    assert.equal(span(c, 'x')[1], span(channel, 'x')[1], `${width} channel keeps the edge its leads meet`);
    const thickness = (bar) => span(bar, 'x')[1] - span(bar, 'x')[0];
    assert.ok(width === 'thin' ? thickness(c) < thickness(channel) : thickness(c) > thickness(channel));
    // The gap between the gate and the channel stays open.
    assert.ok(span(c, 'x')[0] - span(g, 'x')[1] > 5, `${width} gate gap`);
  }
  // The arrowhead keeps its tip on the source line.
  const arrow = (list) => list.find((g) => g.fill === 'foreground' && g.points.length === 3);
  const tip = (list) => arrow(list).points.find((p) => p.x === 0);
  assert.deepEqual(tip(weightedGraphics(graphics, 'thin')), tip(graphics));
});

test('an arrowhead a stroke ends at the base of scales about its base: the sampler\'s on its arc', () => {
  const graphics = getSymbol('sampler').graphics;
  const arrow = (list) => list.find((g) => g.fill === 'foreground').points;
  const middle = (points) => {
    const lengths = points.map((p, i) => Math.hypot(points[(i + 1) % 3].x - points[(i + 2) % 3].x, points[(i + 1) % 3].y - points[(i + 2) % 3].y));
    const tip = lengths.indexOf(Math.min(...lengths));
    const base = points.filter((_, i) => i !== tip);
    return { x: (base[0].x + base[1].x) / 2, y: (base[0].y + base[1].y) / 2 };
  };
  const before = middle(arrow(graphics));
  const after = middle(arrow(weightedGraphics(graphics, 'thin')));
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 1e-9);
});

test('a part drawn thin draws its filled shapes thinner too', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add nmos M1 --at 0 0');
  const normal = svgString(circuit);
  circuit.components.get('M1').style.width = 'thin';
  const thin = svgString(circuit);
  // The gate bar's outer edge moves in: -87.21 is drawn only at normal width.
  assert.match(normal, /-87\.21/);
  assert.doesNotMatch(thin, /-87\.21/);
});

test('a ring keeps its outer edge at any width, so a switch\'s arm still meets its pivot and its contact', () => {
  for (const type of ['switch_open', 'switch_closed', 'signal_sum']) {
    const graphics = getSymbol(type).graphics;
    const ring = (list) => list.find((g) => g.kind === 'circle');
    const outer = (g, width) => g.r + strokeWidth({ width }, g.style || 'symbol') / 2;
    for (const width of ['thin', 'thick']) {
      assert.ok(Math.abs(outer(ring(weightedGraphics(graphics, width)), width) - outer(ring(graphics), undefined)) < 1e-9, `${type} ${width}`);
    }
  }
});

test('a solder dot scales with the line width as an arrowhead does, keeping its weight thin', () => {
  const dot = (width) => weightedGraphics(getSymbol('solder').graphics, width)[0].r;
  assert.equal(dot(undefined), 12);
  assert.equal(dot('thin').toFixed(2), '8.49');
  assert.equal(dot('thick').toFixed(2), '14.70');
});

test('a thin sum\'s input arrowhead still meets its ring, whose outer edge stays put', () => {
  const circuit = new Circuit();
  for (const line of ['add input U --at -800 0', 'add signal_sum SUM1 --at 0 0', 'connect U.p SUM1.w']) runCommand(circuit, line);
  const tip = () => svgString(circuit).match(/<polygon points="([-\d.]+) /)[1];
  const normal = tip();
  circuit.components.get('SUM1').style.width = 'thin';
  assert.equal(tip(), normal);
});
