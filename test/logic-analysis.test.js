import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { analyzeLogic, logicNameTex, sumOfProducts } from '../src/core/analysis/logic.js';

function build(lines) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  return circuit;
}
const table = (result) => result.rows.map((row) => `${[...row.states, ...row.inputs].join('')}|${[...row.next, ...row.outputs].join('')}`);
const equations = (result) => Object.fromEntries(result.expressions.map((e) => [e.name, e.tex]));

function halfAdder() {
  return build([
    'add input A --at -400 -40', 'add input B --at -400 40', 'add xor2_gate U1 --at 0 -200', 'add and2_gate U2 --at 0 200',
    'add output S --at 400 -200', 'add output C --at 400 200',
    'connect A.p U1.a', 'connect B.p U1.b', 'connect A.p U2.a', 'connect B.p U2.b', 'connect U1.y S.p', 'connect U2.y C.p',
  ]);
}

test('a half adder: inputs and outputs from its ports, a row per combination, each output a sum of products', () => {
  const result = analyzeLogic(halfAdder());
  assert.equal(result.ok, true);
  assert.equal(result.sequential, false);
  assert.deepEqual(result.inputs.map((s) => s.name), ['A', 'B']);
  assert.deepEqual(result.outputs.map((s) => s.name), ['C', 'S']);
  assert.deepEqual(table(result), ['00|00', '01|01', '10|01', '11|10']);
  assert.deepEqual(equations(result), { C: 'A \\cdot B', S: 'A \\cdot \\overline{B} + \\overline{A} \\cdot B' });
});

test('a pin wired to nothing is a signal of its own: an unwired input an input, an unwired output an output', () => {
  const result = analyzeLogic(build(['add nand2_gate U1 --at 0 0']));
  assert.deepEqual(result.inputs.map((s) => s.name), ['U1.a', 'U1.b']);
  assert.deepEqual(result.outputs.map((s) => s.name), ['U1.y']);
  assert.deepEqual(table(result), ['00|1', '01|1', '10|1', '11|0']);
  assert.equal(result.expressions[0].tex, '\\overline{\\text{U1.a}} + \\overline{\\text{U1.b}}');
});

test('a multiplexer passes a at s = 0 and b at s = 1; ground and a supply are 0 and 1', () => {
  const mux = analyzeLogic(build(['add mux2 U1 --at 0 0', 'add input A --at -400 -40', 'add input B --at -400 40', 'add input S --at -400 300', 'add output Y --at 400 0',
    'connect A.p U1.a', 'connect B.p U1.b', 'connect S.p U1.s', 'connect U1.y Y.p']));
  assert.deepEqual(mux.inputs.map((s) => s.name), ['A', 'B', 'S']);
  assert.equal(equations(mux).Y, 'A \\cdot \\overline{S} + B \\cdot S');
  const tied = analyzeLogic(build(['add and2_gate U1 --at 0 0', 'add input A --at -400 -40', 'add supply VDD --at -200 -200', 'add output Y --at 400 0',
    'connect A.p U1.a', 'connect VDD.p U1.b', 'connect U1.y Y.p']));
  assert.deepEqual(tied.inputs.map((s) => s.name), ['A']);
  assert.equal(equations(tied).Y, 'A');
});

test('tri-state buffers share a signal: Z with none driving, X when two disagree', () => {
  const result = analyzeLogic(build([
    'add tristate_buffer U1 --at 0 -200', 'add tristate_buffer U2 --at 0 200', 'add input A --at -400 -200', 'add input B --at -400 200',
    'add input E1 --at 0 -400', 'add input E2 --at 0 400', 'add output Y --at 400 0',
    'connect A.p U1.a', 'connect B.p U2.a', 'connect E1.p U1.en', 'connect E2.p U2.en', 'connect U1.y Y.p', 'connect U2.y Y.p',
  ]));
  assert.equal(result.ok, true, result.error);
  const at = (a, b, e1, e2) => result.rows.find((row) => row.inputs.join('') === `${a}${b}${e1}${e2}`).outputs[0];
  assert.equal(at(1, 0, 0, 0), 'Z');
  assert.equal(at(1, 0, 1, 0), 1);
  assert.equal(at(1, 0, 0, 1), 0);
  assert.equal(at(1, 0, 1, 1), 'X');
  assert.equal(at(1, 1, 1, 1), 1);
  assert.equal(result.expressions[0].tex, null, 'no sum of products where it can be Z');
});

test('a flip-flop makes a state table: the clock takes no column, the next state an equation', () => {
  const toggle = build(['add dff U1 --at 0 0', 'add xor2_gate U2 --at -600 -40', 'add input T --at -1000 -80', 'add input CLK --at -1000 200', 'add output Q --at 400 -40',
    'connect T.p U2.a', 'connect U2.y U1.D', 'connect U1.Q Q.p', 'connect U1.Q U2.b', 'connect CLK.p U1.CLK']);
  const result = analyzeLogic(toggle);
  assert.equal(result.sequential, true);
  assert.deepEqual(result.inputs.map((s) => s.name), ['T']);
  assert.deepEqual(result.states.map((s) => [s.name, s.next]), [['Q', 'Q^{+}']]);
  assert.deepEqual(result.clock, { name: 'CLK', falling: false });
  assert.deepEqual(result.outputs, [], 'Q is the state, not an output too');
  assert.deepEqual(table(result), ['00|0', '01|1', '10|1', '11|0']);
  assert.equal(equations(result)['Q^{+}'], 'Q \\cdot \\overline{T} + \\overline{Q} \\cdot T');
});

