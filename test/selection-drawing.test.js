import { editorSource } from './helpers/editor-source.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Circuit, Net } from '../src/core/model.js';
import { resolveCopySelection } from '../src/core/selection.js';
import { selectionDrawing } from '../src/core/selection-drawing.js';
import { addTerminalStubs } from '../src/core/stubs.js';

function fixture() {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  circuit.addComponent('capacitor', { refdes: 'C1', x: 80, y: 400 });
  const net = circuit.connect('R1.b', 'R2.a');
  circuit.renameNet(net.id, 'SIGNAL');
  const netLabel = circuit.addNetLabel(net.id, { x: 280, y: 0 });
  const annotation = circuit.addLabel({ text: 'NOTE', x: 80, y: 200 });
  return { circuit, net, netLabel, annotation };
}

const wireId = (net) => `data-net-id="${net.id}"`;

test('selection image is a subset with its owned labels, not a viewport crop', () => {
  const { circuit, annotation } = fixture();
  // An unselected object may even overlap the selected one.
  circuit.addComponent('inductor', { refdes: 'L1', x: 80, y: 0 });
  const before = circuit.toJSON();
  const svg = selectionDrawing(circuit, { refs: ['R1'], labels: [annotation] });
  assert.match(svg, /data-ref="R1"/);
  assert.match(svg, /Instance label R_\{1\}/);
  assert.match(svg, /Annotation NOTE/);
  assert.doesNotMatch(svg, /data-ref="(?:R2|C1|L1)"|data-net-id=/);
  assert.doesNotMatch(svg, /editor-overlay|selected|grid-line|cursor-crosshair/);
  assert.deepEqual(circuit.toJSON(), before);
});

test('complete component sets include internal physical nets and their labels', () => {
  const { circuit, net, netLabel } = fixture();
  const svg = selectionDrawing(circuit, { refs: new Set(['R1', 'R2']) });
  assert.ok(svg.includes(wireId(net)));
  assert.ok(svg.includes(`data-label-id="${netLabel.id}"`));
  assert.doesNotMatch(svg, /Annotation NOTE|data-ref="C1"/);
  const parts = resolveCopySelection(circuit, { refs: ['R1', 'R2'] });
  assert.deepEqual(parts.nets, [net]);
});

test('explicit whole-net selection draws its wire and net labels, not its terminals', () => {
  const { circuit, net, netLabel } = fixture();
  const svg = selectionDrawing(circuit, { netIds: [net.id] });
  assert.doesNotMatch(svg, /data-ref=/);
  assert.ok(svg.includes(wireId(net)));
  assert.ok(svg.includes(`data-label-id="${netLabel.id}"`));
  const parts = resolveCopySelection(circuit, { netIds: [net.id] });
  assert.deepEqual(parts.comps, []);
  assert.equal(parts.fragments.length, 1);
  assert.deepEqual(parts.fragments[0].netLabels, [netLabel]);
});

test('a labelled stub on a MOS gate copies only the stub and its net label', () => {
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 400, y: 400 });
  const [stub] = addTerminalStubs(circuit, ['M1']).stubs.filter((entry) => entry.ref === 'M1.g');
  const parts = resolveCopySelection(circuit, { netIds: [stub.netId], labels: [circuit.labels.get(stub.labelId)] });
  assert.deepEqual(parts.comps, []);
  assert.equal(parts.nets.length, 0);
  assert.equal(parts.fragments.length, 1);
  assert.deepEqual(parts.fragments[0].paths, [[{ x: 280, y: 400 }, { x: 200, y: 400 }]]);
  assert.deepEqual(parts.fragments[0].netLabels.map((label) => label.id), [stub.labelId]);
  // The selected net label is not also copied as a loose annotation.
  assert.deepEqual(parts.freeLabels, []);
});

test('an owned label brings its component', () => {
  const { circuit } = fixture();
  const owned = [...circuit.labels.values()].find((label) => label.owner === 'R1');
  const labelSvg = selectionDrawing(circuit, { labels: [owned] });
  assert.match(labelSvg, /data-ref="R1"/);
  assert.doesNotMatch(labelSvg, /data-ref="R2"|data-net-id=/);
});

