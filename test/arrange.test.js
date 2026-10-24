import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { findTopology, wiresJoining } from '../src/core/topology-match.js';
import { applyArrangement, arrangementCandidates } from '../src/core/arrange.js';
import { builtInDrawings } from '../src/core/arrange-builtins.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));

/** A current mirror drawn the textbook way: the diode on the left facing
 *  right, gates joined straight across, grounds below. */
function neatMirror(circuit = new Circuit(), { x = 0, y = 0, prefix = 'M' } = {}) {
  run(circuit,
    `add nmos ${prefix}1 --at ${x} ${y} --mirrorX`, `add nmos ${prefix}2 --at ${x + 400} ${y}`,
    `connect ${prefix}1.g ${prefix}2.g`, `connect ${prefix}1.d ${prefix}1.g`);
  return circuit;
}

/** The same mirror drawn anyhow, with a load on its output going on to the
 *  rest of the drawing. */
function messyMirror(circuit = new Circuit()) {
  run(circuit,
    'add nmos MA --at 0 0', 'add nmos MB --at 480 -160',
    'add resistor RL --at 480 -480 --rot 90',
    'connect MA.g MB.g', 'connect MA.d MA.g', 'connect MB.d RL.b');
  return circuit;
}

const relative = (circuit, refs) => {
  const base = circuit.components.get(refs[0]).transform;
  return refs.map((ref) => {
    const t = circuit.components.get(ref).transform;
    return { dx: t.x - base.x, dy: t.y - base.y, rotation: t.rotation, mirrorX: t.mirrorX, mirrorY: t.mirrorY };
  });
};

test('the recognizer finds a topology drawn inside a larger circuit', () => {
  const source = neatMirror();
  run(source, 'add resistor R1 --at 400 -320 --rot 90', 'connect M2.d R1.b', 'add nmos M9 --at 1200 0');
  const matches = findTopology(messyMirror(), ['MA', 'MB'], source);
  assert.equal(matches.length, 1);
  assert.deepEqual([...matches[0].parts].map(([ref, p]) => [ref, p.refdes]), [['MA', 'M1'], ['MB', 'M2']]);
});

test('the recognizer keeps every net: gates tied without a diode are not a mirror', () => {
  const target = new Circuit();
  run(target, 'add nmos MA --at 0 0', 'add nmos MB --at 400 0', 'connect MA.g MB.g');
  assert.deepEqual(findTopology(target, ['MA', 'MB'], neatMirror()), []);
  // Nor does a mirror map onto two parts that merely share a gate net with more.
  assert.deepEqual(findTopology(neatMirror(), ['M1', 'M2'], target), []);
});

test('two rail symbols of one supply are one net: a mirror on two VDD symbols is no stacked pair', () => {
  const target = new Circuit();
  run(target, 'add pmos M4 --at 0 0', 'add pmos M5 --at 400 0', 'add supply --at 0 -160', 'add supply --at 400 -160',
    'connect M4.g M5.g', 'connect M4.d M4.g', 'connect M4.s SUPPLY1.p', 'connect M5.s SUPPLY2.p');
  // A bias stack: M22 diode-connected over M24, which has its own source node.
  const stack = new Circuit();
  run(stack, 'add pmos M22 --at 0 0', 'add pmos M24 --at 0 400', 'add supply --at 0 -160', 'add resistor R1 --at 0 720 --rot 90',
    'connect M22.g M24.g', 'connect M22.d M22.g', 'connect M22.s SUPPLY1.p', 'connect M24.s R1.a');
  assert.deepEqual(findTopology(target, ['M4', 'M5'], stack), []);
  const mirror = new Circuit();
  run(mirror, 'add pmos M1 --at 0 0', 'add pmos M2 --at 400 0', 'add supply --at 0 -160', 'add supply --at 400 -160',
    'connect M1.g M2.g', 'connect M1.d M1.g', 'connect M1.s SUPPLY1.p', 'connect M2.s SUPPLY2.p');
  assert.equal(findTopology(target, ['M4', 'M5'], mirror).length, 1);
});

test('a drawing with another part drawn among its parts is passed over', () => {
  // A three-leg mirror in a row: M1 with M2 is a mirror drawn alone, M1 with M3 has M2 between.
  const source = new Circuit();
  run(source, 'add nmos M1 --at 0 0 --mirrorX', 'add nmos M2 --at 400 0', 'add nmos M3 --at 800 0',
    'connect M1.g M2.g M3.g', 'connect M1.d M1.g');
  const images = findTopology(messyMirror(), ['MA', 'MB'], source).map((m) => m.parts.get('MB').refdes);
  assert.deepEqual(images, ['M2']);
});

