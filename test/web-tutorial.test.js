import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { TUTORIAL_STEPS, TUTORIAL_TARGETS, openTutorialTargets, tutorialProgress, tutorialRuns } from '../src/web/tutorial.js';

const run = (circuit, ...lines) => lines.forEach((line) => runCommand(circuit, line));
const doneIds = (circuit, skipped) => tutorialProgress(circuit, skipped).steps.filter((step) => step.done).map((step) => step.id);

test('a drawn 5T OTA completes every step, one at a time', () => {
  const circuit = new Circuit();
  assert.equal(tutorialProgress(circuit).current.id, 'tail');
  run(circuit, 'add nmos M1 --at 0 400');
  assert.deepEqual(doneIds(circuit), ['tail']);
  run(circuit, 'add nmos M2 --at -240 120', 'add nmos M3 --at 240 120 --mirrorX');
  assert.equal(tutorialProgress(circuit).current.id, 'loads');
  // Gates facing away from each other are not yet a mirror pair.
  run(circuit, 'add pmos M4 --at -240 -240', 'add pmos M5 --at 240 -240');
  assert.equal(tutorialProgress(circuit).current.id, 'loads');
  run(circuit, 'mirror M4 x');
  assert.equal(tutorialProgress(circuit).current.id, 'tail-wire');
  run(circuit, 'connect M2.s M3.s M1.d');
  run(circuit, 'connect M2.d M4.d', 'connect M3.d M5.d');
  run(circuit, 'connect M4.g M5.g M4.d');
  assert.equal(tutorialProgress(circuit).current.id, 'rails');
  run(circuit, 'add supply V1 --at -240 -400', 'add supply V2 --at 240 -400', 'add ground G1 --at 0 560',
    'connect V1.p M4.s', 'connect V2.p M5.s', 'connect G1.gnd M1.s');
  assert.equal(tutorialProgress(circuit).current.id, 'pins');
  run(circuit, 'add input VI1 --at -560 120', 'add input VI2 --at 560 120 --mirrorX', 'add input VB --at -320 400',
    'connect VI1.p M2.g', 'connect VI2.p M3.g', 'connect VB.p M1.g');
  assert.equal(tutorialProgress(circuit).current.id, 'pins', 'the output still needs its pin');
  run(circuit, 'add output VO --at 480 -40', 'connect VO.p M5.d');
  assert.equal(tutorialProgress(circuit).current.id, 'label');
  const output = circuit.netOfTerminal({ comp: 'M5', term: 'd' });
  const point = output.paths()[0][0];
  circuit.addNetLabel(output.id, { text: 'OUT', x: point.x, y: point.y });
  assert.equal(tutorialProgress(circuit).current.id, 'highlight');
  circuit.cycleNetHighlight(output);
  const done = tutorialProgress(circuit);
  assert.equal(done.finished, true);
  assert.equal(done.doneCount, TUTORIAL_STEPS.length);
});

test('a skipped step is passed over but still counts once it is done', () => {
  const circuit = new Circuit();
  const skipped = new Set(['tail']);
  assert.equal(tutorialProgress(circuit, skipped).current.id, 'pair');
  assert.equal(tutorialProgress(circuit, skipped).steps[0].skipped, true);
  run(circuit, 'add nmos M1 --at 0 0');
  assert.equal(tutorialProgress(circuit, skipped).steps[0].done, true);
});

test('suggested spots disappear once a matching part stands on them', () => {
  const circuit = new Circuit();
  const pair = TUTORIAL_STEPS.find((step) => step.id === 'pair');
  assert.equal(openTutorialTargets(circuit, pair).length, 2);
  const [left] = TUTORIAL_TARGETS.pair;
  run(circuit, `add nmos M1 --at ${left.x} ${left.y}`);
  assert.deepEqual(openTutorialTargets(circuit, pair).map((target) => target.x), [240]);
  assert.deepEqual(openTutorialTargets(circuit, TUTORIAL_STEPS.find((step) => step.id === 'label')), []);
});

test('step text marks keys, and the tutorial is offered, never pushed', () => {
  assert.deepEqual(tutorialRuns('Press **w** now'), [
    { key: false, text: 'Press ' }, { key: true, text: 'w' }, { key: false, text: ' now' },
  ]);
  const html = readFileSync(new URL('../src/web/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="btn-tutorial"[^>]*role="menuitem"/);
  assert.match(html, /data-empty-action="tutorial"/);
  const main = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  // Nothing starts the tutorial except an explicit choice.
  assert.equal((main.match(/(?<!function )startTutorial\(\)/g) || []).length, 1);
  assert.match(main, /requestDocumentAction\('Starting the tutorial'/);
});

test('the suggested rows are evenly spaced, eight cells apart', () => {
  const { tail, pair, loads } = TUTORIAL_TARGETS;
  assert.equal(tail[0].y - pair[0].y, 320);
  assert.equal(pair[0].y - loads[0].y, 320);
});
