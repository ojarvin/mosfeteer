import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { loadDocument } from '../src/core/document.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import {
  addBeat, cycleBeatHighlight, introduceAt, moveBeat, removeBeat, resolveBeat, setSwitchFrom,
  setVisibleAt, setVisibleFrom, switchStateAt, visibleBeats,
} from '../src/core/beats.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));
const COLORS = ['red', 'orange', 'yellow'];

/** R1 and R2 in a row, R3 hanging below their joint (a T with a dot). */
function tee(beats = 3) {
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'add resistor R3 --at 200 240 --rot 90', 'connect R1.b R2.a R3.a');
  for (let i = 0; i < beats; i += 1) addBeat(circuit);
  return circuit;
}
const roundTrip = (circuit) => loadDocument(JSON.parse(JSON.stringify(circuit.toJSON())));
const hidden = (circuit, index) => [...resolveBeat(circuit, index).hiddenRefs].sort();
const looks = (circuit) => circuit.beats.map((_, index) => {
  const view = resolveBeat(circuit, index);
  return { refs: [...view.hiddenRefs].sort(), switches: [...view.switchTypes].sort(), highlights: [...view.highlights].sort() };
});

test('a document without beats saves no beats key and draws as before', () => {
  const circuit = tee(0);
  assert.equal('beats' in circuit.toJSON(), false);
  assert.deepEqual(roundTrip(circuit).beats, []);
  assert.equal(resolveBeat(circuit, 0), null);
});

test('beats store only changes and survive a save and load', () => {
  const circuit = tee();
  setVisibleFrom(circuit, 1, ['R3'], false);
  assert.deepEqual(circuit.toJSON().beats, [{ id: 'b1', name: '' }, { id: 'b2', name: '', hide: ['R3'] }, { id: 'b3', name: '' }]);
  const loaded = roundTrip(circuit);
  assert.deepEqual(loaded.toJSON().beats, circuit.toJSON().beats);
  assert.deepEqual(visibleBeats(loaded, 'R3'), [0]);
});

test('a change carries forward until the next beat that already differed', () => {
  const circuit = tee(4);
  setVisibleFrom(circuit, 0, ['R3'], false);
  assert.deepEqual(visibleBeats(circuit, 'R3'), []);
  setVisibleFrom(circuit, 2, ['R3'], true);
  assert.deepEqual(visibleBeats(circuit, 'R3'), [2, 3]);
  // An object whose first change is a show is hidden before it, on its own.
  assert.deepEqual(circuit.toJSON().beats[2].show, ['R3']);
  assert.equal(circuit.toJSON().beats[0].hide, undefined);
  // Hiding at beat 3 also reaches beat 4, which looked the same.
  setVisibleFrom(circuit, 2, ['R3'], false);
  assert.deepEqual(visibleBeats(circuit, 'R3'), []);
  setVisibleAt(circuit, 1, ['R3'], true);
  assert.deepEqual(visibleBeats(circuit, 'R3'), [1]);
});

test('unlisted objects, including ones drawn later, show in every beat', () => {
  const circuit = tee();
  setVisibleFrom(circuit, 1, ['R3'], false);
  run(circuit, 'add resistor R4 --at 0 400');
  assert.deepEqual(visibleBeats(circuit, 'R4'), [0, 1, 2]);
  // Drawn while a beat is shown: it appears from that beat on.
  run(circuit, 'add resistor R5 --at 400 400');
  introduceAt(circuit, 1, ['R5']);
  assert.deepEqual(visibleBeats(circuit, 'R5'), [1, 2]);
});

