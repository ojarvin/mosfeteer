/** Logic synthesis: a truth table of 0, 1, Z, and - as minimized gates,
 *  drawn with ports, and read back by the logic analysis as the same table. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { analyzeLogic, minimalCover } from '../src/core/analysis/logic.js';
import { compactNames, drawSynthesis, signalNames, synthesizeLogic } from '../src/core/analysis/logic-synthesis.js';
import { nameList } from '../src/core/bus.js';

const FULL_ADDER = { inputs: ['A', 'B', 'C'], outputs: [{ name: 'S', values: '01101001' }, { name: 'CO', values: '00010111' }] };
const DONT_CARE = { inputs: ['A', 'B', 'C', 'D'], outputs: [{ name: 'Y', values: '0001-1--0110----' }] };
const TRI_STATE = { inputs: ['A', 'B', 'EN'], outputs: [{ name: 'Y', values: 'Z0Z1Z1Z0' }] };
const WIDE = { inputs: ['A', 'B', 'C', 'D', 'E'], outputs: [{ name: 'Y', values: '00000000000000010000000000000011' }] };
const CONSTANTS = { inputs: ['A'], outputs: [{ name: 'H', values: '11' }, { name: 'L', values: '00' }, { name: 'F', values: 'ZZ' }, { name: 'P', values: '01' }, { name: 'N', values: '10' }] };

/** Draw `spec` into an empty drawing and read it back. */
function drawn(spec, options = {}) {
  const result = synthesizeLogic(spec, options);
  assert.ok(result.ok, result.error);
  const circuit = new Circuit();
  drawSynthesis(circuit, result);
  return { result, circuit };
}

/** The analysis of the drawing gives every value the table asks for. */
function assertMatches(circuit, spec) {
  const report = analyzeLogic(circuit);
  assert.ok(report.ok, report.error);
  assert.deepEqual(report.inputs.map((input) => input.name).sort(), [...spec.inputs].sort());
  // The analysis sorts its columns by name; the table counts in spec order.
  const order = report.inputs.map((input) => spec.inputs.indexOf(input.name));
  for (const output of spec.outputs) {
    const column = report.outputs.findIndex((o) => o.name === output.name);
    assert.ok(column >= 0, `${output.name} is an output`);
    for (const row of report.rows) {
      const index = order.reduce((sum, k, i) => sum + row.inputs[i] * 2 ** (spec.inputs.length - 1 - k), 0);
      const want = output.values[index];
      if (want !== '-') assert.equal(String(row.outputs[column]), want, `${output.name} in row ${index}`);
    }
  }
}

const errorsOf = (circuit) => runCommand(circuit, 'eval').json.issues.filter((issue) => issue.severity === 'error');

test('the minimizer takes don\'t-cares: free rows join the products', () => {
  // Ones at 1 and 3; 5 and 7 free: C alone.
  assert.deepEqual(minimalCover([1, 3], [5, 7], 3), [[[2, 1]]]);
  assert.deepEqual(minimalCover([1, 3], [], 3), [[[0, 0], [2, 1]]]);
  assert.deepEqual(minimalCover([], [1, 2], 2), []);
});

test('each style draws gates the analysis reads as the table, with no Design Check errors', () => {
  for (const spec of [FULL_ADDER, DONT_CARE, TRI_STATE, WIDE, CONSTANTS]) {
    for (const style of ['and-or', 'nand', 'or-and', 'nor']) {
      const { circuit } = drawn(spec, { style });
      assertMatches(circuit, spec);
      assert.deepEqual(errorsOf(circuit), [], `${spec.outputs[0].name} ${style}`);
    }
  }
});

test('the equations: a sum of products, or a product of sums; a tri-state output has its enable', () => {
  const sop = synthesizeLogic(FULL_ADDER, { style: 'and-or' });
  assert.equal(sop.outputs[1].tex, 'A \\cdot B + A \\cdot C + B \\cdot C');
  const pos = synthesizeLogic(FULL_ADDER, { style: 'or-and' });
  assert.equal(pos.outputs[1].tex, '(A + B) \\cdot (A + C) \\cdot (B + C)');
  const free = synthesizeLogic(DONT_CARE);
  assert.match(free.outputs[0].tex, /^B \+ /, 'the free rows make B a product of its own');
  const tri = synthesizeLogic(TRI_STATE);
  assert.equal(tri.outputs[0].enableTex, '\\mathrm{EN}');
  assert.ok(tri.nodes.some((node) => node.type === 'tristate_buffer'));
});

