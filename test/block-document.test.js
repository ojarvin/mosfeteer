import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockDiagram } from '../src/core/block-model.js';
import { runCommand } from '../src/core/commands.js';
import { createDocument, documentKindLabel, isBlockDiagram, loadDocument, renderDocument } from '../src/core/document.js';

function diagram() {
  const d = new BlockDiagram();
  d.addBlock({ id: 'B1', text: 'In', rect: { x: 0, y: 0, w: 160, h: 80 }, terminals: [{ id: 'out', side: 'right', offset: 40 }], style: { color: '#d00', width: 'thick', lineStyle: 'dashed' } });
  d.addBlock({ id: 'B2', text: 'Out', rect: { x: 400, y: 0, w: 160, h: 80 }, terminals: [{ id: 'in', side: 'left', offset: 40 }] });
  d.getBlock('B1').ensurePerimeterTerminals();
  d.getBlock('B2').ensurePerimeterTerminals();
  d.addArrow({ id: 'A1', from: 'B1.out', to: 'B2.in', style: { color: '#00f', width: 'thin', lineStyle: 'dotted' } });
  return d;
}

test('document dispatch round-trips and renders block styles', () => {
  const original = diagram();
  const loaded = loadDocument(original.toJSON());
  assert.ok(loaded instanceof BlockDiagram);
  assert.equal(isBlockDiagram(loaded), true);
  const svg = renderDocument(loaded);
  assert.match(svg, /stroke="#d00" stroke-width="9"/);
  assert.match(svg, /stroke-dasharray="12 12"/);
  assert.match(svg, /stroke="#00f" stroke-width="3"/);
  assert.match(svg, /stroke-dasharray="2 10"/);
});

test('block annotations use the shared arrowhead placement style', () => {
  const d = new BlockDiagram();
  d.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 160, y: 0 }], style: { arrowhead: 'both' } });
  d.addAnnotation('arrow', { points: [{ x: 0, y: 160 }, { x: 160, y: 160 }], style: { arrowhead: 'none' } });
  const svg = renderDocument(d);
  assert.equal((svg.match(/<polygon points=/g) || []).length, 2);
  assert.deepEqual(d.toJSON().labels?.map((label) => label.style.arrowhead), ['both', 'none']);
});

