import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svgString } from '../src/core/render.js';
import { Circuit } from '../src/core/model.js';

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

test('svgString includes each refdes as a text element', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 400, y: 0 });
  c.addComponent('capacitor', { x: 400, y: 120 });
  c.addComponent('diode', { x: 400, y: 240 });
  const svg = svgString(c);
  assert.ok(svg.includes('>R1<'));
  assert.ok(svg.includes('>C1<'));
  assert.ok(svg.includes('>D1<'));
});

test('svgString includes refdes only for components with refPrefix/refPos', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 400, y: 0 });
  c.addComponent('ground', { x: 400, y: 120 });
  const svg = svgString(c);
  assert.ok(svg.includes('>R1<'));
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

test('svgString marks generated balanced net junctions with a solder dot', () => {
  const c = new Circuit();
  const left = c.addComponent('nmos', { x: 0, y: -80 });
  const right = c.addComponent('nmos', { x: 480, y: -80, mirrorX: true });
  const tail = c.addComponent('nmos', { x: 120, y: 160 });
  c.connect(`${left.refdes}.s`, `${right.refdes}.s`, `${tail.refdes}.d`);
  const svg = svgString(c, { terminals: false, junctions: false });
  assert.ok(svg.includes('cx="240" cy="40" r="5"'), 'balanced junction dot present');
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
  // exactly one M1 text element (the owned label), not the built-in refPos one
  assert.equal((svg.match(/>M1</g) || []).length, 1);
  assert.ok(svg.includes('>M1<'));
});