test('a latch holds while its enable is low; an active-low reset forces 0', () => {
  const latch = analyzeLogic(build(['add latch U1 --at 0 0', 'add input L --at -400 -40', 'add input EN --at -400 40', 'connect L.p U1.L', 'connect EN.p U1.EN']));
  assert.deepEqual(latch.inputs.map((s) => s.name), ['EN', 'L']);
  assert.equal(equations(latch)['\\text{U1.Q}^{+}'], '\\text{U1.Q} \\cdot \\overline{\\mathrm{EN}} + \\mathrm{EN} \\cdot L');
  const reset = analyzeLogic(build(['add dff_rstb U1 --at 0 0', 'add input D --at -400 -40', 'add input CLK --at -400 40', 'add input RSTB --at 0 400',
    'connect D.p U1.D', 'connect CLK.p U1.CLK', 'connect RSTB.p U1.RSTB']));
  assert.equal(equations(reset)['\\text{U1.Q}^{+}'], 'D \\cdot \\mathrm{RSTB}');
});

test('it refuses what it cannot read: a gate loop, two drivers, an analog part, two clocks, a clock from logic or into it', () => {
  const error = (lines) => analyzeLogic(build(lines)).error || '';
  assert.match(error(['add nand2_gate U1 --at 0 0', 'add nand2_gate U2 --at 600 400', 'connect U1.y U2.a', 'connect U2.y U1.b']), /loop runs through U1, U2|loop runs through U2, U1/);
  assert.match(error(['add inverter U1 --at 0 -200', 'add inverter U2 --at 0 200', 'add output Y --at 400 0', 'connect U1.y Y.p', 'connect U2.y Y.p']), /driven by U1\.y and U2\.y/);
  assert.match(error(['add inverter U1 --at 0 0', 'add resistor R1 --at 400 0', 'connect U1.y R1.a']), /R1 \(resistor\) is on the logic signal/);
  assert.match(error(['add dff U1 --at 0 0', 'add dff U2 --at 0 400', 'add input C1 --at -400 40', 'add input C2 --at -400 440', 'connect C1.p U1.CLK', 'connect C2.p U2.CLK']), /on 2 clocks/);
  assert.match(error(['add dff U1 --at 0 0', 'add inverter U2 --at -400 40', 'connect U2.y U1.CLK']), /comes from logic/);
  assert.match(error(['add dff U1 --at 0 0', 'add inverter U2 --at -400 400', 'add input CLK --at -800 40', 'connect CLK.p U1.CLK', 'connect CLK.p U2.a']), /also feeds U2\.a/);
  assert.match(analyzeLogic(new Circuit()).error, /no logic/);
});

test('a drawing-only part is not analyzed', () => {
  const circuit = halfAdder();
  runCommand(circuit, 'add resistor R9 --at 400 600');
  runCommand(circuit, 'connect R9.a U2.y');
  assert.equal(analyzeLogic(circuit).ok, false);
  circuit.components.get('R9').drawingOnly = true;
  assert.equal(analyzeLogic(circuit).ok, true);
});

test('sums of products are minimal: majority, three-input parity, constants', () => {
  const majority = Array.from({ length: 8 }, (_, i) => ((i >> 2) + ((i >> 1) & 1) + (i & 1) >= 2 ? 1 : 0));
  assert.equal(sumOfProducts(majority, ['A', 'B', 'C']).tex, 'A \\cdot B + A \\cdot C + B \\cdot C');
  const parity = Array.from({ length: 8 }, (_, i) => ((i >> 2) ^ ((i >> 1) & 1) ^ (i & 1)));
  assert.equal(sumOfProducts(parity, ['A', 'B', 'C']).sop.length, 4);
  assert.equal(sumOfProducts([0, 0], ['A']).tex, '0');
  assert.equal(sumOfProducts([1, 1], ['A']).tex, '1');
  assert.equal(sumOfProducts([0, 'Z'], ['A']).tex, null);
});

test('signal names as TeX: markup kept, digits subscripted, words upright, pins as text', () => {
  assert.equal(logicNameTex('A'), 'A');
  assert.equal(logicNameTex('Q0'), 'Q_{0}');
  assert.equal(logicNameTex('SEL'), '\\mathrm{SEL}');
  assert.equal(logicNameTex('D_{in}'), 'D_{in}');
  assert.equal(logicNameTex('$\\phi_1$'), '\\phi_1');
  assert.equal(logicNameTex('U1.a'), '\\text{U1.a}');
});

test('analyze logic prints the table and the equations; with no logic it says so', () => {
  const output = runCommand(halfAdder(), 'analyze logic');
  const text = output.output ?? output.text;
  assert.match(text, /^A B \| C S\n0 0 \| 0 0\n/);
  assert.match(text, /S = A \\cdot \\overline\{B\} \+ \\overline\{A\} \\cdot B/);
  assert.throws(() => runCommand(new Circuit(), 'analyze logic'), /no logic/);
  assert.throws(() => runCommand(halfAdder(), 'analyze logic extra'), /usage: analyze logic/);
});
