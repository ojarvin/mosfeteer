import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockDiagram } from '../src/core/block-model.js';
import { runCommand } from '../src/core/commands.js';
import { isBlockDiagram, loadDocument, renderDocument } from '../src/core/document.js';

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

test('selected blocks wrap their complete clickable subtree', () => {
  const svg = renderDocument(diagram(), { selectedBlocks: new Set(['B1']) });
  assert.match(svg, /<g data-block-id="B1"><rect class="block-node selected"/);
  assert.match(svg, /<text[^>]*>In<\/text><\/g>/);
  assert.doesNotMatch(svg, /<g data-block-id="B2"><rect class="block-node selected"/);
});

test('block commands list entries on separate lines', () => {
  const d = new BlockDiagram();
  runCommand(d, 'add-block B1 One 0 0 160 80');
  runCommand(d, 'add-block B2 Two 240 0 160 80');
  assert.equal(runCommand(d, 'list').text, 'B1 One\nB2 Two');
});
