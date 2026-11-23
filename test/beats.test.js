import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { loadDocument } from '../src/core/document.js';
import { runCommand } from '../src/core/commands.js';
import { BEAT_DIM_INK, BEAT_FADE_INK, svgString } from '../src/core/render.js';
import {
  addBeat, closedSwitchHighlight, cycleBeatHighlight, introduceAt, mergeBeats, phaseBeats, moveBeat, removeBeat, resolveBeat, setSwitchFrom,
  setPresenceAt, setPresenceFrom, switchStateAt, visibleBeats,
  complementPhase, phaseClosedIn, phaseKey, switchPhases,
} from '../src/core/beats.js';
import { plainTexText } from '../src/core/render.js';

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
  // Solid grays, not opacity: overlapping faint strokes would double up.
  assert.ok(faded.includes(`class="wire-ink" d="M 200 163`) && faded.includes(`stroke="${BEAT_FADE_INK}"`));
  assert.ok(!faded.includes('opacity="0.12"'));
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
  // The dot stays inked: the shown wire from R1 to R2 runs through it.
  assert.deepEqual([...first.dimRefs].sort(), ['R3']);
  assert.deepEqual(first.wires.get('N1').dimmed.map(({ a, b }) => [a, b]), [[{ x: 200, y: 160 }, { x: 200, y: 0 }]]);
  assert.equal(first.wires.get('N1').shown.length, 2);
  const dimmed = svgString(circuit, { beat: { view: first } });
  // The dimmed wire and leads share one gray ink path, so joints paint once.
  assert.equal((dimmed.match(new RegExp(`class="wire-ink"[^>]*stroke="${BEAT_DIM_INK}"`, 'g')) || []).length, 1);
  assert.deepEqual(visibleBeats(circuit, 'R3'), [0, 1]);
  // Hidden before a leading dim needs saying: it is not implied.
  const later = tee(2);
  setPresenceAt(later, 0, ['R3'], 'hide');
  setPresenceAt(later, 1, ['R3'], 'dim');
  assert.deepEqual(later.toJSON().beats.map((beat) => [beat.dim, beat.hide]), [[undefined, ['R3']], [['R3'], undefined]]);
  assert.throws(() => setPresenceFrom(later, 0, ['R3'], 'blink'), /shown, dimmed, or hidden/);
});

test('an open-ended labeled stub keeps its tip beyond the label', () => {
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

test('a TeX phase draws as math and groups however it is spelled', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'add switch_open S2 --at 400 0', 'add switch_open S3 --at 800 0');
  circuit.labelOf('S1').text = '$\\phi_1$';
  circuit.labelOf('S2').text = '$\\phi_{1}$';
  run(circuit, 'value S3 "$ \\phi_1 $"');
  // One phase, three spellings: each label keeps its own source.
  assert.equal(circuit.labelOf('S2').text, '$\\phi_{1}$');
  assert.deepEqual([...circuit.components.values()].map((c) => circuit.labelOf(c.refdes).math), [true, true, true]);
  run(circuit, 'switch S2 closed');
  assert.deepEqual([...circuit.components.values()].map((c) => c.type), ['switch_closed', 'switch_closed', 'switch_closed']);
  addBeat(circuit);
  setSwitchFrom(circuit, 0, '$\\phi_1$', 'open');
  assert.deepEqual(circuit.toJSON().beats[0].switches, { '$\\phi_{1}$': 'open' });
  assert.equal((svgString(circuit).match(/schematic-math-label/g) || []).length, 3);
  // $\phi$ and $\varphi$ are different symbols, so different phases.
  circuit.labelOf('S3').text = '$\\varphi_1$';
  assert.equal(circuit.components.get('S3').type, 'switch_closed', 'a new phase keeps the drawn position');
  assert.equal(switchStateAt(circuit, 'S3', 0), 'open', 'and brings its old phase\'s beats');
  // Naming the switch itself returns it to a plain part label.
  circuit.labelOf('S3').text = 'S3';
  assert.equal(circuit.labelOf('S3').math, false);
  assert.equal(circuit.labelOf('S3').text, 'S_{3}');
  // Saved and loaded, the math label and the grouping survive.
  const loaded = roundTrip(circuit);
  assert.equal(loaded.labelOf('S1').math, true);
  assert.equal(switchStateAt(loaded, '$\\phi_{1}$', 0), 'open');
});