test('a selected net label alone remains a visual selection without its wire', () => {
  const { circuit, netLabel } = fixture();
  const svg = selectionDrawing(circuit, { labels: [netLabel] });
  assert.match(svg, /Net label SIGNAL/);
  assert.doesNotMatch(svg, /data-ref=|data-net-id=/);
});

test('partial wires copy only selected geometry and retain authored styles', () => {
  const { circuit, net } = fixture();
  net.route = [{ x: 160, y: 0 }, { x: 240, y: 0 }, { x: 240, y: -80 }, { x: 400, y: -80 }, { x: 400, y: 0 }];
  net.wireStyles['0:2'] = { color: '#ff0000', width: 'normal', lineStyle: 'dashed' };
  const selection = { refs: ['R1', 'R2'], wireKeys: [`${net.id}:0:2`] };
  const parts = resolveCopySelection(circuit, selection);
  assert.equal(parts.nets.length, 0);
  assert.equal(parts.fragments.length, 1);
  const svg = selectionDrawing(circuit, selection);
  assert.match(svg, /d="M 240 0 L 240 -80"[^>]+stroke="#ff0000"[^>]+stroke-dasharray/);
  assert.doesNotMatch(svg, /Net label SIGNAL/);
  assert.equal(svg.includes(wireId(net)), false);
});

test('whole floating nets and annotation child labels follow their selection', () => {
  const circuit = new Circuit();
  const net = new Net(circuit, { id: 'FLOAT', route: [{ x: 0, y: 0 }, { x: 160, y: 0 }] });
  circuit.nets.set(net.id, net);
  const box = circuit.addLabel({ kind: 'box', x: 0, y: 160, end: { x: 160, y: 240 } });
  const child = circuit.addLabel({ parent: box.id, text: 'CAPTION', x: 80, y: 200 });
  const svg = selectionDrawing(circuit, { labels: [box], wireKeys: ['FLOAT:0:1'] });
  assert.ok(svg.includes(wireId(net)));
  assert.ok(svg.includes(`data-label-id="${child.id}"`));
  assert.match(svg, /CAPTION/);
});

test('no selection copies the entire drawing, using print-ready defaults', () => {
  const { circuit, net, annotation } = fixture();
  const svg = selectionDrawing(circuit);
  assert.match(svg, /data-ref="R1"/);
  assert.match(svg, /data-ref="R2"/);
  assert.match(svg, /data-ref="C1"/);
  assert.ok(svg.includes(wireId(net)));
  assert.ok(svg.includes(`data-label-id="${annotation.id}"`));
  assert.doesNotMatch(svg, /grid-line|pin-dot|cursor-crosshair/);
  assert.match(svg, /fill="#fff"/);
});

test('bounds include owned labels and have explicit padding, even for flat wires and empty documents', () => {
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  const bounds = circuit.inkBounds();
  // The owned label's text reaches above the part, but not its whole box.
  assert.ok(bounds.y < circuit.getComponent('R1').bboxWorld().y);
  assert.ok(bounds.y > circuit.labelOf('R1').bbox().y);
  const svg = selectionDrawing(circuit, { refs: ['R1'] }, { padding: 20 });
  const viewBox = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const expected = [bounds.x - 20, bounds.y - 20, bounds.w + 40, bounds.h + 40];
  viewBox.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 0.01, `viewBox ${viewBox} ≈ ${expected}`));
  const empty = selectionDrawing(new Circuit(), {}, { padding: 0 });
  assert.match(empty, /width="1" height="1"/);
  assert.doesNotMatch(empty, /empty schematic/);
  assert.throws(() => selectionDrawing(circuit, {}, { padding: -1 }), /padding/);
});

test('math selection preserves MathML and its measured footprint', () => {
  const { circuit } = fixture();
  const equation = circuit.addLabel({ text: '$$Z = \\frac{1}{s C}$$', math: true, x: 800, y: 0 });
  const before = equation.toJSON();
  const svg = selectionDrawing(circuit, { labels: [equation] });
  assert.match(svg, /schematic-math-label/);
  assert.match(svg, /<mfrac>/);
  assert.deepEqual(equation.toJSON(), before);
  assert.doesNotMatch(svg, /data-ref=/);
});

