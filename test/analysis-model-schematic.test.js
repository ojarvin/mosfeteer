import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { smallSignalSchematic } from '../src/core/analysis/model-schematic.js';
import { evaluate } from '../src/core/commands.js';
import { smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';

function fixture(id) {
  const entry = smallSignalGoldenCorpus.find((candidate) => candidate.id === id);
  assert.ok(entry, `missing fixture ${id}`);
  const circuit = entry.build();
  const report = analyzeSmallSignalV2(circuit, { input: entry.ports.input, output: entry.ports.output });
  assert.equal(report.ok, true, report.error || '');
  return { circuit, report };
}

test('the drawn model carries one branch per solved primitive', () => {
  const { circuit, report } = fixture('nmos-common-source');
  const model = smallSignalSchematic(report, { circuit });
  assert.equal(model.ok, true, model.error || '');

  const primitives = report.details.pipeline.selected;
  for (const primitive of primitives) {
    // The body effect of a device whose source is the AC reference is a
    // source across one node: it carries no current and is not drawn.
    const degenerate = primitive.controlPlus !== undefined && primitive.controlPlus === primitive.controlMinus;
    const drawn = [...model.correspondence.values()].some((entry) => entry.primitive === primitive.id);
    assert.equal(drawn, !degenerate, `${primitive.id} drawn: ${drawn}`);
  }

  const types = [...model.circuit.components.values()].map((component) => component.type);
  // A transconductance is a controlled source, r_o and R_D are resistors, and
  // the model keeps the analysis ports and one AC-ground rail.
  assert.equal(types.filter((type) => type === 'vccs').length, 1, 'g_m is drawn, the null g_mb is not');
  assert.ok(types.filter((type) => type === 'resistor').length >= 2);
  assert.ok(types.includes('input') && types.includes('output') && types.includes('ground'));

  // Every drawn branch is labelled with the symbol the equations use, and a
  // controlled source names the nodes it reads.
  const labels = [...model.circuit.labels.values()].map((label) => label.text);
  for (const text of ['r_{o1}', 'R_{D}', 'g_{m1}(VIN - 0)']) {
    assert.ok(labels.includes(text), `${text} should label a branch`);
  }
});

test('the model reads left to right: ports on the node line, nodes named', () => {
  const { circuit, report } = fixture('nmos-cascode');
  const model = smallSignalSchematic(report, { circuit });
  assert.equal(model.ok, true, model.error || '');

  const ports = [...model.circuit.components.values()].filter((component) => ['input', 'output'].includes(component.type));
  assert.equal(ports.length, 2);
  const branches = [...model.circuit.components.values()]
    .filter((component) => !['input', 'output', 'ground', 'solder'].includes(component.type));
  const left = Math.min(...branches.map((component) => component.bboxWorld().x));
  const right = Math.max(...branches.map((component) => component.bboxWorld().x + component.bboxWorld().w));
  for (const port of ports) {
    assert.equal(port.transform.y, 0, 'ports sit on the node line');
    const outside = port.transform.x < left || port.transform.x > right;
    assert.ok(outside, `${port.refdes} should stand outside the drawn branches`);
  }
  assert.ok(ports[0].transform.x < ports[1].transform.x, 'input first, output last');

  // Internal nodes carry a net label; a node with a port reads its name off
  // the port, and the rail is what the ground symbol says.
  const netLabels = [...model.circuit.labels.values()].filter((label) => label.isNetLabel());
  assert.ok(netLabels.length >= 1);
  for (const label of netLabels) {
    assert.ok(!['VIN', 'VOUT', 'VSS'].includes(label.text), `${label.text} is already named by a symbol`);
  }
});

test('the drawn model is a valid schematic in its own right', () => {
  // A model that fails Design check is a model no one would put in a paper:
  // every branch routed, nothing overlapping, every label in open space.
  for (const id of ['nmos-common-source', 'source-degeneration', 'nmos-cascode', 'cmos-inverter', 'current-mirror-load', 'rlc-first-order']) {
    const { circuit, report } = fixture(id);
    const model = smallSignalSchematic(report, { circuit });
    assert.equal(model.ok, true, `${id}: ${model.error || ''}`);
    const issues = evaluate(model.circuit);
    assert.equal(issues.ok, true, `${id}: ${JSON.stringify(issues.issues || issues).slice(0, 300)}`);
    assert.deepEqual(model.failures, [], id);
  }
});

/** The corpus has no gate-drain feedback case; the Miller tests build their own. */
function millerCommonSource() {
  const circuit = new Circuit();
  circuit.addComponent('input', { refdes: 'VIN', x: -240, y: 0 });
  circuit.addComponent('output', { refdes: 'VOUT', x: 240, y: -80 });
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'RD', x: 0, y: -160 });
  circuit.addComponent('capacitor', { refdes: 'CGD', x: -80, y: -80 });
  circuit.addComponent('ground', { refdes: 'GND', x: 160, y: 160 });
  circuit.addComponent('supply', { refdes: 'VDD', x: 160, y: -240 });
  circuit.connect('VIN.p', 'M1.g', 'CGD.a');
  circuit.connect('M1.d', 'RD.a', 'VOUT.p', 'CGD.b');
  circuit.connect('M1.s', 'GND.gnd');
  circuit.connect('RD.b', 'VDD.p');
  return circuit;
}

test('a Miller-approximated bridge is drawn as its two shunt capacitances', () => {
  const circuit = millerCommonSource();
  const report = analyzeSmallSignalV2(circuit, { input: 'VIN', output: 'VOUT' });
  assert.equal(report.ok, true, report.error || '');
  const model = smallSignalSchematic(report, { circuit });
  assert.equal(model.ok, true, model.error || '');
  const labels = [...model.circuit.labels.values()].map((label) => label.text);
  assert.ok(labels.some((text) => /^C_\{M1,in\}$/.test(text)), 'the gate-side Miller capacitance is drawn');
  assert.ok(labels.some((text) => /^C_\{M1,out\}$/.test(text)), 'the drain-side Miller capacitance is drawn');
  // Its value is a whole fraction, so the drawing names it and the legend
  // states it rather than hanging an equation off a symbol.
  assert.equal(model.legend.length, 2);
  for (const entry of model.legend) assert.match(entry.value, /C_\{GD\}/);
  assert.ok(model.notes.some((note) => note.includes('Miller approximation')));
});

test('an analysis without primitives has no model to draw', () => {
  const result = smallSignalSchematic({ ok: false }, {});
  assert.equal(result.ok, false);
  assert.match(result.error, /no small-signal primitives/);
});
