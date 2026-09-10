import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockDiagram } from '../src/core/block-model.js';
import { runCommand } from '../src/core/commands.js';
import { createDocument, documentKindLabel, isBlockDiagram, loadDocument, renderDocument } from '../src/core/document.js';

function diagram() {
  const d = new BlockDiagram();
  d.addBlock({ id: 'B1', text: 'In', rect: { x: 0, y: 0, w: 160, h: 80 }, style: { color: '#d00', width: 'thick', lineStyle: 'dashed' } });
  d.addBlock({ id: 'B2', text: 'Out', rect: { x: 400, y: 0, w: 160, h: 80 } });
  d.addTerminal('B1', { id: 'out', side: 'right', offset: 40 });
  d.addTerminal('B2', { id: 'in', side: 'left', offset: 40 });
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
  assert.match(svg, /stroke-dasharray="12 8"/);
  assert.match(svg, /stroke="#00f" stroke-width="3"/);
  assert.match(svg, /stroke-dasharray="2 8"/);
});

test('selected blocks and connectors expose isolated editor hit targets', () => {
  const svg = renderDocument(diagram(), { selectedBlocks: new Set(['B1']), selectedArrows: new Set(['A1']), grid: true });
  assert.match(svg, /<g data-block-id="B1"><rect class="block-node selected"/);
  assert.match(svg, /<g data-arrow-id="A1" class="block-connector selected">/);
  assert.match(svg, /data-block-terminal="B1\.out"/);
  assert.match(svg, /<polygon points=/);
  assert.match(svg, /<pattern id="block-grid-/);
  assert.match(svg, /<text[^>]*>In<\/text><\/g>/);
  assert.doesNotMatch(svg, /<g data-block-id="B2"><rect class="block-node selected"/);
});

test('block editor rendering gates terminals and exposes resize/annotation hit targets', () => {
  const d = new BlockDiagram();
  d.addBlock({ id: 'B1', text: 'One', rect: { x: 0, y: 0, w: 160, h: 80 } });
  d.addLabel({ id: 'L1', text: 'note', x: 240, y: 0 });
  const hidden = renderDocument(d, { terminals: false, selectedBlocks: new Set(['B1']), selectedLabels: new Set(['L1']) });
  assert.doesNotMatch(hidden, /data-block-terminal=/);
  assert.match(hidden, /data-block-handle="se"/);
  assert.match(hidden, /data-label-id="L1"/);
  const shown = renderDocument(d, { terminals: true });
  assert.match(shown, /data-block-terminal="B1\.T1"/);
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
  runCommand(d, 'rm-connector A1');
  assert.equal(d.arrows.size, 0);
});
