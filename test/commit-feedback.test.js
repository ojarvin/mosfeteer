import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { REVEAL_MS, commitFeedbackDiff, commitFeedbackSvg, isEmptyFeedback, pieceRuns, revealTime } from '../src/web/commit-feedback.js';

const clone = (circuit) => Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));

function twoResistors() {
  const c = new Circuit();
  c.addComponent('resistor', { x: 0, y: 0 });
  c.addComponent('resistor', { x: 400, y: 0 });
  return c;
}

test('an unchanged document produces no commit feedback', () => {
  const c = twoResistors();
  assert.ok(isEmptyFeedback(commitFeedbackDiff(clone(c), clone(c))));
});

test('only the labels an edit touched glow, whatever the browser measured', () => {
  const c = twoResistors();
  const note = c.addLabel({ text: 'note', x: 0, y: 400 });
  // The live labels carry browser text metrics; the committed copy does not.
  for (const label of c.labels.values()) label.setRenderedTextBounds(123, 45);
  const before = clone(c);
  c.addComponent('resistor', { x: 800, y: 0 });
  assert.deepEqual(commitFeedbackDiff(before, c).labels.map((label) => label.owner), ['R3']);
  const edited = clone(c);
  note.text = 'changed';
  assert.deepEqual(commitFeedbackDiff(edited, c).labels.map((label) => label.id), [note.id]);
});

test('a placed component glows along its own symbol and label, not a box', () => {
  const c = twoResistors();
  const before = clone(c);
  c.addComponent('resistor', { x: 800, y: 0 });
  const diff = commitFeedbackDiff(before, c);
  assert.deepEqual(diff.components.map((comp) => comp.refdes), ['R3']);
  assert.equal(diff.labels.length, 1, 'its owned label glows too');
  const { under } = commitFeedbackSvg(diff);
  assert.match(under, /<g class="landing-glow"><g transform="translate\(800/);
  assert.match(under, /<path d="M/, 'the resistor zigzag is traced');
  assert.doesNotMatch(under, /<rect/);
});

test('a new wire glows only its new pieces and ripples at both connected pins', () => {
  const c = twoResistors();
  const before = clone(c);
  c.connect('R1.b', 'R2.a');
  const diff = commitFeedbackDiff(before, c);
  assert.equal(diff.components.length, 0);
  assert.equal(diff.pieces.length, 6, 'a 240-unit wire is six grid pieces');
  assert.deepEqual(diff.points.map((p) => `${p.x},${p.y}`).sort(), ['320,0', '80,0']);
  const svg = commitFeedbackSvg(diff);
  assert.match(svg.reveal, /class="landing-reveal"/, 'the wire\'s own ink uncovered, no glow over it');
  assert.doesNotMatch(svg.over + svg.under, /landing-wire/);
  assert.match(svg.over, /class="landing-ripple"/);
});

test('deleting a wired component is a deletion even when the net reroutes', () => {
  const c = new Circuit();
  c.addComponent('resistor', { x: 0, y: 0 });
  c.addComponent('resistor', { x: 400, y: 0 });
  c.addComponent('resistor', { x: 400, y: 400 });
  c.connect('R1.b', 'R2.a');
  c.connect('R1.b', 'R3.a');
  const before = clone(c);
  c.removeComponent('R2');
  const diff = commitFeedbackDiff(before, c);
  assert.deepEqual(diff.removedComponents.map((comp) => comp.refdes), ['R2']);
  assert.equal(diff.pieces.length, 0, 'no green reroute flash');
  assert.equal(diff.points.length, 0);
  assert.match(commitFeedbackSvg(diff).over, /<g class="landing-removed">/);
});

test('a move glows the moved component and never reports the old route as removed', () => {
  const moved = twoResistors();
  moved.connect('R1.b', 'R2.a');
  const before = clone(moved);
  moved.moveComponent('R2', 400, 160);
  const diff = commitFeedbackDiff(before, moved);
  assert.deepEqual(diff.components.map((comp) => comp.refdes), ['R2']);
  assert.equal(diff.removedPieces.length, 0);
  assert.equal(diff.removedComponents.length, 0);
});

test('shortening a wire removes more than it adds but is not a deletion', () => {
  const c = twoResistors();
  c.connect('R1.b', 'R2.a');
  const net = [...c.nets.values()][0];
  net.branches = [[{ x: 80, y: 0 }, { x: 80, y: 160 }, { x: 320, y: 160 }, { x: 320, y: 0 }]];
  net.route = net.branches[0];
  const before = clone(c);
  net.branches = [[{ x: 80, y: 0 }, { x: 80, y: 40 }, { x: 320, y: 40 }, { x: 320, y: 0 }]];
  net.route = net.branches[0];
  const diff = commitFeedbackDiff(before, c);
  assert.ok(diff.pieces.length > 0 && diff.pieces.length < 14);
  assert.equal(diff.removedPieces.length, 0, 'no red halo at the old position');
});

test('a new wire is uncovered one run per stretch, from end to end, so it draws itself along it', () => {
  const c = twoResistors();
  const before = clone(c);
  c.connect('R1.b', 'R2.a');
  const diff = commitFeedbackDiff(before, c);
  const runs = pieceRuns(diff.pieces);
  assert.equal(runs.length, 1, 'six pieces in a row are one run');
  assert.deepEqual(runs[0].map((p) => `${p.x},${p.y}`).sort(), ['320,0', '80,0'], 'straight through: just its ends');
  assert.equal((commitFeedbackSvg(diff).reveal.match(/class="landing-reveal" pathLength="1"/g) || []).length, 1);
});

test('wire runs keep their bends, part at a branch, and close a loop', () => {
  const piece = (ax, ay, bx, by) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } });
  const key = (run) => run.map((p) => `${p.x},${p.y}`).join(' ');
  // An L: one run with its corner.
  const bend = pieceRuns([piece(0, 0, 40, 0), piece(40, 0, 80, 0), piece(80, 0, 80, 40)]);
  assert.equal(bend.length, 1);
  assert.ok(['0,0 80,0 80,40', '80,40 80,0 0,0'].includes(key(bend[0])), key(bend[0]));
  // A T: three runs from the branch point or to it.
  const tee = pieceRuns([piece(0, 0, 40, 0), piece(40, 0, 80, 0), piece(40, 0, 40, 40)]);
  assert.equal(tee.length, 3);
  assert.equal(tee.flat().length, 6);
  // A square loop: one run back to where it began.
  const loop = pieceRuns([piece(0, 0, 40, 0), piece(40, 0, 40, 40), piece(0, 40, 40, 40), piece(0, 0, 0, 40)]);
  assert.equal(loop.length, 1);
  assert.equal(loop[0].length, 5);
  assert.deepEqual(loop[0][0], loop[0].at(-1));
});

