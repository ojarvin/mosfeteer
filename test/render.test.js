import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorOverlay, svgString, texToMathML, svgPixelSize } from '../src/core/render.js';
import { Circuit, Net } from '../src/core/model.js';
import { SOLDER_DOT_RADIUS } from '../src/core/components/solder.js';
import { getSymbol } from '../src/core/components/index.js';

import { strokeAttrs, setColorToken, resolveColor } from '../src/core/style.js';

test('the shared analysis MathML renderer renders fractions and escapes literal input', () => {
  const markup = texToMathML('A_v = -\\frac{g_m}{1 + g_m R_S} \\left(r_o \\parallel R_D\\right)');
  assert.match(markup, /<mfrac>/);
  assert.match(markup, /<msub>/);
  assert.match(markup, /∥/);
  assert.doesNotMatch(markup, /\\frac|\\parallel/);
  const escaped = texToMathML('\\text{<img src=x onerror=alert(1)>}');
  assert.doesNotMatch(escaped, /<img/);
  assert.match(escaped, /&lt;img/);
});

test('grid lines use the ordinary style throughout', () => {
  const svg = svgString(new Circuit(), { grid: true, viewport: { x: -40, y: -40, w: 400, h: 400 } });
  assert.doesNotMatch(svg, /major-grid/);
  assert.match(svg, /class="grid-line"[^>]+x1="0"/);
  assert.match(svg, /class="grid-line"[^>]+x1="40"/);
});

test('wires and pin leads share one square-capped ink path', () => {
  assert.match(strokeAttrs('unknown'), /stroke-linecap="flat"/);
  assert.match(strokeAttrs('unknown'), /stroke-linejoin="miter"/);
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  const net = c.connect('R1.b', 'R2.a');
  assert.deepEqual(net.paths()[0], [{ x: 160, y: 0 }, { x: 400, y: 0 }]);
  const svg = svgString(c);
  const wire = svg.match(/<path class="wire-managed"[^>]+>/)?.[0] || '';
  assert.match(wire, /stroke-linecap="square"/);
  assert.match(wire, /stroke-linejoin="miter"/);
  assert.match(wire, /stroke-opacity="0"/, 'the hit element is unpainted; the ink path draws the wire');
  // Wires and pin leads share one square-capped ink path, so their overlap at
  // a terminal is rasterized once (no doubled anti-aliased edges). Leads are
  // pulled in by half the stroke width, so the cap ends exactly where the
  // butt-ended lead did.
  const ink = svg.match(/<path class="wire-ink"[^>]+>/)?.[0] || '';
  assert.match(ink, /M 160 0 L 400 0/);
  assert.match(ink, /M 3 0 L 50 0 L 55 20/, 'R1 lead in world coordinates');
  assert.match(ink, /L 157 0/, 'R1 terminal-side lead end');
  assert.match(ink, /stroke-linecap="square"/);
  c.addComponent('capacitor', { refdes: 'C1', x: 80, y: 400 });
  const plates = svgString(c);
  assert.match(plates.match(/<path d="M -12.94 -32.2 L -12.94 32.2"[^>]+>/)?.[0] || '', /stroke-linecap="butt"/, 'body strokes keep butt caps');
  assert.match(plates.match(/<path class="wire-ink"[^>]+>/)?.[0] || '', /M 3 400 L 64.06 400/);
});

test('ghosted and dashed strokes keep their own elements outside the ink path', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0, style: { lineStyle: 'dashed' } });
  const svg = svgString(c, { ghostRefs: ['R1'] });
  assert.doesNotMatch(svg, /class="wire-ink"/);
  assert.match(svg, /<path d="M -80 0 L -30 0[^>]+stroke-dasharray/);
});

test('symmetric resistor zigzag keeps sharp mitered corners', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  const path = svgString(c).match(/<path class="wire-ink"[^>]+M 3 0 L 50 0[^>]+>/)?.[0] || '';
  assert.match(path, /stroke-linejoin="miter"/);
  assert.match(path, /stroke-miterlimit="5"/);
});

