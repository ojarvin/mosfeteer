import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockDiagram, BLOCK_DIAGRAM_KIND, BLOCK_DIAGRAM_VERSION, blockLabelPosition } from '../src/core/block-model.js';

function fixture() {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'B1', text: 'Input', rect: { x: 0, y: 0, w: 160, h: 80 } });
  diagram.addBlock({ id: 'B2', text: 'Output', rect: { x: 400, y: 160, w: 160, h: 80 } });
  diagram.addTerminal('B1', { id: 'out', side: 'right', offset: 40 });
  diagram.addTerminal('B2', { id: 'in', side: 'left', offset: 40 });
  diagram.addArrow('A1', 'B1.out', 'B2.in');
  return diagram;
}

test('block diagram is a separate discriminated, serializable document', () => {
  const original = fixture();
  const state = original.toJSON();
  assert.equal(state.kind, BLOCK_DIAGRAM_KIND);
  assert.equal(state.version, BLOCK_DIAGRAM_VERSION);
  assert.ok(!('components' in state) && !('nets' in state) && !('labels' in state));
  assert.deepEqual(BlockDiagram.fromJSON(state).toJSON(), state);
});

test('block labels are centered and text edits preserve the center', () => {
  const diagram = new BlockDiagram();
  const block = diagram.addBlock({ id: 'B1', text: 'A', rect: { x: 0, y: 0, w: 160, h: 80 } });
  assert.deepEqual(block.labelPosition(), { x: 80, y: 40, anchor: 'middle' });
  const center = block.labelPosition();
  diagram.renameBlock('B1', 'A much longer block label');
  assert.deepEqual(block.labelPosition(), center);
  assert.deepEqual(blockLabelPosition(block.rect), center);
});

test('perimeter terminals retain side and offset while block moves', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'B1', rect: { x: 80, y: 120, w: 160, h: 120 } });
  diagram.addTerminal('B1', { id: 'top', side: 'top', offset: 40 });
  diagram.addTerminal('B1', { id: 'right', side: 'right', offset: 80 });
  diagram.addTerminal('B1', { id: 'bottom', side: 'bottom', offset: 120 });
  diagram.addTerminal('B1', { id: 'left', side: 'left', offset: 0 });
  assert.deepEqual(diagram.terminalPoint('B1.top'), { x: 120, y: 120 });
  assert.deepEqual(diagram.terminalPoint('B1.right'), { x: 240, y: 200 });
  assert.deepEqual(diagram.terminalPoint('B1.bottom'), { x: 200, y: 240 });
  assert.deepEqual(diagram.terminalPoint('B1.left'), { x: 80, y: 120 });
  diagram.moveBlock('B1', 400, 440);
  assert.deepEqual(diagram.terminalPoint('B1.top'), { x: 440, y: 440 });
  assert.deepEqual(diagram.getTerminal('B1.right').direction(), { x: 1, y: 0 });
});

test('resize clamps terminal offsets without changing terminal identity', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'B1', rect: { x: 0, y: 0, w: 240, h: 160 } });
  diagram.addTerminal('B1', { id: 'in', side: 'left', offset: 160 });
  diagram.resizeBlock('B1', 160, 80);
  assert.deepEqual(diagram.getTerminal('B1.in').toJSON(), { id: 'in', side: 'left', offset: 80 });
});

test('invalid terminal moves leave the terminal unchanged', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'B1', rect: { x: 0, y: 0, w: 160, h: 80 } });
  diagram.addTerminal('B1', { id: 'out', side: 'right', offset: 40 });
  assert.throws(() => diagram.moveTerminal('B1.out', 'top', 999), /between 0 and 160/);
  assert.deepEqual(diagram.getTerminal('B1.out').toJSON(), { id: 'out', side: 'right', offset: 40 });
});

test('arrow identity is terminal-based and block deletion cascades incident arrows', () => {
  const diagram = fixture();
  assert.deepEqual(diagram.getArrow('A1').from, { block: 'B1', terminal: 'out' });
  assert.deepEqual(diagram.getArrow('A1').to, { block: 'B2', terminal: 'in' });
  assert.throws(() => diagram.removeTerminal('B1.out'), /arrows reference/);
  diagram.removeBlock('B1');
  assert.equal(diagram.arrows.size, 0);
});

test('validation rejects stale endpoint identity and leaves failed mutation atomic', () => {
  const diagram = fixture();
  const before = diagram.toJSON();
  assert.throws(() => diagram.addArrow({ id: 'bad', from: 'B1.missing', to: 'B2.in' }), /unknown terminal/);
  assert.deepEqual(diagram.toJSON(), before);
  const arrow = diagram.getArrow('A1');
  arrow.points[0] = { x: 999, y: 999 };
  assert.throws(() => diagram.validate(), /does not start/);
});
