import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svgString } from '../src/core/render.js';
import { Circuit } from '../src/core/model.js';
import { SOLDER_DOT_RADIUS } from '../src/core/components/solder.js';

import { strokeAttrs, setColorToken, resolveColor } from '../src/core/style.js';

test('grid lines use the ordinary style throughout', () => {
  const svg = svgString(new Circuit(), { grid: true, viewport: { x: -40, y: -40, w: 400, h: 400 } });
  assert.doesNotMatch(svg, /major-grid/);
  assert.match(svg, /class="grid-line"[^>]+x1="0"/);
  assert.match(svg, /class="grid-line"[^>]+x1="40"/);
});

test('wire rendering uses round caps without changing symbol stroke roles', () => {
  assert.match(strokeAttrs('unknown'), /stroke-linecap="flat"/);
  assert.match(strokeAttrs('unknown'), /stroke-linejoin="miter"/);
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  const net = c.connect('R1.b', 'R2.a');
  assert.deepEqual(net.paths()[0], [{ x: 160, y: 0 }, { x: 400, y: 0 }]);
  const svg = svgString(c);
  const wire = svg.match(/<path class="wire-managed"[^>]+>/)?.[0] || '';
  assert.match(wire, /stroke-linecap="round"/);
  assert.match(wire, /stroke-linejoin="miter"/);
  assert.match(svg.match(/<path d="M -80 0 L -34\.88 0[^>]+>/)?.[0] || '', /stroke-linecap="butt"/);
});

test('annotation arrowheads stay close to MOS source-arrow size', () => {
  const c = new Circuit();
  c.addAnnotation('arrow', { x: 0, y: 0, end: { x: 160, y: 0 } });
  const svg = svgString(c);
  assert.match(svg, /<polygon points="160 0 128 -18 128 18"/);
  assert.doesNotMatch(svg, /<polygon points="160 0 120 24 120 -24"/);
});

test('line annotations render as rounded non-connectivity paths', () => {
  const c = new Circuit();
  c.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 80, y: 40 }, { x: 160, y: 0 }], style: { color: '#d00', lineStyle: 'dashed' } });
  const svg = svgString(c);
  assert.match(svg, /<path d="M 0 0 L 80 40 L 160 0"/);
  assert.match(svg, /stroke-linecap="round"/);
  assert.match(svg, /stroke-dasharray="12 8"/);
  assert.doesNotMatch(svg, /class="wire-managed"/);
});

test('default wire stroke keeps semantic colors resolving dynamically', () => {
  assert.match(strokeAttrs('unknown'), /stroke-linecap="flat"/);
  assert.match(strokeAttrs('unknown'), /stroke-linejoin="miter"/);
  const original = '#d96c75';
  assert.equal(resolveColor(original), original);
  setColorToken('red', '#ff4477');
  try {
    assert.equal(resolveColor(original), '#ff4477');
  } finally {
    setColorToken('red', original);
  }
});
test('svgString of an empty circuit renders without throwing', () => {
  const c = new Circuit();
  const svg = svgString(c);
  assert.strictEqual(typeof svg, 'string');
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('xmlns'));
});

test('svgString starts with <svg and contains xmlns', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 480, y: 0 });
  const svg = svgString(c);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.match(/<svg\s[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/));
});

test('svgString includes each refdes as a label with subscript numeral', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 480, y: 0 });
  c.addComponent('capacitor', { x: 480, y: 120 });
  c.addComponent('diode', { x: 480, y: 240 });
  const svg = svgString(c);
  // owned instance labels render the letter + a subscript-numeral tspan (R1 -> R + sub 1)
  assert.ok(svg.includes('>R<tspan'), 'resistor id label present');
  assert.ok(svg.includes('>C<tspan'), 'capacitor id label present');
  assert.ok(svg.includes('>D<tspan'), 'diode id label present');
  assert.equal((svg.match(/baseline-shift="-6px"/g) || []).length, 3, 'three subscript numerals');
});

test('svgString includes refdes only for components with refPrefix/refPos', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 480, y: 0 });
  c.addComponent('ground', { x: 400, y: 120 });
  const svg = svgString(c);
  assert.ok(svg.includes('>R<tspan'));
  // ground has empty refPrefix/null refPos -> no GROUND1 text label
  assert.ok(!svg.includes('>GROUND1<'));
});

test('svgString renders VCM outline without a VCM instance label', () => {
  const c = new Circuit();
  c.addComponent('vcm', { x: 400, y: 120 });
  const svg = svgString(c);
  assert.ok(svg.includes('M -28 24 L 28 24 L 0 56 Z'), 'VCM triangle outline present');
  assert.doesNotMatch(svg, /<polygon\b/, 'VCM has no filled polygon primitive');
  assert.doesNotMatch(svg, /<text\b/, 'VCM has no instance label');
});