/** A switched-capacitor integrator: on ϕ1, S1 and S2 charge CS from VIN; on
 * ϕ2, S3 and S4 dump it into the integrating capacitor CF around OA. */
function integrator() {
  const circuit = new Circuit();
  run(circuit,
    'add input VIN --at -560 0', 'add switch_open S1 --at -320 0', 'add capacitor CS --at 0 0',
    'add switch_open S2 --at 320 0', 'add switch_open S3 --at -160 320 --rot 90', 'add switch_open S4 --at 160 320 --rot 90',
    'add opamp OA --at 800 40 --mirrorY', 'add capacitor CF --at 800 -320', 'add output VOUT --at 1200 40',
    'add ground G1 --at -160 560', 'add ground G2 --at 160 560', 'add ground G3 --at 560 240',
    'connect VIN.p S1.a', 'connect S1.b CS.a S3.a', 'connect CS.b S2.a S4.a', 'connect S2.b OA.im CF.a --name X',
    'connect S3.b G1.gnd', 'connect S4.b G2.gnd', 'connect OA.ip G3.gnd', 'connect OA.o CF.b VOUT.p',
    'value S1 $\\phi_1$', 'value S4 $\\phi_1$', 'value S3 $\\phi_2$', 'value S2 $\\phi_2$');
  return circuit;
}

test('phase beats close one phase each, show what still works, and dim what is cut off', () => {
  const circuit = integrator();
  assert.equal(phaseBeats(circuit), 2);
  assert.deepEqual(circuit.beats.map((beat) => beat.name), ['$\\phi_1$', '$\\phi_2$']);
  const look = (index) => {
    const view = resolveBeat(circuit, index);
    const refs = (set) => [...set].filter((ref) => !ref.startsWith('J')).sort();
    return { dim: refs(view.dimRefs), hidden: refs(view.hiddenRefs), closed: [...view.switchTypes].filter(([, type]) => type === 'switch_closed').map(([ref]) => ref).sort() };
  };
  // ϕ1 samples VIN onto CS through S1 and S4; the integrator keeps holding
  // its output, so only the open ϕ2 switches and S3's ground are dimmed.
  assert.deepEqual(look(0), { dim: ['G1', 'S2', 'S3'], hidden: [], closed: ['S1', 'S4'] });
  // ϕ2 moves the charge through S3 and S2 into CF; the input is cut off.
  assert.deepEqual(look(1), { dim: ['G2', 'S1', 'S4', 'VIN'], hidden: [], closed: ['S2', 'S3'] });
  assert.throws(() => phaseBeats(tee(0)), /no switch has a phase/);
});

