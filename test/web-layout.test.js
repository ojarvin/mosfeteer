import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSymbol } from '../src/core/components/index.js';
import {
  alignmentPlan, describeGuides, distributionPlan, ghostLayoutItem, layoutAnchor,
  layoutSuggestions, placementGuides,
} from '../src/web/layout.js';

const item = (id, x, y, w = 80, h = 80, type = 'resistor') => ({
  id, kind: 'component', type, rotation: 0,
  anchor: { x, y }, bbox: { x: x - w / 2, y: y - h / 2, w, h },
});

test('a generic symbol anchor uses declared terminals and survives mirroring', () => {
  const def = getSymbol('nmos');
  assert.deepEqual(def.layoutAnchorTerminals, ['d', 's']);
  assert.deepEqual(layoutAnchor(def, { x: 400, y: 240, rotation: 0, mirrorX: true, mirrorY: false }), { x: 400, y: 240 });
  const ghost = ghostLayoutItem({ def, x: 400, y: 240, rotation: 0, mirrorX: true, mirrorY: false });
  assert.deepEqual(ghost.anchor, { x: 400, y: 240 });
  assert.notEqual(ghost.bbox.x + ghost.bbox.w / 2, ghost.anchor.x, 'asymmetric bbox center is not the spacing anchor');
});

test('align uses the outer bbox of the whole selection and refuses off-grid claims', () => {
  const a = item('A', 0, 0);
  const b = item('B', 200, 80);
  const left = alignmentPlan([a, b], 'left');
  assert.equal(left.ok, true);
  assert.deepEqual(left.deltas, [
    { id: 'A', dx: 0, dy: 0 },
    { id: 'B', dx: -200, dy: 0 },
  ]);
  const top = alignmentPlan([a, b], 'top');
  assert.deepEqual(top.deltas[1], { id: 'B', dx: 0, dy: -80 });
  const odd = item('C', 200, 0, 104);
  assert.equal(alignmentPlan([a, odd], 'left').ok, false);
});

test('distribution distinguishes outline gaps from anchor intervals and holds outer objects', () => {
  const a = item('A', 0, 0);
  const b = item('B', 280, 0);
  const c = item('C', 640, 0);
  const anchors = distributionPlan([a, b, c], 'x', 'anchors');
  assert.equal(anchors.ok, true);
  assert.deepEqual(anchors.deltas, [
    { id: 'A', dx: 0, dy: 0 },
    { id: 'B', dx: 40, dy: 0 },
    { id: 'C', dx: 0, dy: 0 },
  ]);
  const wide = { ...item('B', 280, 0), bbox: { x: 160, y: -40, w: 160, h: 80 } };
  const gaps = distributionPlan([a, wide, c], 'x', 'gaps');
  assert.equal(gaps.ok, true);
  assert.notDeepEqual(gaps.deltas, anchors.deltas);
  assert.equal(distributionPlan([a, b], 'x', 'anchors').ok, false);
});

test('a guide measures to the position it points at, standing there or not', () => {
  const peers = [item('A', 0, 0), item('B', 320, 0)];
  const arrived = placementGuides(peers, item('__ghost__', 640, 0)).find((guide) => guide.kind === 'spacing');
  assert.equal(arrived.exact, true);
  assert.equal(arrived.cells, 8);
  // Three anchors in axis order: the two intervals drawn between them are the
  // equal ones being claimed.
  assert.deepEqual(arrived.points, [
    { id: 'A', x: 0, y: 0, moving: false },
    { id: 'B', x: 320, y: 0, moving: false },
    { id: '__ghost__', x: 640, y: 0, moving: true },
  ]);
  // One cell short, the same target is offered instead of confirmed -- and the
  // moving point still sits ON it, so both labels stay the target's own.
  const offered = placementGuides(peers, item('__ghost__', 600, 0)).find((guide) => guide.kind === 'spacing');
  assert.equal(offered.exact, false);
  assert.equal(offered.target, 640);
  assert.equal(offered.cells, 8);
  assert.equal(offered.points.at(-1).x, 640);
  assert.equal(describeGuides([offered]), 'even horizontal spacing 8 cells (A, B) 1 cell right');
  // Further off than half the interval it would create, it is not offered at
  // all: the object is not near that position, it is between two of them.
  assert.equal(placementGuides(peers, item('__ghost__', 440, 0))
    .find((guide) => guide.kind === 'spacing'), undefined);
});