test('complete junctions retain solder dots and truncated single arms do not', () => {
  const circuit = new Circuit();
  const net = new Net(circuit, {
    id: 'TEE', branches: [
      [{ x: -160, y: 0 }, { x: 0, y: 0 }],
      [{ x: 0, y: 0 }, { x: 160, y: 0 }],
      [{ x: 0, y: 0 }, { x: 0, y: 160 }],
    ], junctions: [{ x: 0, y: 0 }],
  });
  circuit.nets.set(net.id, net);
  circuit.syncJunctionSolders();
  const dot = [...circuit.components.values()].find((comp) => comp.type === 'solder');
  assert.ok(dot);
  const full = selectionDrawing(circuit, { netIds: [net.id] });
  assert.ok(full.includes(`data-ref="${dot.refdes}"`));
  const arm = selectionDrawing(circuit, { wireKeys: ['TEE:0:1'] });
  assert.equal(arm.includes(`data-ref="${dot.refdes}"`), false);
});

test('wire appearance survives a fragment split inside an authored segment', () => {
  const circuit = new Circuit();
  const net = new Net(circuit, {
    id: 'TEE', branches: [
      [{ x: -160, y: 0 }, { x: 160, y: 0 }],
      [{ x: 0, y: 0 }, { x: 0, y: 160 }],
    ], junctions: [{ x: 0, y: 0 }],
    wireStyles: { '0:1': { color: '#ff0000', lineStyle: 'dashed', width: 'normal' } },
  });
  circuit.nets.set(net.id, net);
  const svg = selectionDrawing(circuit, { wireKeys: ['TEE:0:1'] });
  const red = [...svg.matchAll(/<path class="wire-fixed"[^>]+stroke="#ff0000"[^>]+stroke-dasharray/g)];
  assert.equal(red.length, 2);
});

test('exporting only the selection renders the subset with the normal export frame', async () => {
  const { selectionSubset, hasDrawableSelection, DRAWING_EXPORT_OPTIONS: exportOptions } = await import('../src/core/selection-drawing.js');
  const { svgString } = await import('../src/core/render.js');
  const { runCommand: run } = await import('../src/core/commands.js');
  const { Circuit: Model } = await import('../src/core/model.js');
  const circuit = new Model();
  run(circuit, 'add resistor R1 --at 0 0');
  run(circuit, 'add resistor R2 --at 800 0');
  assert.equal(hasDrawableSelection({}), false);
  assert.equal(selectionSubset(circuit, {}), circuit, 'no selection is the whole document');
  const subset = selectionSubset(circuit, { refs: new Set(['R1']) });
  assert.deepEqual([...subset.components.keys()], ['R1']);
  const svg = svgString(subset, exportOptions);
  assert.match(svg, /data-ref="R1"/);
  assert.doesNotMatch(svg, /data-ref="R2"/);
  assert.ok(circuit.components.has('R2'), 'the document is untouched');
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /name="selection"[^>]*\/> Only the selection/);
  const main = editorSource();
  assert.match(main, /exportSelectionInput\.checked = false;/);
});

test('a selection keeps the net highlight colors of the document', async () => {
  const { resolveColor } = await import('../src/core/style.js');
  const { circuit, net } = fixture();
  circuit.cycleNetHighlight(net);
  const color = resolveColor(circuit.netHighlight(net));
  assert.ok(color);
  const count = (svg) => (svg.match(new RegExp(color, 'g')) || []).length;
  // Whole parts with their net, and a lone wire segment (a fragment net).
  const whole = selectionDrawing(circuit, { refs: new Set(['R1', 'R2']), netIds: new Set([net.id]) });
  assert.ok(count(whole) > 0, 'the highlighted net keeps its color');
  const segment = selectionDrawing(circuit, { wireKeys: new Set([`${net.id}:0:1`]) });
  assert.ok(count(segment) > 0, 'a partial wire keeps its color too');
});