test('a phase beat dims a capacitor floating between open switches', () => {
  const circuit = new Circuit();
  run(circuit,
    'add input VA --at -560 0', 'add switch_open S1 --at -320 0', 'add capacitor C1 --at 0 0',
    'add switch_open S2 --at 320 0', 'add output VB --at 560 0',
    'connect VA.p S1.a', 'connect S1.b C1.a', 'connect C1.b S2.a', 'connect S2.b VB.p',
    'value S1 φ_{1}', 'value S2 φ_{1}', 'add switch_open S3 --at 0 400', 'value S3 φ_{2}');
  phaseBeats(circuit);
  const dim = (index) => [...resolveBeat(circuit, index).dimRefs].filter((ref) => !ref.startsWith('J')).sort();
  assert.deepEqual(dim(0), ['S3']);
  // ϕ2 opens both of C1's switches: nothing reaches it, so it is dimmed too.
  assert.deepEqual(dim(1), ['C1', 'S1', 'S2', 'S3', 'VA', 'VB']);
  // A named plate is a virtual connection, but C1 still hangs from the other.
  circuit.renameNet(circuit.netOfTerminal({ comp: 'C1', term: 'a' }), 'TOP');
  circuit.beats = [];
  phaseBeats(circuit);
  assert.deepEqual(dim(1), ['C1', 'S1', 'S2', 'S3', 'VA', 'VB']);
  // With both plates named, C1 is no longer floating.
  circuit.renameNet(circuit.netOfTerminal({ comp: 'C1', term: 'b' }), 'BOT');
  circuit.beats = [];
  phaseBeats(circuit);
  assert.deepEqual(dim(1), ['S1', 'S2', 'S3', 'VA', 'VB']);
});

test('a phase beat dims a closed switch that leads nowhere, but not one joining two ends', () => {
  const circuit = new Circuit();
  run(circuit,
    'add input VA --at -400 0', 'add switch_open S1 --at -160 0', 'add switch_open S2 --at 160 0',
    'add capacitor C1 --at 480 0', 'add ground G1 --at 720 120',
    'connect VA.p S1.a', 'connect S1.b S2.a', 'connect S2.b C1.a', 'connect C1.b G1.gnd',
    'value S1 φ_{1}', 'value S2 φ_{2}');
  phaseBeats(circuit);
  const dim = (index) => [...resolveBeat(circuit, index).dimRefs].filter((ref) => !ref.startsWith('J')).sort();
  // ϕ1: VA and S1 reach nothing past the open S2; C1 hangs on it, nothing
  // reading its charge.
  assert.deepEqual(dim(0), ['C1', 'G1', 'S1', 'S2', 'VA']);
  // ϕ2: S2 leads only to the open S1, and C1 hangs on S2.
  assert.deepEqual(dim(1), ['C1', 'G1', 'S1', 'S2', 'VA']);
  // A closed switch joining two ends does work: here it resets VA to VCM,
  // while S1 still leads only to the open S2.
  run(circuit, 'add vcm VCM1 --at -400 -240', 'add switch_open S3 --at -160 -240', 'connect VA.p S3.a', 'connect S3.b VCM1.vcm', 'value S3 φ_{1}');
  circuit.beats = [];
  phaseBeats(circuit);
  assert.deepEqual(dim(0), ['C1', 'G1', 'S1', 'S2']);
});

test('a phase beat dims a feedback capacitor behind its open series switch', () => {
  const circuit = integrator();
  run(circuit, 'rm CF', 'add capacitor CF --at 640 -320', 'add switch_open S5 --at 960 -320',
    'connect CF.a OA.im', 'connect CF.b S5.a', 'connect S5.b OA.o', 'value S5 $\\phi_2$');
  phaseBeats(circuit);
  const dim = (index) => [...resolveBeat(circuit, index).dimRefs].filter((ref) => !ref.startsWith('J')).sort();
  // ϕ1: CF hangs on the open S5; the opamp stays.
  assert.deepEqual(dim(0), ['CF', 'G1', 'S2', 'S3', 'S5']);
  assert.deepEqual(dim(1), ['G2', 'S1', 'S4', 'VIN']);
  // Without S5 the plain integrator keeps CF holding its output.
  const plain = integrator();
  phaseBeats(plain);
  assert.ok(!resolveBeat(plain, 0).dimRefs.has('CF'));
});