test('a new solder dot is the drawing\'s own, named with when its wire reaches it; a pin gets its ripple then', () => {
  const svg = commitFeedbackSvg({
    components: [], labels: [], removedComponents: [], removedLabels: [], removedPieces: [],
    pieces: [{ a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }, { a: { x: 40, y: 0 }, b: { x: 80, y: 0 } }],
    points: [{ x: 0, y: 0 }, { x: 80, y: 0, solder: 'J1' }],
  }, { from: { x: 0, y: 0 } });
  assert.deepEqual(svg.solders, [{ refdes: 'J1', at: REVEAL_MS }], 'the far end, reached last');
  assert.doesNotMatch(svg.over, /landing-pop|cx="80" cy="0" r="6"/, 'no stand-in dot over it');
  assert.match(svg.over, /class="landing-ripple" cx="80" cy="0" r="18" style="--landing-at:240ms"/);
  assert.match(svg.over, /class="landing-ripple" cx="0" cy="0" r="18"\/>/, 'the start lands at once');
  // Begun at the other end: the dot is there at once.
  const back = commitFeedbackSvg({ components: [], labels: [], removedComponents: [], removedLabels: [], removedPieces: [], pieces: [{ a: { x: 0, y: 0 }, b: { x: 80, y: 0 } }], points: [{ x: 80, y: 0, solder: 'J1' }] }, { from: { x: 80, y: 0 } });
  assert.deepEqual(back.solders, [{ refdes: 'J1', at: 0 }]);
  assert.match(back.reveal, /d="M 80 0 L 0 0"/, 'drawn from where it was begun');
});

test('the reveal reaches a share of a run on its ease: none at once, all at its end, halfway early', () => {
  assert.equal(revealTime(0), 0);
  assert.equal(revealTime(1), REVEAL_MS);
  const half = revealTime(0.5);
  assert.ok(half > 0 && half < REVEAL_MS / 2, `the ease is quick, then settles: ${half}`);
});