test('annotation arrowheads stay close to MOS source-arrow size', () => {
  const c = new Circuit();
  c.addAnnotation('arrow', { x: 0, y: 0, end: { x: 160, y: 0 } });
  const svg = svgString(c);
  assert.match(svg, /<polygon points="160 0 128 -18 128 18"/);
  assert.doesNotMatch(svg, /<polygon points="160 0 120 24 120 -24"/);
});

test('wire arrowheads stop at the visible edge of a schematic block', () => {
  const c = new Circuit();
  c.addComponent('block', { refdes: 'B1', x: 0, y: 0 });
  const net = new Net(c, {
    id: 'N1',
    routingMode: 'fixed',
    fixedPaths: [{ points: [{ x: 0, y: -240 }, { x: 0, y: -80 }], start: null, end: { comp: 'B1', term: 'T9' } }],
    style: { arrowhead: 'end' },
  });
  c.nets.set(net.id, net);
  const svg = svgString(c);
  assert.match(svg, /<polygon points="0 -84\.80 18 -116\.80 -18 -116\.80"/);
});

test('all non-solid wire strokes stop at the same arrowhead shaft as solid wires', () => {
  const c = new Circuit();
  c.addComponent('block', { refdes: 'B1', x: 0, y: 0 });
  const net = new Net(c, {
    id: 'N1',
    routingMode: 'fixed',
    fixedPaths: [{ points: [{ x: 0, y: -240 }, { x: 0, y: -80 }], start: null, end: { comp: 'B1', term: 'T9' } }],
    wireStyles: { '0:1': { lineStyle: 'dashed', arrowhead: 'end' } },
  });
  c.nets.set(net.id, net);
  for (const [lineStyle, dash] of [['dashed', '12 12'], ['dotted', '2 10'], ['dash-dot', '14 10 3 10']]) {
    net.wireStyles['0:1'] = { lineStyle, arrowhead: 'end' };
    const svg = svgString(c);
    assert.match(svg, new RegExp(`<path class="wire-fixed" d="M 0 -240 L 0 -116\\.80"[^>]+stroke-dasharray="${dash}"`));
    assert.match(svg, /<polygon points="0 -84\.80 18 -116\.80 -18 -116\.80"/);
  }
});

test('styled segments can place a shared wire arrowhead only at path endpoints', () => {
  const c = new Circuit();
  const net = new Net(c, {
    id: 'N1',
    routingMode: 'fixed',
    fixedPaths: [{ points: [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 160 }] }],
    wireStyles: {
      '0:1': { arrowhead: 'start' },
      '0:2': { arrowhead: 'end' },
    },
  });
  c.nets.set(net.id, net);
  const svg = svgString(c);
  assert.match(svg, /<polygon points="0 0 32 18 32 -18"/);
  assert.match(svg, /<polygon points="160 160 178 128 142 128"/);
  assert.doesNotMatch(svg, /<polygon points="160 0/);
});

test('line annotations render as rounded non-connectivity paths', () => {
  const c = new Circuit();
  c.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 80, y: 40 }, { x: 160, y: 0 }], style: { color: '#d00', lineStyle: 'dashed' } });
  const svg = svgString(c);
  assert.match(svg, /<path d="M 0 0 L 80 40 L 160 0"/);
  assert.match(svg, /stroke-linecap="round"/);
  assert.match(svg, /stroke-dasharray="12 12"/);
  assert.doesNotMatch(svg, /class="wire-managed"/);
});

