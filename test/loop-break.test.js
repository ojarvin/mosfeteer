import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { analyzeSmallSignalV2, numericLoopGain, numericSmallSignal } from '../src/core/analysis/engine.js';
import { resolveLoopBreak } from '../src/core/analysis/loop-gain.js';

function net(circuit, name, ...refs) {
  const result = circuit._createNet(name);
  result.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return result;
}

/** A 5T OTA in unity feedback: M2's gate on VOUT by a wire, by the name
 *  VOUT, or (open) on its own net VINN. */
function ota(closing) {
  const circuit = new Circuit();
  [['input', 'VIN'], ['output', 'VOUT'], ['nmos', 'M1'], ['nmos', 'M2'], ['pmos', 'M3'], ['pmos', 'M4'], ['current_source', 'I1'], ['ground', 'GND'], ['supply', 'VDD']]
    .forEach(([type, refdes], i) => circuit.addComponent(type, { refdes, x: i * 400, y: 0 }));
  net(circuit, 'VIN', 'VIN.p', 'M1.g');
  net(circuit, 'X', 'M1.d', 'M3.d', 'M3.g', 'M4.g');
  if (closing === 'wire') net(circuit, 'VOUT', 'M2.d', 'M4.d', 'VOUT.p', 'M2.g');
  else {
    net(circuit, 'VOUT', 'M2.d', 'M4.d', 'VOUT.p');
    net(circuit, closing === 'name' ? 'VOUT' : 'VINN', 'M2.g');
  }
  net(circuit, 'T', 'M1.s', 'M2.s', 'I1.a');
  net(circuit, 'VSS', 'I1.b', 'GND.gnd');
  net(circuit, 'VDD', 'M3.s', 'M4.s', 'VDD.p');
  return circuit;
}

const loopAt = (circuit, at) => analyzeSmallSignalV2(circuit, { input: 'VIN', output: 'VOUT', loopGain: { at }, ignoreBodyEffect: true });

test('the loop breaks at a terminal, at the net that closes it, or between two nets, and each gives the same T', () => {
  const reference = loopAt(ota('wire'), 'M2.g').loop;
  assert.equal(reference.ok, true, reference.error);
  assert.equal(reference.at, 'M2.g');
  for (const [closing, at] of [['wire', 'VOUT'], ['name', 'VOUT'], ['name', 'M2.g'], ['open', 'VOUT to VINN'], ['open', 'VOUT -> VINN']]) {
    const loop = loopAt(ota(closing), at).loop;
    assert.equal(loop.ok, true, `${closing} ${at}: ${loop.error}`);
    assert.deepEqual(loop.equations, reference.equations, `${closing} ${at}`);
    assert.equal(loop.loading, undefined, 'a gate draws no current: T is exact');
  }
  // T(0) close to g_m (r_o2 || r_o4) = 50 at g_m = 1, r_o = 100: exactly
  // 5025/101, r_o1 finite.
  const values = { gm1: 1, gm2: 1, gm3: 1, gm4: 1, ro1: 100, ro2: 100, ro3: 100, ro4: 100 };
  const numeric = analyzeSmallSignalV2(ota('wire'), { input: 'VIN', output: 'VOUT', loopGain: { at: 'M2.g' }, ignoreBodyEffect: true, values }).loop;
  assert.equal(numeric.equations[0], 'T(0) = \\frac{5025}{101}');
});

test('a loop not drawn closed leaves its input at AC ground for the open-loop analysis, and says so', () => {
  const report = loopAt(ota('open'), 'VOUT to VINN');
  assert.equal(report.ok, true, report.error);
  assert.ok(report.assumptions.includes('VINN at AC ground: the loop\'s open input'), JSON.stringify(report.assumptions));
  // Without a loop asked for, the open input is the user's to say.
  assert.equal(analyzeSmallSignalV2(ota('open'), { input: 'VIN', output: 'VOUT' }).ok, false);
});

test('a lifted terminal that draws current is named as left out of T', () => {
  const loop = loopAt(ota('wire'), 'M2.d').loop;
  assert.equal(loop.ok, true, loop.error);
  assert.deepEqual(loop.loading, ['M2.d']);
});

