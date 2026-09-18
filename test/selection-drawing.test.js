import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, Net } from '../src/core/model.js';
import { BlockDiagram } from '../src/core/block-model.js';
import { resolveCopySelection } from '../src/core/selection.js';
import { selectionDrawing } from '../src/core/selection-drawing.js';

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

test('explicit whole-net selection brings its terminals, and an owned label brings its component', () => {
  const { circuit, net } = fixture();
  const svg = selectionDrawing(circuit, { netIds: [net.id] });
  assert.match(svg, /data-ref="R1"/);
  assert.match(svg, /data-ref="R2"/);
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
  const bounds = circuit.bounds();
  const svg = selectionDrawing(circuit, { refs: ['R1'] }, { padding: 20 });
  assert.ok(svg.includes(`viewBox="${bounds.x - 20} ${bounds.y - 20} ${bounds.w + 40} ${bounds.h + 40}"`));
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

test('block selection includes internal connectors and excludes neighbours and selection UI', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'B1', text: 'First', rect: { x: 0, y: 0, w: 160, h: 160 } });
  diagram.addBlock({ id: 'B2', text: 'Second', rect: { x: 400, y: 0, w: 160, h: 160 } });
  diagram.addBlock({ id: 'B3', text: 'Other', rect: { x: 800, y: 0, w: 160, h: 160 } });
  const arrow = diagram.addArrow({ id: 'A1', from: 'B1.T5', to: 'B2.T11' });
  const before = diagram.toJSON();
  const svg = selectionDrawing(diagram, { blockIds: ['B1', 'B2'] });
  assert.match(svg, /First|Second/);
  assert.doesNotMatch(svg, /Other|selected|block-terminal|resize-handle/);
  assert.ok(svg.includes(`data-arrow-id="${arrow.id}"`));
  const arrowSvg = selectionDrawing(diagram, { arrowIds: ['A1'] });
  assert.ok(arrowSvg.includes(`data-arrow-id="${arrow.id}"`));
  assert.doesNotMatch(arrowSvg, /data-block-id=/);
  assert.deepEqual(diagram.toJSON(), before);
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

test('selected block connectors carry only their own labels', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'B1', rect: { x: 0, y: 0, w: 160, h: 160 } });
  diagram.addBlock({ id: 'B2', rect: { x: 400, y: 0, w: 160, h: 160 } });
  const arrow = diagram.addArrow({ id: 'A1', from: 'B1.T5', to: 'B2.T11' });
  const attached = diagram.addConnectorLabel(arrow.id, { text: 'SIGNAL' });
  const free = diagram.addLabel({ text: 'OTHER', x: 800, y: 0 });
  const svg = selectionDrawing(diagram, { arrowIds: [arrow.id] });
  assert.ok(svg.includes(`data-label-id="${attached.id}"`));
  assert.ok(!svg.includes(`data-label-id="${free.id}"`));
  assert.doesNotMatch(svg, /data-block-id=/);
});