test('two placed columns predict the third from either side', () => {
  const peers = [item('M1', 0, 0, 120, 160, 'pmos'), item('M2', 320, 0, 120, 160, 'pmos')];
  const next = placementGuides(peers, item('__ghost__', 560, 0, 120, 160, 'pmos'))
    .find((guide) => guide.kind === 'spacing');
  assert.equal(next.target, 640);
  assert.deepEqual(next.points.map((point) => point.id), ['M1', 'M2', '__ghost__']);
  // The run reads backwards too, so the order the first two were drawn in
  // never decides whether the third is guided.
  const back = placementGuides(peers, item('__ghost__', -240, 0, 120, 160, 'pmos'))
    .find((guide) => guide.kind === 'spacing');
  assert.equal(back.target, -320);
  assert.deepEqual(back.points.map((point) => point.id), ['__ghost__', 'M1', 'M2']);
});

test('a part to the side is centred between two stacked components', () => {
  // Ten cells apart in a column; the port sits well off to the right, which is
  // where an output branch puts it.
  const stack = [item('M1', 0, 0, 120, 160, 'nmos'), item('M2', 0, 400, 120, 160, 'nmos')];
  const guide = placementGuides(stack, item('__ghost__', 480, 200, 80, 80, 'port'))
    .find((candidate) => candidate.kind === 'spacing');
  assert.equal(guide.axis, 'y');
  assert.equal(guide.exact, true);
  assert.equal(guide.cells, 5);
  assert.deepEqual(guide.points.map((point) => point.id), ['M1', '__ghost__', 'M2']);
  // And it is offered on the way in, naming the direction in world terms:
  // y grows downward, so a target further down the axis is below.
  const approaching = placementGuides(stack, item('__ghost__', 480, 160, 80, 80, 'port'))
    .find((candidate) => candidate.kind === 'spacing');
  assert.equal(approaching.exact, false);
  assert.equal(approaching.target, 200);
  assert.equal(describeGuides([approaching]), 'even vertical spacing 5 cells (M1, M2) 1 cell down');
  const above = placementGuides(stack, item('__ghost__', 480, 240, 80, 80, 'port'))
    .find((candidate) => candidate.kind === 'spacing');
  assert.equal(describeGuides([above]), 'even vertical spacing 5 cells (M1, M2) 1 cell up');
});

test('an odd gap has no grid centre and the guide says so', () => {
  const stack = [item('M1', 0, 0, 120, 160, 'nmos'), item('M2', 0, 360, 120, 160, 'nmos')];
  const guide = placementGuides(stack, item('__ghost__', 480, 200, 80, 80, 'port'))
    .find((candidate) => candidate.kind === 'spacing');
  assert.equal(guide.offGrid, true);
  assert.equal(guide.exact, false);
  assert.equal(guide.target, 180);
  assert.equal(guide.cells, 4.5);
  assert.equal(describeGuides([guide]), 'no grid centre between M1, M2: an odd gap halves to 4.5 cells');
  // A reachable relationship is always preferred over reporting that one.
  const even = placementGuides([item('M1', 0, 0), item('M2', 0, 400)], item('__ghost__', 480, 200));
  assert.equal(even.find((candidate) => candidate.kind === 'spacing').offGrid, false);
});

test('the guide names the branch being worked next to, not its mirror', () => {
  // A 5T OTA's two branches: an NMOS/PMOS pair each side of the output column.
  // Both offer the same vertical centre, so the nearer one has to win outright.
  const stage = [
    item('M1', -480, -400, 120, 160, 'pmos'), item('M2', -480, 400, 120, 160, 'nmos'),
    item('M3', 480, -400, 120, 160, 'pmos'), item('M4', 480, 400, 120, 160, 'nmos'),
  ];
  const right = placementGuides(stage, item('__ghost__', 800, 0, 80, 80, 'port'))
    .find((guide) => guide.kind === 'spacing');
  assert.deepEqual(right.points.map((point) => point.id), ['M3', '__ghost__', 'M4']);
  const left = placementGuides(stage, item('__ghost__', -800, 0, 80, 80, 'port'))
    .find((guide) => guide.kind === 'spacing');
  assert.deepEqual(left.points.map((point) => point.id), ['M1', '__ghost__', 'M2']);
});

test('an unrelated part standing in a row does not hide the row', () => {
  // Pairs are enumerated, so C between A and B does not stop A and B defining
  // the run the ghost continues.
  const peers = [item('A', 0, 0), item('C', 160, 0), item('B', 320, 0)];
  const guide = placementGuides(peers, item('__ghost__', 640, 0)).find((candidate) => candidate.kind === 'spacing');
  assert.equal(guide.exact, true);
  assert.deepEqual(guide.points.map((point) => point.id), ['A', 'B', '__ghost__']);
});

