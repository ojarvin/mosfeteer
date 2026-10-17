/** Designs the browser tests open, built with the model itself. */

import { Circuit } from '../../src/core/model.js';
import { runCommand } from '../../src/core/commands.js';

function build(lines, negatives = []) {
  const circuit = new Circuit();
  for (const line of lines) {
    const result = runCommand(circuit, line);
    if (result?.ok === false) throw new Error(`${line}: ${result.message}`);
  }
  for (const [refdes, term] of negatives) circuit.setSignalInputNegative(refdes, term, true);
  return circuit.toJSON();
}

/** A second-order discrete delta-sigma loop: gains k_1, k_2, a quantizer. */
export function modulator() {
  return build([
    'add input U --at -1600 0', 'add signal_sum S1 --at -1200 0', 'add tf_z H1 --at -800 0 --value "tf([0 1], [1 -1])"',
    'add signal_sum S3 --at -400 0', 'add tf_z H2 --at 0 0 --value "tf([0 1], [1 -1])"', 'add quantizer QZ1 --at 800 0',
    'add output V --at 1200 0', 'add gain K1 --at -800 400 --rot 180 --value k_1', 'add gain K2 --at 0 400 --rot 180 --value k_2',
    'connect U.p S1.w', 'connect S1.e H1.in', 'connect H1.out S3.w', 'connect S3.e H2.in', 'connect QZ1.out V.p',
    'connect K1.out S1.s', 'connect K2.out S3.s', 'connect H2.out QZ1.in', 'connect V.p K1.in', 'connect V.p K2.in',
  ], [['S1', 's'], ['S3', 's']]);
}

/** A feed-forward chain: no loop, no quantizer. */
export function chain() {
  return build([
    'add input U --at -800 0', 'add gain K1 --at -400 0 --value k', 'add tf_s H1 --at 0 0 --value "1/(s+1)"', 'add output V --at 400 0',
    'connect U.p K1.in', 'connect K1.out H1.in', 'connect H1.out V.p',
  ]);
}

/** A common-source stage: a circuit, not a signal-flow diagram. */
export function amplifier() {
  return build([
    'add nmos M1 --at 0 0', 'add resistor RD --at 0 -320 --rot 90', 'add supply VDD --at 0 -560', 'add ground GND --at 0 240',
    'add input VIN --at -400 0', 'add output VOUT --at 400 -160',
    'connect VIN.p M1.g', 'connect M1.s GND.gnd', 'connect M1.d RD.b', 'connect RD.a VDD.p', 'connect M1.d VOUT.p',
  ]);
}

/** The amplifier on a wide sheet: a note far off makes it a large design,
 *  so on its card it reaches across the gap to a neighbor's. */
export function wideAmplifier() {
  return build([
    'add nmos M1 --at 0 0', 'add resistor RD --at 0 -320 --rot 90', 'add supply VDD --at 0 -560', 'add ground GND --at 0 240',
    'add input VIN --at -400 0', 'add output VOUT --at 400 -160',
    'connect VIN.p M1.g', 'connect M1.s GND.gnd', 'connect M1.d RD.b', 'connect RD.a VDD.p', 'connect M1.d VOUT.p',
    'annotation add margin 4000 2400',
  ]);
}

/** Two resistors apart, diagonally: R1 at the origin, R2 down and right;
 *  a note far off widens the fitted view to room for wires beside them. */
export function twoResistors() {
  return build(['add resistor R1 --at 0 0', 'add resistor R2 --at 800 400', 'annotation add margin 1600 1000']);
}

/** Things to select and edit: a note over a resistor's body, a named wire
 *  with its label, a bent line, and two input ports. */
export function editing() {
  const circuit = new Circuit();
  for (const line of [
    'add resistor R1 --at 0 0', 'annotation add note 0 0',
    'add resistor R2 --at 600 0', 'add resistor R3 --at 1000 0', 'connect R2.b R3.a --name OUT',
    'add input IN --at -400 400', 'add input IN2 --at -400 640',
  ]) runCommand(circuit, line);
  const net = circuit.netOfTerminal({ comp: 'R2', term: 'b' });
  circuit.addNetLabel(net, { x: 760, y: 0, netSide: 'right' });
  circuit.addAnnotation('line', { x: 0, y: 400, points: [{ x: 0, y: 400 }, { x: 200, y: 400 }, { x: 200, y: 560 }] });
  return circuit.toJSON();
}

