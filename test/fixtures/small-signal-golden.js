import { Circuit } from '../../src/core/model.js';

/**
 * Stable Phase 0 schema for symbolic-analysis fixtures.
 *
 * A fixture is data plus a deterministic builder. `ports` contains terminal
 * references, `expected.exact` contains canonical v2 identities, and
 * `expected.textbook` describes the default concise presentation. Variants
 * name supported assumption combinations and their expected identities.
 * Samples use positive component values and positive angular frequency; their
 * expected values are numeric oracle targets for later integration tests.
 */
export const SMALL_SIGNAL_GOLDEN_SCHEMA_VERSION = 1;

const TEXTBOOK_DEFAULTS = Object.freeze({
  ignoreBodyEffect: true,
  gmroLarge: true,
  ignoreChannelLengthModulation: false,
  dominantPoleApproximation: false,
});

function net(circuit, terminal, name) {
  const physicalNet = circuit.netOfTerminal(terminal);
  circuit.renameNet(physicalNet, name);
  return physicalNet;
}

function add(circuit, type, refdes, x, y, options = {}) {
  return circuit.addComponent(type, { refdes, x, y, ...options });
}

function basicPorts(circuit, inputRef = 'VIN', outputRef = 'VOUT') {
  add(circuit, 'input', inputRef, -240, 0);
  add(circuit, 'output', outputRef, 240, 0);
}

function railTerminal(refdes, pmos, supply = false) {
  if (supply === pmos) return `${refdes}.p`;
  return `${refdes}.gnd`;
}

