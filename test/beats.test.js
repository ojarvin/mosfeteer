import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { loadDocument } from '../src/core/document.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import {
  addBeat, cycleBeatHighlight, introduceAt, moveBeat, removeBeat, resolveBeat, setSwitchFrom,
  setPresenceAt, setPresenceFrom, switchStateAt, visibleBeats,
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
  setPresenceFrom(circuit, 1, ['R3'], 'hide');
  assert.deepEqual(circuit.toJSON().beats, [{ id: 'b1', name: '' }, { id: 'b2', name: '', hide: ['R3'] }, { id: 'b3', name: '' }]);
  const loaded = roundTrip(circuit);
  assert.deepEqual(loaded.toJSON().beats, circuit.toJSON().beats);
  assert.deepEqual(visibleBeats(loaded, 'R3'), [0]);
});

test('a change carries forward until the next beat that already differed', () => {
  const circuit = tee(4);
  setPresenceFrom(circuit, 0, ['R3'], 'hide');
  assert.deepEqual(visibleBeats(circuit, 'R3'), []);
  setPresenceFrom(circuit, 2, ['R3'], 'show');
  assert.deepEqual(visibleBeats(circuit, 'R3'), [2, 3]);
  // An object whose first change is a show is hidden before it, on its own.
  assert.deepEqual(circuit.toJSON().beats[2].show, ['R3']);
  assert.equal(circuit.toJSON().beats[0].hide, undefined);
  // Hiding at beat 3 also reaches beat 4, which looked the same.
  setPresenceFrom(circuit, 2, ['R3'], 'hide');
  assert.deepEqual(visibleBeats(circuit, 'R3'), []);
  setPresenceAt(circuit, 1, ['R3'], 'show');
  assert.deepEqual(visibleBeats(circuit, 'R3'), [1]);
});

test('unlisted objects, including ones drawn later, show in every beat', () => {
  const circuit = tee();
  setPresenceFrom(circuit, 1, ['R3'], 'hide');
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
  setPresenceFrom(circuit, 1, ['R3'], 'hide');
  setPresenceFrom(circuit, 2, ['R2'], 'hide');
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
  setPresenceFrom(three, 2, ['R3'], 'show');
  setPresenceFrom(three, 0, ['R3'], 'hide');
  setPresenceFrom(three, 2, ['R3'], 'show');
  const order = looks(three);
  moveBeat(three, 2, 0);
  assert.deepEqual(looks(three), [order[2], order[0], order[1]]);
  // Deleting the only beat that showed an object keeps it out of the rest.
  removeBeat(three, 0);
  assert.deepEqual(visibleBeats(three, 'R3'), []);
});

test('wires keep only what joins the shown terminals, and a dot needs three arms', () => {
  const circuit = tee();
  setPresenceFrom(circuit, 1, ['R3'], 'hide');
  setPresenceFrom(circuit, 2, ['R2'], 'hide');
  assert.deepEqual(hidden(circuit, 0), []);
  assert.equal(resolveBeat(circuit, 0).wires.get('N1'), 'all');
  // Without R3 the stub down to it goes, and so does the junction dot.
  const second = resolveBeat(circuit, 1);
  assert.deepEqual([...second.hiddenRefs].sort(), ['J1', 'R3']);
  const pieces = second.wires.get('N1').shown;
  assert.deepEqual(second.wires.get('N1').dimmed, []);
  assert.deepEqual(pieces.map(({ a, b }) => [a, b]), [[{ x: 80, y: 0 }, { x: 200, y: 0 }], [{ x: 320, y: 0 }, { x: 200, y: 0 }]]);
  // With only R1 left there is nothing to join.
  assert.equal(resolveBeat(circuit, 2).wires.get('N1'), 'none');
});

test('a placeholder net label keeps its wire until the part that replaces it appears', () => {
  const circuit = tee(2);
  const net = circuit.nets.get('N1');
  const label = circuit.addNetLabel(net, 'V_{B}', { x: 200, y: 80 });
  setPresenceFrom(circuit, 0, ['R2', 'R3'], 'hide');
  setPresenceFrom(circuit, 1, ['R3'], 'show');
  setPresenceFrom(circuit, 1, [label.id], 'hide');
  // Beat 1: R1 alone, its wire runs on to the label.
  const first = resolveBeat(circuit, 0);
  assert.equal(first.hiddenLabels.has(label.id), false);
  assert.deepEqual(first.wires.get('N1').shown.map(({ a, b }) => [a, b]), [[{ x: 80, y: 0 }, { x: 200, y: 0 }], [{ x: 200, y: 80 }, { x: 200, y: 0 }]]);
  // Beat 2: R3 replaces the label.
  const second = resolveBeat(circuit, 1);
  assert.equal(second.hiddenLabels.has(label.id), true);
  // R1 to R3, still through the label's point, which cuts R3's wire in two.
  assert.deepEqual(second.wires.get('N1').shown.map(({ a, b }) => [a, b]), [[{ x: 80, y: 0 }, { x: 200, y: 0 }], [{ x: 200, y: 160 }, { x: 200, y: 80 }], [{ x: 200, y: 80 }, { x: 200, y: 0 }]]);
});