/** A design whose op-amp links to another design ('child'). */
export function linkedTop() {
  const circuit = new Circuit();
  for (const line of ['add opamp OA1 --at 0 0', 'add resistor R1 --at -600 -40', 'connect R1.b OA1.ip', 'link OA1 child']) runCommand(circuit, line);
  return circuit.toJSON();
}

/** A design tagged `filters`, with one part. */
export function tagged(name) {
  const circuit = new Circuit();
  for (const line of [`add capacitor ${name} --at 0 0`, 'tag add filters']) runCommand(circuit, line);
  return circuit.toJSON();
}

/** The amplifier with two beats. */
export function withBeats() {
  const circuit = new Circuit();
  for (const line of ['add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'beat add first', 'beat add second', 'beat hide 1 R2']) runCommand(circuit, line);
  return circuit.toJSON();
}

/** A two-stage Miller OTA as a unity-gain buffer, its nets joined by name
 *  only (no wires): too large to derive with its device capacitances. */
export function millerBuffer() {
  const circuit = new Circuit();
  const add = (type, refdes, x, y) => circuit.addComponent(type, { refdes, x, y });
  add('input', 'VINP', -800, 0); add('supply', 'VDD', 0, -800); add('ground', 'GND', 0, 800);
  add('nmos', 'M1', -400, 0); add('nmos', 'M2', 400, 0); add('pmos', 'M3', -400, -400); add('pmos', 'M4', 400, -400);
  add('nmos', 'M5', 0, 400); add('pmos', 'M6', 1200, -400); add('nmos', 'M7', 1200, 400);
  add('capacitor', 'CC', 800, -200); add('capacitor', 'CL', 1600, 400); add('output', 'VOUT', 1600, 0);
  const net = (name, ...refs) => { circuit._createNet(name).terminals = refs.map((ref) => circuit.resolveTerm(ref)); };
  net('V_{DD}', 'VDD.p', 'M3.s', 'M4.s', 'M6.s');
  net('V_{SS}', 'GND.gnd', 'M5.s', 'M7.s', 'CL.b');
  net('VINP', 'VINP.p', 'M1.g');
  net('X', 'M1.d', 'M3.d', 'M3.g', 'M4.g');
  net('Y', 'M2.d', 'M4.d', 'M6.g', 'CC.a');
  net('OUT', 'M6.d', 'M7.d', 'CC.b', 'CL.a', 'VOUT.p', 'M2.g');
  net('TAIL', 'M1.s', 'M2.s', 'M5.d');
  net('VB', 'M5.g', 'M7.g');
  return circuit.toJSON();
}

/** The stray-insensitive SC integrator (test/switched-cap.test.js): S1 and
 *  S3 on φ1, S2 and S4 on φ2, with its timing diagram; `timing: false`
 *  leaves the clock undrawn. */
export function scIntegrator({ timing = true } = {}) {
  const circuit = new Circuit();
  const p1 = '"$\\varphi_1$"';
  const p2 = '"$\\varphi_2$"';
  for (const line of [
    'add input VIN --at -1400 0', 'add output VOUT --at 600 0',
    `add switch_open S1 --at -1200 0 --value ${p1}`, 'add capacitor CS --at -800 0',
    `add switch_open S2 --at -1000 400 --value ${p2}`, `add switch_open S3 --at -600 400 --value ${p1}`,
    `add switch_open S4 --at -400 0 --value ${p2}`, 'add opamp U1 --at 0 0', 'add capacitor CF --at 0 -400',
    'add ground G1 --at -1000 800', 'add ground G2 --at -600 800', 'add ground G3 --at -400 400',
    'connect VIN.p S1.a', 'connect S1.b CS.a', 'connect CS.a S2.a', 'connect S2.b G1.gnd',
    'connect CS.b S3.a', 'connect S3.b G2.gnd', 'connect CS.b S4.a', 'connect S4.b U1.im',
    'connect U1.ip G3.gnd', 'connect CF.a U1.im', 'connect CF.b U1.o', 'connect U1.o VOUT.p',
  ]) runCommand(circuit, line);
  if (timing) runCommand(circuit, 'timing 1=10 2=01');
  return circuit.toJSON();
}