test('spacing is recognised centred between two peers and ahead of a run', () => {
  const outer = [item('A', 0, 0), item('C', 640, 0)];
  const centred = placementGuides(outer, item('__ghost__', 320, 0)).find((guide) => guide.kind === 'spacing');
  assert.equal(centred.cells, 8);
  assert.deepEqual(centred.points.map((point) => point.id), ['A', '__ghost__', 'C']);
  // A run continued backwards is the same relationship seen from the other end.
  const before = placementGuides([item('B', 320, 0), item('C', 640, 0)], item('__ghost__', 0, 0))
    .find((guide) => guide.kind === 'spacing');
  assert.deepEqual(before.points.map((point) => point.id), ['__ghost__', 'B', 'C']);
});

test('a differential pair spaces off the tail device across its own row', () => {
  // M1 input, then the tail 8 right and 4 down, then the second input: the
  // spacing that matters is the horizontal one, which the tail's row offset
  // must not hide, and the second input is back on the first input's row.
  const peers = [item('M1', 0, 0, 120, 160, 'nmos'), item('M3', 320, 160, 120, 160, 'nmos')];
  const guides = placementGuides(peers, item('__ghost__', 640, 0, 120, 160, 'nmos'));
  const spacing = guides.find((guide) => guide.kind === 'spacing');
  assert.equal(spacing.axis, 'x');
  assert.equal(spacing.cells, 8);
  assert.deepEqual(spacing.points.map((point) => point.id), ['M1', 'M3', '__ghost__']);
  const align = guides.find((guide) => guide.kind === 'align');
  assert.equal(align.axis, 'y');
  assert.equal(align.value, 0);
  assert.deepEqual(align.points.map((point) => point.id), ['M1', '__ghost__']);
  assert.equal(describeGuides(guides), 'even horizontal spacing 8 cells (M1, M3) · row with M1');
});

test('a tail device of another type still anchors the spacing', () => {
  const peers = [item('M1', 0, 0, 120, 160, 'nmos'), item('I1', 320, 160, 80, 160, 'current_source')];
  const spacing = placementGuides(peers, item('__ghost__', 640, 0, 120, 160, 'nmos'))
    .find((guide) => guide.kind === 'spacing');
  assert.deepEqual(spacing.points.map((point) => point.id), ['M1', 'I1', '__ghost__']);
});

test('guides stay local: a distant peer neither spaces nor aligns', () => {
  // The same 8-cell interval, but the run sits far off the measured axis.
  const far = [item('A', 0, 2000), item('B', 320, 2000)];
  assert.deepEqual(placementGuides(far, item('__ghost__', 640, 0)), []);
  // A part sharing the row from the far side of the drawing is a coincidence.
  assert.deepEqual(placementGuides([item('A', 40000, 0)], item('__ghost__', 0, 0)), []);
  // And an interval nothing would call a spacing is not reported as one.
  assert.deepEqual(placementGuides([item('A', -80000, 0), item('B', -40000, 0)], item('__ghost__', 0, 0)), []);
});

test('an alignment guide reaches only the immediate neighbours', () => {
  const row = [item('A', -640, 0), item('B', -320, 0), item('C', 320, 0)];
  const align = placementGuides(row, item('__ghost__', 0, 0)).find((guide) => guide.kind === 'align');
  assert.deepEqual(align.points.map((point) => point.id), ['B', '__ghost__', 'C']);
});

test('the closest couple stays responsible for a middle guide while the cursor moves', () => {
  const stage = [
    item('M8', 0, 0), item('M9', 480, 0),
    item('M6', 0, 320), item('M7', 480, 320),
    item('M4', 0, 640), item('M5', 480, 640),
  ];
  for (const [x, y] of [[960, 400], [960, 440], [1000, 440]]) {
    const guide = placementGuides(stage, item('__ghost__', x, y, 80, 80, 'port'))
      .find((candidate) => candidate.kind === 'spacing' && candidate.axis === 'y');
    assert.deepEqual(guide.points.map((point) => point.id), ['M7', '__ghost__', 'M5']);
  }
});

