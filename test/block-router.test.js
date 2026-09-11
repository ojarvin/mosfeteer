import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockDiagram } from '../src/core/block-model.js';
import { BLOCK_ARROWHEAD_HALF_WIDTH, BLOCK_ARROWHEAD_LENGTH, blockArrowGeometry, blockConnectorJunctions, conformBlockArrowEndpoints, moveBlockArrowRun, pruneBlockArrowEndpointLoops, routeBlockArrow, routeIsOrthogonal } from '../src/core/block-router.js';

function diagramWithTerminals(sourceSide, targetSide, source = { x: 0, y: 0 }, target = { x: 480, y: 0 }) {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'S', rect: { ...source, w: 160, h: 160 }, terminals: [{ id: 'out', side: sourceSide, offset: 80 }] });
  diagram.addBlock({ id: 'T', rect: { ...target, w: 160, h: 160 }, terminals: [{ id: 'in', side: targetSide, offset: 80 }] });
  return diagram;
}

test('automatic routes use exact terminal endpoints and avoid a blocker', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'S', rect: { x: 0, y: 0, w: 160, h: 80 } });
  diagram.addBlock({ id: 'M', rect: { x: 240, y: -40, w: 160, h: 160 } });
  diagram.addBlock({ id: 'T', rect: { x: 480, y: 0, w: 160, h: 80 } });
  diagram.addTerminal('S', { id: 'out', side: 'right', offset: 40 });
  diagram.addTerminal('T', { id: 'in', side: 'left', offset: 40 });
  const arrow = diagram.addArrow({ id: 'A1', from: 'S.out', to: 'T.in' });
  assert.deepEqual(arrow.points[0], { x: 160, y: 40 });
  assert.deepEqual(arrow.points.at(-1), { x: 480, y: 40 });
  assert.ok(arrow.points.some((point) => point.y === -80 || point.y === 160), JSON.stringify(arrow.points));
  for (let i = 1; i < arrow.points.length; i++) {
    assert.ok(arrow.points[i].x === arrow.points[i - 1].x || arrow.points[i].y === arrow.points[i - 1].y);
  }
});

test('source and target sides enforce outward escape and inward approach', () => {
  const cases = [
    ['right', 'left', { x: 160, y: 80 }, { x: 480, y: 80 }],
    ['left', 'right', { x: 0, y: 80 }, { x: 640, y: 80 }],
    ['bottom', 'top', { x: 80, y: 160 }, { x: 560, y: 0 }],
    ['top', 'bottom', { x: 80, y: 0 }, { x: 560, y: 160 }],
  ];
  for (const [sourceSide, targetSide, source, target] of cases) {
    const diagram = diagramWithTerminals(sourceSide, targetSide, { x: 0, y: 0 }, { x: target.x - (targetSide === 'left' ? 0 : 160), y: target.y - (targetSide === 'top' ? 0 : 160) });
    const arrow = diagram.addArrow({ id: 'A1', from: 'S.out', to: 'T.in' });
    const first = arrow.points[1];
    const last = arrow.points.at(-2);
    const sourcePoint = diagram.terminalPoint('S.out');
    const targetPoint = diagram.terminalPoint('T.in');
    const direction = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
    assert.deepEqual({ x: Math.sign(first.x - sourcePoint.x), y: Math.sign(first.y - sourcePoint.y) }, direction[sourceSide]);
    assert.deepEqual({ x: Math.sign(targetPoint.x - last.x) || 0, y: Math.sign(targetPoint.y - last.y) || 0 }, { x: -direction[targetSide].x || 0, y: -direction[targetSide].y || 0 });
  }
});

