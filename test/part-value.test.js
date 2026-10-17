import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import { PART_VALUE_ROLE, replacedNameLabels, valueLabelTex } from '../src/core/part-value.js';

function circuitWith(lines) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  return circuit;
}

const valueLabels = (circuit) => [...circuit.labels.values()].filter((label) => label.role === PART_VALUE_ROLE);

test('a value draws nothing by default: no tiny text on the symbol, no label', () => {
  const circuit = circuitWith(['add capacitor C1 --at 0 0', 'value C1 8p', 'add resistor R1 --at 400 0', 'value R1 1M']);
  assert.deepEqual(valueLabels(circuit), []);
  const svg = svgString(circuit);
  assert.ok(!svg.includes('>8p<') && !svg.includes('>1M<'), 'the symbol text is gone');
});

test('--label beside writes the value alone, a step past the name, away from the part', () => {
  const circuit = circuitWith(['add capacitor C1 --at 0 0', 'value C1 1.5n --label beside']);
  const [label] = valueLabels(circuit);
  assert.equal(label.text, '$\\mathrm{1.5\\,nF}$', 'the number as typed, with its unit; no name');
  const name = circuit.labelOf('C1').anchorWorld();
  assert.deepEqual(label.anchorWorld(), { x: name.x, y: name.y - 80 }, 'the name is above the part, so the value is above the name');
  assert.equal(circuit.components.get('C1').valueLabel, 'beside');
});

test('--label replace stands in the name\'s place, and the name hides', () => {
  const circuit = circuitWith(['add resistor R1 --at 0 0 --rot 90', 'value R1 1M --label replace']);
  const [label] = valueLabels(circuit);
  assert.equal(label.text, '$\\mathrm{1\\,MΩ}$');
  assert.deepEqual(label.anchorWorld(), circuit.labelOf('R1').anchorWorld());
  assert.ok(replacedNameLabels(circuit).has(circuit.labelOf('R1').id));
  runCommand(circuit, 'value R1 --label hide');
  assert.deepEqual(valueLabels(circuit), []);
  assert.equal(replacedNameLabels(circuit).size, 0, 'the name back');
  assert.equal(circuit.components.get('R1').value, '1M', 'the value kept');
});

test('the label follows the value and the name, survives a reload, and deleting it only hides it', () => {
  const circuit = circuitWith(['add capacitor C1 --at 0 0', 'value C1 8p --label beside']);
  runCommand(circuit, 'value C1 10p');
  assert.equal(valueLabels(circuit)[0].text, '$\\mathrm{10\\,pF}$');
  runCommand(circuit, 'rename C1 C_L');
  assert.ok(circuit.valueLabelOf('C_L'), 'renamed with its part');
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.equal(reloaded.components.get('C_L').valueLabel, 'beside');
  assert.equal(valueLabels(reloaded).length, 1);
  circuit.removeLabel(circuit.valueLabelOf('C_L').id);
  assert.equal(circuit.components.get('C_L').valueLabel, null);
  assert.equal(circuit.components.get('C_L').value, '10p');
  // An emptied value takes its label with it.
  runCommand(circuit, 'value C_L 1p --label beside');
  runCommand(circuit, 'value C_L ""');
  assert.deepEqual(valueLabels(circuit), []);
});

test('a value that is not a number reads as typed', () => {
  assert.equal(valueLabelTex({ value: 'R_{L}', type: 'resistor' }), '$R_{L}$');
});

test('value --label refuses a part with no value label, and a mode it does not know', () => {
  const circuit = circuitWith(['add nmos M1 --at 0 0', 'add resistor R1 --at 400 0']);
  assert.throws(() => runCommand(circuit, 'value M1 x --label beside'), /only passives and sources/);
  assert.throws(() => runCommand(circuit, 'value R1 1k --label above'), /--label is beside/);
  assert.equal(circuit.components.get('R1').value, '', 'nothing changed');
});