test('NAND–NAND and NOR–NOR use that gate alone, and inverters only where allowed', () => {
  const types = (result) => new Set(result.nodes.filter((node) => node.kind === 'gate').map((node) => node.type));
  assert.deepEqual([...types(synthesizeLogic(FULL_ADDER, { style: 'nand' }))].filter((type) => !/^nand\d_gate$|^inverter$/.test(type)), []);
  const pure = synthesizeLogic(FULL_ADDER, { style: 'nand', gates: ['nand'] });
  assert.ok([...types(pure)].every((type) => /^nand\d_gate$/.test(type)));
  const twos = synthesizeLogic(WIDE, { style: 'nor', gates: ['nor'], maxInputs: 2 });
  assert.deepEqual([...types(twos)], ['nor2_gate']);
  const circuit = new Circuit();
  drawSynthesis(circuit, twos);
  assertMatches(circuit, WIDE);
});

test('allowed gates and the fan-in shape the gates: wide products as trees, the fewest gates', () => {
  const result = synthesizeLogic({ inputs: ['A', 'B', 'C', 'D'], outputs: [{ name: 'Y', values: '0000000000000001' }] }, { maxInputs: 3 });
  // A four-input AND as AND3(AND2, C, D): two gates.
  assert.equal(result.gateCount, 2);
  const noAnd = synthesizeLogic(FULL_ADDER, { gates: ['inverter', 'or', 'nand'] });
  assert.ok(noAnd.ok);
  assert.ok(!noAnd.nodes.some((node) => /^and\d/.test(node.type)));
});

test('more than four inputs join the gates by name', () => {
  const { circuit } = drawn(WIDE, { style: 'nand' });
  assertMatches(circuit, WIDE);
  const names = [...circuit.labels.values()].filter((label) => label.netId).map((label) => label.text);
  assert.ok(names.includes('B') && names.includes('D'), names.join(' '));
});

test('a spec or option it cannot use is refused with a reason', () => {
  assert.match(synthesizeLogic({ inputs: [], outputs: [{ name: 'Y' }] }).error, /input/);
  assert.match(synthesizeLogic({ inputs: ['A', 'a'], outputs: [{ name: 'Y' }] }).error, /named twice/);
  assert.match(synthesizeLogic({ inputs: ['A'], outputs: [{ name: 'Y', values: '012' }] }).error, /0, 1, Z, or -/);
  assert.match(synthesizeLogic({ inputs: ['A'], outputs: [{ name: 'Y', values: '011' }] }).error, /3 values for 2 rows/);
  assert.match(synthesizeLogic(FULL_ADDER, { style: 'nand', gates: ['and', 'or'] }).error, /NAND gates allowed/);
  assert.match(synthesizeLogic(FULL_ADDER, { gates: ['and', 'or'] }).error, /inverts/);
  // Short values are padded with 0, and x reads as -.
  const padded = synthesizeLogic({ inputs: ['A', 'B'], outputs: [{ name: 'Y', values: '0x' }] });
  assert.equal(padded.outputs[0].values, '0-00');
});

test('a name the drawing already has leaves the drawing as it was', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add resistor R1 --at 0 0');
  runCommand(circuit, 'add input B --at 400 400');
  const before = JSON.stringify(circuit.toJSON());
  assert.throws(() => drawSynthesis(circuit, synthesizeLogic(FULL_ADDER)), /part named B/);
  assert.equal(JSON.stringify(circuit.toJSON()), before);
});

test('drawn right of what is there', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'add resistor R1 --at 0 0');
  const right = circuit.inkBounds(0);
  const { refs } = drawSynthesis(circuit, synthesizeLogic({ inputs: ['A', 'B'], outputs: [{ name: 'Y', values: '0110' }] }));
  for (const ref of refs) assert.ok(circuit.getComponent(ref).bboxWorld().x > right.x + right.w, ref);
});

test('synthesize logic: prints, draws, and refuses', () => {
  const circuit = new Circuit();
  const printed = runCommand(circuit, 'synthesize logic A,B Y=0110 --print');
  assert.equal(printed.mutated, false);
  assert.match(printed.text, /^Y = A · B̅ \+ A̅ · B$/m);
  assert.equal(circuit.components.size, 0);
  const done = runCommand(circuit, 'synthesize logic A,B,EN Y=Z0Z1Z1Z0 --style nand --gates nand --max-inputs 2');
  assert.equal(done.mutated, true);
  assert.match(done.text, /driven when EN/);
  assertMatches(circuit, TRI_STATE);
  assert.ok([...circuit.components.values()].every((part) => !/_gate$/.test(part.type) || part.type === 'nand2_gate'));
  assert.throws(() => runCommand(circuit, 'synthesize logic A Y'), /NAME=VALUES/);
  assert.throws(() => runCommand(circuit, 'synthesize logic A Y=01 --style xor'), /--style is/);
  assert.throws(() => runCommand(new Circuit(), 'synthesize logic A Y=01 --gates xor'), /--gates/);
});

