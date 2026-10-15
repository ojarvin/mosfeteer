import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { TUTORIALS, TUTORIAL_STEPS, TUTORIAL_TARGETS, openTutorialTargets, tutorialById, tutorialProgress, tutorialRuns } from '../src/web/tutorial.js';

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

test('step text marks keys', () => {
  assert.deepEqual(tutorialRuns('Press **w** now'), [
    { key: false, text: 'Press ' }, { key: true, text: 'w' }, { key: false, text: ' now' },
  ]);
});

test('the suggested rows are evenly spaced, eight cells apart', () => {
  const { tail, pair, loads } = TUTORIAL_TARGETS;
  assert.equal(tail[0].y - pair[0].y, 320);
  assert.equal(pair[0].y - loads[0].y, 320);
});

const progressOf = (id, circuit, ui = {}) => tutorialProgress(circuit, new Set(), { tutorial: tutorialById(id), ui });
const doneOf = (id, circuit, ui) => progressOf(id, circuit, ui).steps.filter((step) => step.done).map((step) => step.id);

test('the switched-cap tutorial: phases, the clock, its span, beats, a beat stepped to, H(z), a finite gain', () => {
  const tutorial = tutorialById('switched-cap');
  const circuit = Circuit.fromJSON(tutorial.start());
  assert.deepEqual(doneOf('switched-cap', circuit), []);
  // One pair on a phase, the other pair on another.
  run(circuit, 'value S1 $\\varphi_1$', 'value S3 $\\varphi_1$', 'value S2 $\\varphi_2$');
  assert.deepEqual(doneOf('switched-cap', circuit), []);
  run(circuit, 'value S4 $\\varphi_2$');
  assert.deepEqual(doneOf('switched-cap', circuit), ['phases']);
  // Both high at once is no two-phase clock.
  run(circuit, 'timing 1=11 2=01');
  assert.ok(!doneOf('switched-cap', circuit).includes('clock'));
  run(circuit, 'timing 1=10 2=01');
  assert.ok(doneOf('switched-cap', circuit).includes('clock'));
  run(circuit, 'timing --span "1:2>2:2=$t_{nov}$"');
  assert.ok(doneOf('switched-cap', circuit).includes('span'));
  run(circuit, 'beat phases');
  assert.ok(doneOf('switched-cap', circuit).includes('beats'));
  assert.ok(doneOf('switched-cap', circuit, { activeBeat: 1 }).includes('step'));
  assert.ok(doneOf('switched-cap', circuit, { scEquation: 'VOUT/VIN = CS/CF ...' }).includes('derive'));
  circuit.components.get('U1').analysis.model = 'finite-gain';
  const all = progressOf('switched-cap', circuit, { activeBeat: 1, scEquation: 'A1 ...' });
  assert.equal(all.finished, true, JSON.stringify(all.steps));
});

test('the delta-sigma tutorial: the forward path, the loop closed, STF and NTF, a coefficient, time, the graph annotated', () => {
  const tutorial = tutorialById('sdm');
  const circuit = Circuit.fromJSON(tutorial.start());
  assert.equal(progressOf('sdm', circuit).current.id, 'forward');
  run(circuit, 'connect S1.e K1.in', 'connect K1.out H1.in');
  assert.deepEqual(doneOf('sdm', circuit), []);
  run(circuit, 'connect H1.out QZ1.in');
  assert.deepEqual(doneOf('sdm', circuit), ['forward']);
  run(circuit, 'connect V.p S1.s');
  assert.deepEqual(doneOf('sdm', circuit), ['forward', 'feedback']);
  assert.ok(doneOf('sdm', circuit, { signalFlowResults: 2 }).includes('derive'));
  circuit.analysisValues.coefficients.a = 1;
  assert.ok(!doneOf('sdm', circuit).includes('coefficient'), 'a left at 1 is not moved');
  circuit.analysisValues.coefficients.a = 0.5;
  assert.ok(doneOf('sdm', circuit).includes('coefficient'));
  assert.ok(doneOf('sdm', circuit, { plotsTab: 'Time' }).includes('time'));
  assert.ok(!doneOf('sdm', circuit).includes('annotate'));
  circuit.addAnnotation('box', { x: 0, y: 400, end: { x: 400, y: 800 }, plot: { kind: 'response', axis: 'normalized', range: { low: -4, high: -0.3 }, traces: [{ label: 'V/U', color: '#3b74e0', points: [{ f: 0.001, db: 0 }, { f: 0.1, db: -1 }] }] } });
  assert.ok(doneOf('sdm', circuit).includes('annotate'));
});

test('every tutorial has its own steps and words; the OTA is the first and the default', () => {
  assert.deepEqual(TUTORIALS.map((t) => t.id), ['ota', 'switched-cap', 'sdm']);
  assert.equal(tutorialById('nonsense'), TUTORIALS[0]);
  assert.equal(TUTORIALS[0].steps, TUTORIAL_STEPS);
  for (const tutorial of TUTORIALS) {
    assert.ok(tutorial.title && tutorial.card && tutorial.blurb && tutorial.finish && tutorial.done, tutorial.id);
    assert.equal(new Set(tutorial.steps.map((step) => step.id)).size, tutorial.steps.length);
  }
});
