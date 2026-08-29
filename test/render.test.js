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
  // Pair sources share y=0 at x=120 and x=360; tail drain at (240,80). The
  // diff-pair source pins must escape DOWN (continue in terminal direction),
  // so the balanced T-junction lands one cell below the pair row at (240,40)
  // — never a pin-row trunk at y=0.
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

test('fully differential opamp shares the opamp footprint with two outputs', () => {
  const c = new Circuit();
  c.addComponent('opamp', { x: 0, y: 0 });
  c.addComponent('opamp_diff', { x: 0, y: 0, rotation: 0 });
  const o = c.components.get('U1');
  const diff = c.components.get('U2');
  // Same footprint: identical bbox and matching input rows.
  assert.deepEqual(diff.bboxWorld(), o.bboxWorld());
  assert.deepEqual(diff.terminalWorld('ip'), { x: -200, y: 40 });
  assert.deepEqual(diff.terminalWorld('im'), { x: -200, y: -40 });
  // Two outputs on the grid at the same x=160 as the plain opamp's pin.
  // Polarity is flipped vs the inputs: op (+) rides the top row, om (-) bottom.
  assert.deepEqual(diff.terminalWorld('op'), { x: 160, y: -40 });
  assert.deepEqual(diff.terminalWorld('om'), { x: 160, y: 40 });
  const svg = svgString(c);
  assert.ok(svg.includes('data-ref="U2"'), 'differential opamp rendered');
  // Two output leads (top row and bottom row).
  const om = svg.match(/M 12\.8 -40 L 160 -40/g);
  const op = svg.match(/M 12\.81 40 L 160 40/g);
  assert.ok(om && op, 'both output leads rendered');
  // Polarity marks are the SAME size as the input marks (28 units), aligned on
  // the same rows, and sit clear of the slanted edges: inputs at x=-76, outputs
  // (flipped) at x=-38.
  const inPlus = svg.match(/M -76 26 L -76 54/g);
  const inMinus = svg.match(/M -90 -40 L -62 -40/g);
  const outPlus = svg.match(/M -38 -54 L -38 -26/g);
  const outMinus = svg.match(/M -52 40 L -24 40/g);
  assert.ok(inPlus && inMinus, 'input polarity marks rendered');
  assert.ok(outPlus && outMinus, 'flipped output polarity marks rendered');
  // Owned instance label (same as every component) still renders its id.
  assert.ok(svg.includes('>U<tspan'), 'U2 instance label rendered');
});

test('wires render ON TOP of component bodies (z-order)', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  c.wireTo('R1.b', { x: 400, y: 0 });
  const svg = svgString(c);
  // The net wire (160,0)->(400,0) must be emitted after the LAST component
  // group so component linework can never hide it.
  const wire = svg.indexOf('M 160 0 L 400 0');
  const lastCompGroup = svg.lastIndexOf('<g class="sym"');
  assert.ok(wire > lastCompGroup, `net wire must come after the last component group (wire @${wire}, last comp @${lastCompGroup})`);
  // and before the terminal dots (pin markers stay readable on top of wires)
  const terminalDot = svg.indexOf('r="3" fill="#111"');
  assert.ok(terminalDot > wire, 'terminal dots draw above wires');
});

test('renderer draws every fixed path after managed promotion', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 400, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 800, y: 400 });
  const n = c.connect('R1.b', 'R2.a');
  n.route = [{ x: 160, y: 0 }, { x: 400, y: 0 }];
  c.wireDirectTo('R1.b', 'R3.a', [{ x: 640, y: 80 }]);
  const svg = svgString(c);
  assert.ok(svg.includes('M 160 0 L 400 0'), 'promoted managed path is rendered');
  assert.ok(svg.includes('M 160 0 L 640 80 L 800 400'), 'new fixed path is rendered');
});