test('a resistor matches wired either way round; a MOS never swaps source and drain', () => {
  const source = new Circuit();
  run(source, 'add nmos M1 --at 0 0', 'add resistor R1 --at 0 -240 --rot 90', 'connect M1.d R1.b');
  const target = new Circuit();
  run(target, 'add nmos MA --at 0 0', 'add resistor RA --at 0 -240 --rot 90', 'connect MA.d RA.a');
  const [match] = findTopology(target, ['MA', 'RA'], source);
  assert.equal(match.parts.get('RA').swapped, true);
  const flipped = new Circuit();
  run(flipped, 'add nmos MA --at 0 0', 'add resistor RA --at 0 -240 --rot 90', 'connect MA.s RA.a');
  assert.deepEqual(findTopology(flipped, ['MA', 'RA'], source), []);
});

test('the wires joining some pins are the net pruned back to them', () => {
  // A T: a trunk from (0,0) to (400,0), a branch down from (200,0) to (200,200).
  const paths = [[{ x: 0, y: 0 }, { x: 400, y: 0 }], [{ x: 200, y: 0 }, { x: 200, y: 200 }]];
  assert.deepEqual(wiresJoining(paths, [{ x: 0, y: 0 }, { x: 200, y: 200 }]),
    [[{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }]]);
  assert.equal(wiresJoining(paths, [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 200, y: 200 }]).length, 3, 'three arms from the joint');
  assert.deepEqual(wiresJoining(paths, [{ x: 0, y: 0 }]), []);
  assert.equal(wiresJoining(paths, [{ x: 0, y: 0 }, { x: 600, y: 0 }]), null, 'a point the wires never reach');
});

test('arranging draws the parts, their labels, and the wires among them as the earlier drawing does', () => {
  const source = neatMirror();
  source.labels.get(source.labelOf('M1').id).offset = { x: 120, y: -120 };
  const circuit = messyMirror();
  const { candidates: [candidate] } = arrangementCandidates(circuit, ['MA', 'MB'], [{ circuit: source, name: 'neat' }]);
  assert.deepEqual(candidate.parts, ['M1', 'M2']);
  applyArrangement(circuit, ['MA', 'MB'], candidate);
  assert.deepEqual(relative(circuit, ['MA', 'MB']), relative(source, ['M1', 'M2']));
  assert.deepEqual(circuit.labelOf('MA').offset, { x: 120, y: -120 });
  const shift = { x: circuit.components.get('MA').transform.x, y: circuit.components.get('MA').transform.y };
  const gates = circuit.netOfTerminal({ comp: 'MA', term: 'g' }).paths().map((p) => p.map((q) => ({ x: q.x - shift.x, y: q.y - shift.y })));
  const drawn = source.netOfTerminal({ comp: 'M1', term: 'g' }).paths();
  // Each grid step a wire takes, however the wire is cut into polylines.
  const steps = (paths) => [...new Set(paths.flatMap((path) => path.slice(1).flatMap((b, i) => {
    const a = path[i];
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 40;
    return Array.from({ length: n }, (_, k) => {
      const p = { x: a.x + Math.sign(b.x - a.x) * 40 * k, y: a.y + Math.sign(b.y - a.y) * 40 * k };
      const q = { x: p.x + Math.sign(b.x - a.x) * 40, y: p.y + Math.sign(b.y - a.y) * 40 };
      return [`${p.x},${p.y}`, `${q.x},${q.y}`].sort().join('-');
    });
  })))].sort();
  assert.deepEqual(steps(gates), steps(drawn), 'the gate and diode wires are the drawing\'s');
  // The load is still wired to the output, from where it is.
  assert.deepEqual(circuit.components.get('RL').transform, { x: 480, y: -480, rotation: 90, mirrorX: false, mirrorY: false });
  assert.ok(circuit._pathsConnectedToTerminals(circuit.netOfTerminal({ comp: 'MB', term: 'd' })));
  assert.ok(!runCommand(circuit, 'eval').text.match(/overlap|crossing/i));
});

test('the open design comes first, a way drawn several times is counted once, and the parts\' own way is left out', () => {
  const circuit = messyMirror();
  neatMirror(circuit, { x: 1600, y: 0, prefix: 'Q' });
  const elsewhere = new Circuit();
  neatMirror(elsewhere);
  neatMirror(elsewhere, { x: 0, y: 800, prefix: 'N' });
  const odd = new Circuit();
  run(odd, 'add nmos M1 --at 0 0', 'add nmos M2 --at 0 400', 'connect M1.g M2.g', 'connect M1.d M1.g');
  const { candidates } = arrangementCandidates(circuit, ['MA', 'MB'], [
    { circuit, name: 'this design' }, { circuit: elsewhere, name: 'elsewhere' }, { circuit: odd, name: 'odd' }]);
  assert.deepEqual(candidates.map((c) => [c.source.name, c.count]), [['this design', 3], ['odd', 1]]);
  assert.deepEqual(candidates[0].parts, ['Q1', 'Q2']);
  // Arranged, the parts are drawn that way already: it is not offered again.
  applyArrangement(circuit, ['MA', 'MB'], candidates[0]);
  const again = arrangementCandidates(circuit, ['MA', 'MB'], [{ circuit, name: 'this design' }, { circuit: odd, name: 'odd' }]);
  assert.deepEqual(again.candidates.map((c) => c.source.name), ['odd']);
  assert.equal(again.alike, 1);
});