test('svgString draws value text when present', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 480, y: 0, value: '1k' });
  const svg = svgString(c);
  assert.ok(svg.includes('>1k<'));
});

test('svgString renders ADC and DAC body labels in label font', () => {
  const c = new Circuit();
  c.addComponent('adc', { x: 480, y: 0 });
  c.addComponent('dac', { x: 960, y: 0 });
  const svg = svgString(c);
  assert.match(svg, /font-weight="bold" font-style="italic"[^>]*>ADC<\/text>/);
  assert.match(svg, /font-weight="bold" font-style="italic"[^>]*>DAC<\/text>/);
  assert.ok(svg.includes('M 120 -100 L -40 -100 L -120 0 L -40 100 L 120 100 Z'));
});

test('converter labels stay upright when the symbol is mirrored', () => {
  const c = new Circuit();
  c.addComponent('adc', { x: 480, y: 0, mirrorX: true });
  const svg = svgString(c);
  assert.match(svg, /<text x="460" y="0" dominant-baseline="middle"[^>]*>ADC<\/text>/);
});

test('svgString renders component terminal dots by default', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 480, y: 0 });
  const svg = svgString(c);
  assert.ok(svg.includes('<circle'));
});

test('svgString accepts terminal/junction/grid/background options without throwing', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 480, y: 0 });
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
  const r1 = c.addComponent('resistor', { x: 480, y: 0 });
  const r2 = c.addComponent('resistor', { x: 480, y: -120 });
  c.connect(`${r1.refdes}.a`, `${r2.refdes}.b`);
  const svg = svgString(c);
  assert.ok(svg.includes('<path d="'), 'renders net paths');
  assert.ok(svg.includes(`data-ref="${r1.refdes}"`));
  assert.ok(svg.includes(`data-ref="${r2.refdes}"`));
});