test('endpoint conformance never folds back flat when a block overtakes its connector body', () => {
  const diagram = diagramWithTerminals('right', 'left', { x: 160, y: 0 }, { x: 640, y: 160 });
  const arrow = {
    from: { block: 'S', terminal: 'out' },
    to: { block: 'T', terminal: 'in' },
    points: [{ x: 320, y: 80 }, { x: 240, y: 80 }, { x: 240, y: 240 }, { x: 640, y: 240 }],
  };
  const route = conformBlockArrowEndpoints(diagram, arrow, arrow.points);
  assert.deepEqual(route.slice(0, 2), [{ x: 320, y: 80 }, { x: 360, y: 80 }]);
  for (let i = 2; i < route.length; i++) {
    const a = route[i - 2]; const b = route[i - 1]; const c = route[i];
    assert.notDeepEqual(
      { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) },
      { x: -Math.sign(c.x - b.x), y: -Math.sign(c.y - b.y) },
    );
  }
});

test('endpoint repair prunes a rectangular one-cell escape loop without moving later bends', () => {
  const route = pruneBlockArrowEndpointLoops([
    { x: 320, y: 80 }, { x: 360, y: 80 }, { x: 360, y: 120 },
    { x: 240, y: 120 }, { x: 240, y: 80 }, { x: 240, y: 240 }, { x: 640, y: 240 },
  ]);
  assert.deepEqual(route, [
    { x: 320, y: 80 }, { x: 360, y: 80 }, { x: 360, y: 240 }, { x: 640, y: 240 },
  ]);
});

test('adjacent facing terminals collapse to one straight connector', () => {
  const diagram = diagramWithTerminals('right', 'left', { x: 0, y: 0 }, { x: 200, y: 0 });
  const arrow = diagram.addArrow({ id: 'A1', from: 'S.out', to: 'T.in' });
  assert.deepEqual(arrow.points, [{ x: 160, y: 80 }, { x: 200, y: 80 }]);
});

test('diagonal layouts prefer a midpoint dogleg for fresh routes', () => {
  const diagram = diagramWithTerminals('right', 'left', { x: 0, y: 0 }, { x: 480, y: 160 });
  const arrow = diagram.addArrow({ id: 'A1', from: 'S.out', to: 'T.in' });
  assert.deepEqual(arrow.points, [
    { x: 160, y: 80 }, { x: 320, y: 80 }, { x: 320, y: 240 }, { x: 480, y: 240 },
  ]);
});

test('a safe outside L wins over a staircase with more bends', () => {
  const diagram = diagramWithTerminals('right', 'top', { x: 0, y: 0 }, { x: 480, y: 240 });
  const arrow = diagram.addArrow({ id: 'A1', from: 'S.out', to: 'T.in' });
  assert.deepEqual(arrow.points, [
    { x: 160, y: 80 }, { x: 560, y: 80 }, { x: 560, y: 240 },
  ]);
});

test('fan-out connectors may share a source trunk before branching', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'S', rect: { x: 0, y: 80, w: 160, h: 160 }, terminals: [{ id: 'out', side: 'right', offset: 80 }] });
  diagram.addBlock({ id: 'T1', rect: { x: 480, y: 0, w: 160, h: 160 }, terminals: [{ id: 'in', side: 'left', offset: 80 }] });
  diagram.addBlock({ id: 'T2', rect: { x: 480, y: 240, w: 160, h: 160 }, terminals: [{ id: 'in', side: 'left', offset: 80 }] });
  diagram.addArrow({ id: 'A1', from: 'S.out', to: 'T1.in' });
  diagram.addArrow({ id: 'A2', from: 'S.out', to: 'T2.in' });
  diagram.moveBlocks(['S'], 40, 0);
  const [a, b] = ['A1', 'A2'].map((id) => diagram.getArrow(id).points);
  assert.deepEqual(a[0], b[0]);
  assert.deepEqual(a[1], b[1]);
  assert.notDeepEqual(a.at(-1), b.at(-1));
});

test('moving a block arrow run keeps both terminal endpoints and orthogonal legs', () => {
  const moved = moveBlockArrowRun([{ x: 0, y: 0 }, { x: 160, y: 0 }], { lo: 0, hi: 1, orient: 'h' }, 80);
  assert.deepEqual(moved, [{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 0 }]);
  assert.equal(routeIsOrthogonal(moved), true);
});