test('inserting, deleting, and moving beats leaves every other beat looking the same', () => {
  const circuit = tee(3);
  run(circuit, 'add switch_open S1 --at 0 400');
  setVisibleFrom(circuit, 1, ['R3'], false);
  setVisibleFrom(circuit, 2, ['R2'], false);
  setSwitchFrom(circuit, 2, 'S1', 'closed');
  cycleBeatHighlight(circuit, 1, circuit.nets.values().next().value, COLORS);
  const before = looks(circuit);

  addBeat(circuit, { index: 1 });
  assert.deepEqual(looks(circuit), [before[0], before[0], before[1], before[2]], 'a new beat copies the one before it');
  removeBeat(circuit, 1);
  assert.deepEqual(looks(circuit), before);
  removeBeat(circuit, 2);
  assert.deepEqual(looks(circuit), before.slice(0, 2));

  const three = tee(3);
  setVisibleFrom(three, 2, ['R3'], true);
  setVisibleFrom(three, 0, ['R3'], false);
  setVisibleFrom(three, 2, ['R3'], true);
  const order = looks(three);
  moveBeat(three, 2, 0);
  assert.deepEqual(looks(three), [order[2], order[0], order[1]]);
  // Deleting the only beat that showed an object keeps it out of the rest.
  removeBeat(three, 0);
  assert.deepEqual(visibleBeats(three, 'R3'), []);
});

test('wires keep only what joins the shown terminals, and a dot needs three arms', () => {
  const circuit = tee();
  setVisibleFrom(circuit, 1, ['R3'], false);
  setVisibleFrom(circuit, 2, ['R2'], false);
  assert.deepEqual(hidden(circuit, 0), []);
  assert.equal(resolveBeat(circuit, 0).wires.get('N1'), 'all');
  // Without R3 the stub down to it goes, and so does the junction dot.
  const second = resolveBeat(circuit, 1);
  assert.deepEqual([...second.hiddenRefs].sort(), ['J1', 'R3']);
  const pieces = second.wires.get('N1');
  assert.ok(Array.isArray(pieces));
  assert.deepEqual(pieces.map(({ a, b }) => [a, b]), [[{ x: 80, y: 0 }, { x: 200, y: 0 }], [{ x: 320, y: 0 }, { x: 200, y: 0 }]]);
  // With only R1 left there is nothing to join.
  assert.equal(resolveBeat(circuit, 2).wires.get('N1'), 'none');
});

test('a placeholder net label keeps its wire until the part that replaces it appears', () => {
  const circuit = tee(2);
  const net = circuit.nets.get('N1');
  const label = circuit.addNetLabel(net, 'V_{B}', { x: 200, y: 80 });
  setVisibleFrom(circuit, 0, ['R2', 'R3'], false);
  setVisibleFrom(circuit, 1, ['R3'], true);
  setVisibleFrom(circuit, 1, [label.id], false);
  // Beat 1: R1 alone, its wire runs on to the label.
  const first = resolveBeat(circuit, 0);
  assert.equal(first.hiddenLabels.has(label.id), false);
  assert.deepEqual(first.wires.get('N1').map(({ a, b }) => [a, b]), [[{ x: 80, y: 0 }, { x: 200, y: 0 }], [{ x: 200, y: 80 }, { x: 200, y: 0 }]]);
  // Beat 2: R3 replaces the label.
  const second = resolveBeat(circuit, 1);
  assert.equal(second.hiddenLabels.has(label.id), true);
  // R1 to R3, still through the label's point, which cuts R3's wire in two.
  assert.deepEqual(second.wires.get('N1').map(({ a, b }) => [a, b]), [[{ x: 80, y: 0 }, { x: 200, y: 0 }], [{ x: 200, y: 160 }, { x: 200, y: 80 }], [{ x: 200, y: 80 }, { x: 200, y: 0 }]]);
});

test('an unlisted net label follows the parts on its net', () => {
  const circuit = tee(1);
  const label = circuit.addNetLabel(circuit.nets.get('N1'), 'X', { x: 200, y: 80 });
  setVisibleFrom(circuit, 0, ['R1', 'R2', 'R3'], false);
  assert.equal(resolveBeat(circuit, 0).hiddenLabels.has(label.id), true);
  assert.equal(resolveBeat(circuit, 0).hiddenRefs.has('J1'), true);
});

test('owned labels follow their part and cannot be listed on their own', () => {
  const circuit = tee(1);
  const owned = circuit.labelOf('R3');
  setVisibleFrom(circuit, 0, [owned.id], false);
  assert.deepEqual(circuit.toJSON().beats[0].hide, ['R3']);
  assert.equal(resolveBeat(circuit, 0).hiddenLabels.has(owned.id), true);
  assert.throws(() => setVisibleFrom(circuit, 0, ['J1'], false), /cannot be shown or hidden/);
});

