import { Circuit } from '../../src/core/model.js';

function net(circuit, name, ...refs) {
  const result = circuit._createNet(name);
  result.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return result;
}

/** A PMOS-input two-stage Miller OTA, open loop: its only loop through M5
 *  is the local one through R_M and C_M. */
export function millerOta() {
  const circuit = new Circuit();
  [['input', 'VINP'], ['input', 'VINN'], ['output', 'VOUT'], ['pmos', 'M1'], ['pmos', 'M2'], ['nmos', 'M3'], ['nmos', 'M4'], ['nmos', 'M5'], ['pmos', 'M6'], ['pmos', 'M7'], ['pmos', 'M8'],
    ['current_source', 'I1'], ['resistor', 'RM'], ['capacitor', 'CM'], ['capacitor', 'CL'], ['ground', 'GND'], ['supply', 'VDD']]
    .forEach(([type, refdes], i) => circuit.addComponent(type, { refdes, x: i * 400, y: 0 }));
  net(circuit, 'VINN', 'VINN.p', 'M1.g');
  net(circuit, 'VINP', 'VINP.p', 'M2.g');
  net(circuit, 'TAIL', 'M1.s', 'M2.s', 'M8.d');
  net(circuit, 'MIRROR', 'M1.d', 'M3.d', 'M3.g', 'M4.g');
  net(circuit, 'VO1', 'M2.d', 'M4.d', 'M5.g', 'RM.a');
  net(circuit, 'MS', 'RM.b', 'CM.a');
  net(circuit, 'VOUT', 'M5.d', 'M6.d', 'CM.b', 'CL.a', 'VOUT.p');
  net(circuit, 'VBP', 'M6.g', 'M7.g', 'M7.d', 'M8.g', 'I1.a');
  net(circuit, 'VSS', 'M3.s', 'M4.s', 'M5.s', 'CL.b', 'I1.b', 'GND.gnd');
  net(circuit, 'VDD', 'M6.s', 'M7.s', 'M8.s', 'VDD.p');
  return circuit;
}