test('block path compaction removes 180-degree folds and their sticks', () => {
  const moved = moveBlockArrowRun([
    { x: 0, y: 0 }, { x: 0, y: 40 }, { x: 20, y: 40 }, { x: 40, y: 40 },
    { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 80, y: 40 },
  ], { lo: 1, hi: 3, orient: 'h' }, 0);
  assert.deepEqual(moved, [
    { x: 0, y: 0 }, { x: 0, y: 40 }, { x: 80, y: 40 },
  ]);
});

test('shared connector trunks receive one junction dot at the branch', () => {
  const arrows = new Map([
    ['A1', { id: 'A1', points: [{ x: 0, y: 0 }, { x: 160, y: 0 }] }],
    ['A2', { id: 'A2', points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }] }],
  ]);
  assert.deepEqual(blockConnectorJunctions({ arrows }), [{ x: 80, y: 0 }]);
});

test('fixed route edits retain a terminal-facing arrow leg', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'S', rect: { x: 0, y: 0, w: 160, h: 80 }, terminals: [{ id: 'out', side: 'right', offset: 40 }] });
  diagram.addBlock({ id: 'T', rect: { x: 400, y: 0, w: 160, h: 80 }, terminals: [{ id: 'in', side: 'left', offset: 40 }] });
  const arrow = diagram.addArrow({ id: 'A1', from: 'S.out', to: 'T.in' });
  diagram.setArrowRoute('A1', [
    { x: 160, y: 40 }, { x: 320, y: 40 }, { x: 320, y: 80 },
    { x: 400, y: 80 }, { x: 400, y: 40 },
  ], 'fixed');
  assert.deepEqual(arrow.points.slice(-2), [{ x: 360, y: 40 }, { x: 400, y: 40 }]);
});

test('arrowhead geometry has exact cardinal orientation and terminal tip', () => {
  const right = blockArrowGeometry([{ x: 0, y: 0 }, { x: 120, y: 0 }]);
  assert.deepEqual(right.tip, { x: 120, y: 0 });
  assert.deepEqual(right.shaftPoints.at(-1), { x: 120 - BLOCK_ARROWHEAD_LENGTH, y: 0 });
  assert.deepEqual(right.left, { x: 120 - BLOCK_ARROWHEAD_LENGTH, y: -BLOCK_ARROWHEAD_HALF_WIDTH });
  assert.deepEqual(right.right, { x: 120 - BLOCK_ARROWHEAD_LENGTH, y: BLOCK_ARROWHEAD_HALF_WIDTH });
  const down = blockArrowGeometry([{ x: 0, y: 0 }, { x: 0, y: 120 }]);
  assert.deepEqual(down.shaftPoints.at(-1), { x: 0, y: 120 - BLOCK_ARROWHEAD_LENGTH });
  assert.deepEqual(down.left, { x: BLOCK_ARROWHEAD_HALF_WIDTH, y: 120 - BLOCK_ARROWHEAD_LENGTH });
  assert.deepEqual(down.right, { x: -BLOCK_ARROWHEAD_HALF_WIDTH, y: 120 - BLOCK_ARROWHEAD_LENGTH });
});

test('fixed routes are refreshed against the two-cell aura after a block move', () => {
  const diagram = new BlockDiagram();
  diagram.addBlock({ id: 'S', rect: { x: 0, y: 0, w: 160, h: 80 } });
  diagram.addBlock({ id: 'T', rect: { x: 400, y: 160, w: 160, h: 80 } });
  diagram.addTerminal('S', { id: 'out', side: 'right', offset: 40 });
  diagram.addTerminal('T', { id: 'in', side: 'left', offset: 40 });
  const arrow = diagram.addArrow({ id: 'A1', from: 'S.out', to: 'T.in', routingMode: 'fixed', points: [{ x: 160, y: 40 }, { x: 280, y: 40 }, { x: 280, y: 200 }, { x: 400, y: 200 }] });
  diagram.moveBlock('T', 480, 160);
  assert.deepEqual(arrow.points, [{ x: 160, y: 40 }, { x: 320, y: 40 }, { x: 320, y: 200 }, { x: 480, y: 200 }]);
  assert.equal(routeBlockArrow(diagram, arrow)[0].x, 160);
});