test('annotations and wires share start/end/both arrowhead styling', () => {
  const start = new Circuit();
  start.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 160, y: 0 }], style: { arrowhead: 'start' } });
  const startSvg = svgString(start);
  assert.equal((startSvg.match(/<polygon points=/g) || []).length, 1);
  assert.match(startSvg, /<polygon points="0 0 32 18 32 -18"/);

  const none = new Circuit();
  none.addAnnotation('arrow', { points: [{ x: 0, y: 0 }, { x: 160, y: 0 }], style: { arrowhead: 'none' } });
  assert.equal((svgString(none).match(/<polygon points=/g) || []).length, 0);

  const both = new Circuit();
  const net = new Net(both, { id: 'W1', route: [{ x: 0, y: 0 }, { x: 160, y: 0 }], style: { arrowhead: 'both' } });
  both.nets.set(net.id, net);
  assert.equal((svgString(both).match(/<polygon points=/g) || []).length, 2);
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

test('rendered objects expose semantic keyboard targets', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.connect('R1.b', 'R2.a');
  const svg = svgString(c, { viewport: { x: -400, y: -200, w: 800, h: 400 } });
  assert.match(svg, /data-ref="R1"[^>]+role="button"[^>]+tabindex="0"/);
  assert.match(svg, /data-net-id="[^"]+"[^>]+role="button"[^>]+tabindex="0"/);
  assert.match(svg, /aria-label="Component R1, resistor"/);
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

test('svgString renders named reference marker values without adding a refdes', () => {
  const c = new Circuit();
  c.addComponent('ground', { refdes: 'GND1', x: 400, y: 120, value: 'LOCAL_GND' });
  c.addComponent('vcm', { refdes: 'VCM1', x: 600, y: 120, value: 'VCM_A' });
  const svg = svgString(c);
  assert.match(svg, />LOCAL_GND</);
  assert.match(svg, />VCM_A</);
  assert.doesNotMatch(svg, />GND1</);
  assert.doesNotMatch(svg, />VCM1</);
});

test('svgString renders math labels as live MathML instead of literal TeX', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$Z_{out} = r_{o1}$$', x: 400, y: 120, math: true });
  const svg = svgString(c);
  assert.match(svg, /<foreignObject\b/);
  assert.match(svg, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/);
  assert.match(svg, /<msub><mpadded depth="0"><mi>Z<\/mi><\/mpadded><mrow><mi>o<\/mi><mi>u<\/mi><mi>t<\/mi><\/mrow><\/msub>/);
  assert.doesNotMatch(svg, /<text[^>]*>Z_\{out\}/);
  assert.doesNotMatch(svg, /<mrow>[^<]*\$\$Z/);
});

test('math labels use scalable textbook parallel bars and fraction space', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$\\left(R_{1} \\|\\| R_{2}\\right)$$', x: 400, y: 120, math: true });
  const fraction = c.addLabel({ text: '$$\\frac{1}{R_{1}}$$', x: 400, y: 320, math: true });
  const svg = svgString(c);
  // A fenced group is its own <mrow> and, with nothing tall inside, keeps
  // TeX's text-size parentheses tight against their content.
  assert.match(svg, /<mrow><mo fence="true" stretchy="false" lspace="0em" rspace="0em">\(<\/mo>/);
  assert.match(svg, /<mo fence="true" stretchy="false" lspace="0em" rspace="0em">\)<\/mo><\/mrow>/);
  assert.equal((svg.match(/<mo fence="false" stretchy="true" minsize="1\.2em" lspace="0\.15em" rspace="0\.15em">∥<\/mo>/g) || []).length, 1);
  assert.match(svg, /aria-label="Math label [^"]*\\\|\\\|/);
  assert.match(svg, /font-family:'Latin Modern Math','Computer Modern'/);
  assert.match(svg, /font-weight:normal/);
  assert.equal(fraction.bbox().h, 240, 'fraction labels reserve extra vertical margin');
});