test('arranging keeps clear of the rest of the drawing', () => {
  const circuit = messyMirror();
  run(circuit, 'add nmos MX --at 440 -80');
  const { candidates } = arrangementCandidates(circuit, ['MA', 'MB'], [{ circuit: neatMirror(), name: 'neat' }]);
  applyArrangement(circuit, ['MA', 'MB'], candidates[0]);
  const body = circuit.components.get('MX').bboxWorld();
  for (const ref of ['MA', 'MB']) {
    const b = circuit.components.get(ref).bboxWorld();
    assert.ok(b.x + b.w <= body.x || body.x + body.w <= b.x || b.y + b.h <= body.y || body.y + body.h <= b.y, `${ref} clear of MX`);
  }
});

test('a drawing that finds no clear place changes nothing', () => {
  const circuit = messyMirror();
  const { candidates: [candidate] } = arrangementCandidates(circuit, ['MA', 'MB'], [{ circuit: neatMirror(), name: 'neat' }]);
  // Tile every place within reach with capacitors, around the parts as they
  // are (added as a load does: no pin of theirs touches another).
  const taken = [...circuit.components.values()].map((c) => c.bboxWorld());
  circuit._loading = true;
  for (let x = -1600; x <= 2000; x += 160) for (let y = -1600; y <= 1600; y += 80) {
    const box = { x: x - 80, y: y - 40, w: 160, h: 80 };
    if (taken.every((r) => box.x + box.w <= r.x || r.x + r.w <= box.x || box.y + box.h <= r.y || r.y + r.h <= box.y)) circuit.addComponent('capacitor', { x, y });
  }
  circuit._loading = false;
  const before = JSON.stringify(circuit.toJSON());
  assert.throws(() => applyArrangement(circuit, ['MA', 'MB'], candidate), /no clear place/);
  assert.equal(JSON.stringify(circuit.toJSON()), before);
});

test('arrange lists the ways and draws the one picked; with none it says so', () => {
  const circuit = messyMirror();
  neatMirror(circuit, { x: 1600, y: 0, prefix: 'Q' });
  const listed = runCommand(circuit, 'arrange MA MB --list');
  assert.equal(listed.mutated, false);
  assert.match(listed.text, /^1\. like Q1, Q2 in this design/);
  assert.match(listed.text, /drawn so 2 times/, 'the built-in mirror is drawn the same way');
  const done = runCommand(circuit, 'arrange MA MB');
  assert.equal(done.mutated, true);
  assert.match(done.text, /arranged MA, MB like Q1, Q2 in this design/);
  assert.deepEqual(relative(circuit, ['MA', 'MB']), relative(circuit, ['Q1', 'Q2']));
  assert.throws(() => runCommand(circuit, 'arrange MA'), /usage: arrange/);
  assert.throws(() => runCommand(circuit, 'arrange MA MB'), /MA, MB are drawn as every other drawing of them already/);
  run(circuit, 'add nmos U1 --at 0 1200', 'add nmos U2 --at 0 1600', 'connect U1.g U2.g', 'connect U1.d U1.g');
  assert.throws(() => runCommand(circuit, 'arrange MA MB --pick 9'), /--pick is 1 to 1/);
  const lone = new Circuit();
  run(lone, 'add nmos M1 --at 0 0', 'add capacitor C1 --at 400 0');
  assert.throws(() => runCommand(lone, 'arrange M1 C1'), /no other drawing of M1, C1/);
});

test('the workspace\'s designs are searched after the open one, and the built-in drawings last', () => {
  const circuit = messyMirror();
  const upright = new Circuit();
  run(upright, 'add nmos M1 --at 0 0', 'add nmos M2 --at 0 400', 'connect M1.g M2.g', 'connect M1.d M1.g');
  const designs = [{ circuit: upright, name: 'bias' }];
  const listed = runCommand(circuit, 'arrange MA MB --list', { designs });
  assert.deepEqual(listed.json.map((c) => c.source), ['bias', 'NMOS current mirror']);
});

test('every built-in drawing is clean and recognizes itself drawn anyhow', () => {
  for (const { circuit, name } of builtInDrawings()) {
    const report = runCommand(circuit, 'eval').text;
    assert.ok(!/overlap|crossing|error/i.test(report), `${name}: ${report}`);
    const refs = [...circuit.components.values()].filter((c) => c.type !== 'solder').map((c) => c.refdes);
    assert.ok(findTopology(circuit, refs, circuit).length >= 1, name);
  }
});