test('an unlisted net label follows the parts on its net', () => {
  const circuit = tee(1);
  const label = circuit.addNetLabel(circuit.nets.get('N1'), 'X', { x: 200, y: 80 });
  setPresenceFrom(circuit, 0, ['R1', 'R2', 'R3'], 'hide');
  assert.equal(resolveBeat(circuit, 0).hiddenLabels.has(label.id), true);
  assert.equal(resolveBeat(circuit, 0).hiddenRefs.has('J1'), true);
});

test('owned labels follow their part and cannot be listed on their own', () => {
  const circuit = tee(1);
  const owned = circuit.labelOf('R3');
  setPresenceFrom(circuit, 0, [owned.id], 'hide');
  assert.deepEqual(circuit.toJSON().beats[0].hide, ['R3']);
  assert.equal(resolveBeat(circuit, 0).hiddenLabels.has(owned.id), true);
  assert.throws(() => setPresenceFrom(circuit, 0, ['J1'], 'hide'), /cannot be shown or hidden/);
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
  setPresenceFrom(circuit, 1, ['R3'], 'hide');
  setSwitchFrom(circuit, 1, 'S1', 'closed');
  run(circuit, 'rename R3 RB', 'rename S1 SA');
  assert.deepEqual(circuit.toJSON().beats[1], { id: 'b2', name: '', hide: ['RB'], switches: { SA: 'closed' } });
  run(circuit, 'rm RB');
  assert.deepEqual(circuit.toJSON().beats[1], { id: 'b2', name: '', switches: { SA: 'closed' } });
});

test('a beat drawing leaves hidden objects out, or fades them for the editor', () => {
  const circuit = tee(1);
  setPresenceFrom(circuit, 0, ['R3'], 'hide');
  const view = resolveBeat(circuit, 0);
  const omitted = svgString(circuit, { beat: { view } });
  assert.ok(!omitted.includes('data-ref="R3"'));
  assert.ok(omitted.includes('data-ref="R1"'));
  assert.ok(!omitted.includes('data-net-id="N1"'), 'a partial net is drawn as plain ink');
  const faded = svgString(circuit, { beat: { view, fade: true } });
  assert.match(faded, /opacity="0.12" data-ref="R3"/);
  assert.ok(faded.includes('data-net-id="N1"'), 'the editor keeps the net to click');
  // Every beat keeps the whole drawing's frame.
  const box = (svg) => svg.match(/viewBox="([^"]+)"/)[1];
  assert.equal(box(omitted), box(svgString(circuit)));
});

test('a dimmed part stays on the page, faint, with the wire that joins it', () => {
  const circuit = tee(3);
  setPresenceFrom(circuit, 0, ['R3'], 'dim');
  setPresenceFrom(circuit, 1, ['R3'], 'show');
  setPresenceFrom(circuit, 2, ['R3'], 'hide');
  assert.deepEqual(circuit.toJSON().beats.map((beat) => [beat.show, beat.dim, beat.hide]), [
    [undefined, ['R3'], undefined], [['R3'], undefined, undefined], [undefined, undefined, ['R3']],
  ]);
  const first = resolveBeat(circuit, 0);
  assert.deepEqual([...first.dimRefs].sort(), ['J1', 'R3'], 'the dot has only two shown arms');
  assert.deepEqual(first.wires.get('N1').dimmed.map(({ a, b }) => [a, b]), [[{ x: 200, y: 160 }, { x: 200, y: 0 }]]);
  assert.equal(first.wires.get('N1').shown.length, 2);
  assert.match(svgString(circuit, { beat: { view: first } }), /opacity="0.3" data-ref="R3"/);
  assert.deepEqual(visibleBeats(circuit, 'R3'), [0, 1]);
  // Hidden before a leading dim needs saying: it is not implied.
  const later = tee(2);
  setPresenceAt(later, 0, ['R3'], 'hide');
  setPresenceAt(later, 1, ['R3'], 'dim');
  assert.deepEqual(later.toJSON().beats.map((beat) => [beat.dim, beat.hide]), [[undefined, ['R3']], [['R3'], undefined]]);
  assert.throws(() => setPresenceFrom(later, 0, ['R3'], 'blink'), /shown, dimmed, or hidden/);
});

