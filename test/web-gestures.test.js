import test from 'node:test';
import assert from 'node:assert/strict';
import { getSymbol } from '../src/core/components/index.js';
import { applyTransform } from '../src/core/geometry.js';
import {
  arrivalDirection, easeOutCubic, isPinDragCandidate, knifeCrossings, lerpView, quickAddPlacement, zoomView,
  pinJoinPoints, radialRingRadius, radialSector, segmentsIntersect, signalSpliceRotation, spliceCandidate, upstreamEnd, wheelIntent,
} from '../src/web/gestures.js';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';

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
      mirrorX: placement.mirrorX, mirrorY: placement.mirrorY }, t.x, t.y);
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
  // Markers sit on the point with their pin facing back along the wire.
  const hang = (type, direction) => {
    const { placement: p } = landed(type, direction);
    const b = def(type).bbox;
    const centre = applyTransform({ x: 0, y: 0, rotation: p.rotation, mirrorX: p.mirrorX, mirrorY: p.mirrorY }, b.x + b.w / 2, b.y + b.h / 2);
    assert.deepEqual({ x: p.x, y: p.y }, point);
    return { x: Math.sign(Math.round(centre.x)), y: Math.sign(Math.round(centre.y)), rotation: p.rotation };
  };
  assert.deepEqual(hang('ground', { x: 0, y: 1 }), { x: 0, y: 1, rotation: 0 });
  assert.deepEqual(hang('supply', { x: 0, y: -1 }), { x: 0, y: -1, rotation: 0 });
  for (const type of ['ground', 'supply', 'vcm']) {
    for (const direction of [{ x: 1, y: 0 }, { x: -1, y: 0 }]) {
      const got = hang(type, direction);
      assert.deepEqual({ x: got.x, y: got.y }, direction, `${type} toward ${direction.x}`);
    }
  }
  // PMOS honours its default mirror while scoring.
  ({ world } = landed('pmos', { x: 0, y: -1 }));
  assert.deepEqual(world, point);
});

