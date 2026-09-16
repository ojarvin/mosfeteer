import { Circuit } from '../../src/core/model.js';

function net(circuit, name, refs) {
  const result = circuit._createNet(name);
  result.terminals = refs.map((ref) => circuit.resolveTerm(ref));
  return result;
}

export function commonSourceCascade(count = 3, { reactive = false, feedback = false } = {}) {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'IN', x: -400, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: count * 480, y: -80 });
  circuit.addComponent('ground', { refdes: 'GND', x: -240, y: 240 });
  const ground = ['GND.gnd'];
  for (let i = 1; i <= count; i++) {
    circuit.addComponent('nmos', { refdes: `M${i}`, x: (i - 1) * 480, y: 0 });
    circuit.addComponent('resistor', { refdes: `R${i}`, x: (i - 1) * 480, y: -240 });
    ground.push(`M${i}.s`, `R${i}.b`);
    if (reactive) {
      circuit.addComponent('capacitor', { refdes: `C${i}`, x: (i - 1) * 480 + 200, y: -240 });
      ground.push(`C${i}.b`);
    }
  }
  net(circuit, 'VIN', ['IN.p', 'M1.g']);
  for (let i = 1; i <= count; i++) net(circuit, i === count ? 'VOUT' : `STAGE${i}`, [
    `M${i}.d`, `R${i}.a`, i === count ? 'OUT.p' : `M${i + 1}.g`, ...(reactive ? [`C${i}.a`] : []),
  ]);
  net(circuit, 'VSS', ground);
  if (feedback) {
    circuit.addComponent('resistor', { refdes: 'RF', x: 1200, y: -480 });
    circuit.netOfTerminal('M1.d').terminals.push(circuit.resolveTerm('RF.a'));
    circuit.netOfTerminal('OUT.p').terminals.push(circuit.resolveTerm('RF.b'));
  }
  return circuit;
}

export function cascodeBranches() {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'IN', x: -400, y: 0 });
  circuit.addComponent('output', { refdes: 'OUT', x: 480, y: -240 });
  circuit.addComponent('ground', { refdes: 'GND', x: 200, y: 240 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 200, y: -720 });
  for (let i = 1; i <= 4; i++) circuit.addComponent(i <= 2 ? 'nmos' : 'pmos', { refdes: `M${i}`, x: 0, y: -(i - 1) * 160 });
  circuit.addComponent('port', { refdes: 'BIASN', x: -200, y: -160 });
  circuit.addComponent('port', { refdes: 'BIASP', x: -200, y: -320 });
  circuit.nets.clear();
  net(circuit, 'VIN', ['IN.p', 'M1.g']);
  net(circuit, 'VSS', ['GND.gnd', 'M1.s']);
  net(circuit, 'LOWER', ['M1.d', 'M2.s']);
  net(circuit, 'VOUT', ['M2.d', 'M3.d', 'OUT.p']);
  net(circuit, 'UPPER', ['M3.s', 'M4.d']);
  net(circuit, 'VDD', ['M4.s', 'VDD.p']);
  net(circuit, 'VBIASN', ['BIASN.p', 'M2.g']);
  net(circuit, 'VBIASP', ['BIASP.p', 'M3.g', 'M4.g']);
  return circuit;
}