test('switch positions are per beat and never change the drawing', () => {
  const circuit = tee(2);
  run(circuit, 'add switch_open S1 --at 0 400', 'add switch_open S2 --at 400 400');
  setSwitchFrom(circuit, 0, 'S1', 'closed');
  setSwitchFrom(circuit, 1, 'S1', 'open');
  setSwitchFrom(circuit, 1, 'S2', 'closed');
  assert.equal(circuit.components.get('S1').type, 'switch_open');
  assert.deepEqual([switchStateAt(circuit, 'S1', 0), switchStateAt(circuit, 'S2', 0)], ['closed', 'open']);
  assert.deepEqual([...resolveBeat(circuit, 1).switchTypes], [['S2', 'switch_closed']]);
  const blade = (svg, ref) => svg.slice(svg.indexOf(`data-ref="${ref}"`), svg.indexOf('</g></g>', svg.indexOf(`data-ref="${ref}"`)));
  const beat0 = svgString(circuit, { beat: { view: resolveBeat(circuit, 0) } });
  assert.ok(blade(beat0, 'S1').includes('-19.16'), 'S1 closed in the first beat');
  assert.ok(!blade(beat0, 'S2').includes('-19.16'));
  assert.ok(!svgString(circuit).includes('-19.16'), 'the drawing keeps both open');
  // A later change to the drawn position still carries into beats that did not set one.
  circuit.setSwitchState('S2', 'closed');
  assert.equal(switchStateAt(circuit, 'S2', 0), 'closed');
  assert.throws(() => setSwitchFrom(circuit, 0, 'R1', 'closed'), /not a switch/);
});

test('highlights are per beat over the drawing\'s own highlights', () => {
  const circuit = tee(2);
  const net = circuit.nets.get('N1');
  circuit.cycleNetHighlight(net);
  assert.equal(resolveBeat(circuit, 0).netHighlight(net), 'red');
  assert.equal(cycleBeatHighlight(circuit, 1, net, COLORS), 'orange');
  assert.equal(resolveBeat(circuit, 0).netHighlight(net), 'red');
  assert.equal(resolveBeat(circuit, 1).netHighlight(net), 'orange');
  const draw = (index) => svgString(circuit, { beat: { view: resolveBeat(circuit, index) } });
  assert.equal(draw(0), svgString(circuit));
  assert.notEqual(draw(1), draw(0));
});

test('renaming a part keeps its place in the beats; deleting it drops it from them', () => {
  const circuit = tee(2);
  run(circuit, 'add switch_open S1 --at 0 400');
  setVisibleFrom(circuit, 1, ['R3'], false);
  setSwitchFrom(circuit, 1, 'S1', 'closed');
  run(circuit, 'rename R3 RB', 'rename S1 SA');
  assert.deepEqual(circuit.toJSON().beats[1], { id: 'b2', name: '', hide: ['RB'], switches: { SA: 'closed' } });
  run(circuit, 'rm RB');
  assert.deepEqual(circuit.toJSON().beats[1], { id: 'b2', name: '', switches: { SA: 'closed' } });
});

test('a beat drawing leaves hidden objects out, or fades them for the editor', () => {
  const circuit = tee(1);
  setVisibleFrom(circuit, 0, ['R3'], false);
  const view = resolveBeat(circuit, 0);
  const omitted = svgString(circuit, { beat: { view } });
  assert.ok(!omitted.includes('data-ref="R3"'));
  assert.ok(omitted.includes('data-ref="R1"'));
  assert.ok(!omitted.includes('data-net-id="N1"'), 'a partial net is drawn as plain ink');
  const faded = svgString(circuit, { beat: { view, fade: true } });
  assert.match(faded, /opacity="0.2" data-ref="R3"/);
  assert.ok(faded.includes('data-net-id="N1"'), 'the editor keeps the net to click');
  // Every beat keeps the whole drawing's frame.
  const box = (svg) => svg.match(/viewBox="([^"]+)"/)[1];
  assert.equal(box(omitted), box(svgString(circuit)));
});
