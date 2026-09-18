import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';

function net(circuit, name, ...refs) {
  const result = circuit._createNet(name);
  result.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return result;
}

/**
 * A telescopic-cascode first stage driving a common-source second stage, with
 * the compensation capacitor returned to the cascode source node (Ahuja
 * compensation) rather than to the second stage's gate. The compensation loop
 * therefore runs through an active device, and the resulting expressions are
 * large enough to have exercised two failures at once: a structural content
 * cancellation reported as budget exhaustion, and a `g_m r_o >> 1` reduction
 * that annihilated the s^0 coefficient of a difference.
 */
function cascodeCompensatedTwoStage() {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'VIN', x: -400, y: 0 });
  circuit.addComponent('output', { refdes: 'VOUT', x: 1600, y: 0 });
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 400 });
  circuit.addComponent('nmos', { refdes: 'M2', x: 0, y: 0 });
  circuit.addComponent('pmos', { refdes: 'M4', x: 0, y: -800 });
  circuit.addComponent('pmos', { refdes: 'M5', x: 0, y: -400 });
  circuit.addComponent('nmos', { refdes: 'M3', x: 1200, y: 400 });
  circuit.addComponent('pmos', { refdes: 'M6', x: 1200, y: -400 });
  circuit.addComponent('capacitor', { refdes: 'CC', x: 800, y: 800 });
  circuit.addComponent('ground', { refdes: 'GND', x: -400, y: 800 });
  circuit.addComponent('supply', { refdes: 'VDD', x: -400, y: -1200 });
  net(circuit, 'VIN', 'VIN.p', 'M1.g');
  net(circuit, 'A', 'M1.d', 'M2.s', 'CC.b');
  net(circuit, 'C', 'M4.d', 'M5.s');
  net(circuit, 'B', 'M2.d', 'M5.d', 'M3.g');
  net(circuit, 'VOUT', 'M3.d', 'M6.d', 'CC.a', 'VOUT.p');
  net(circuit, 'VSS', 'M1.s', 'M2.g', 'M3.s', 'GND.gnd');
  net(circuit, 'VDD', 'M4.s', 'M4.g', 'M5.g', 'M6.s', 'M6.g', 'VDD.p');
  return circuit;
}

test('a cascode-compensated two-stage amplifier solves and keeps its DC behavior', () => {
  const report = analyzeSmallSignalV2(cascodeCompensatedTwoStage(), { input: 'VIN', output: 'VOUT' });

  // A content factor that does not divide exactly is a structural outcome,
  // not exhaustion; this circuit used to report the latter.
  assert.equal(report.ok, true, report.error || '');

  const rows = report.equations.join('\n');
  // At DC the compensation capacitor is an open circuit, so the output sees
  // the second stage's two output resistances and nothing else.
  assert.match(rows, /Z_\{out\}\(0\) = r_\{o3\} \\parallel r_\{o6\}/);
  // The DC gain is a finite product of the two stages. A reduction that
  // cancelled the s^0 coefficient reported Z_out(0) = 0, no A_v(0) row at
  // all, and a pole at the origin this amplifier does not have.
  const dcGain = report.equations.find((row) => row.startsWith('A_v(0) ='));
  assert.ok(dcGain, 'the report must carry a DC gain row');
  for (const symbol of ['g_{m1}', 'g_{m3}', 'r_{o1}', 'r_{o6}']) {
    assert.ok(dcGain.includes(symbol), `${symbol} belongs in the DC gain`);
  }
  assert.doesNotMatch(rows, /p_\{0\} = 0/);
});
