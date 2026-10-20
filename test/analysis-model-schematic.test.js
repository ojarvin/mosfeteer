import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit, analyzedCircuit } from '../src/core/model.js';
import { analyzeSmallSignalV2 } from '../src/core/analysis/engine.js';
import { placeSmallSignalModel, smallSignalSchematic } from '../src/core/analysis/model-schematic.js';
import { noiseCandidates } from '../src/core/analysis/noise.js';
import { tableParts } from '../src/core/parts-table.js';
import { evaluate, runCommand } from '../src/core/commands.js';
import { smallSignalGoldenCorpus } from './fixtures/small-signal-golden.js';

function correspondenceHas(model, refdes) {
  return model.correspondence.has(refdes);
}

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

  // Every drawn branch is labeled with the symbol the equations use, and a
  // controlled source names the nodes it reads.
  const labels = [...model.circuit.labels.values()].map((label) => label.text);
  for (const text of ['r_{o1}', 'R_{D}', 'g_{m1}\\,\\mathrm{VIN}']) {
    assert.ok(labels.includes(text), `${text} should label a branch`);
  }
  // Set in the equations' math font.
  assert.ok([...model.circuit.labels.values()].filter((label) => label.owner && correspondenceHas(model, label.owner)).every((label) => label.math));
});

test('the model reads left to right: ports outside the branches, nodes named', () => {
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

test('an ignored body effect leaves no branch in the model', () => {
  const { circuit, report } = fixture('source-degeneration');
  // The default assumption drops the branch before the solve, so it is absent
  // from the model, the netlist, and the symbols the drawing names.
  assert.equal(report.details.pipeline.selected.some((entry) => /\.gmb$/.test(String(entry.id))), false);
  assert.ok(report.assumptions.includes('g_mb = 0'));
  const model = smallSignalSchematic(report, { circuit });
  const labels = [...model.circuit.labels.values()].map((label) => label.text);
  assert.equal(labels.some((text) => text.includes('g_{mb')), false);

  // Keeping it puts the branch back, in the model and in the drawing.
  const kept = analyzeSmallSignalV2(circuit, {
    input: 'VIN.p', output: 'VOUT.p', neglectBodyEffect: false,
  });
  assert.equal(kept.ok, true, kept.error || '');
  assert.ok(kept.details.pipeline.selected.some((entry) => /\.gmb$/.test(String(entry.id))));
  const keptModel = smallSignalSchematic(kept, { circuit });
  const keptLabels = [...keptModel.circuit.labels.values()].map((label) => label.text);
  assert.ok(keptLabels.some((text) => text.includes('g_{mb')));
});

test('every branch label sits against its own symbol', () => {
  const { circuit, report } = fixture('nmos-cascode');
  const model = smallSignalSchematic(report, { circuit });
  for (const label of model.circuit.labels.values()) {
    if (!label.owner) continue;
    const body = model.circuit.getComponent(label.owner).bboxWorld();
    const box = label.bbox();
    // The box hugs the text, without the spare cells an unmeasured math box
    // keeps: what the browser measures sits where the box says.
    assert.ok(box.w - label.textWidth() < 80, `${label.text}: a ${box.w} box for ${label.textWidth()} of text`);
    // One grid cell at most between the label box and the symbol it names, so
    // it can never read as belonging to the next branch along.
    const gapX = Math.max(body.x - (box.x + box.w), box.x - (body.x + body.w), 0);
    const gapY = Math.max(body.y - (box.y + box.h), box.y - (body.y + body.h), 0);
    assert.ok(Math.max(gapX, gapY) <= 40, `${label.text} sits ${Math.max(gapX, gapY)} from ${label.owner}`);
  }
});

test('an analysis without primitives has no model to draw', () => {
  const result = smallSignalSchematic({ ok: false }, {});
  assert.equal(result.ok, false);
  assert.match(result.error, /no small-signal primitives/);
});

test('each transistor\'s branches stand side by side, and a stacked transistor stands on the one below', () => {
  const { circuit, report } = fixture('nmos-cascode');
  const model = smallSignalSchematic(report, { circuit });
  const at = (refdes) => model.circuit.components.get(refdes).transform;
  // g_m and r_o of each device share a row, side by side.
  for (const [gm, ro] of [['gm1', 'ro1'], ['gm2', 'ro2']]) {
    assert.equal(at(gm).y, at(ro).y, `${gm} beside ${ro}`);
    assert.ok(at(gm).x < at(ro).x, `${gm} left of ${ro}`);
  }
  // M2 (the cascode) stands on M1, in the same column.
  assert.ok(at('gm2').y < at('gm1').y, 'M2 above M1');
  assert.equal(at('gm2').x, at('gm1').x, 'one column');
  // R_D runs from the output down to the ground, beside the stack.
  assert.ok(at('RD').x > at('ro2').x);
});

test('a controlled source names the nodes it reads, a grounded side left out', () => {
  const { circuit, report } = fixture('nmos-cascode');
  const labels = [...smallSignalSchematic(report, { circuit }).circuit.labels.values()].map((label) => label.text);
  // M1's gate is the input; M2's gate is grounded, its source the internal node.
  assert.ok(labels.includes('g_{m1}\\,\\mathrm{VIN}'), labels.join(' | '));
  assert.ok(labels.some((text) => /^-g_\{m2\}\\,\\mathrm\{N\d+\}$/.test(text)), labels.join(' | '));
});

test('nodes a chopper shorts take the name of the side with a port, else a named one', () => {
  const drawing = (lines) => {
    const circuit = new Circuit();
    for (const line of lines) runCommand(circuit, line);
    return circuit;
  };
  // The input's port is on one side of the chopper, a bare wire on the other.
  const circuit = drawing([
    'add input VIN --at -600 -280', 'add chopper CH1 --at 0 0', 'add nmos M1 --at 400 120',
    'add resistor RD --at 560 -200 --rot 90', 'add ground G1 --at 560 400', 'add output VOUT --at 800 0',
    // The bare wire is drawn first, so it does not win by coming first.
    'connect CH1.op M1.g', 'connect VIN.p CH1.ip', 'connect M1.d RD.a VOUT.p', 'connect M1.s G1.gnd', 'connect RD.b G1.gnd',
  ]);
  const report = analyzeSmallSignalV2(circuit, { input: 'VIN', output: 'VOUT' });
  assert.equal(report.ok, true, report.error || '');
  const model = smallSignalSchematic(report, { circuit });
  const texts = [...model.circuit.labels.values()].map((label) => label.text);
  assert.ok(texts.includes('VIN'), `the input port reads VIN: ${texts.join(' | ')}`);
  assert.ok(texts.some((text) => text.includes('\\mathrm{VIN}')), 'g_m reads the input by name');
  assert.ok(!texts.some((text) => /\bN\d+/.test(text)), `no net id stands in for a name: ${texts.join(' | ')}`);
  // Placed without ports, the bare gate draws nothing: g_m names it.
  const placed = smallSignalSchematic(report, { circuit, ports: false });
  assert.ok(![...placed.circuit.nets.values()].some((net) => net.name === 'VIN'));
  assert.equal(evaluate(placed.circuit).ok, true, JSON.stringify(evaluate(placed.circuit).issues || []).slice(0, 300));
});

test('the model is compact: the ground hangs under the first branch, the ports sit on their node\'s row', () => {
  for (const id of ['nmos-common-source', 'nmos-cascode', 'cmos-inverter']) {
    const { circuit, report } = fixture(id);
    const model = smallSignalSchematic(report, { circuit });
    const parts = [...model.circuit.components.values()];
    const ground = parts.find((part) => part.type === 'ground');
    const shunts = parts.filter((part) => !['input', 'output', 'ground', 'solder'].includes(part.type));
    const pin = ground.terminalWorld('gnd');
    const bottoms = shunts.flatMap((part) => part.worldTerminals()).filter((terminal) => terminal.x === pin.x);
    assert.ok(bottoms.some((terminal) => terminal.y === pin.y - 80), `${id}: the ground is a cell under a branch`);
    // Each port's wire runs straight along the node line to its node.
    for (const port of parts.filter((part) => ['input', 'output'].includes(part.type))) {
      const net = [...model.circuit.nets.values()].find((candidate) => candidate.terminals.some((terminal) => terminal.comp === port.refdes));
      const y = port.terminalWorld('p').y;
      const leg = net.paths().find((path) => path.some((point) => point.x === port.terminalWorld('p').x && point.y === y));
      assert.ok(leg.slice(0, 2).every((point) => point.y === y), `${id}: ${port.refdes} leaves level`);
    }
  }
});

test('without ports, every named node carries its name as a net label', () => {
  const { circuit, report } = fixture('nmos-common-source');
  const model = smallSignalSchematic(report, { circuit, ports: false });
  assert.equal(model.ok, true, model.error || '');
  const types = [...model.circuit.components.values()].map((component) => component.type);
  assert.ok(!types.includes('input') && !types.includes('output'));
  const names = [...model.circuit.labels.values()].filter((label) => label.isNetLabel()).map((label) => label.text);
  assert.ok(names.includes('VOUT'), names.join(' | '));
  assert.equal(evaluate(model.circuit).ok, true);
});

test('a placed model is drawing only: the design analyzes as before, its names stay unique', () => {
  const { circuit, report } = fixture('nmos-common-source');
  const before = analyzeSmallSignalV2(circuit, { input: 'VIN', output: 'VOUT' });
  const ink = circuit.bounds();
  const names = new Set(circuit.components.keys());
  const added = placeSmallSignalModel(circuit, smallSignalSchematic(report, { circuit, ports: false }));
  assert.ok(added.components.length >= 4);
  for (const refdes of added.components) {
    const part = circuit.components.get(refdes);
    assert.equal(part.drawingOnly, true);
    assert.ok(!names.has(refdes), `${refdes} is a new name`);
    assert.ok(part.bboxWorld().y >= ink.y + ink.h, `${refdes} is below the drawing`);
  }
  // Its nodes keep the schematic's names (VOUT), which no longer adds the
  // model's branches to the schematic's node.
  assert.ok([...circuit.nets.values()].filter((net) => net.name === 'VOUT').length >= 2);
  const after = analyzeSmallSignalV2(circuit, { input: 'VIN', output: 'VOUT' });
  assert.equal(after.ok, true, after.error || '');
  assert.ok(before.smallSignalNetlist);
  assert.equal(after.smallSignalNetlist, before.smallSignalNetlist);
  assert.equal(analyzeSmallSignalV2(circuit, {}).ok, true, 'the ports are found as before');
  assert.equal(evaluate(circuit).ok, true, JSON.stringify(evaluate(circuit).issues || []).slice(0, 300));
  // The branch labels come along, and the design still loads as saved.
  const texts = [...circuit.labels.values()].map((label) => label.text);
  assert.ok(texts.includes('r_{o1}') && texts.includes('g_{m1}\\,\\mathrm{VIN}'));
  const reloaded = Circuit.fromJSON(circuit.toJSON());
  assert.ok(added.components.every((refdes) => reloaded.components.get(refdes).drawingOnly));
  assert.equal(analyzedCircuit(reloaded).components.size, names.size);
  assert.ok(!noiseCandidates(reloaded).some((refdes) => added.components.includes(refdes)));
  assert.ok(!tableParts(reloaded).some((part) => added.components.includes(part.refdes)));
});

test('the input comes first: its shunt capacitance, then the gate-drain capacitance across to the output', () => {
  const circuit = new Circuit();
  for (const line of [
    'add input VIN --at -600 0', 'add nmos M1 --at 0 0', 'add pmos M2 --at 0 -480', 'add output VOUT --at 600 -240',
    'add capacitor CGS1 --at -320 240 --rot 90', 'add capacitor CGD1 --at -120 -240', 'add capacitor CGD2 --at 400 0 --rot 90',
    'add ground G1 --at 0 480', 'add supply VDD --at 0 -800', 'add ground G2 --at -600 -480',
    'connect VIN.p M1.g CGS1.a CGD1.a', 'connect M1.d M2.d VOUT.p CGD1.b CGD2.a', 'connect M1.s G1.gnd CGS1.b CGD2.b',
    'connect M2.s VDD.p', 'connect M2.g G2.gnd',
  ]) runCommand(circuit, line);
  // Without the Miller approximation, C_gd stays the bridge it is.
  const report = analyzeSmallSignalV2(circuit, { input: 'VIN', output: 'VOUT', ignoreBodyEffect: true, millerApproximation: false });
  assert.equal(report.ok, true, report.error || '');
  const model = smallSignalSchematic(report, { circuit });
  const at = (refdes) => model.circuit.components.get(refdes).transform;
  assert.ok(at('CGS1').x < at('CGD1').x && at('CGD1').x < at('gm1').x, 'VIN, then across, then VOUT');
  // C_gd lies along the node row, between the two nodes it joins.
  assert.equal(at('CGD1').rotation % 180, 0);
  assert.ok(at('CGD1').y < at('CGS1').y);
  assert.equal(evaluate(model.circuit).ok, true);
});