test('a nearer mixed pair beats a farther same-type continuation', () => {
  const stage = [
    item('M8', 0, 0, 80, 80, 'pmos'), item('M9', 480, 0, 80, 80, 'pmos'),
    item('M6', 0, 320, 80, 80, 'pmos'), item('M7', 480, 320, 80, 80, 'pmos'),
    item('M4', 0, 640, 80, 80, 'nmos'), item('M5', 480, 640, 80, 80, 'nmos'),
  ];
  const guide = placementGuides(stage, item('__ghost__', 960, 480, 80, 80, 'pmos'))
    .find((candidate) => candidate.kind === 'spacing' && candidate.axis === 'y');
  assert.equal(guide.cells, 4);
  assert.equal(guide.exact, true);
  assert.deepEqual(guide.points.map((point) => point.id), ['M7', '__ghost__', 'M5']);
});

test('a repeated pitch remains visible after the first target is passed', () => {
  const row = [item('M6', 0, 0), item('M7', 480, 0)];
  const guide = placementGuides(row, item('__ghost__', 1440, 0, 80, 80, 'port'))
    .find((candidate) => candidate.kind === 'spacing');
  assert.equal(guide.cells, 12);
  assert.equal(guide.exact, true);
  assert.deepEqual(guide.points.map((point) => point.id), ['M6', 'M7', '__spacing_x_1', '__ghost__']);
  assert.equal(guide.points[2].synthetic, true);
});

test('a continuation guide marks a grid midpoint against its full pitch', () => {
  const guide = placementGuides([item('A', 0, 0), item('B', 480, 0)], item('__ghost__', 720, 0))
    .find((candidate) => candidate.kind === 'spacing' && candidate.axis === 'x');
  assert.equal(guide.cells, 12);
  assert.equal(guide.exact, false);
  assert.deepEqual(guide.halfway, {
    cells: 6,
    from: { id: 'B', x: 480, y: 0, moving: false },
    at: { id: '__ghost__', x: 720, y: 0, moving: true },
  });
  // A one-cell offset is no longer the halfway reference, and an odd pitch
  // has no grid midpoint to mark.
  assert.equal(placementGuides([item('A', 0, 0), item('B', 480, 0)], item('__ghost__', 680, 0))
    .find((candidate) => candidate.kind === 'spacing' && candidate.axis === 'x')?.halfway, undefined);
  assert.equal(placementGuides([item('A', 0, 0), item('B', 360, 0)], item('__ghost__', 540, 0))
    .find((candidate) => candidate.kind === 'spacing' && candidate.axis === 'x')?.halfway, undefined);
});

test('layout suggestions are conservative and separate from electrical check', () => {
  assert.deepEqual(layoutSuggestions([item('A', 0, 0), item('B', 320, 0)]), []);
  const spacing = layoutSuggestions([item('A', 0, 0), item('B', 320, 0), item('C', 600, 0)]);
  assert.ok(spacing.some((suggestion) => suggestion.kind === 'spacing' && suggestion.ids.length === 3));
  const alignment = layoutSuggestions([
    item('A', 0, 0), item('B', 320, 0), item('C', 640, 0), item('D', 960, 40),
  ]);
  assert.ok(alignment.some((suggestion) => suggestion.kind === 'alignment' && suggestion.ids.includes('D')));
});

test('the editor draws and names the guides it computed', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  // Guides describe the object being placed or moved against what is already
  // committed, so the moving set and generated junction dots are not peers.
  assert.match(main, /!ghostRefs\.has\(component\.refdes\) && component\.type !== 'solder'/);
  // The status line names the same relationship the dimension lines measure.
  assert.match(main, /activePlacementGuides = placementGuide\?\.guides \|\| \[\]/);
  assert.match(main, /parts\.push\(describeGuides\(activePlacementGuides\)\)/);

  const render = readFileSync(new URL('../src/core/render.js', import.meta.url), 'utf8');
  const overlay = render.slice(render.indexOf('if (opts.placementGuide?.guides?.length)'),
    render.indexOf('// A marquee/visual selection is only a preview'));
  // Every interval is drawn between two anchors the guide carries, with a
  // leader from each, and both equal intervals are labelled the same way.
  assert.match(overlay, /for \(let i = 0; i \+ 1 < guide\.points\.length; i \+= 1\)/);
  assert.equal((overlay.match(/\$\{guide\.cells\} cells/g) || []).length, 2);
  assert.match(overlay, /leader = \(p\)/);
  // It is an overlay: no coordinate of the moving object is touched here.
  assert.doesNotMatch(overlay, /moving\.(anchor|bbox)\.[xy] =/);
});