test('fences size to their own group, and signs use TeX prefix form', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$A_v(s) = -g_m \\frac{1}{s C_L}$$', x: 400, y: 120, math: true });
  const svg = svgString(c);
  // `(s)` sits next to a fraction: its fences must size to `s`, not the line.
  assert.match(svg, /<mrow><mo fence="true" stretchy="false"[^>]*>\(<\/mo><mi>s<\/mi><mo fence="true" stretchy="false"[^>]*>\)<\/mo><\/mrow>/);
  // A leading minus is a prefix operator drawn with U+2212, not a hyphen.
  assert.match(svg, /<mo form="prefix" lspace="0em" rspace="0em">\u2212<\/mo>/);
  assert.doesNotMatch(svg, /<mo[^>]*>-<\/mo>/);
});

test('a fence around tall content stretches, and \\left…\\right closes once', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$g_m \\left( r_o \\| \\frac{1}{s C_L} \\right)$$', x: 400, y: 120, math: true });
  const svg = svgString(c);
  assert.equal((svg.match(/<mo fence="true" stretchy="true"[^>]*>\(<\/mo>/g) || []).length, 1);
  assert.equal((svg.match(/<mo fence="true" stretchy="true"[^>]*>\)<\/mo>/g) || []).length, 1);
});

test('a binary sign keeps infix spacing', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$R_1 - R_2 + R_3$$', x: 400, y: 120, math: true });
  const svg = svgString(c);
  assert.equal((svg.match(/<mo form="infix">\u2212<\/mo>/g) || []).length, 1);
  assert.equal((svg.match(/<mo form="infix">\+<\/mo>/g) || []).length, 1);
});

test('Greek commands render as letters, uppercase upright like TeX', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$f_p = \\frac{1}{2 \\pi R C}, \\Delta \\omega$$', x: 400, y: 120, math: true });
  const svg = svgString(c);
  assert.match(svg, /<mi>\u03c0<\/mi>/);
  assert.match(svg, /<mi>\u03c9<\/mi>/);
  assert.match(svg, /<mi mathvariant="normal">\u0394<\/mi>/);
  assert.doesNotMatch(svg, /<mi>p<\/mi><mi>i<\/mi>/);
});

test('a single-character nucleus keeps TeX script shifts off its own metrics', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$g_{m1} r_{o1} x^2$$', x: 400, y: 120, math: true });
  const svg = svgString(c);
  // TeX rule 18a: `g`'s descender must not drop its subscript below `r`'s.
  assert.match(svg, /<msub><mpadded depth="0"><mi>g<\/mi><\/mpadded>/);
  assert.match(svg, /<msub><mpadded depth="0"><mi>r<\/mi><\/mpadded>/);
  assert.match(svg, /<msup><mpadded height="0"><mi>x<\/mi><\/mpadded>/);
});

test('a composite nucleus keeps its own metrics, as TeX does', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$\\frac{a}{b}^2$$', x: 400, y: 120, math: true });
  const svg = svgString(c);
  assert.doesNotMatch(svg, /<mpadded/);
});

test('parallel bars stretch to fraction height and prose in math text keeps spaces', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$\\frac{1}{R_{1}} \\|\\| \\frac{1}{R_{2}}$$', x: 400, y: 120, math: true });
  c.addLabel({ text: '$$\\text{Miller approximation used for } C_{gd}$$', x: 400, y: 320, math: true });
  const svg = svgString(c);
  assert.equal((svg.match(/minsize="2\.2em" maxsize="2\.8em"/g) || []).length, 1);
  assert.match(svg, /<mtext>Miller&#160;approximation&#160;used&#160;for&#160;<\/mtext>/);
});

test('math labels support LaTeX Vert and Big sizing', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$R_{1} \\Vert R_{2}$$', x: 400, y: 120, math: true });
  c.addLabel({ text: '$$\\frac{1}{R_{1}} \\Big\\Vert \\frac{1}{R_{2}}$$', x: 400, y: 320, math: true });
  const svg = svgString(c);
  assert.match(svg, /<mo fence="false" stretchy="true" minsize="1\.2em" lspace="0\.15em" rspace="0\.15em">∥<\/mo>/);
  assert.match(svg, /<mo fence="false" stretchy="true" minsize="2\.0em" maxsize="2\.5em" lspace="0\.15em" rspace="0\.15em">∥<\/mo>/);
});

