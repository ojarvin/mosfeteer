import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { swapComponentType } from '../src/core/swap.js';
import { TRANSFER_FUNCTION_ROLE, parseTransferFunction, readTransferFunction, transferFunctionTex } from '../src/core/transfer-function.js';

const run = (circuit, line) => runCommand(circuit, line);

test('tf() definitions read the MATLAB way: numerator and denominator lists, or a gain', () => {
  assert.deepEqual(parseTransferFunction('tf([1], [1 2 1])'), { num: ['1'], den: ['1', '2', '1'], inverse: false });
  assert.deepEqual(parseTransferFunction('[1, -2], [1 0.5]'), { num: ['1', '-2'], den: ['1', '0.5'], inverse: false });
  assert.deepEqual(parseTransferFunction('2*g_m'), { num: ['2*g_m'], den: ['1'], inverse: false });
  // In z, ascending powers of z^-1 by default; 'Variable', 'z' for MATLAB's descending powers.
  assert.deepEqual(parseTransferFunction('tf([1 -1], [1])', 'z'), { num: ['1', '-1'], den: ['1'], inverse: true });
  assert.deepEqual(parseTransferFunction("tf([1], [1 -1], 'Variable', 'z')", 'z'), { num: ['1'], den: ['1', '-1'], inverse: false });
  for (const bad of ['', 'tf([1], [1], [2])', '[1 2', '[1 x+y], [1]', "tf([1], [1], 'Variable', 'q')", "tf([1], [1], 'Variable', 'z')"]) {
    assert.throws(() => parseTransferFunction(bad, 's'), undefined, bad);
  }
});

test('the block draws its definition as math: descending powers, or powers of z^-1', () => {
  assert.equal(transferFunctionTex('tf([1], [1 2 1])', 's'), '\\frac{1}{s^{2} + 2 s + 1}');
  assert.equal(transferFunctionTex('tf([1], [1 -1])', 'z'), '\\frac{1}{1 - z^{-1}}');
  assert.equal(transferFunctionTex('tf([1 -1], [1])', 'z'), '1 - z^{-1}');
  assert.equal(transferFunctionTex("tf([1], [1 -1], 'Variable', 'z')", 'z'), '\\frac{1}{z - 1}');
  assert.equal(transferFunctionTex('[a_1 0 -p], [1 0]', 's'), '\\frac{a_{1} s^{2} - p}{s}');
  // A gain stands alone; over -1 its sign flips.
  assert.equal(transferFunctionTex('k', 's'), 'k');
  assert.equal(transferFunctionTex('tf([k], [-1])', 's'), '-k');
  assert.equal(transferFunctionTex('g_m/C', 's'), '\\frac{g_{m}}{C}');
});

test('a transfer-function block sizes its box to the equation, its pins mid-side on the grid', () => {
  const circuit = new Circuit();
  const gain = circuit.addComponent('tf_s', { value: 'k' });
  assert.deepEqual(gain.bodySize, { w: 160, h: 160 });
  const big = circuit.addComponent('tf_s', { value: 'tf([1 2 3 4], [1 0.5 0.25 0.125 0.0625])' });
  assert.ok(big.bodySize.w > 600 && big.bodySize.h >= 160);
  for (const block of [gain, big]) {
    assert.equal(block.bodySize.w % 80, 0);
    assert.equal(block.bodySize.h % 80, 0);
    const [input, output] = block.worldTerminals();
    assert.deepEqual([input.name, input.x, input.y], ['in', -block.bodySize.w / 2, 0]);
    assert.deepEqual([output.name, output.x, output.y], ['out', block.bodySize.w / 2, 0]);
    assert.deepEqual(block.bboxWorld(), { x: -block.bodySize.w / 2, y: -block.bodySize.h / 2, w: block.bodySize.w, h: block.bodySize.h });
  }
  // Its equation is an owned math label in the middle, not a pickable one.
  const label = [...circuit.labels.values()].find((l) => l.owner === gain.refdes && l.role === TRANSFER_FUNCTION_ROLE);
  assert.equal(label.text, '$k$');
  assert.deepEqual(label.offset, { x: 0, y: 0 });
  assert.equal(label.selectable, false);
});