test('a phase beat shows capacitors sharing their charge through closed switches', () => {
  const circuit = new Circuit();
  run(circuit,
    'add capacitor C1 --at 0 0', 'add capacitor C2 --at 400 0', 'add switch_open S1 --at 200 -200', 'add switch_open S2 --at 200 200',
    'connect C1.a S1.a', 'connect S1.b C2.a', 'connect C1.b S2.a', 'connect S2.b C2.b', 'value S1 φ_{2}', 'value S2 φ_{2}',
    'add input VA --at -400 -400', 'add switch_open S3 --at -200 -400', 'connect VA.p S3.a', 'connect S3.b C1.a', 'value S3 φ_{1}',
    'add ground G1 --at -200 400', 'add switch_open S4 --at -200 200', 'connect C1.b S4.a', 'connect S4.b G1.gnd', 'value S4 φ_{1}');
  phaseBeats(circuit);
  const dim = (index) => [...resolveBeat(circuit, index).dimRefs].filter((ref) => !ref.startsWith('J')).sort();
  // ϕ2 joins C1 and C2 plate to plate, touching no rail or pin.
  assert.deepEqual(dim(0), ['G1', 'S3', 'S4', 'VA']);
  // ϕ1 samples onto C1; C2 floats between open switches.
  assert.deepEqual(dim(1), ['C2', 'S1', 'S2']);
  // A closed switch across one floating capacitor resets it.
  const reset = new Circuit();
  run(reset, 'add capacitor C1 --at 0 0', 'add switch_open S1 --at 240 0 --rot 90', 'connect C1.a S1.a', 'connect C1.b S1.b', 'value S1 φ_{1}',
    'add switch_open S2 --at 0 400', 'value S2 φ_{2}');
  phaseBeats(reset);
  assert.deepEqual([...resolveBeat(reset, 0).dimRefs].filter((ref) => !ref.startsWith('J')).sort(), ['S2']);
});

test('a beat draws a stacked wire\'s fans and repeats as the wire they repeat', () => {
  const circuit = new Circuit();
  run(circuit, 'add gain A1 --at 0 0 --rot 90', 'add port VIN --at 0 -440', 'connect VIN.p A1.in',
    'add switch_open S1 --at 400 -440', 'connect S1.a A1.in', 'value S1 φ_{1}', 'add switch_open S2 --at 400 -840', 'value S2 φ_{2}');
  const box = circuit.labels.get(run(circuit, 'box A1')[0].json.id);
  const input = circuit.netOfTerminal({ comp: 'A1', term: 'in' });
  run(circuit, `annotation stack ${box.id} 3`, `net ${input.id} fan ${box.id} on`);
  phaseBeats(circuit);
  // ϕ2 dims S1, so the wire to it is dimmed and the rest of the net shown.
  const view = resolveBeat(circuit, 1);
  assert.equal(typeof view.wires.get(input.id), 'object');
  const strokes = (svg) => (svg.match(/<g class="wire-echo"[^]*?<\/g>/g) || []).map((g) => g.match(/stroke="([^"]*)"/)[1]);
  for (const fade of [false, true]) {
    const drawn = strokes(svgString(circuit, { beat: { view, fade } }));
    assert.equal(drawn.length, 3);
    assert.ok(drawn.every((color) => color !== BEAT_DIM_INK && color !== BEAT_FADE_INK), `fade ${fade}: ${drawn}`);
  }
  // Dimming the gain dims the fan into it.
  run(circuit, 'beat dim 2 A1 VIN');
  assert.deepEqual(strokes(svgString(circuit, { beat: { view: resolveBeat(circuit, 1) } })), [BEAT_DIM_INK, BEAT_DIM_INK, BEAT_DIM_INK]);
});