test('the synthesis table is saved with the design', () => {
  const circuit = new Circuit();
  circuit.analysisValues.synthesis = { inputs: ['A', 'B'], outputs: [{ name: 'Y', values: '01z-' }], style: 'nor', gates: ['nor'], maxInputs: 2 };
  const back = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(back.analysisValues.synthesis, { inputs: ['A', 'B'], outputs: [{ name: 'Y', values: '01Z-' }], style: 'nor', gates: ['nor'], maxInputs: 2 });
});

test('names are a list by spaces or commas; a bus range is its bits, shown as the range again', () => {
  assert.deepEqual(nameList('A B,C ,  D'), ['A', 'B', 'C', 'D']);
  assert.deepEqual(nameList('V_{a, b} X'), ['V_{a, b}', 'X']);
  assert.deepEqual(signalNames('EN D[2:0] Q<0:1>'), ['EN', 'D[2]', 'D[1]', 'D[0]', 'Q<0>', 'Q<1>']);
  assert.equal(compactNames(['EN', 'D[2]', 'D[1]', 'D[0]', 'Q<0>', 'Q<1>', 'R[4]']), 'EN D[2:0] Q<0:1> R[4]');
  assert.equal(compactNames(['D[3]', 'D[1]']), 'D[3] D[1]');
});

test('a bus in and out: a port per bit, read back by the analysis', () => {
  // Two bits of binary to three of thermometer code.
  const spec = { inputs: ['D[1:0]'], outputs: [{ name: 'T[2]', values: '0001' }, { name: 'T[1]', values: '0011' }, { name: 'T[0]', values: '0111' }] };
  const result = synthesizeLogic(spec);
  assert.deepEqual(result.inputs, ['D[1]', 'D[0]']);
  assert.equal(result.outputs[0].tex, '\\mathrm{D}[1] \\cdot \\mathrm{D}[0]', 'a bus bit upright, not leaning into its bracket');
  const circuit = new Circuit();
  drawSynthesis(circuit, result);
  assertMatches(circuit, { inputs: ['D[1]', 'D[0]'], outputs: spec.outputs });
  assert.match(synthesizeLogic({ inputs: ['D[1:0'], outputs: [{ name: 'Y' }] }).error, /not a signal name/);
});

test('synthesize logic takes the inputs by spaces, and a bus output as a value string per bit', () => {
  const circuit = new Circuit();
  const done = runCommand(circuit, 'synthesize logic D<1:0> T<2:0>=0001,0011,0111');
  assert.match(done.text, /^T<1> = D\[1\]$/m);
  assertMatches(circuit, { inputs: ['D<1>', 'D<0>'], outputs: [{ name: 'T<2>', values: '0001' }, { name: 'T<1>', values: '0011' }, { name: 'T<0>', values: '0111' }] });
  assert.match(runCommand(new Circuit(), 'synthesize logic D[1:0] Q[1:0]=0001,0110 --print').text, /D̅\[0\]/);
  assert.throws(() => runCommand(new Circuit(), 'synthesize logic A Q[1:0]=01'), /2 bits take 2 value strings/);
});

test('each gate output feeds one of its readers straight: pins given out to turn the fewest wires, rail-fed gates moved level', () => {
  // Three bits to one-hot: each first-column AND feeds two in the second.
  const spec = { inputs: ['B[2:0]'], outputs: [6, 5, 4, 3, 2, 1, 0].map((k) => ({ name: `O[${k}]`, values: Array.from({ length: 8 }, (_, v) => (v === k + 1 ? '1' : '0')).join('') })) };
  const result = synthesizeLogic(spec, { maxInputs: 2 });
  const circuit = new Circuit();
  drawSynthesis(circuit, result);
  assertMatches(circuit, { inputs: ['B[2]', 'B[1]', 'B[0]'], outputs: spec.outputs });
  const gates = [...circuit.components.values()].filter((part) => /_gate$/.test(part.type));
  for (const gate of gates) {
    const out = gate.terminalWorld('y');
    const net = circuit.netOfTerminal({ comp: gate.refdes, term: 'y' });
    const levels = net.terminals.filter((t) => t.comp !== gate.refdes).map((t) => circuit.getComponent(t.comp).terminalWorld(t.term).y);
    assert.ok(levels.includes(out.y), `${gate.refdes} runs straight into one of its readers`);
  }
  assert.deepEqual(errorsOf(circuit), []);
});