test('a break point that cannot be is refused with what to write instead', () => {
  const refused = (closing, at) => resolveLoopBreak(ota(closing), at).error;
  assert.match(refused('wire', 'M2'), /M2 is a transistor: break the loop at one of its terminals, such as M2\.g/);
  assert.match(refused('wire', 'NOPE'), /nothing named NOPE/);
  assert.match(refused('wire', 'M2.q'), /M2 has no terminal q/);
  assert.match(refused('wire', 'X to NOPE'), /no net named NOPE/);
  assert.match(refused('wire', 'VOUT to VOUT'), /are one net/);
  assert.match(refused('wire', 'T'), /T feeds no gate or amplifier input to break at: name the terminal to break at, such as M1\.s/);
  assert.match(refused('open', 'M2.g'), /M2\.g is the only connection of its net/);
  assert.match(refused('wire', 'I1'), /I1 is a part/);
  // A rail is no part of a loop.
  assert.match(loopAt(ota('open'), 'VDD to VINN').loop.error, /VDD is AC ground/);
});

test('an opamp is still broken as a whole: T = A beta', () => {
  const circuit = new Circuit();
  [['input', 'VIN'], ['output', 'VOUT'], ['resistor', 'R1'], ['resistor', 'R2'], ['opamp', 'U1'], ['ground', 'GND']]
    .forEach(([type, refdes], i) => circuit.addComponent(type, { refdes, x: i * 400, y: 0 }));
  net(circuit, 'VIN', 'VIN.p', 'R1.a');
  net(circuit, 'X', 'R1.b', 'R2.a', 'U1.im');
  net(circuit, 'VOUT', 'R2.b', 'U1.o', 'VOUT.p');
  net(circuit, 'VSS', 'U1.ip', 'GND.gnd');
  circuit.setComponentAnalysis('U1', { model: 'finite-gain' });
  const byName = analyzeSmallSignalV2(circuit, { input: 'VIN', output: 'VOUT', loopGain: { at: 'U1' } }).loop;
  const byElement = analyzeSmallSignalV2(circuit, { input: 'VIN', output: 'VOUT', loopGain: { element: 'U1' } }).loop;
  assert.equal(byName.ok, true, byName.error);
  assert.deepEqual(byName.equations, byElement.equations);
  // At its input terminal instead: the same loop, broken where it is drawn.
  const atInput = analyzeSmallSignalV2(circuit, { input: 'VIN', output: 'VOUT', loopGain: { at: 'U1.im' } }).loop;
  assert.equal(atInput.ok, true, atInput.error);
});

test('analyze loop-gain: the rows, or why not', () => {
  const circuit = ota('wire');
  const report = runCommand(circuit, 'analyze loop-gain M2.g --output VOUT --input VIN --ignore-body-effect');
  assert.match(report.text, /^AC loop gain at M2\.g: |^DC loop gain at M2\.g: /m);
  assert.equal(report.json.at, 'M2.g');
  assert.throws(() => runCommand(circuit, 'analyze loop-gain M2 --output VOUT --input VIN'), /M2 is a transistor/);
});

test('in numbers, a broken loop gives the same T, at any size, and an open loop\'s gain plots too', () => {
  const values = { gm1: 1, gm2: 1, gm3: 1, gm4: 1, ro1: 100, ro2: 100, ro3: 100, ro4: 100, CL: 10 };
  const withLoad = (closing) => {
    const circuit = ota(closing);
    circuit.addComponent('capacitor', { refdes: 'CL', x: 4000, y: 0 });
    circuit.nets.get([...circuit.nets.values()].find((n) => n.terminals.some((t) => t.comp === 'VOUT')).id).terminals.push({ comp: 'CL', term: 'a' });
    circuit.nets.get([...circuit.nets.values()].find((n) => n.name === 'VSS').id).terminals.push({ comp: 'CL', term: 'b' });
    return circuit;
  };
  for (const [closing, at] of [['wire', 'M2.g'], ['name', 'VOUT'], ['open', 'VOUT to VINN']]) {
    const model = numericLoopGain(withLoad(closing), { input: 'VIN', output: 'VOUT', ignoreBodyEffect: true, loopGain: { at } });
    assert.equal(model.ok, true, model.error);
    const loop = model.at(values).quantities.loop;
    // DC: 5025/101, as the exact T(0); one pole from C_L.
    assert.ok(Math.abs(loop.response(1e-9).re - 5025 / 101) < 1e-6, `${closing} ${at}: ${loop.response(1e-9).re}`);
    assert.equal(loop.poles.length, 1);
  }
  // The open loop's own gain, its input held at AC ground, plots as well.
  const open = numericSmallSignal(withLoad('open'), { input: 'VIN', output: 'VOUT', ignoreBodyEffect: true, loopGain: { at: 'VOUT to VINN' } });
  assert.equal(open.ok, true, open.error);
  assert.equal(open.at(values).ok, true);
  // An opamp's break is a return ratio: not in numbers here.
  assert.equal(numericLoopGain(withLoad('wire'), { input: 'VIN', output: 'VOUT', loopGain: { at: 'M2' } }).ok, false);
});