test('a closed switch carries a net highlight across to the net it shorts', async () => {
  const { COLOR_PALETTE } = await import('../src/core/style.js');
  const circuit = new Circuit();
  run(circuit, 'add resistor R1 --at -400 0', 'add switch_open S1 --at 0 0', 'add resistor R2 --at 400 0',
    'add resistor R3 --at 400 400', 'connect R1.b S1.a', 'connect S1.b R2.a', 'value S1 φ_{1}');
  const left = circuit.netOfTerminal({ comp: 'S1', term: 'a' });
  const right = circuit.netOfTerminal({ comp: 'S1', term: 'b' });
  circuit.netHighlights.set(circuit.netGroupKey(left), 'blue');
  const blueWires = (svg) => (svg.toLowerCase().match(new RegExp(COLOR_PALETTE.blue, 'g')) || []).length;
  // Open, the switch keeps the color on its own side.
  assert.equal(closedSwitchHighlight(circuit, (net) => circuit.netHighlight(net))(right), null);
  const open = blueWires(svgString(circuit));
  // A beat that closes it shorts the nets: the right side takes the color.
  addBeat(circuit);
  addBeat(circuit);
  setSwitchFrom(circuit, 1, 'S1', 'closed');
  assert.equal(resolveBeat(circuit, 0).netHighlight(right), null);
  assert.equal(resolveBeat(circuit, 1).netHighlight(right), 'blue');
  // The closed switch conducts, so it takes the color too; open, it does not.
  const s1 = circuit.components.get('S1');
  assert.equal(resolveBeat(circuit, 1).netHighlight.switchColor(s1), 'blue');
  assert.equal(resolveBeat(circuit, 0).netHighlight.switchColor(s1), null);
  // So does closing it in the drawing; a net with its own color keeps it.
  circuit.beats = [];
  circuit.setSwitchState('S1', 'closed');
  assert.ok(blueWires(svgString(circuit)) > open);
  const switchSvg = () => svgString(circuit).match(/data-ref="S1"[^]*?<\/g><\/g>/)[0].toLowerCase();
  assert.ok(switchSvg().includes(COLOR_PALETTE.blue));
  // Two colors: each net keeps its own, and the switch takes one of them.
  circuit.netHighlights.set(circuit.netGroupKey(circuit.netOfTerminal({ comp: 'S1', term: 'b' })), 'red');
  const both = closedSwitchHighlight(circuit, (net) => circuit.netHighlight(net));
  assert.equal(both(circuit.netOfTerminal({ comp: 'S1', term: 'b' })), 'red');
  assert.ok(['blue', 'red'].includes(both.switchColor(circuit.components.get('S1'))));
});

test('merging beats keeps the most visible look, closes any closed switch, and leaves the other beats alone', () => {
  const circuit = integrator();
  phaseBeats(circuit);
  addBeat(circuit, { name: 'after' });
  setPresenceFrom(circuit, 2, ['VIN'], 'hide');
  const after = looks(circuit)[2];
  const index = mergeBeats(circuit, [1, 0]);
  assert.equal(index, 0);
  assert.equal(circuit.beats.length, 2);
  assert.equal(circuit.beats[0].name, '$\\phi_1, \\phi_2$');
  const view = resolveBeat(circuit, 0);
  // Both phases' switches are closed; VIN, dimmed only in phi2, shows.
  assert.deepEqual([...view.switchTypes].filter(([, type]) => type === 'switch_closed').map(([ref]) => ref).sort(), ['S1', 'S2', 'S3', 'S4']);
  assert.equal(view.dimRefs.has('VIN'), false);
  assert.deepEqual(looks(circuit)[1], after);
  assert.throws(() => mergeBeats(circuit, [0]), /two or more/);
  const cmd = integrator();
  phaseBeats(cmd);
  assert.match(runCommand(cmd, 'beat merge 1 2').text, /merged beats 1, 2/);
  assert.equal(cmd.beats.length, 1);
});

