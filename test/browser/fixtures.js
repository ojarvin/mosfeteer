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