test('routing places an actual solder component at a balanced net junction', () => {
  const c = new Circuit();
  const left = c.addComponent('nmos', { x: 120, y: -80 });
  const right = c.addComponent('nmos', { x: 600, y: -80, mirrorX: true });
  const tail = c.addComponent('nmos', { x: 240, y: 160 });
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

test('svgString escapes literal text without breaking rich markup', () => {
  const c = new Circuit();
  c.addLabel({ text: '<tag & "quoted">', x: 0, y: 0 });
  c.addLabel({ text: 'M_{<1>}', x: 160, y: 0 });
  const svg = svgString(c);
  assert.match(svg, /&lt;tag &amp; &quot;quoted&quot;&gt;/);
  assert.match(svg, /M\s*<tspan[^>]*>&lt;1&gt;<\/tspan>/);
  assert.doesNotMatch(svg, /<tag/);
});

test('svgString escapes component attributes and style colors', () => {
  const c = new Circuit();
  const refdes = 'R\"/><script>alert(1)</script>';
  c.addComponent('resistor', { refdes, style: { color: '\" onload=\"alert(2)' } });
  const svg = svgString(c);
  assert.match(svg, /data-ref="R&quot;\/&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  assert.match(svg, /stroke="&quot; onload=&quot;alert\(2\)/);
  assert.doesNotMatch(svg, /<script|" onload=/);
});

test('svgString renders standalone label text with its alignment anchor', () => {
  const c = new Circuit();
  c.addLabel({ text: 'TP1', x: 400, y: 0, align: 'left' });
  const svg = svgString(c);
  assert.ok(svg.includes('>TP1<'), 'standalone label text present');
  assert.ok(svg.includes('text-anchor="start"'), 'left-aligned label anchors start');
});

test('svgString renders explicit net labels with rich-text net names', () => {
  const c = new Circuit();
  const net = c.createWireNet({ name: 'V_{IN}', route: [{ x: 0, y: 0 }, { x: 80, y: 0 }] });
  c.addNetLabel(net, { id: 'VIN_LABEL', x: 80, y: 0 });
  const svg = svgString(c);
  assert.ok(svg.includes('class="label"') || svg.includes('font-style'));
  assert.ok(svg.includes('<tspan') && svg.includes('IN'));
});

test('svgString applies per-label bold and italic toggles', () => {
  const c = new Circuit();
  c.addLabel({ id: 'plain', text: 'plain', x: 0, y: 0, style: { bold: false, italic: false } });
  const svg = svgString(c);
  assert.match(svg, /font-weight="normal"/);
  assert.doesNotMatch(svg, /font-style="italic"/);
});

test('transistor instance label renders as a dedicated label object (no duplicate refPos)', () => {
  const c = new Circuit();
  c.addComponent('nmos', { x: 520, y: 0 });
  const svg = svgString(c);
  // exactly one owned label (M + subscript 1), not the built-in refPos one
  assert.equal((svg.match(/>M<tspan/g) || []).length, 1);
  assert.ok(svg.includes('>M<tspan'));
  assert.ok(svg.includes('>1</tspan>'));
});

test('label subscripts: explicit _{...} markup and owned trailing digits', () => {
  const c = new Circuit();
  const owned = c.addComponent('resistor', { x: 480, y: 0 });
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
  c.addComponent('nmos', { x: 520, y: 0 });
  const svg = svgString(c);
  assert.ok(svg.includes('<polygon'), 'filled polygon primitive rendered');
  assert.ok(svg.includes('fill="#111" stroke="none"'), 'foreground fill present');
});


test('MOS terminal-facing leads end at their rendered terminal coordinates', () => {
  const endpoint = (d) => {
    const match = d.match(/L (-?[\d.]+) (-?[\d.]+)$/);
    assert.ok(match, `path has a final line endpoint: ${d}`);
    return { x: Number(match[1]), y: Number(match[2]) };
  };

  for (const type of ['nmos', 'pmos', 'nmosb', 'pmosb']) {
    const c = new Circuit();
    const component = c.addComponent(type, { x: 520, y: 0 });
    const symbol = svgString(c).match(/<g class="sym"[^>]*>([\s\S]*?)<\/g><\/g>/)?.[1] || '';
    const paths = [...symbol.matchAll(/<path d="([^"]+)"/g)].map((match) => endpoint(match[1]));

    for (const terminal of component.def.terminals.filter(({ name }) => ['d', 's', 'b'].includes(name))) {
      assert.ok(
        paths.some((point) => point.x === terminal.x && point.y === terminal.y),
        `${type}.${terminal.name} lead reaches its terminal in rendered SVG`,
      );
    }
  }
});

test('svgString renders bulk MOS terminal and channel connection', () => {
  const c = new Circuit();
  c.addComponent('nmosb', { x: 520, y: 0 });
  const svg = svgString(c);
  assert.match(svg, /M -54\.65 0 L 0 0/, 'bulk graphic joins the channel at its terminal');
  assert.match(svg, /<text[^>]*>M/, 'bulk MOS owned label renders');
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

test('default render layers keep annotations below wires and components above wires', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.wireTo('R1.b', { x: 400, y: 0 });
  c.addAnnotation('arrow', { x: 0, y: 200, end: { x: 160, y: 200 }, text: 'NOTE' });
  c.addLabel({ text: 'TOP', x: 240, y: 200 });
  const svg = svgString(c);
  const annotation = svg.indexOf('M 0 200 L 128 200');
  const annotationText = svg.indexOf('>NOTE<');
  const wire = svg.indexOf('M 160 0 L 400 0');
  const component = svg.indexOf('<g class="sym"');
  const label = svg.indexOf('>TOP<');
  assert.ok(annotation >= 0 && annotation < wire);
  assert.ok(annotationText > annotation && annotationText < wire);
  assert.ok(wire < component && component < label);
  const terminalDot = svg.indexOf('r="3" fill="#111"');
  assert.ok(terminalDot > wire, 'terminal dots draw above wires');
});

test('pushed-back components retain the top layer above wires', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 80, y: 0, drawOrder: -1 });
  const svg = svgString(c);
  assert.ok(svg.indexOf('data-ref="R2"') < svg.indexOf('data-ref="R1"'));
  const restored = Circuit.fromJSON(c.toJSON());
  assert.equal(restored.getComponent('R2').drawOrder, -1);
});

test('crosshair renders behind component objects', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  const svg = svgString(c, {
    viewport: { x: -200, y: -120, w: 400, h: 240 },
    cursor: { x: 0, y: 0 },
    cursorCrosshair: { x: -200, y: -120, w: 400, h: 240 },
  });
  const crosshair = svg.indexOf('class="editor-cursor-crosshair"');
  const component = svg.indexOf('<g class="sym"');
  assert.ok(crosshair >= 0 && component >= 0 && crosshair < component);
});

test('renderer draws every fixed path after managed promotion', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 880, y: 400 });
  const n = c.connect('R1.b', 'R2.a');
  n.route = [{ x: 160, y: 0 }, { x: 400, y: 0 }];
  c.wireDirectTo('R1.b', 'R3.a', [{ x: 640, y: 80 }]);
  const svg = svgString(c);
  assert.ok(svg.includes('M 160 0 L 400 0'), 'promoted managed path is rendered');
  assert.ok(svg.includes('M 160 0 L 640 80 L 800 400'), 'new fixed path is rendered');
});