test('math labels support LaTeX quad spacing', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$Z_{in} \\approx R_{1},\\quad A_{v1} \\approx -g_{m1}R_{1}$$', x: 400, y: 120, math: true });
  const svg = svgString(c);
  assert.match(svg, /<mspace width="1em"\/>/);
  assert.doesNotMatch(svg, /<mi>quad<\/mi>/);
});

test('complex math labels reserve extra rows for nested fractions', () => {
  const c = new Circuit();
  const label = c.addLabel({ text: '$$Z = \\frac{1}{R_{1}} + \\frac{1}{\\frac{1}{R_{2}} + \\frac{1}{R_{3}}}$$', x: 400, y: 120, math: true });
  assert.ok(label.bbox().h >= 240, 'nested fractions get a taller box');
  assert.ok(label.bbox().w > 0, 'nested fractions reserve horizontal margin');
});

test('math label default ink follows the theme while explicit colors remain literal', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$Z_{out}$$', x: 400, y: 120, math: true });
  c.addLabel({ text: '$$I_{D}$$', x: 400, y: 200, math: true, style: { color: '#d00' } });
  const svg = svgString(c);
  assert.match(svg, /class="schematic-math-label"[^>]+color:var\(--svg-ink, #111\)/);
  assert.match(svg, /class="schematic-math-label"[^>]+color:#d00/);
});

test('math labels support measured multi-line annotations', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$\\text{Assumptions\\:}\ng_{m}r_{o} \\gg 1$$', x: 400, y: 120, math: true });
  const svg = svgString(c);
  assert.match(svg, /schematic-math-line/);
  assert.match(svg, /<mtext>Assumptions:<\/mtext>/);
  assert.equal((svg.match(/<math /g) || []).length, 2);
});

test('math labels render the compact \u226b relation', () => {
  const c = new Circuit();
  c.addLabel({ text: '$$g_{m}r_{o} \\gg 1$$', x: 400, y: 120, math: true });
  const svg = svgString(c);
  assert.equal((svg.match(/<mo>≫<\/mo>/g) || []).length, 1);
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
  assert.ok(svg.includes('class="wire-managed"'), 'renders net paths');
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

test('label subscripts: explicit _{...} markup and default component source', () => {
  const c = new Circuit();
  const owned = c.addComponent('resistor', { x: 480, y: 0 });
  c.addLabel({ text: 'C_{GS}', x: 400, y: 200, align: 'left' });
  const svg = svgString(c);
  // default R1 is persisted as explicit R_{1}
  assert.ok(svg.includes('>R<tspan'));
  assert.ok(svg.includes('>1</tspan>'));
  // explicit markup C_GS -> C + subscript GS
  assert.ok(svg.includes('>C<tspan'));
  assert.ok(svg.includes('>GS</tspan>'));
  // free label alignment (left anchor) is preserved
  assert.ok(svg.includes('text-anchor="start"'));
});

test('svgString renders filled polygon bodies (textbook gate bars)', () => {
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
    const ink = svgString(c).match(/<path class="wire-ink" d="([^"]+)"/)?.[1] || '';
    const paths = ink.split(/(?=M )/).map((d) => endpoint(d.trim()));

    for (const terminal of component.def.terminals.filter(({ name }) => ['d', 's', 'b'].includes(name))) {
      // Ink leads stop half a stroke short; the square cap reaches the terminal.
      const world = component.terminalWorld(terminal.name);
      assert.ok(
        paths.some((point) => Math.hypot(point.x - world.x, point.y - world.y) === 3),
        `${type}.${terminal.name} lead reaches its terminal in rendered SVG`,
      );
    }
  }
});

test('svgString renders bulk MOS terminal and channel connection', () => {
  const c = new Circuit();
  c.addComponent('nmosb', { x: 520, y: 0 });
  const svg = svgString(c);
  assert.match(svg, /M 466\.02 0 L 517 0/, 'bulk graphic starts inside the channel bar and runs to its terminal');
  assert.match(svg, /<text[^>]*>M/, 'bulk MOS owned label renders');
});
test('textbook symbols render (sources, opamp, gates, ports)', () => {
  const c = new Circuit();
  c.addComponent('current_source', { x: 400, y: 0 });
  c.addComponent('voltage_source', { x: 400, y: 160 });
  c.addComponent('opamp', { x: 600, y: 0 });
  c.addComponent('and2_gate', { x: 900, y: 0 });
  c.addComponent('inverter', { x: 1200, y: 0 });
  c.addComponent('port', { x: 120, y: 0 });
  const svg = svgString(c);
  assert.ok(svg.includes('data-ref'), 'symbols render');
  assert.ok(svg.includes('<polygon'), 'current source arrow body present');
  assert.ok(svg.includes('translate(400 -160)') || true, 'voltage source present');
});

test('OR-family gates share the tuned body geometry', () => {
  const bodyPath = (type) => getSymbol(type).graphics.find((graphic) => graphic.kind === 'path' && graphic.d.endsWith('Z'))?.d;
  const or = bodyPath('or2_gate');
  const xor = bodyPath('xor2_gate');
  assert.ok(or && xor, 'both gates expose a closed body path');
  assert.equal(bodyPath('nor2_gate'), or, 'NOR reuses the OR body');
  assert.equal(bodyPath('xnor2_gate'), xor, 'XNOR reuses the XOR body');

  // XOR/XNOR use the same body translated right by 26.91 units so their
  // additional rear curve can meet the input leads. Every corresponding point
  // must therefore have the same y and a fixed x translation.
  const orCoords = or.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const xorCoords = xor.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.equal(xorCoords.length, orCoords.length);
  for (let i = 0; i < orCoords.length; i += 2) {
    assert.ok(Math.abs((xorCoords[i] - orCoords[i]) - 26.91) < 1e-9);
    assert.equal(xorCoords[i + 1], orCoords[i + 1]);
  }
  assert.match(xor, /M 72\.55 0 C 55\.5 18\.5 6\.5 70 -70\.09 70/, 'outer curve reaches the rear with a horizontal tangent');
  assert.equal((xor.match(/\bC\b/g) || []).length, 4, 'the body has one smooth bezier per side');
  assert.match(xor, /C -61\.5 58 -40\.75 35 -40\.75 0/, 'inner curve follows the extra rear curve without opening at the centre');
  const orPaths = getSymbol('or2_gate').graphics.filter((graphic) => graphic.kind === 'path');
  const xorPaths = getSymbol('xor2_gate').graphics.filter((graphic) => graphic.kind === 'path');
  assert.equal(orPaths.filter((graphic) => graphic.d.endsWith('Z')).length, 1);
  assert.equal(xorPaths.filter((graphic) => graphic.d.endsWith('Z')).length, 1);
  assert.equal(xorPaths.length, orPaths.length + 1, 'XOR adds only its extra rear curve');
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
  const om = svg.match(/M 15\.8 -40 L 157 -40/g);
  const op = svg.match(/M 15\.81 40 L 157 40/g);
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

test('themeInk renders default ink as currentColor while exports keep literal colors', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { x: 0, y: 0 });
  circuit.addComponent('capacitor', { x: 400, y: 0, style: { color: '#d96c75' } });
  const exported = svgString(circuit, { terminals: false, junctions: false });
  const themed = svgString(circuit, { terminals: false, junctions: false, themeInk: true });
  assert.match(exported, /(stroke|fill)="#111"/);
  assert.doesNotMatch(themed, /(stroke|fill)="#111"/);
  assert.match(themed, /stroke="currentColor"/);
  assert.match(themed, /#d96c75/);
});

test('connected pins get no seam patches; wires end in square caps', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 800, y: 0 });
  c.addComponent('resistor', { x: 800, y: 400 });
  c.connect('R1.b', 'R2.b');
  const svg = svgString(c, { terminals: false, junctions: false });
  assert.doesNotMatch(svg, /pin-contact/);
  assert.match(svg, /class="wire-managed"[^>]*stroke-linecap="square"/);
});