test('a phase has a complement: its name with an overbar, offered before any switch uses it', () => {
  assert.equal(complementPhase('$\\varphi_1$'), '$\\overline{\\varphi_1}$');
  assert.equal(complementPhase('$\\overline{\\varphi_1}$'), '$\\varphi_1$');
  assert.equal(complementPhase('CLK'), '$\\overline{CLK}$');
  assert.equal(plainTexText(complementPhase('$\\varphi_1$')), 'φ\u03051\u0305');
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'value S1 $\\varphi_1$', 'add switch_open S2 --at 0 400', 'value S2 $\\varphi_2$');
  assert.deepEqual(switchPhases(circuit).map((p) => p.source), ['$\\varphi_1$', '$\\varphi_2$']);
  assert.deepEqual(switchPhases(circuit, { complements: true }).map((p) => [p.source, !!p.complement]), [
    ['$\\varphi_1$', false], ['$\\overline{\\varphi_1}$', true], ['$\\varphi_2$', false], ['$\\overline{\\varphi_2}$', true],
  ]);
  // Used, a complement is a phase of its own and offered once.
  run(circuit, 'add switch_open S3 --at 0 800', 'value S3 $\\overline{\\varphi_1}$');
  assert.deepEqual(switchPhases(circuit, { complements: true }).map((p) => p.source), ['$\\varphi_1$', '$\\varphi_2$', '$\\overline{\\varphi_2}$', '$\\overline{\\varphi_1}$']);
  // A plain phase and its bar undone are one phase.
  const k = phaseKey('CLK');
  assert.equal(phaseClosedIn(phaseKey(complementPhase('CLK')), k), false);
  assert.equal(phaseClosedIn(phaseKey(complementPhase('CLK')), phaseKey('X')), true);
});

test('a complement switch stands opposite its phase in every beat, but is drawn as the user draws it', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'value S1 $\\varphi_1$', 'add switch_open S2 --at 0 400');
  addBeat(circuit);
  addBeat(circuit);
  setSwitchFrom(circuit, 1, 'S1', 'closed');
  run(circuit, 'value S2 $\\overline{\\varphi_1}$');
  // The drawing keeps both switches open.
  assert.equal(circuit.getComponent('S2').type, 'switch_open');
  circuit.setSwitchState('S1', 'closed');
  assert.equal(circuit.getComponent('S2').type, 'switch_open');
  // Beats keep the complement opposite, whichever of the two is flipped.
  const states = () => [0, 1].map((i) => [switchStateAt(circuit, 'S1', i), switchStateAt(circuit, 'S2', i)]);
  circuit.setSwitchState('S1', 'open');
  setSwitchFrom(circuit, 0, 'S1', 'open');
  setSwitchFrom(circuit, 1, 'S1', 'closed');
  assert.deepEqual(states(), [['open', 'closed'], ['closed', 'open']]);
  setSwitchFrom(circuit, 0, 'S2', 'open');
  assert.deepEqual(states(), [['closed', 'open'], ['closed', 'open']]);
});

test('phase beats are made only for phases in use; a complement is closed while its phase is open', () => {
  const circuit = new Circuit();
  run(circuit,
    'add switch_open S1 --at 0 0', 'value S1 $\\varphi_1$',
    'add switch_open S2 --at 0 400', 'value S2 $\\varphi_2$',
    'add switch_open S3 --at 0 800', 'value S3 $\\overline{\\varphi_1}$');
  // φ̄2 is only offered, never used: no beat for it.
  assert.equal(phaseBeats(circuit), 3);
  assert.deepEqual(circuit.beats.map((beat) => beat.name), ['$\\varphi_1$', '$\\varphi_2$', '$\\overline{\\varphi_1}$']);
  const closed = (index) => ['S1', 'S2', 'S3'].filter((ref) => switchStateAt(circuit, ref, index) === 'closed');
  assert.deepEqual(closed(0), ['S1']);
  assert.deepEqual(closed(1), ['S2', 'S3']);
  assert.deepEqual(closed(2), ['S3']);
});

// ----- frames -------------------------------------------------------------------

