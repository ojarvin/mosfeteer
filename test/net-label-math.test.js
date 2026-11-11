/** A net named as math ($\varphi_1$, as a switch's phase is written) is drawn as math. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';

function named(name) {
  const circuit = new Circuit();
  for (const line of ['add resistor R1 --at 0 0', 'add resistor R2 --at 400 0', 'connect R1.b R2.a']) runCommand(circuit, line);
  const net = [...circuit.nets.values()][0];
  runCommand(circuit, `netlabel add ${net.id} "${name}" 200 0`);
  return { circuit, label: [...circuit.labels.values()].find((label) => label.netId === net.id) };
}

test('a net label named wholly in $...$ is drawn as math, as a switch\'s phase is', () => {
  const { circuit, label } = named('$\\varphi_1$');
  assert.equal(label.math, true);
  assert.equal(label.mathSource(), '\\varphi_1');
  const svg = svgString(circuit, {});
  assert.match(svg, /<foreignObject[^>]*>[\s\S]*schematic-math-label/);
  assert.doesNotMatch(svg, /<text[^>]*>\$\\varphi_1\$<\/text>/);
});

test('a net label with a plain name stays the net label\'s text', () => {
  const { circuit, label } = named('V_{OUT}');
  assert.equal(label.math, false);
  assert.doesNotMatch(svgString(circuit, {}), /schematic-math-label/);
});
