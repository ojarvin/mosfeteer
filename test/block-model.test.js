import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockDiagram, BLOCK_DIAGRAM_KIND, BLOCK_DIAGRAM_VERSION, blockLabelPosition } from '../src/core/block-model.js';
import { runCommand } from '../src/core/commands.js';

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

test('new blocks expose non-corner generic terminals and preserve them across resize', () => {
  const diagram = new BlockDiagram();
  const block = diagram.addBlock({ id: 'B1', rect: { x: 0, y: 0, w: 160, h: 80 } });
  assert.equal(block.terminals.size, 4);
  assert.deepEqual(block.getTerminal('T1').toJSON(), { id: 'T1', side: 'top', offset: 40, generated: true });
  diagram.resizeBlock('B1', { w: 240, h: 120 });
  assert.deepEqual(block.getTerminal('T1').toJSON(), { id: 'T1', side: 'top', offset: 40, generated: true });
  assert.equal(block.terminals.has('T5'), true);
});

test('generated terminals reject undersized resizes without collisions or loss', () => {
  const diagram = new BlockDiagram();
  const block = diagram.addBlock({ id: 'B1', rect: { x: 0, y: 0, w: 200, h: 80 } });
  assert.equal([...block.terminals.values()].filter((terminal) => terminal.side === 'top').length, 3);
  assert.throws(() => diagram.resizeBlock('B1', 80, 80), /too small/);
  assert.deepEqual(block.rect, { x: 0, y: 0, w: 200, h: 80 });
  const points = [...block.terminals.values()].map((terminal) => `${terminal.side}:${terminal.offset}`);
  assert.equal(new Set(points).size, points.length);
});

test('perimeter terminals retain side and offset while block moves', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'B1', rect: { x: 80, y: 120, w: 160, h: 120 }, terminals: [
    { id: 'top', side: 'top', offset: 40 },
    { id: 'right', side: 'right', offset: 80 },
    { id: 'bottom', side: 'bottom', offset: 120 },
    { id: 'left', side: 'left', offset: 0 },
  ] });
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
  diagram.addBlock({ id: 'B1', rect: { x: 0, y: 0, w: 240, h: 160 }, terminals: [{ id: 'in', side: 'left', offset: 160 }] });
  diagram.resizeBlock('B1', 160, 80);
  assert.deepEqual(diagram.getTerminal('B1.in').toJSON(), { id: 'in', side: 'left', offset: 80 });
});

test('resize rejects clamped terminal collisions atomically', () => {
  const diagram = new BlockDiagram();
  const block = diagram.addBlock({ id: 'B1', rect: { x: 0, y: 0, w: 240, h: 160 }, terminals: [
    { id: 'top', side: 'top', offset: 160 },
    { id: 'right', side: 'right', offset: 0 },
  ] });
  assert.throws(() => diagram.resizeBlock('B1', 80, 80), /coincident terminal/);
  assert.deepEqual(block.rect, { x: 0, y: 0, w: 240, h: 160 });
});

test('invalid terminal moves leave the terminal unchanged', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'B1', rect: { x: 0, y: 0, w: 160, h: 80 } });
  diagram.addTerminal('B1', { id: 'out', side: 'right', offset: 40 });
  assert.throws(() => diagram.moveTerminal('B1.out', 'top', 999), /between 0 and 160/);
  assert.deepEqual(diagram.getTerminal('B1.out').toJSON(), { id: 'out', side: 'right', offset: 40 });
});

test('terminal additions and moves reject generated terminal collisions', () => {
  const diagram = new BlockDiagram();
  const block = diagram.addBlock({ id: 'B1', rect: { x: 0, y: 0, w: 160, h: 80 } });
  assert.throws(() => diagram.addTerminal('B1', { id: 'explicit', side: 'top', offset: 40 }), /already occupied/);
  diagram.addTerminal('B1', { id: 'explicit', side: 'right', offset: 40 });
  assert.throws(() => diagram.moveTerminal('B1.explicit', 'top', 40), /already occupied/);
  assert.deepEqual(block.getTerminal('explicit').toJSON(), { id: 'explicit', side: 'right', offset: 40 });
  diagram.addBlock({ id: 'B2', rect: { x: 400, y: 0, w: 160, h: 80 }, terminals: [{ id: 'top', side: 'top', offset: 0 }] });
  assert.throws(() => diagram.addTerminal('B2', { id: 'left', side: 'left', offset: 0 }), /already occupied/);
});

test('annotation rename updates visible child text', () => {
  const diagram = new BlockDiagram();
  diagram.addAnnotation('box', { id: 'A1', text: 'Old', x: 0, y: 0, end: { x: 80, y: 80 } });
  runCommand(diagram, 'annotation rename A1 New');
  assert.equal([...diagram.labels.values()].find((label) => label.parent === 'A1').text, 'New');
});

test('line annotation commands create two-point lines', () => {
  const diagram = new BlockDiagram();
  runCommand(diagram, 'annotation add line L1 note 0 0 80 0');
  const line = diagram.labels.get('L1');
  assert.deepEqual(line.points, [{ x: 0, y: 0 }, { x: 80, y: 0 }]);
});

test('arrow identity is terminal-based and block deletion cascades incident arrows', () => {
  const diagram = fixture();
  assert.deepEqual(diagram.getArrow('A1').from, { block: 'B1', terminal: 'out' });
  assert.deepEqual(diagram.getArrow('A1').to, { block: 'B2', terminal: 'in' });
  assert.throws(() => diagram.removeTerminal('B1.out'), /arrows reference/);
  diagram.removeBlock('B1');
  assert.equal(diagram.arrows.size, 0);
});

test('detached visual arrows survive block operations and keep their geometry', () => {
  const diagram = new BlockDiagram({
    blocks: [{ id: 'B1', rect: { x: 0, y: 0, w: 160, h: 80 } }],
    arrows: [{ id: 'A1', detached: true, routingMode: 'fixed', points: [{ x: 0, y: 40 }, { x: 240, y: 40 }] }],
  });
  diagram.moveBlock('B1', 160, 160);
  assert.deepEqual(diagram.getArrow('A1').points, [{ x: 0, y: 40 }, { x: 240, y: 40 }]);
  assert.match(runCommand(diagram, 'list').text, /A1 \(detached visual connector\)/);
  diagram.removeBlock('B1');
  assert.equal(diagram.arrows.size, 1);
});

test('detaching an attached arrow preserves its route while allowing independent movement', () => {
  const diagram = fixture();
  const route = diagram.getArrow('A1').points.map((point) => ({ ...point }));
  diagram.detachArrow('A1');
  diagram.moveBlock('B1', 0, 160);
  assert.equal(diagram.getArrow('A1').detached, true);
  assert.deepEqual(diagram.getArrow('A1').points, route);
});

test('detached block moves preserve internal connectors and detach boundary connectors', () => {
  const diagram = fixture();
  diagram.addBlock({ id: 'B3', rect: { x: 800, y: 160, w: 160, h: 80 } });
  diagram.addTerminal('B3', { id: 'in', side: 'left', offset: 40 });
  diagram.addArrow({ id: 'A2', from: 'B2.in', to: 'B3.in' });
  diagram.detachBoundaryArrows(['B1', 'B2']);
  assert.equal(diagram.getArrow('A1').detached, false);
  assert.equal(diagram.getArrow('A2').detached, true);
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