test('a beat frame carries forward like any beat change, and none goes back to the whole drawing', async () => {
  const { frameAt, setFrameFrom } = await import('../src/core/beats.js');
  const circuit = tee(4);
  const box = { x: 0, y: -40, w: 200, h: 80 };
  setFrameFrom(circuit, 1, box);
  assert.deepEqual([0, 1, 2, 3].map((i) => frameAt(circuit, i)), [null, box, box, box]);
  setFrameFrom(circuit, 3, null);
  assert.deepEqual([0, 1, 2, 3].map((i) => frameAt(circuit, i)), [null, box, box, null]);
  // Reframing beat 1 changes it and the beats after it that shared its frame.
  const other = { x: 400, y: -40, w: 120, h: 80 };
  setFrameFrom(circuit, 1, other);
  assert.deepEqual([0, 1, 2, 3].map((i) => frameAt(circuit, i)), [null, other, other, null]);
  assert.throws(() => setFrameFrom(circuit, 0, { x: 0, y: 0, w: 0, h: 10 }), /width and height/);
  assert.deepEqual(resolveBeat(circuit, 2).frame, other);
});

test('beat frames are saved, and adding, moving, removing, or merging beats keeps every beat framed as before', async () => {
  const { frameAt, setFrameFrom } = await import('../src/core/beats.js');
  const circuit = tee(3);
  const a = { x: 0, y: -40, w: 200, h: 80 };
  const b = { x: 400, y: 0, w: 100, h: 100 };
  setFrameFrom(circuit, 1, a);
  setFrameFrom(circuit, 2, b);
  const saved = circuit.toJSON().beats;
  assert.deepEqual(saved.map((beat) => beat.frame), [undefined, a, b]);
  const loaded = loadDocument(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual([0, 1, 2].map((i) => frameAt(loaded, i)), [null, a, b]);
  const looks = (c) => c.beats.map((_, i) => frameAt(c, i));
  addBeat(circuit, { index: 1 });
  assert.deepEqual(looks(circuit), [null, null, a, b]);
  moveBeat(circuit, 3, 0);
  assert.deepEqual(looks(circuit), [b, null, null, a]);
  removeBeat(circuit, 0);
  assert.deepEqual(looks(circuit), [null, null, a]);
  // Merged: the frame around both, or the whole drawing when either has none.
  setFrameFrom(circuit, 1, b);
  mergeBeats(circuit, [1, 2]);
  assert.deepEqual(looks(circuit), [null, { x: 0, y: -40, w: 500, h: 140 }]);
  mergeBeats(circuit, [0, 1]);
  assert.deepEqual(looks(circuit), [null]);
});

test('a framed beat exports its frame alone, padded as the drawing is', async () => {
  const { setFrameFrom } = await import('../src/core/beats.js');
  const circuit = tee(2);
  setFrameFrom(circuit, 1, { x: 0, y: -40, w: 200, h: 80 });
  const viewBox = (svg) => svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  assert.deepEqual(viewBox(svgString(circuit, { beat: { view: resolveBeat(circuit, 0) } })), viewBox(svgString(circuit)));
  assert.deepEqual(viewBox(svgString(circuit, { beat: { view: resolveBeat(circuit, 1) } })), [-40, -80, 280, 160]);
});

test('beat frame frames beats to parts, labels, or nets; none clears; unknown names and missing beats are refused', () => {
  const circuit = tee(2);
  const framed = runCommand(circuit, 'beat frame 2 R1 R3');
  assert.equal(framed.mutated, true, framed.text);
  const r1 = circuit.components.get('R1').bboxWorld();
  assert.ok(framed.json.frame.x <= r1.x + 1 && framed.json.frame.w > 0, JSON.stringify(framed.json));
  assert.match(runCommand(circuit, 'beat list').text, /frame /);
  assert.equal(runCommand(circuit, 'beat frame 2 none').mutated, true);
  assert.equal(resolveBeat(circuit, 1).frame, null);
  assert.throws(() => runCommand(circuit, 'beat frame 2 NOPE'), /no part, label, or net NOPE/);
  assert.throws(() => runCommand(circuit, 'beat frame 9 R1'), /no beat 9/);
  assert.throws(() => runCommand(circuit, 'beat frame 2'), /usage: beat frame/);
});