function nmosCommonSource({ pmos = false, bulk = false } = {}) {
  const circuit = new Circuit();
  const type = pmos ? (bulk ? 'pmosb' : 'pmos') : (bulk ? 'nmosb' : 'nmos');
  add(circuit, type, 'M1', 0, 0);
  add(circuit, 'resistor', 'RD', 0, pmos ? 160 : -160);
  add(circuit, pmos ? 'ground' : 'supply', 'LOAD', 80, pmos ? 320 : -320);
  add(circuit, pmos ? 'supply' : 'ground', 'RAIL', -160, pmos ? -160 : 160);
  basicPorts(circuit);
  circuit.connect('M1.d', 'RD.a', 'VOUT.p');
  circuit.connect('RD.b', railTerminal('LOAD', pmos, false));
  circuit.connect('M1.s', railTerminal('RAIL', pmos, true));
  circuit.connect('M1.g', 'VIN.p');
  if (bulk) circuit.connect('M1.b', railTerminal('RAIL', pmos, true));
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function passiveDivider() {
  const circuit = new Circuit();
  add(circuit, 'resistor', 'R1', 0, 0);
  add(circuit, 'resistor', 'R2', 240, 160);
  add(circuit, 'ground', 'GND', 320, 160);
  basicPorts(circuit);
  circuit.connect('VIN.p', 'R1.a');
  circuit.connect('R1.b', 'R2.a', 'VOUT.p');
  circuit.connect('R2.b', 'GND.gnd');
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function rlcFirstOrder() {
  const circuit = new Circuit();
  add(circuit, 'resistor', 'R1', 0, 0);
  add(circuit, 'capacitor', 'C1', 240, 160);
  add(circuit, 'ground', 'GND', 320, 240);
  basicPorts(circuit);
  circuit.connect('VIN.p', 'R1.a');
  circuit.connect('R1.b', 'C1.a', 'VOUT.p');
  circuit.connect('C1.b', 'GND.gnd');
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function rlcSecondOrder() {
  const circuit = new Circuit();
  add(circuit, 'resistor', 'R1', 0, 0);
  add(circuit, 'inductor', 'L1', 240, 0);
  add(circuit, 'capacitor', 'C1', 480, 160);
  add(circuit, 'ground', 'GND', 560, 240);
  basicPorts(circuit, 'VIN', 'VOUT');
  circuit.connect('VIN.p', 'R1.a');
  circuit.connect('R1.b', 'L1.a');
  circuit.connect('L1.b', 'C1.a', 'VOUT.p');
  circuit.connect('C1.b', 'GND.gnd');
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function commonGate({ pmos = false } = {}) {
  const circuit = new Circuit();
  const mos = pmos ? 'pmos' : 'nmos';
  add(circuit, mos, 'M1', 0, 0);
  add(circuit, 'resistor', 'RD', 0, pmos ? 160 : -160);
  add(circuit, pmos ? 'ground' : 'supply', 'LOAD', 80, pmos ? 320 : -320);
  add(circuit, pmos ? 'supply' : 'ground', 'RAIL', -160, pmos ? -160 : 160);
  add(circuit, 'port', 'BIAS', -240, 0);
  add(circuit, 'input', 'VIN', 240, 80);
  add(circuit, 'output', 'VOUT', 240, pmos ? 160 : -80);
  circuit.connect('M1.g', 'BIAS.p');
  circuit.connect('M1.s', 'VIN.p');
  circuit.connect('M1.d', 'RD.a', 'VOUT.p');
  circuit.connect('RD.b', railTerminal('LOAD', pmos, false));
  circuit.connect('BIAS.p', railTerminal('RAIL', pmos, true));
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function commonDrain({ pmos = false } = {}) {
  const circuit = new Circuit();
  const mos = pmos ? 'pmos' : 'nmos';
  add(circuit, mos, 'M1', 0, 0);
  add(circuit, 'resistor', 'RS', 240, pmos ? -160 : 160);
  add(circuit, pmos ? 'supply' : 'ground', 'RAIL', 320, pmos ? -320 : 320);
  add(circuit, pmos ? 'ground' : 'supply', 'DRAIN', -160, pmos ? 160 : -160);
  basicPorts(circuit);
  circuit.connect('M1.g', 'VIN.p');
  circuit.connect('M1.s', 'RS.a', 'VOUT.p');
  circuit.connect('RS.b', railTerminal('RAIL', pmos, true));
  circuit.connect('M1.d', railTerminal('DRAIN', pmos, false));
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function sourceDegeneration() {
  const circuit = new Circuit();
  add(circuit, 'nmos', 'M1', 0, 0);
  add(circuit, 'resistor', 'RD', 0, -160);
  add(circuit, 'resistor', 'RS', 240, 160);
  add(circuit, 'ground', 'GND_D', 80, -160);
  add(circuit, 'ground', 'GND_S', 320, 240);
  basicPorts(circuit);
  circuit.connect('M1.g', 'VIN.p');
  circuit.connect('M1.d', 'RD.a', 'VOUT.p');
  circuit.connect('RD.b', 'GND_D.gnd');
  circuit.connect('M1.s', 'RS.a');
  circuit.connect('RS.b', 'GND_S.gnd');
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function diodeConnectedLoad() {
  const circuit = new Circuit();
  add(circuit, 'nmos', 'M1', 0, 0);
  add(circuit, 'pmos', 'M2', 0, -240);
  add(circuit, 'ground', 'GND', -240, 80);
  add(circuit, 'supply', 'VDD', 240, -320);
  basicPorts(circuit);
  circuit.connect('M1.s', 'GND.gnd');
  circuit.connect('M2.s', 'VDD.p');
  circuit.connect('M1.d', 'M2.d', 'M2.g', 'VOUT.p');
  circuit.connect('M1.g', 'VIN.p');
  net(circuit, 'VIN.p', 'VIN');
  // M2.d is the output node itself; its port already names the net VOUT.
  net(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function cmosInverter() {
  const circuit = new Circuit();
  add(circuit, 'nmos', 'M1', 0, 0);
  add(circuit, 'pmos', 'M2', 0, -240);
  add(circuit, 'ground', 'GND', -240, 80);
  add(circuit, 'supply', 'VDD', 240, -320);
  basicPorts(circuit);
  circuit.connect('M1.s', 'GND.gnd');
  circuit.connect('M2.s', 'VDD.p');
  circuit.connect('M1.d', 'M2.d', 'VOUT.p');
  circuit.connect('M1.g', 'M2.g', 'VIN.p');
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function cascode({ pmos = false } = {}) {
  const circuit = new Circuit();
  const mos = pmos ? 'pmos' : 'nmos';
  add(circuit, mos, 'M1', 0, 0);
  add(circuit, mos, 'M2', 0, pmos ? -240 : 240);
  add(circuit, pmos ? 'supply' : 'ground', 'RAIL', -240, pmos ? -320 : 320);
  add(circuit, pmos ? 'ground' : 'supply', 'LOAD', 240, pmos ? 320 : -320);
  add(circuit, 'resistor', 'RD', 240, pmos ? 160 : -160);
  add(circuit, 'input', 'VIN', -240, pmos ? 80 : 0);
  add(circuit, 'port', 'BIAS', -240, pmos ? -160 : 160);
  add(circuit, 'output', 'VOUT', 240, pmos ? 80 : -80);
  circuit.connect('M1.s', railTerminal('RAIL', pmos, true));
  circuit.connect('M1.g', 'VIN.p');
  circuit.connect('M2.g', 'BIAS.p');
  circuit.connect('BIAS.p', railTerminal('RAIL', pmos, true));
  circuit.connect('M1.d', 'M2.s');
  circuit.connect('M2.d', 'RD.a', 'VOUT.p');
  circuit.connect('RD.b', railTerminal('LOAD', pmos, false));
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  net(circuit, 'BIAS.p', 'VBIAS');
  return circuit;
}

function currentMirrorLoad() {
  const circuit = new Circuit();
  add(circuit, 'nmos', 'M1', 0, 0);
  add(circuit, 'pmos', 'M2', 0, -240);
  add(circuit, 'pmos', 'M3', 400, -240);
  add(circuit, 'ground', 'GND', -240, 80);
  add(circuit, 'supply', 'VDD', 200, -320);
  basicPorts(circuit);
  circuit.connect('M1.s', 'GND.gnd');
  circuit.connect('M1.g', 'VIN.p');
  circuit.connect('M1.d', 'M2.d', 'M2.g');
  circuit.connect('M2.s', 'M3.s', 'VDD.p');
  circuit.connect('M3.g', 'M2.g');
  circuit.connect('M3.d', 'VOUT.p');
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  net(circuit, 'M2.g', 'VBIAS');
  return circuit;
}

function explicitBulkMovingSource() {
  const circuit = new Circuit();
  add(circuit, 'nmosb', 'M1', 0, 0);
  add(circuit, 'resistor', 'RS', 240, 160);
  add(circuit, 'resistor', 'RD', 0, -160);
  add(circuit, 'ground', 'GND_S', 320, 240);
  add(circuit, 'ground', 'GND_B', -240, 160);
  add(circuit, 'ground', 'GND_D', 80, -160);
  basicPorts(circuit);
  circuit.connect('M1.g', 'VIN.p');
  circuit.connect('M1.s', 'RS.a');
  circuit.connect('RS.b', 'GND_S.gnd');
  circuit.connect('M1.d', 'RD.a', 'VOUT.p');
  circuit.connect('RD.b', 'GND_D.gnd');
  circuit.connect('M1.b', 'GND_B.gnd');
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  net(circuit, 'M1.b', 'VB');
  return circuit;
}

function disconnectedReactiveIsland() {
  const circuit = nmosCommonSource();
  add(circuit, 'capacitor', 'CISO', 800, 0);
  add(circuit, 'port', 'ISO_A', 720, 0);
  add(circuit, 'port', 'ISO_B', 880, 0);
  circuit.connect('CISO.a', 'ISO_A.p');
  circuit.connect('CISO.b', 'ISO_B.p');
  return circuit;
}

function pivotCrossCoupledPair() {
  const circuit = new Circuit();
  add(circuit, 'nmos', 'M1', 0, 0);
  add(circuit, 'nmos', 'M2', 400, 0);
  add(circuit, 'ground', 'GND', 200, 160);
  add(circuit, 'input', 'VIN', 200, 240);
  add(circuit, 'output', 'VOUT', 200, -160);
  circuit.connect('M1.s', 'M2.s', 'GND.gnd');
  circuit.connect('M1.d', 'M2.g', 'VOUT.p');
  circuit.connect('M1.g', 'M2.d', 'VIN.p');
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

function singularFloatingCircuit() {
  const circuit = new Circuit();
  add(circuit, 'resistor', 'R1', 0, 0);
  add(circuit, 'input', 'VIN', -240, 0);
  add(circuit, 'output', 'VOUT', 240, 0);
  circuit.connect('VIN.p', 'R1.a');
  circuit.connect('R1.b', 'VOUT.p');
  net(circuit, 'VIN.p', 'VIN');
  net(circuit, 'VOUT.p', 'VOUT');
  return circuit;
}

const samples = Object.freeze({
  divider: [
    { values: { R1: 1e3, R2: 2e3 }, s: 1, expected: { transfer: 2 / 3, inputImpedance: 3e3, outputImpedance: 2e3 / 3 } },
    { values: { R1: 3e3, R2: 6e3 }, s: 10, expected: { transfer: 2 / 3, inputImpedance: 9e3, outputImpedance: 2e3 } },
  ],
  rc: [
    { values: { R1: 1e3, C1: 1e-6 }, s: 1e3, expected: { transfer: 1 / 2, inputImpedance: 2e3, outputImpedance: 5e2 } },
    { values: { R1: 2e3, C1: 2e-6 }, s: 5e2, expected: { transfer: 1 / 3, inputImpedance: 3e3, outputImpedance: 2e3 / 3 } },
  ],
  rlc: [
    { values: { R1: 10, L1: 1e-3, C1: 1e-6 }, s: 1e3, expected: { transfer: 1 / 1.011, inputImpedance: 1011, outputImpedance: 10.8803165183 } },
    { values: { R1: 20, L1: 2e-3, C1: 5e-7 }, s: 2e3, expected: { transfer: 1 / 1.024, inputImpedance: 1024, outputImpedance: 23.4375 } },
  ],
  cs: [
    { values: { gm1: 2e-3, ro1: 1e5, RD: 1e4 }, s: 1, expected: { transfer: -18.1818181818, inputImpedance: Infinity, outputImpedance: 9090.9090909 } },
    { values: { gm1: 1e-3, ro1: 2e5, RD: 2e4 }, s: 2, expected: { transfer: -18.1818181818, inputImpedance: Infinity, outputImpedance: 18181.8181818 } },
  ],
  cg: [
    { values: { gm1: 2e-3, ro1: 1e5, RD: 1e4 }, s: 1, expected: { transfer: 18.2727272727, inputImpedance: 547.2636816, outputImpedance: 9090.9090909 } },
    { values: { gm1: 1e-3, ro1: 2e5, RD: 2e4 }, s: 2, expected: { transfer: 18.2727272727, inputImpedance: 1094.5273632, outputImpedance: 18181.8181818 } },
  ],
  cd: [
    { values: { gm1: 2e-3, ro1: 1e5, RS: 1e4 }, s: 1, expected: { transfer: 0.9478672986, inputImpedance: Infinity, outputImpedance: 473.9336493 } },
    { values: { gm1: 1e-3, ro1: 2e5, RS: 2e4 }, s: 2, expected: { transfer: 0.9478672986, inputImpedance: Infinity, outputImpedance: 947.8672986 } },
  ],
  generic: [
    { values: { gm1: 2e-3, gmb1: 4e-4, ro1: 1e5, RD: 1e4, RS: 2e3 }, s: 1, expected: { transfer: -3.3783783784, inputImpedance: Infinity, outputImpedance: 9831.0810811 } },
    { values: { gm1: 1e-3, gmb1: 2e-4, ro1: 2e5, RD: 2e4, RS: 4e3 }, s: 2, expected: { transfer: -3.3783783784, inputImpedance: Infinity, outputImpedance: 19662.1621622 } },
  ],
  diode: [
    { values: { gm1: 2e-3, gm2: 3e-3, ro1: 1e5, ro2: 2e5 }, s: 1, expected: { transfer: -0.6633499171, inputImpedance: Infinity, outputImpedance: 331.6749585 } },
    { values: { gm1: 1e-3, gm2: 2e-3, ro1: 2e5, ro2: 4e5 }, s: 2, expected: { transfer: -0.498132005, inputImpedance: Infinity, outputImpedance: 498.1320045 } },
  ],
  mirror: [
    { values: { gm1: 2e-3, gm2: 3e-3, gm3: 3e-3, ro1: 1e5, ro2: 2e5, ro3: 3e5 }, s: 1, expected: { transfer: -109.0909091, inputImpedance: Infinity, outputImpedance: 54545.4545455 } },
    { values: { gm1: 1e-3, gm2: 2e-3, gm3: 2e-3, ro1: 2e5, ro2: 4e5, ro3: 6e5 }, s: 2, expected: { transfer: -109.0909091, inputImpedance: Infinity, outputImpedance: 109090.9090909 } },
  ],
  inverter: [
    { values: { gm1: 2e-3, gm2: 3e-3, ro1: 1e5, ro2: 2e5 }, s: 1, expected: { transfer: -333.3333333333, inputImpedance: Infinity, outputImpedance: 66666.6666667 } },
    { values: { gm1: 1e-3, gm2: 2e-3, ro1: 2e5, ro2: 4e5 }, s: 2, expected: { transfer: -400, inputImpedance: Infinity, outputImpedance: 133333.3333333 } },
  ],
  cascode: [
    { values: { gm1: 2e-3, gm2: 4e-3, ro1: 1e5, ro2: 2e5, RD: 1e4 }, s: 1, expected: { transfer: -19.9975096501, inputImpedance: Infinity, outputImpedance: 9998.7548251 } },
    { values: { gm1: 1e-3, gm2: 2e-3, ro1: 2e5, ro2: 4e5, RD: 2e4 }, s: 2, expected: { transfer: -19.9975096501, inputImpedance: Infinity, outputImpedance: 19997.5096501 } },
  ],
  singular: [
    { values: { R1: 1e3 }, s: 1, expected: { status: 'singular' } },
    { values: { R1: 2e3 }, s: 10, expected: { status: 'singular' } },
  ],
});

function expected(exact, textbook, variants, sampleSet, options = {}) {
  return {
    exact: { inputImpedance: exact.inputImpedance, outputImpedance: exact.outputImpedance, transfer: exact.transfer },
    textbook: {
      defaults: { ...TEXTBOOK_DEFAULTS, ...(options.textbookDefaults || {}) },
      inputImpedance: textbook.inputImpedance,
      outputImpedance: textbook.outputImpedance,
      transfer: textbook.transfer,
      focus: options.focus || ['gain', 'loading'],
    },
    variants,
    samples: sampleSet,
  };
}

function fixture(id, description, build, ports, result) {
  return Object.freeze({
    id,
    description,
    category: fixtureCategory(id),
    build,
    ports: Object.freeze({ ...ports }),
    expected: Object.freeze(result),
  });
}

function fixtureCategory(id) {
  if (id.startsWith('rlc') || id === 'passive-divider') return 'passive';
  if (id.includes('common-source')) return 'single-mos-common-source';
  if (id.includes('common-gate')) return 'single-mos-common-gate';
  if (id.includes('common-drain')) return 'single-mos-common-drain';
  if (id === 'source-degeneration') return 'single-mos-feedback';
  if (id === 'diode-connected-load') return 'diode-connected-mos';
  if (id === 'cmos-inverter') return 'two-mos-complementary';
  if (id.includes('cascode')) return 'two-mos-cascode';
  if (id === 'current-mirror-load') return 'active-load-mirror';
  if (id === 'explicit-bulk-moving-source') return 'bulk-effect';
  if (id === 'disconnected-reactive-island') return 'relevance-pruning';
  if (id === 'pivot-cross-coupled-pair') return 'solver-pivot';
  if (id === 'singular-floating') return 'diagnostics';
  throw new Error(`No category for golden fixture ${id}`);
}

export const smallSignalGoldenCorpus = Object.freeze([
  fixture('passive-divider', 'Two-resistor voltage divider.', passiveDivider, { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: 'R_{1} + R_{2}', outputImpedance: 'R_{1} \\|\\| R_{2}', transfer: '\\frac{R_{2}}{R_{1}+R_{2}}' },
    { inputImpedance: 'R_{1} + R_{2}', outputImpedance: 'R_{1} \\|\\| R_{2}', transfer: '\\frac{R_{2}}{R_{1}+R_{2}}' },
    [{ id: 'ro-infinity', options: { ignoreChannelLengthModulation: true }, result: { unchanged: true } }], samples.divider, { focus: ['divider ratio', 'source/load resistance'] },
  )),
  fixture('rlc-first-order', 'Series resistor with a shunt capacitor.', rlcFirstOrder, { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: 'R_{1} + \\frac{1}{s C_{1}}', outputImpedance: 'R_{1} \\|\\| \\frac{1}{s C_{1}}', transfer: '\\frac{1}{1+s R_{1} C_{1}}' },
    { inputImpedance: 'R_{1} + \\frac{1}{s C_{1}}', outputImpedance: 'R_{1} \\|\\| \\frac{1}{s C_{1}}', transfer: '\\frac{1}{1+s R_{1} C_{1}}' },
    [{ id: 'no-assumptions', options: {}, result: { unchanged: true } }], samples.rc, { focus: ['single pole', 'capacitive loading'] },
  )),
  fixture('rlc-second-order', 'Series R-L path with a shunt capacitor.', rlcSecondOrder, { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: 'R_{1}+sL_{1}+\\frac{1}{sC_{1}}', outputImpedance: '(R_{1}+sL_{1}) \\|\\| \\frac{1}{sC_{1}}', transfer: '\\frac{1}{1+sR_{1}C_{1}+s^{2}L_{1}C_{1}}' },
    { inputImpedance: 'R_{1}+sL_{1}+\\frac{1}{sC_{1}}', outputImpedance: '(R_{1}+sL_{1}) \\|\\| \\frac{1}{sC_{1}}', transfer: '\\frac{1}{1+sR_{1}C_{1}+s^{2}L_{1}C_{1}}' },
    [{ id: 'dominant-pole', options: { dominantPoleApproximation: true }, result: { denominatorDegree: 1 } }], samples.rlc, { focus: ['two poles', 'series inductance'] },
  )),
  fixture('nmos-common-source', 'NMOS common-source stage with resistive load.', () => nmosCommonSource(), { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: 'r_{o1} \\|\\| R_{D}', transfer: '-g_{m1}(r_{o1} \\|\\| R_{D})' },
    { inputImpedance: '\\infty', outputImpedance: 'r_{o1} \\|\\| R_{D}', transfer: '-g_{m1}(r_{o1} \\|\\| R_{D})' },
    [{ id: 'ro-infinity', options: { ignoreChannelLengthModulation: true }, result: { outputImpedance: 'R_{D}', transfer: '-g_{m1}R_{D}' } }], samples.cs, { focus: ['inverting gain', 'drain loading'] },
  )),
  fixture('pmos-common-source', 'PMOS common-source stage with resistive load.', () => nmosCommonSource({ pmos: true }), { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: 'r_{o1} \\|\\| R_{D}', transfer: '-g_{m1}(r_{o1} \\|\\| R_{D})' },
    { inputImpedance: '\\infty', outputImpedance: 'r_{o1} \\|\\| R_{D}', transfer: '-g_{m1}(r_{o1} \\|\\| R_{D})' },
    [{ id: 'ro-infinity', options: { ignoreChannelLengthModulation: true }, result: { outputImpedance: 'R_{D}', transfer: '-g_{m1}R_{D}' } }], samples.cs, { focus: ['inverting gain', 'source polarity'] },
  )),
  fixture('nmos-common-gate', 'NMOS common-gate stage with source input.', () => commonGate(), { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '1/(g_{m1}+(1-A_v)/r_{o1})', outputImpedance: 'r_{o1} \\|\\| R_{D}', transfer: '(1+g_{m1}r_{o1})R_{D}/(R_{D}+r_{o1})' },
    { inputImpedance: '1/g_{m1}', outputImpedance: 'r_{o1} \\|\\| R_{D}', transfer: 'g_{m1}(r_{o1} \\|\\| R_{D})' },
    [{ id: 'ro-infinity', options: { ignoreChannelLengthModulation: true }, result: { inputImpedance: '1/g_{m1}', transfer: 'g_{m1}R_{D}' } }], samples.cg, { focus: ['low input resistance', 'non-inverting gain'] },
  )),
  fixture('pmos-common-gate', 'PMOS common-gate stage with source input.', () => commonGate({ pmos: true }), { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '1/(g_{m1}+(1-A_v)/r_{o1})', outputImpedance: 'r_{o1} \\|\\| R_{D}', transfer: '(1+g_{m1}r_{o1})R_{D}/(R_{D}+r_{o1})' },
    { inputImpedance: '1/g_{m1}', outputImpedance: 'r_{o1} \\|\\| R_{D}', transfer: 'g_{m1}(r_{o1} \\|\\| R_{D})' },
    [{ id: 'ro-infinity', options: { ignoreChannelLengthModulation: true }, result: { inputImpedance: '1/g_{m1}', transfer: 'g_{m1}R_{D}' } }], samples.cg, { focus: ['low input resistance', 'polarity symmetry'] },
  )),
  fixture('nmos-common-drain', 'NMOS source follower.', () => commonDrain(), { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: '(R_{S} \\|\\| r_{o1})/(1+g_{m1}(R_{S} \\|\\| r_{o1}))', transfer: 'g_{m1}(R_{S} \\|\\| r_{o1})/(1+g_{m1}(R_{S} \\|\\| r_{o1}))' },
    { inputImpedance: '\\infty', outputImpedance: '(R_{S} \\|\\| r_{o1})/(1+g_{m1}(R_{S} \\|\\| r_{o1}))', transfer: 'g_{m1}(R_{S} \\|\\| r_{o1})/(1+g_{m1}(R_{S} \\|\\| r_{o1}))' },
    [{ id: 'ro-infinity', options: { ignoreChannelLengthModulation: true }, result: { transfer: 'g_{m1}R_{S}/(1+g_{m1}R_{S})' } }], samples.cd, { focus: ['buffer gain', 'low output resistance'] },
  )),
  fixture('pmos-common-drain', 'PMOS source follower with reversed rails.', () => commonDrain({ pmos: true }), { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: '(R_{S} \\|\\| r_{o1})/(1+g_{m1}(R_{S} \\|\\| r_{o1}))', transfer: 'g_{m1}(R_{S} \\|\\| r_{o1})/(1+g_{m1}(R_{S} \\|\\| r_{o1}))' },
    { inputImpedance: '\\infty', outputImpedance: '(R_{S} \\|\\| r_{o1})/(1+g_{m1}(R_{S} \\|\\| r_{o1}))', transfer: 'g_{m1}(R_{S} \\|\\| r_{o1})/(1+g_{m1}(R_{S} \\|\\| r_{o1}))' },
    [{ id: 'ro-infinity', options: { ignoreChannelLengthModulation: true }, result: { transfer: 'g_{m1}R_{S}/(1+g_{m1}R_{S})' } }], samples.cd, { focus: ['buffer gain', 'polarity symmetry'] },
  )),
  fixture('source-degeneration', 'NMOS common-source with source degeneration.', sourceDegeneration, { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: 'R_{D} \\|\\| (r_{o1}+R_{S}+g_{m1}r_{o1}R_{S})', transfer: '-g_{m1}R_{D}r_{o1}/(R_{D}+r_{o1}+R_{S}+g_{m1}r_{o1}R_{S})' },
    { inputImpedance: '\\infty', outputImpedance: 'R_{D} \\|\\| (r_{o1}+R_{S}+g_{m1}r_{o1}R_{S})', transfer: '-g_{m1}R_{D}r_{o1}/(R_{D}+r_{o1}+R_{S}+g_{m1}r_{o1}R_{S})' },
    [{ id: 'ro-infinity', options: { ignoreChannelLengthModulation: true }, result: { transfer: '-g_{m1}R_{D}/(1+g_{m1}R_{S})', outputImpedance: 'R_{D} \\|\\| R_{S}' } }], samples.generic, { focus: ['degeneration feedback', 'gain reduction'] },
  )),
  fixture('diode-connected-load', 'NMOS driver with diode-connected PMOS load.', diodeConnectedLoad, { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: '1/(g_{m2}+g_{mb2}+1/r_{o1}+1/r_{o2})', transfer: '-g_{m1}/(g_{m2}+g_{mb2}+1/r_{o1}+1/r_{o2})' },
    { inputImpedance: '\\infty', outputImpedance: '1/(g_{m2}+1/r_{o1}+1/r_{o2})', transfer: '-g_{m1}/(g_{m2}+1/r_{o1}+1/r_{o2})' },
    [{ id: 'ignore-body-effect', options: { ignoreBodyEffect: true }, result: { outputImpedance: '1/(g_{m2}+1/r_{o1}+1/r_{o2})' } }], samples.diode, { focus: ['diode-connected conductance', 'active load'] },
  )),
  fixture('cmos-inverter', 'Complementary MOS inverter at its small-signal operating point.', cmosInverter, { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: 'r_{o1} \\|\\| r_{o2}', transfer: '-(g_{m1}+g_{m2})(r_{o1} \\|\\| r_{o2})' },
    { inputImpedance: '\\infty', outputImpedance: 'r_{o1} \\|\\| r_{o2}', transfer: '-(g_{m1}+g_{m2})(r_{o1} \\|\\| r_{o2})' },
    [{ id: 'ro-infinity', options: { ignoreChannelLengthModulation: true }, result: { outputImpedance: '0', transfer: '0' } }], samples.inverter, { focus: ['parallel transconductors', 'inverting gain'] },
  )),
  fixture('nmos-cascode', 'Two-device NMOS cascode with a grounded gate bias.', () => cascode(), { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: 'R_{D} \\|\\| (r_{o1}+r_{o2}+g_{m2}r_{o1}r_{o2})', transfer: '-g_{m1}(R_{D} \\|\\| (r_{o1}+r_{o2}+g_{m2}r_{o1}r_{o2}))' },
    { inputImpedance: '\\infty', outputImpedance: 'R_{D} \\|\\| (r_{o1}+r_{o2}+g_{m2}r_{o1}r_{o2})', transfer: '-g_{m1}(R_{D} \\|\\| (r_{o1}+r_{o2}+g_{m2}r_{o1}r_{o2}))' },
    [{ id: 'ro-infinity', options: { ignoreChannelLengthModulation: true }, result: { outputImpedance: 'R_{D}', transfer: '-g_{m1}R_{D}' } }], samples.cascode, { focus: ['cascode output resistance', 'gain loading'] },
  )),
  fixture('pmos-cascode', 'Two-device PMOS cascode with reversed rails.', () => cascode({ pmos: true }), { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: 'R_{D} \\|\\| (r_{o1}+r_{o2}+g_{m2}r_{o1}r_{o2})', transfer: '-g_{m1}(R_{D} \\|\\| (r_{o1}+r_{o2}+g_{m2}r_{o1}r_{o2}))' },
    { inputImpedance: '\\infty', outputImpedance: 'R_{D} \\|\\| (r_{o1}+r_{o2}+g_{m2}r_{o1}r_{o2})', transfer: '-g_{m1}(R_{D} \\|\\| (r_{o1}+r_{o2}+g_{m2}r_{o1}r_{o2}))' },
    [{ id: 'ro-infinity', options: { ignoreChannelLengthModulation: true }, result: { outputImpedance: 'R_{D}', transfer: '-g_{m1}R_{D}' } }], samples.cascode, { focus: ['cascode output resistance', 'polarity symmetry'] },
  )),
  fixture('current-mirror-load', 'NMOS driver with a two-device PMOS current mirror load.', currentMirrorLoad, { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: 'r_{o2} \\|\\| r_{o3} \\|\\| r_{o1}', transfer: '-g_{m1}(r_{o1} \\|\\| r_{o2} \\|\\| r_{o3})' },
    { inputImpedance: '\\infty', outputImpedance: 'r_{o2} \\|\\| r_{o3} \\|\\| r_{o1}', transfer: '-g_{m1}(r_{o1} \\|\\| r_{o2} \\|\\| r_{o3})' },
    [{ id: 'ignore-body-effect', options: { ignoreBodyEffect: true }, result: { unchanged: true } }], samples.mirror, { focus: ['mirror load', 'output resistance'] },
  )),
  fixture('explicit-bulk-moving-source', 'Four-terminal NMOS with grounded bulk and moving source.', explicitBulkMovingSource, { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: 'R_{D} \\|\\| (r_{o1}+R_{S}+(g_{m1}+g_{mb1})r_{o1}R_{S})', transfer: '-g_{m1}R_{D}r_{o1}/(R_{D}+r_{o1}+R_{S}+(g_{m1}+g_{mb1})r_{o1}R_{S})' },
    { inputImpedance: '\\infty', outputImpedance: 'R_{D} \\|\\| (r_{o1}+R_{S}+g_{m1}r_{o1}R_{S})', transfer: '-g_{m1}R_{D}r_{o1}/(R_{D}+r_{o1}+R_{S}+g_{m1}r_{o1}R_{S})' },
    [{ id: 'ignore-body-effect', options: { ignoreBodyEffect: true }, result: { transfer: 'source-degeneration form with g_{mb1}=0' } }], samples.generic, { focus: ['body effect', 'moving source'] },
  )),
  fixture('disconnected-reactive-island', 'Common-source stage with an electrically disconnected capacitor.', disconnectedReactiveIsland, { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '\\infty', outputImpedance: 'r_{o1} \\|\\| R_{D}', transfer: '-g_{m1}(r_{o1} \\|\\| R_{D})' },
    { inputImpedance: '\\infty', outputImpedance: 'r_{o1} \\|\\| R_{D}', transfer: '-g_{m1}(r_{o1} \\|\\| R_{D})' },
    [{ id: 'ignore-island', options: {}, result: { acOrder: 0 } }], samples.cs, { focus: ['relevance pruning', 'unchanged ports'] },
  )),
  fixture('pivot-cross-coupled-pair', 'Cross-coupled two-NMOS network requiring a pivot row swap.', pivotCrossCoupledPair, { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: '1/(g_{m1}+g_{m2})', outputImpedance: '1/(g_{m1}+g_{m2})', transfer: 'undefined without a load' },
    { inputImpedance: '1/(g_{m1}+g_{m2})', outputImpedance: '1/(g_{m1}+g_{m2})', transfer: 'undefined without a load' },
    [{ id: 'ignore-body-effect', options: { ignoreBodyEffect: true }, result: { unchanged: true } }], samples.inverter, { focus: ['pivot stability', 'cross-coupled controls'] },
  )),
  fixture('singular-floating', 'Floating resistor with no AC reference.', singularFloatingCircuit, { input: 'VIN.p', output: 'VOUT.p' }, expected(
    { inputImpedance: 'singular', outputImpedance: 'singular', transfer: 'singular' },
    { inputImpedance: 'singular', outputImpedance: 'singular', transfer: 'singular' },
    [{ id: 'no-reference', options: {}, result: { status: 'singular' } }], samples.singular, { focus: ['diagnostic', 'missing reference'] },
  )),
]);

export function buildSmallSignalGolden(fixtureId) {
  const fixtureToBuild = smallSignalGoldenCorpus.find(({ id }) => id === fixtureId);
  if (!fixtureToBuild) throw new Error(`Unknown small-signal golden fixture: ${fixtureId}`);
  return fixtureToBuild.build();
}