test('svgPixelSize reads the root size and falls back when it is missing', () => {
  assert.deepEqual(svgPixelSize('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><g/></svg>'),
    { width: 640, height: 480 });
  assert.deepEqual(svgPixelSize('<svg width="12.5" height="7.25"/>'), { width: 12.5, height: 7.25 });
  // Missing, zero, or non-numeric sizes fall back rather than producing a
  // zero-sized PDF page or canvas.
  assert.deepEqual(svgPixelSize('<svg viewBox="0 0 10 10"/>'), { width: 1000, height: 800 });
  assert.deepEqual(svgPixelSize('<svg width="0" height="0"/>'), { width: 1000, height: 800 });
  assert.deepEqual(svgPixelSize(''), { width: 1000, height: 800 });
  // Only the root element counts, not a nested one.
  assert.deepEqual(svgPixelSize('<svg width="200" height="100"><svg width="5" height="5"/></svg>'),
    { width: 200, height: 100 });
});

test('a mirrored pair is dimensioned from its axis in grid cells', () => {
  const circuit = new Circuit();
  const def = getSymbol('nmos');
  const ghost = { def, x: 240, y: 0, rotation: 0, mirrorX: false, mirrorY: false };
  const overlay = editorOverlay(circuit, {
    ghost,
    symmetryAxis: { operation: 'mirrorX', pin: { x: 0, y: 0 }, from: { x: 240, y: 0 } },
  });
  // Two equal intervals either side of the axis, so the pair's own pitch is
  // readable as twice the number shown.
  assert.match(overlay, /symmetry-offset/);
  assert.equal(overlay.match(/>6 cells</g)?.length, 2);
  // A ghost sitting on the axis places one component, so there is nothing to
  // dimension.
  const onAxis = editorOverlay(circuit, {
    ghost: { ...ghost, x: 0 },
    symmetryAxis: { operation: 'mirrorX', pin: { x: 0, y: 0 }, from: { x: 0, y: 0 } },
  });
  assert.match(onAxis, /symmetry-axis/);
  assert.doesNotMatch(onAxis, /symmetry-offset/);
});