test('selected blocks and connectors expose isolated editor hit targets', () => {
  const svg = renderDocument(diagram(), { selectedBlocks: new Set(['B1']), selectedArrows: new Set(['A1']), terminals: true, grid: true });
  assert.match(svg, /<g data-block-id="B1"><rect class="block-node selected"/);
  assert.match(svg, /<g data-arrow-id="A1" class="block-connector selected">/);
  assert.match(svg, /data-block-terminal="B1\.out"/);
  assert.match(svg, /<polygon points=/);
  assert.match(svg, /<pattern id="block-grid-/);
  assert.match(svg, /<text[^>]*>In<\/text>\s*<\/g>/);
  assert.doesNotMatch(svg, /<g data-block-id="B2"><rect class="block-node selected"/);
});

test('individual block connector segments expose selection highlighting', () => {
  const svg = renderDocument(diagram(), { selectedArrowSegments: new Set(['A1:1']) });
  assert.match(svg, /data-arrow-segment="A1:1" class="selected"/);
});

test('connector labels render as block-local non-electrical labels', () => {
  const d = diagram();
  d.addNetLabel('A1', { id: 'L1', text: 'signal', anchor: { x: 280, y: 40 } });
  const svg = renderDocument(d);
  assert.match(svg, /data-label-id="L1"/);
  assert.match(svg, /class="block-net-label"/);
  assert.doesNotMatch(svg, /data-net-id/);
});

test('block editor rendering gates terminals and exposes resize/annotation hit targets', () => {
  const d = new BlockDiagram();
  d.addBlock({ id: 'B1', text: 'One', rect: { x: 0, y: 0, w: 160, h: 80 } });
  d.addLabel({ id: 'L1', text: 'note', x: 240, y: 0 });
  d.addAnnotation('box', { id: 'A1', x: 240, y: 80, end: { x: 400, y: 160 } });
  const hidden = renderDocument(d, { terminals: false, selectedBlocks: new Set(['B1']), selectedLabels: new Set(['L1']) });
  assert.doesNotMatch(hidden, /data-block-terminal=/);
  assert.match(hidden, /data-block-handle="se"/);
  assert.match(hidden, /data-label-id="L1"/);
  assert.match(hidden, /class="block-label-bbox"/);
  assert.doesNotMatch(hidden, /data-annotation-endpoint=/);
  const shown = renderDocument(d, { terminals: true });
  assert.match(shown, /data-block-terminal="B1\.T1"/);
  const selectedAnnotation = renderDocument(d, { selectedLabels: new Set(['A1']) });
  assert.match(selectedAnnotation, /data-annotation-endpoint="A1:corner:top-left"/);
  assert.match(selectedAnnotation, /data-annotation-endpoint="A1:corner:bottom-right"/);
});

test('block placement ghost is not hidden by an empty ghost list', () => {
  const svg = renderDocument(new BlockDiagram(), {
    ghostBlock: { rect: { x: 0, y: 0, w: 160, h: 80 }, text: 'Block' },
    ghostBlocks: [],
  });
  assert.match(svg, /class="block-ghost"/);
});

test('box and arrow placement previews render complete ghost shapes', () => {
  const diagram = new BlockDiagram();
  const box = renderDocument(diagram, { annotationPreview: { kind: 'box', a: { x: 0, y: 0 }, b: { x: 160, y: 80 } } });
  const arrow = renderDocument(diagram, { annotationPreview: { kind: 'arrow', a: { x: 0, y: 0 }, b: { x: 160, y: 80 } } });
  assert.match(box, /class="annotation-preview block-box"/);
  assert.match(arrow, /class="annotation-preview block-arrow"/);
  assert.match(arrow, /<polygon points=/);
});

test('move and copy ghosts render arrow and box geometry, not text placeholders', () => {
  const diagram = new BlockDiagram();
  const box = diagram.addAnnotation('box', { id: 'B', x: 0, y: 0, end: { x: 160, y: 80 } });
  const arrow = diagram.addAnnotation('arrow', { id: 'A', x: 240, y: 0, end: { x: 400, y: 80 } });
  const svg = renderDocument(diagram, { ghostLabels: [box, arrow] });
  assert.match(svg, /block-ghost block-label-ghost[^>]*>[\s\S]*block-box/);
  assert.match(svg, /block-ghost block-label-ghost[^>]*>[\s\S]*block-arrow/);
});

test('block commands create and edit only block-domain objects', () => {
  const d = createDocument('block');
  assert.equal(documentKindLabel(d), 'Block diagram');
  runCommand(d, 'add-block B1 One 0 0 160 80');
  runCommand(d, 'add-block B2 Two 240 0 160 80');
  runCommand(d, 'add-terminal B1 out right 40');
  runCommand(d, 'add-terminal B2 in left 40');
  const added = runCommand(d, 'add-connector A1 B1.out B2.in');
  assert.equal(added.mutated, true);
  assert.match(runCommand(d, 'list').text, /A1 B1\.out -> B2\.in/);
  assert.throws(() => runCommand(d, 'connect B1.out B2.in'), /unknown command/);
  const label = runCommand(d, 'netlabel add A1 SIG signal 120 40');
  assert.equal(label.mutated, true);
  assert.equal(d.labels.get('SIG').connectorId, 'A1');
  runCommand(d, 'rm-connector A1');
  assert.equal(d.labels.size, 0);
  assert.equal(d.arrows.size, 0);
});

test('block command families and multiline annotations stay in the block domain', () => {
  const d = createDocument('block');
  runCommand(d, 'block add B1 One 0 0 160 80');
  runCommand(d, 'block add B2 Two 400 0 160 80');
  runCommand(d, 'terminal add B1 out right 40');
  runCommand(d, 'terminal add B2 in left 40');
  runCommand(d, 'connector add A1 B1.out B2.in');
  runCommand(d, 'annotation add line trace note 0 160 80 160 80 240 160 240');

  assert.deepEqual(d.labels.get('trace').points, [
    { x: 0, y: 160 }, { x: 80, y: 160 }, { x: 80, y: 240 }, { x: 160, y: 240 },
  ]);
  assert.match(runCommand(d, 'connector add A2 B1.out B2.in').text, /added connector A2/);
  assert.match(runCommand(d, 'annotation list').text, /trace line/);
  assert.match(runCommand(d, 'netlabel list').text, /no connector labels/);
  assert.throws(() => runCommand(d, 'connect B1.out B2.in'), /unknown command/);
});