test('quick-add ports face along the wire and parts inherit the source pose', () => {
  const point = { x: 400, y: 200 };
  const pose = (placement) => ({ rotation: placement.rotation, mirrorX: placement.mirrorX, mirrorY: placement.mirrorY });
  // An input port on a leftward wire keeps its textbook pose, with its pin on the point.
  let placement = quickAddPlacement(def('input'), point, { x: -1, y: 0 });
  assert.deepEqual(pose(placement), { rotation: 0, mirrorX: false, mirrorY: false });
  assert.deepEqual({ x: placement.x, y: placement.y }, point);
  // From a mirrored MOS gate the wire runs right: the port mirrors instead of turning.
  placement = quickAddPlacement(def('input'), point, { x: 1, y: 0 });
  assert.deepEqual(pose(placement), { rotation: 0, mirrorX: true, mirrorY: false });
  // Output ports already face right by default and flip for a leftward wire.
  assert.equal(quickAddPlacement(def('output'), point, { x: 1, y: 0 }).mirrorX, true);
  assert.equal(quickAddPlacement(def('output'), point, { x: -1, y: 0 }).mirrorX, false);
  // A vertical wire turns the port so its body continues the wire.
  placement = quickAddPlacement(def('port'), point, { x: 0, y: 1 });
  const body = applyTransform({ x: 0, y: 0, ...pose(placement) }, -40, 0);
  assert.ok(body.y > 0 && body.x === 0);
  // Ground turns rather than mirrors, whatever the source.
  assert.deepEqual(pose(quickAddPlacement(def('ground'), point, { x: 0, y: 1 }, { rotation: 0, mirrorX: true })),
    { rotation: 0, mirrorX: false, mirrorY: false });
  assert.equal(pose(quickAddPlacement(def('ground'), point, { x: 1, y: 0 }, { rotation: 0, mirrorX: true })).mirrorX, false);
  // Stacking on a mirrored NMOS drain inherits the mirror; PMOS keeps its default Y mirror.
  const mirroredNmos = { rotation: 0, mirrorX: true, mirrorY: false };
  assert.deepEqual(pose(quickAddPlacement(def('nmos'), point, { x: 0, y: -1 }, mirroredNmos)), { rotation: 0, mirrorX: true, mirrorY: false });
  assert.deepEqual(pose(quickAddPlacement(def('pmos'), point, { x: 0, y: -1 }, mirroredNmos)), { rotation: 0, mirrorX: true, mirrorY: true });
  // An unmirrored source keeps the defaults.
  assert.deepEqual(pose(quickAddPlacement(def('nmos'), point, { x: 0, y: -1 }, { rotation: 0 })), { rotation: 0, mirrorX: false, mirrorY: false });
  // A MOS added on a mirrored gate's wire lands upright, gate to gate.
  placement = quickAddPlacement(def('nmos'), point, { x: 1, y: 0 }, mirroredNmos);
  assert.equal(placement.terminal, 'g');
  assert.deepEqual(pose(placement), { rotation: 0, mirrorX: false, mirrorY: false });
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

test('a signal-flow part dropped on a wire lies along it, its input toward the driver', () => {
  // A wire driven from its right end (x = 800), turning down at its left.
  const net = [[{ x: 800, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 400 }]];
  const paths = net.map((pts, branch) => ({ netId: 'N1', branch, pts }));
  const upstream = (target) => upstreamEnd(target, net, [{ x: 800, y: 0 }]);
  // A part at (400, 0): rot 0 has in at -80, out at +80 along x.
  const pinsAt = (at) => (rotation) => {
    const turn = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[rotation];
    return { in: { x: at.x - 80 * turn[0], y: at.y - 80 * turn[1] }, out: { x: at.x + 80 * turn[0], y: at.y + 80 * turn[1] } };
  };
  // Signal runs right to left: turned 180, its input on the right.
  assert.equal(signalSpliceRotation(pinsAt({ x: 400, y: 0 }), paths, upstream).rotation, 180);
  // On the vertical run the signal goes down: turned 90.
  assert.equal(signalSpliceRotation(pinsAt({ x: 0, y: 200 }), paths, upstream).rotation, 90);
  // No driver known: the first rotation that fits.
  assert.equal(signalSpliceRotation(pinsAt({ x: 400, y: 0 }), paths, () => null).rotation, 0);
  assert.equal(signalSpliceRotation(pinsAt({ x: 400, y: 200 }), paths, upstream), null);
  // A pin mid-way along another branch still links it to the driver.
  const tee = [[{ x: 0, y: 0 }, { x: 800, y: 0 }], [{ x: 400, y: 0 }, { x: 400, y: 400 }]];
  assert.equal(upstreamEnd({ branch: 1, segment: 1, a: { x: 400, y: 0 }, b: { x: 400, y: 400 } }, tee, [{ x: 800, y: 0 }]), 'a');
  assert.equal(upstreamEnd({ branch: 1, segment: 1, a: { x: 400, y: 0 }, b: { x: 400, y: 400 } }, tee, [{ x: 400, y: 400 }]), 'b');
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

test('knife strokes cross rectangles and polylines', async () => {
  const { strokeCrossesRect, strokeCrossesPolyline } = await import('../src/web/gestures.js');
  const rect = { x: 0, y: 0, w: 100, h: 60 };
  assert.equal(strokeCrossesRect([{ x: -20, y: 30 }, { x: 120, y: 30 }], rect), true); // passes through
  assert.equal(strokeCrossesRect([{ x: 20, y: 20 }, { x: 40, y: 40 }], rect), true); // entirely inside
  assert.equal(strokeCrossesRect([{ x: -20, y: -20 }, { x: 120, y: -20 }], rect), false); // passes above
  assert.equal(strokeCrossesRect([{ x: 0, y: 0 }], rect), true);
  assert.equal(strokeCrossesRect([{ x: 0, y: 0 }, { x: 10, y: 10 }], { x: 0, y: 0, w: 0, h: 0 }), false);
  const line = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }];
  assert.equal(strokeCrossesPolyline([{ x: 100, y: -20 }, { x: 100, y: 20 }], line), true);
  assert.equal(strokeCrossesPolyline([{ x: 100, y: 20 }, { x: 180, y: 180 }], line), false);
});

test('Ctrl+A selects nets that join touching pins without any wire', async () => {
  const { selectAllNetIds } = await import('../src/core/selection.js');
  const { Circuit } = await import('../src/core/model.js');
  const circuit = new Circuit();
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R2', x: 160, y: 0 });
  assert.equal(circuit.nets.size, 1);
  assert.deepEqual(selectAllNetIds(circuit), [...circuit.nets.keys()]);
});
test('pin handles scale with the drawing within a screen-size band', async () => {
  const { pinHandleRadius } = await import('../src/web/gestures.js');
  // Mid zoom: the world radius (6 units) wins.
  assert.equal(pinHandleRadius(1.5), 6);
  // Zoomed in (0.5 units/px): capped at 4.5 px on screen.
  assert.equal(pinHandleRadius(0.5) / 0.5, 4.5);
  // Zoomed far out (6 units/px): kept at 2 px so it stays visible.
  assert.equal(pinHandleRadius(6) / 6, 2);
  assert.equal(pinHandleRadius(0), 4.5);
});

test('radial tiles on the ring are separated by the same gap', () => {
  for (const count of [3, 5, 7, 8]) {
    const radius = radialRingRadius(count, 64, 10);
    const chord = 2 * radius * Math.sin(Math.PI / count);
    assert.ok(chord - 64 >= 10 && chord - 64 < 12, `count ${count}: gap ${chord - 64}`);
  }
  assert.equal(radialRingRadius(1, 64, 10), 0);
});

test('a carried pin joins another pin or a free wire end, and nothing it is already on', () => {
  const circuit = new Circuit();
  for (const line of ['add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'connect R1.b R2.a', 'disconnect R2.a', 'rm R2',
    'add capacitor C1 --at 0 400']) runCommand(circuit, line);
  // R1.b's wire now ends free at (320,0); C1's pins are at (-80,400) and (80,400).
  const ghost = (x, y) => [{ x: x - 80, y, netId: null }, { x: x + 80, y, netId: null }];
  assert.deepEqual(pinJoinPoints(circuit, ghost(400, 0)), [{ x: 320, y: 0 }]);
  assert.deepEqual(pinJoinPoints(circuit, ghost(160, 400)), [{ x: 80, y: 400 }]);
  assert.deepEqual(pinJoinPoints(circuit, ghost(1000, 1000)), []);
  // Moving C1 itself: its own pins are carried, never targets.
  const c1 = circuit.components.get('C1');
  const pins = c1.worldTerminals().map((t) => ({ x: t.x, y: t.y, netId: null }));
  assert.deepEqual(pinJoinPoints(circuit, pins, new Set(['C1'])), []);
  // A pin already on the net there joins nothing new; the wire's own end is
  // not offered to a part carrying that net.
  const net = circuit.netOfTerminal({ comp: 'R1', term: 'b' });
  assert.deepEqual(pinJoinPoints(circuit, [{ x: 320, y: 0, netId: net.id }]), []);
  // The middle of the wire: a pin on no net tees in; a wired pin never does.
  assert.deepEqual(pinJoinPoints(circuit, [{ x: 200, y: 0, netId: null }]), [{ x: 200, y: 0 }]);
  const other = circuit.netOfTerminal({ comp: 'C1', term: 'a' })?.id || 'N9';
  assert.deepEqual(pinJoinPoints(circuit, [{ x: 200, y: 0, netId: other }]), []);
});

test('a camera flight zooms geometrically about the point both views share', () => {
  const from = { x: 0, y: 0, w: 1000, h: 600 };
  const to = { x: 300, y: 200, w: 100, h: 60 };
  assert.deepEqual(zoomView(from, to, 0), from);
  const end = zoomView(from, to, 1);
  for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(end[key] - to[key]) < 1e-9, key);
  // Half way it is half way in scale: the geometric mean of the widths.
  assert.ok(Math.abs(zoomView(from, to, 0.5).w - Math.sqrt(from.w * to.w)) < 1e-9);
  // The shared point stays on the same spot of the pane all the way.
  const fx = (to.x * from.w - from.x * to.w) / (from.w - to.w);
  for (const t of [0.2, 0.5, 0.8]) {
    const v = zoomView(from, to, t);
    assert.ok(Math.abs((fx - v.x) / v.w - (fx - from.x) / from.w) < 1e-9);
  }
  // Views of one size simply pan.
  assert.deepEqual(zoomView(from, { ...from, x: 500 }, 1), { ...from, x: 500 });
});