test('an open-ended labelled stub keeps its tip beyond the label', () => {
  const circuit = new Circuit();
  run(circuit, 'add nmos M1 --at 0 0', 'add nmos M2 --at 400 0', 'connect M1.g M2.g');
  const net = circuit.netOfTerminal({ comp: 'M1', term: 'g' });
  // Carry the gate wire on past M1 to an open end at x=-320.
  const gate = circuit.components.get('M1').terminalWorld('g');
  assert.equal(gate.x, -120);
  net.branches = [...net.paths(), [{ x: -120, y: 0 }, { x: -320, y: 0 }]];
  const label = circuit.addNetLabel(net, 'V_{BN}', { x: -240, y: 0 });
  addBeat(circuit);
  setPresenceFrom(circuit, 0, ['M2'], 'hide');
  const wires = resolveBeat(circuit, 0).wires.get(net.id);
  const xs = wires.shown.flatMap(({ a, b }) => [a.x, b.x]);
  assert.equal(Math.min(...xs), -320, 'the tip past the label stays');
  assert.ok(Math.max(...xs) <= -120, 'the run over to hidden M2 goes');
  // Hiding the label drops the stub it carried.
  setPresenceFrom(circuit, 0, [label.id], 'hide');
  assert.equal(resolveBeat(circuit, 0).wires.get(net.id), 'none');
});

/** Two φ1 switches and one φ2 switch, all drawn open. */
function phases(beats = 2) {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'add switch_open S2 --at 400 0', 'add switch_open S3 --at 800 0',
    'value S1 φ_{1}', 'value S2 φ_{1}', 'value S3 φ_{2}');
  for (let i = 0; i < beats; i += 1) addBeat(circuit);
  return circuit;
}

test('a switch label names its phase, and a phase opens and closes as one', () => {
  const circuit = phases(0);
  // The refdes stays the identity; the label shows the phase.
  assert.equal(circuit.labelOf('S1').text, 'φ_{1}');
  assert.equal(circuit.components.get('S1').value, 'φ_{1}');
  run(circuit, 'switch S1 closed');
  assert.deepEqual([...circuit.components.values()].map((c) => c.type), ['switch_closed', 'switch_closed', 'switch_open']);
  run(circuit, 'switch φ_{2} closed');
  assert.equal(circuit.components.get('S3').type, 'switch_closed');
  // Joining a phase takes its position; editing the label is the way in.
  run(circuit, 'add switch_open S4 --at 0 400');
  circuit.labelOf('S4').text = 'φ_{1}';
  assert.equal(circuit.components.get('S4').type, 'switch_closed');
  // Naming the switch itself leaves the phase.
  circuit.labelOf('S4').text = 'S4';
  assert.equal(circuit.components.get('S4').value, '');
  assert.equal(circuit.labelOf('S4').text, 'S_{4}');
  // Renaming the part keeps the phase label.
  run(circuit, 'rename S1 SA');
  assert.equal(circuit.labelOf('SA').text, 'φ_{1}');
  // The phase is drawn once, as the label, not again as value text.
  assert.equal((svgString(circuit).match(/>φ</g) || []).length, 3);
  assert.throws(() => run(circuit, 'switch φ_{9} open'), /not a switch or a switch phase/);
});

test('beats set switch positions per phase, so new switches on a phase follow', () => {
  const circuit = phases();
  setSwitchFrom(circuit, 0, 'S1', 'closed');
  setSwitchFrom(circuit, 1, 'φ_{1}', 'open');
  setSwitchFrom(circuit, 1, 'φ_{2}', 'closed');
  assert.deepEqual(circuit.toJSON().beats.map((beat) => beat.switches), [{ 'φ_{1}': 'closed' }, { 'φ_{1}': 'open', 'φ_{2}': 'closed' }]);
  assert.deepEqual([...resolveBeat(circuit, 0).switchTypes].sort(), [['S1', 'switch_closed'], ['S2', 'switch_closed']]);
  run(circuit, 'add switch_open S5 --at 0 400', 'value S5 φ_{1}');
  assert.equal(switchStateAt(circuit, 'S5', 0), 'closed');
  assert.equal(resolveBeat(circuit, 0).switchTypes.get('S5'), 'switch_closed');
  // Renaming a whole phase keeps its beats.
  for (const ref of ['S1', 'S2', 'S5']) circuit.labelOf(ref).text = 'φ_{a}';
  assert.equal(switchStateAt(circuit, 'φ_{a}', 0), 'closed');
  assert.deepEqual(circuit.toJSON().beats[0].switches, { 'φ_{a}': 'closed' });
});

test('a saved switch value becomes its phase label on load', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0');
  const data = circuit.toJSON();
  data.components[0].value = 'clk';
  const loaded = roundTrip({ toJSON: () => data });
  assert.equal(loaded.labelOf('S1').text, 'clk');
});
