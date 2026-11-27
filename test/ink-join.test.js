import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinInkPaths } from '../src/core/ink-join.js';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';

test('a lead stopped half a stroke short of its pin runs on into the wire there as one line', () => {
  // A gate lead (its cap reaching the pin at -120) and the wire from the pin.
  assert.equal(joinInkPaths(['M -79.88 0 L -117 0', 'M -120 0 L -160 0 L -160 240'], 6), 'M -79.88 0 L -117 0 L -120 0 L -160 0 L -160 240');
  // Ends at one point, a right angle: one line, the corner mitred.
  assert.equal(joinInkPaths(['M 0 0 L 40 0', 'M 40 0 L 40 80'], 6), 'M 0 0 L 40 0 L 40 80');
});

test('a junction, a slanted meeting, and other path commands are left as they are', () => {
  const tee = ['M 0 0 L 40 0', 'M 40 0 L 80 0', 'M 40 0 L 40 40'];
  assert.equal(joinInkPaths(tee, 6).split('M').length - 1, 3, 'three ends at a point: a junction');
  assert.equal(joinInkPaths(['M 0 0 L 40 0', 'M 40 0 L 80 40'], 6).split('M').length - 1, 2, 'a slant would mitre past the caps');
  assert.equal(joinInkPaths(['M 0 0 A 5 5 0 0 1 10 0', 'M 10 0 L 20 0'], 6), 'M 0 0 A 5 5 0 0 1 10 0 M 10 0 L 20 0');
});

test('a drawing\'s leads and wires are drawn as continuous lines where they meet at a pin', () => {
  const circuit = new Circuit();
  for (const line of ['add pmos M1 --at 0 0', 'add pmos M2 --at 0 240', 'wire M1.d M2.s']) runCommand(circuit, line);
  const d = svgString(circuit).match(/class="wire-ink" d="([^"]*)"/)[1];
  assert.match(d, /L 0 77 L 0 80 L 0 160 L 0 163 L/, 'drain lead, wire, and source lead in one line');
});