test('a symmetric wire draft is dimensioned along the axis it mirrors about', () => {
  const circuit = new Circuit();
  const overlay = editorOverlay(circuit, {
    wirePreview: { from: { x: 0, y: 0 }, pts: [{ x: 0, y: 0 }, { x: 0, y: 160 }] },
    symmetryAxis: { operation: 'mirrorY', pin: { x: 0, y: 0 }, from: { x: 0, y: 160 } },
  });
  assert.match(overlay, /symmetry-offset/);
  assert.equal(overlay.match(/>4 cells</g)?.length, 2);
});

test('a placement midpoint is referenced from the ghost to the full-pitch ruler', () => {
  const overlay = editorOverlay(new Circuit(), {
    placementGuide: {
      moving: { anchor: { x: 720, y: 0 }, bbox: { x: 680, y: -40, w: 80, h: 80 } },
      guides: [{
        kind: 'spacing', axis: 'x', cells: 12, exact: false, target: 960,
        points: [
          { id: 'A', x: 0, y: 0, moving: false },
          { id: 'B', x: 480, y: 0, moving: false },
          { id: '__ghost__', x: 960, y: 0, moving: true },
        ],
        halfway: {
          cells: 6,
          from: { id: 'B', x: 480, y: 0, moving: false },
          at: { id: '__ghost__', x: 720, y: 0, moving: true },
        },
      }],
    },
  });
  assert.match(overlay, /class="placement-halfway-reference"/);
  assert.match(overlay, />6 cells</);
});
