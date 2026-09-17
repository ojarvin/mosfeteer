import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { commitFeedbackDiff, commitFeedbackSvg, isEmptyFeedback } from '../src/web/commit-feedback.js';

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
  assert.match(svg.under, /class="landing-wire"/);
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