test('a suggested guide is drawn as one, and the crosshair stays out of its way', () => {
  const render = readFileSync(new URL('../src/core/render.js', import.meta.url), 'utf8');
  const overlay = render.slice(render.indexOf('if (opts.placementGuide?.guides?.length)'),
    render.indexOf('// A marquee/visual selection is only a preview'));
  // Not yet standing there: dashed bars, a line across the target column or
  // row, and a hollow point, so a suggestion never reads as a measurement of
  // where the object actually is.
  assert.match(overlay, /const pending = !guide\.exact;/);
  assert.match(overlay, /if \(pending\) \{[\s\S]*Where to land/);
  assert.match(overlay, /dot\(p, guide\.exact, color\)/);
  assert.match(overlay, /p\.moving && !p\.synthetic && solid/);
});

test('the cursor crosshair starts off, leaving the guides to carry position', () => {
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(main, /let crosshairVisible = false;/);
});

test('the drawn gap is measured beside the centre of the parts', () => {
  // Two devices ten cells apart in a column, with a wire crossing the gap two
  // cells below the upper one: the parts centre and the free-space centre are
  // no longer the same place, and both are worth offering.
  const stack = [item('M1', 0, 0, 120, 160, 'nmos'), item('M2', 0, 400, 120, 160, 'nmos')];
  const occupancy = [
    { id: 'M1', x: -60, y: -80, w: 120, h: 160 },
    { id: 'M2', x: -60, y: 320, w: 120, h: 160 },
    { id: 'N1:1', x: -200, y: 120, w: 400, h: 0 },   // a wire run across the gap
  ];
  const guides = placementGuides(stack, item('__ghost__', 0, 220, 80, 80, 'port'), undefined, occupancy);
  const space = guides.find((guide) => guide.basis === 'space');
  // Free space runs from the wire at y=120 to M2's top edge at y=320.
  assert.equal(space.axis, 'y');
  assert.equal(space.target, 220);
  assert.equal(space.cells, 2.5);
  assert.equal(space.exact, true);
  assert.equal(space.reference, true);
  assert.equal(describeGuides([space]), 'vertical centre of the drawn gap, 2.5 cells each side');
  // The parts centre is elsewhere, and is still offered in its own right.
  const anchors = guides.find((guide) => guide.kind === 'spacing' && guide.basis !== 'space');
  assert.notEqual(anchors?.target, space.target);
});

test('the drawn gap is not offered when it agrees with the parts', () => {
  const stack = [item('M1', 0, 0, 120, 160, 'nmos'), item('M2', 0, 400, 120, 160, 'nmos')];
  // Nothing in the gap: both readings land on 200, so there is one line.
  const occupancy = [
    { id: 'M1', x: -60, y: -80, w: 120, h: 160 },
    { id: 'M2', x: -60, y: 320, w: 120, h: 160 },
  ];
  const guides = placementGuides(stack, item('__ghost__', 0, 200, 80, 80, 'port'), undefined, occupancy);
  assert.equal(guides.filter((guide) => guide.basis === 'space').length, 0);
  // Ink outside the object's own corridor never narrows its gap.
  const aside = [...occupancy, { id: 'N9:1', x: 2000, y: 120, w: 400, h: 0 }];
  const far = placementGuides(stack, item('__ghost__', 0, 200, 80, 80, 'port'), undefined, aside);
  assert.equal(far.filter((guide) => guide.basis === 'space').length, 0);
});

test('a gap whose centre falls between grid lines is still shown', () => {
  // Edges are wherever the ink is, so the middle of a gap is usually not a
  // place anything can sit. It is a line to read, not a target to land on.
  const stack = [item('M1', 0, 0, 120, 160, 'nmos'), item('M2', 0, 480, 120, 160, 'nmos')];
  const occupancy = [
    { id: 'M1', x: -60, y: -80, w: 120, h: 160 },
    { id: 'M2', x: -60, y: 400, w: 120, h: 160 },
    { id: 'N1:1', x: -200, y: 120, w: 400, h: 0 },
  ];
  const space = placementGuides(stack, item('__ghost__', 0, 240, 80, 80, 'port'), undefined, occupancy)
    .find((guide) => guide.basis === 'space');
  assert.equal(space.target, 260);           // between the wire at 120 and M2 at 400
  assert.equal(space.offGrid, true);
  assert.equal(space.exact, false);
  assert.equal(describeGuides([space]), 'vertical centre of the drawn gap, 3.5 cells each side (between grid lines)');
});
