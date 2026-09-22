import test from 'node:test';
import assert from 'node:assert/strict';
import { getSymbol } from '../src/core/components/index.js';
import { applyTransform } from '../src/core/geometry.js';
import {
  arrivalDirection, easeOutCubic, isPinDragCandidate, knifeCrossings, lerpView, quickAddPlacement,
  radialSector, segmentsIntersect, spliceCandidate, wheelIntent,
} from '../src/web/gestures.js';

const def = (type) => getSymbol(type);

test('pin drags wire only from multi-terminal parts', () => {
  assert.equal(isPinDragCandidate(def('resistor')), true);
  assert.equal(isPinDragCandidate(def('nmos')), true);
  assert.equal(isPinDragCandidate(def('ground')), false);
  assert.equal(isPinDragCandidate(def('port')), false);
  assert.equal(isPinDragCandidate(null), false);
});

test('arrival direction skips zero-length tail segments', () => {
  assert.deepEqual(arrivalDirection([{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 0, y: 80 }]), { x: 0, y: 1 });
  assert.equal(arrivalDirection([{ x: 1, y: 1 }]), null);
});

test('quick-add lands the chosen terminal on the drop point, body continuing the wire', () => {
  const point = { x: 400, y: 200 };
  const landed = (type, direction) => {
    const placement = quickAddPlacement(def(type), point, direction);
    const t = def(type).terminals.find((terminal) => terminal.name === placement.terminal);
    const world = applyTransform({ x: placement.x, y: placement.y, rotation: placement.rotation,
      mirrorX: !!def(type).defaultMirrorX, mirrorY: !!def(type).defaultMirrorY }, t.x, t.y);
    return { placement, world };
  };
  // A wire arriving rightwards meets a resistor's a terminal in its default pose.
  let { placement, world } = landed('resistor', { x: 1, y: 0 });
  assert.deepEqual(world, point);
  assert.equal(placement.rotation, 0);
  assert.equal(placement.terminal, 'a');
  assert.equal(placement.x, 480);
  // Arriving downwards, the resistor turns vertical and hangs below the point.
  ({ placement, world } = landed('resistor', { x: 0, y: 1 }));
  assert.deepEqual(world, point);
  assert.equal(placement.x, 400);
  assert.equal(placement.y, 280);
  // A MOS gate is the natural landing for a rightward wire.
  ({ placement, world } = landed('nmos', { x: 1, y: 0 }));
  assert.equal(placement.terminal, 'g');
  assert.deepEqual(world, point);
  // Markers keep their only pose and sit on the point.
  ({ placement } = landed('ground', { x: 1, y: 0 }));
  assert.deepEqual({ x: placement.x, y: placement.y, rotation: placement.rotation }, { x: 400, y: 200, rotation: 0 });
  // PMOS honours its default mirror while scoring.
  ({ world } = landed('pmos', { x: 0, y: -1 }));
  assert.deepEqual(world, point);
});

test('radial sectors start at the top and run clockwise, with a dead zone', () => {
  assert.equal(radialSector(0, -50, 4), 0);
  assert.equal(radialSector(50, 0, 4), 1);
  assert.equal(radialSector(0, 50, 4), 2);
  assert.equal(radialSector(-50, 0, 4), 3);
  assert.equal(radialSector(35, -35, 8), 1);
  assert.equal(radialSector(3, 3, 4), -1);
  assert.equal(radialSector(10, 10, 0), -1);
});

test('segment intersection covers crossings, touches, and misses', () => {
  const p = (x, y) => ({ x, y });
  assert.equal(segmentsIntersect(p(0, 0), p(10, 10), p(0, 10), p(10, 0)), true);
  assert.equal(segmentsIntersect(p(0, 0), p(10, 0), p(10, 0), p(10, 10)), true);
  assert.equal(segmentsIntersect(p(0, 0), p(10, 0), p(0, 5), p(10, 5)), false);
  assert.equal(segmentsIntersect(p(0, 0), p(10, 0), p(5, 0), p(20, 0)), true);
});

test('knife crossings report each crossed segment once as a wire key', () => {
  const paths = [
    { netId: 'N1', branch: 0, pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }] },
    { netId: 'N2', branch: 0, pts: [{ x: 0, y: 400 }, { x: 200, y: 400 }] },
  ];
  assert.deepEqual(knifeCrossings([{ x: 100, y: -50 }, { x: 100, y: 50 }, { x: 250, y: 100 }], paths).sort(), ['N1:0:1', 'N1:0:2']);
  assert.deepEqual(knifeCrossings([{ x: 100, y: 300 }], paths), []);
});

test('splice needs both terminals on one straight segment', () => {
  const paths = [{ netId: 'N1', branch: 0, pts: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }] }];
  const hit = spliceCandidate([{ x: 80, y: 0 }, { x: 240, y: 0 }], paths);
  assert.equal(hit.netId, 'N1');
  assert.equal(hit.segment, 1);
  assert.equal(spliceCandidate([{ x: 320, y: 0 }, { x: 480, y: 0 }], paths), null);
  assert.equal(spliceCandidate([{ x: 400, y: 40 }, { x: 400, y: 200 }], paths).segment, 2);
  assert.equal(spliceCandidate([{ x: 0, y: 0 }], paths), null);
});

test('wheel intent follows the scroll scheme; pinch always zooms', () => {
  assert.equal(wheelIntent({ ctrlKey: false }, 'mouse'), 'zoom');
  assert.equal(wheelIntent({ ctrlKey: false }, 'trackpad'), 'pan');
  assert.equal(wheelIntent({ ctrlKey: true }, 'trackpad'), 'zoom');
});

test('view easing interpolates and clamps', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(2), 1);
  const mid = lerpView({ x: 0, y: 0, w: 100, h: 50 }, { x: 100, y: 100, w: 200, h: 100 }, 0.5);
  assert.ok(mid.x > 50 && mid.x < 100);
  assert.deepEqual(lerpView({ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 6, w: 7, h: 8 }, 1), { x: 5, y: 6, w: 7, h: 8 });
});