test('a new definition resizes the box and its wires follow; a bad one changes nothing', () => {
  const circuit = new Circuit();
  run(circuit, 'add input U --at -800 0');
  run(circuit, 'add tf_s H1 --at 0 0');
  run(circuit, 'add output Y --at 800 0');
  run(circuit, 'connect U.p H1.in');
  run(circuit, 'connect H1.out Y.p');
  run(circuit, 'value H1 tf([1 2 3 4], [1 0.5 0.25 0.125 0.0625])');
  const h1 = circuit.components.get('H1');
  assert.ok(h1.bodySize.w > 600);
  const report = run(circuit, 'eval').text;
  assert.match(report, /no dangling terminals/);
  assert.doesNotMatch(report, /overlaps H1/, 'the equation inside its own box is no overlap');
  const before = JSON.stringify(circuit.toJSON());
  assert.throws(() => run(circuit, 'value H1 tf([1], [1'), /two lists/);
  assert.equal(JSON.stringify(circuit.toJSON()), before);
});

test('a transfer function survives save and load, and swaps between s and z', () => {
  const circuit = new Circuit();
  circuit.addComponent('tf_s', { refdes: 'H1', value: 'tf([1], [1 2 1])' });
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  const roles = [...loaded.labels.values()].filter((l) => l.role === TRANSFER_FUNCTION_ROLE);
  assert.equal(roles.length, 1);
  assert.equal(roles[0].text, '$\\frac{1}{s^{2} + 2 s + 1}$');
  swapComponentType(loaded, 'H1', 'tf_z');
  assert.equal([...loaded.labels.values()].find((l) => l.role === TRANSFER_FUNCTION_ROLE).text, '$\\frac{1}{1 + 2 z^{-1} + z^{-2}}$');
  swapComponentType(loaded, 'H1', 'filter_lpf');
  assert.equal([...loaded.labels.values()].some((l) => l.role === TRANSFER_FUNCTION_ROLE), false);
});

test('an s block reads an expression with delays, or a tf() with an InputDelay', () => {
  assert.equal(transferFunctionTex('(1 - exp(-s*T))/s', 's'), '\\frac{1 - e^{-s\\,T}}{s}');
  assert.equal(transferFunctionTex('exp(-s*T_d)*k/(s + p)', 's'), '\\frac{e^{-s\\,T_{d}}\\,k}{s + p}');
  assert.equal(transferFunctionTex('k(s+1)/(s^2 + w_0^2)', 's'), '\\frac{k\\,\\left(s + 1\\right)}{s^{2} + w_{0}^{2}}');
  assert.equal(transferFunctionTex("tf([k], [1 p], 'InputDelay', T_d)", 's'), '\\frac{k}{s + p}\\,e^{-s\\,T_{d}}');
  // An exponent is a delay; powers are whole; z blocks delay with z^-1.
  for (const [bad, variable] of [['exp(s*T)', 's'], ['exp(-s^2)', 's'], ['s^1.5', 's'], ['(s + 1', 's'], ["tf([1], [1], 'InputDelay', 2)", 'z'], ['1/(1 - exp(-s))', 'z']]) {
    assert.throws(() => readTransferFunction(bad, variable), undefined, bad);
  }
  // The box splits its fraction only when it is the whole equation.
  const circuit = new Circuit();
  const delayed = circuit.addComponent('tf_s', { value: "tf([k], [1 p], 'InputDelay', T)" });
  assert.equal([...circuit.labels.values()].find((l) => l.owner === delayed.refdes).text, '$\\frac{k}{s + p}\\,e^{-s\\,T}$');
  assert.throws(() => run(circuit, `value ${delayed.refdes} exp(s)`), /delay/);
});
