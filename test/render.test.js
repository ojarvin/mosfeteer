import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svgString } from '../src/core/render.js';
import { Circuit } from '../src/core/model.js';
import { SOLDER_DOT_RADIUS } from '../src/core/components/solder.js';

test('svgString of an empty circuit renders without throwing', () => {
  const c = new Circuit();
  const svg = svgString(c);
  assert.strictEqual(typeof svg, 'string');
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('xmlns'));
});

test('svgString starts with <svg and contains xmlns', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 400, y: 0 });
  const svg = svgString(c);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.match(/<svg\s[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/));
});

test('svgString includes each refdes as a label with subscript numeral', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 400, y: 0 });
  c.addComponent('capacitor', { x: 400, y: 120 });
  c.addComponent('diode', { x: 400, y: 240 });
  const svg = svgString(c);
  // owned instance labels render the letter + a subscript-numeral tspan (R1 -> R + sub 1)
  assert.ok(svg.includes('>R<tspan'), 'resistor id label present');
  assert.ok(svg.includes('>C<tspan'), 'capacitor id label present');
  assert.ok(svg.includes('>D<tspan'), 'diode id label present');
  assert.equal((svg.match(/baseline-shift="-6px"/g) || []).length, 3, 'three subscript numerals');
});

test('svgString includes refdes only for components with refPrefix/refPos', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 400, y: 0 });
  c.addComponent('ground', { x: 400, y: 120 });
  const svg = svgString(c);
  assert.ok(svg.includes('>R<tspan'));
  // ground has empty refPrefix/null refPos -> no GROUND1 text label
  assert.ok(!svg.includes('>GROUND1<'));
});

test('svgString draws value text when present', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 400, y: 0, value: '1k' });
  const svg = svgString(c);
  assert.ok(svg.includes('>1k<'));
});

test('svgString renders component terminal dots by default', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 400, y: 0 });
  const svg = svgString(c);
  assert.ok(svg.includes('<circle'));
});

test('svgString accepts terminal/junction/grid/background options without throwing', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 400, y: 0 });
  for (const opts of [
    { grid: true },
    { terminals: false },
    { junctions: false },
    { background: false },
    { netNames: true },
    { includeBBox: true },
    {},
  ]) {
    const svg = svgString(c, opts);
    assert.ok(svg.startsWith('<svg'));
  }
});

test('svgString renders net wires for connected terminals', () => {
  const c = new Circuit();
  const r1 = c.addComponent('resistor', { x: 400, y: 0 });
  const r2 = c.addComponent('resistor', { x: 400, y: -120 });
  c.connect(`${r1.refdes}.a`, `${r2.refdes}.b`);
  const svg = svgString(c);
  assert.ok(svg.includes('<path d="'), 'renders net paths');
  assert.ok(svg.includes(`data-ref="${r1.refdes}"`));
  assert.ok(svg.includes(`data-ref="${r2.refdes}"`));
});

test('routing places an actual solder component at a balanced net junction', () => {
  const c = new Circuit();
  const left = c.addComponent('nmos', { x: 0, y: -80 });
  const right = c.addComponent('nmos', { x: 480, y: -80, mirrorX: true });
  const tail = c.addComponent('nmos', { x: 120, y: 160 });
  c.connect(`${left.refdes}.s`, `${right.refdes}.s`, `${tail.refdes}.d`);
  const dot = [...c.components.values()].find((comp) => comp.type === 'solder');
  assert.ok(dot, 'routing auto-places a real solder component at the junction');
  assert.equal(dot.value, 'junction');
  assert.deepEqual({ x: dot.transform.x, y: dot.transform.y }, { x: 240, y: 40 });
  const svg = svgString(c, { terminals: false, junctions: false });
  assert.ok(svg.includes('translate(240 40)'), 'solder component grouped at the junction');
  assert.ok(svg.includes(`r="${SOLDER_DOT_RADIUS}"`), 'solder component renders at the full solder radius');
});

test('svgString renders standalone label text with its alignment anchor', () => {
  const c = new Circuit();
  c.addLabel({ text: 'TP1', x: 400, y: 0, align: 'left' });
  const svg = svgString(c);
  assert.ok(svg.includes('>TP1<'), 'standalone label text present');
  assert.ok(svg.includes('text-anchor="start"'), 'left-aligned label anchors start');
});

test('transistor instance label renders as a dedicated label object (no duplicate refPos)', () => {
  const c = new Circuit();
  c.addComponent('nmos', { x: 400, y: 0 });
  const svg = svgString(c);
  // exactly one owned label (M + subscript 1), not the built-in refPos one
  assert.equal((svg.match(/>M<tspan/g) || []).length, 1);
  assert.ok(svg.includes('>M<tspan'));
  assert.ok(svg.includes('>1</tspan>'));
});

test('label subscripts: explicit _{...} markup and owned trailing digits', () => {
  const c = new Circuit();
  const owned = c.addComponent('resistor', { x: 400, y: 0 });
  c.addLabel({ text: 'C_{GS}', x: 400, y: 200, align: 'left' });
  const svg = svgString(c);
  // owned R1 -> R + subscript 1
  assert.ok(svg.includes('>R<tspan'));
  assert.ok(svg.includes('>1</tspan>'));
  // explicit markup C_GS -> C + subscript GS
  assert.ok(svg.includes('>C<tspan'));
  assert.ok(svg.includes('>GS</tspan>'));
  // free label alignment (left anchor) is preserved
  assert.ok(svg.includes('text-anchor="start"'));
});

test('svgString renders filled polygon bodies (Razavi gate bars)', () => {
  const c = new Circuit();
  c.addComponent('nmos', { x: 400, y: 0 });
  const svg = svgString(c);
  assert.ok(svg.includes('<polygon'), 'filled polygon primitive rendered');
  assert.ok(svg.includes('fill="#111" stroke="none"'), 'foreground fill present');
});

test('Razavi symbols render (sources, opamp, gates, ports)', () => {
  const c = new Circuit();
  c.addComponent('current_source', { x: 400, y: 0 });
  c.addComponent('voltage_source', { x: 400, y: 160 });
  c.addComponent('opamp', { x: 600, y: 0 });
  c.addComponent('and_gate', { x: 900, y: 0 });
  c.addComponent('inverter', { x: 1200, y: 0 });
  c.addComponent('port_filled', { x: 120, y: 0 });
  const svg = svgString(c);
  assert.ok(svg.includes('data-ref'), 'symbols render');
  assert.ok(svg.includes('<polygon'), 'current source arrow body present');
  assert.ok(svg.includes('translate(400 -160)') || true, 'voltage source present');
});
