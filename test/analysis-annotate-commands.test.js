import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { listFigures } from '../src/core/figures.js';
import { readAnalysisFormState } from '../src/core/analysis/options.js';

function build(lines) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  return circuit;
}

/** A common-source stage with a resistor load. */
function commonSource() {
  return build([
    'add nmos M1 --at 0 0', 'add resistor RD --at 0 -200 --rot 90', 'add supply VDD --at 0 -320', 'add ground GND --at 0 160',
    'add input VIN --at -280 0', 'add output VOUT --at 240 -80',
    'connect VIN.p M1.g', 'connect M1.s GND.gnd', 'connect RD.a VDD.p', 'connect RD.b M1.d VOUT.p',
  ]);
}

const figures = (circuit) => listFigures(circuit).map((figure) => `${figure.kind}:${figure.source}`);
const table = (circuit, source) => [...circuit.labels.values()].find((label) => label.figure?.source === source && label.math);

test('analyze equations: every row the window derives, from its defaults', () => {
  const circuit = commonSource();
  const done = runCommand(circuit, 'analyze equations VOUT --input VIN');
  assert.equal(done.mutated, false);
  assert.match(done.text, /^DC voltage gain: A_v\(0\) = -g_\{m1\}/m);
  assert.match(done.text, /^DC output impedance: /m);
  assert.deepEqual(figures(circuit), []);
  // Noise rows on request; an unknown kind or option is refused.
  assert.match(runCommand(circuit, 'analyze equations VOUT --input VIN --noise thermal').text, /^Input-referred thermal noise: S_\{v,in,th\}/m);
  assert.throws(() => runCommand(circuit, 'analyze equations VOUT --input VIN --noise shot'), /--noise takes thermal, flicker, output/);
  assert.throws(() => runCommand(circuit, 'analyze equations VOUT --input VIN --set wobble=on'), /--set takes OPTION=on\|off/);
  assert.throws(() => runCommand(circuit, 'analyze equations VOUT'), /usage: analyze equations/);
});

test('analyze equations --annotate writes the table once, in place again, and keeps the form for the window', () => {
  const circuit = commonSource();
  const first = runCommand(circuit, 'analyze equations VOUT --input VIN --noise thermal --annotate --exclude Ports');
  assert.equal(first.mutated, true);
  assert.match(first.text, /annotated the small-signal equations table \(F\d+\)/);
  const label = table(circuit, 'small-signal');
  assert.match(label.text, /\\text\{DC voltage gain\} & A_\{v\}\(0\) = -g_\{m1\}/);
  assert.match(label.text, /\\text\{Input-referred thermal noise\}/);
  assert.doesNotMatch(label.text, /\\text\{Ports\}/);
  assert.match(label.text, /\\hline\n\\text\{Assumptions\} & g_\{m\}r_\{o\} \\gg 1\n & g_\{mb\} = 0$/);
  // The form, as the window reads it: net ids, the options, the rows left out.
  const form = readAnalysisFormState(circuit.windows.analysis);
  assert.equal(form.input, circuit.netOfTerminal('VIN.p').id);
  assert.equal(form.output, circuit.netOfTerminal('VOUT.p').id);
  assert.equal(form.options.noiseThermal, true);
  assert.deepEqual(form.annotationExcluded, ['Ports']);
  // Again: the same figure rewritten, never a second.
  const again = runCommand(circuit, 'analyze equations VOUT --input VIN --annotate');
  assert.match(again.text, /updated the small-signal equations table/);
  assert.deepEqual(figures(circuit), ['equations:small-signal']);
  assert.match(table(circuit, 'small-signal').text, /\\text\{Ports\}/);
});

test('analyze logic --annotate writes the truth table and the equations', () => {
  const circuit = build([
    'add input A --at -400 -40', 'add input B --at -400 40', 'add xor2_gate U1 --at 0 -200', 'add and2_gate U2 --at 0 200',
    'add output S --at 400 -200', 'add output C --at 400 200',
    'connect A.p U1.a', 'connect B.p U1.b', 'connect A.p U2.a', 'connect B.p U2.b', 'connect U1.y S.p', 'connect U2.y C.p',
  ]);
  assert.equal(runCommand(circuit, 'analyze logic').mutated, false);
  const done = runCommand(circuit, 'analyze logic --annotate');
  assert.equal(done.mutated, true);
  assert.deepEqual(figures(circuit).sort(), ['equations:logic', 'table:logic']);
  assert.match(table(circuit, 'logic').text, /\\hline/);
  assert.throws(() => runCommand(circuit, 'analyze logic extra'), /usage: analyze logic/);
});

test('synthesize logic --annotate draws the gates and writes the truth table and the equations', () => {
  const circuit = new Circuit();
  const done = runCommand(circuit, 'synthesize logic A B Y=0110 --annotate');
  assert.equal(done.mutated, true);
  assert.deepEqual(figures(circuit).sort(), ['equations:synthesis', 'table:synthesis']);
  assert.throws(() => runCommand(new Circuit(), 'synthesize logic A B Y=0110 --print --annotate'), /--print draws nothing/);
});

test('analyze signal-flow --annotate writes the equation table', () => {
  const circuit = build([
    'add input U --at -720 0', 'add signal_sum SUM1 --at -400 0', 'add tf_z H1 --at 0 0 --value "tf([0 1], [1 -1])"',
    'add output V --at 400 0', 'connect U.p SUM1.w', 'connect SUM1.e H1.in', 'connect H1.out V.p', 'connect V.p SUM1.s',
  ]);
  circuit.setSignalInputNegative('SUM1', 's', true);
  const done = runCommand(circuit, 'analyze signal-flow --output V --input U --annotate');
  assert.equal(done.mutated, true);
  assert.equal(table(circuit, 'signal-flow').text, '\\frac{V}{U} = z^{-1}');
});

test('analyze switched-cap: H(z) read at a phase, the kT/C noise on request, the table on --annotate', () => {
  const p1 = '"$\\varphi_1$"';
  const p2 = '"$\\varphi_2$"';
  const circuit = build([
    'add input VIN --at -1400 0', 'add output VOUT --at 600 0',
    `add switch_open S1 --at -1200 0 --value ${p1}`, 'add capacitor CS --at -800 0',
    `add switch_open S2 --at -1000 400 --value ${p2}`, `add switch_open S3 --at -600 400 --value ${p1}`,
    `add switch_open S4 --at -400 0 --value ${p2}`, 'add opamp U1 --at 0 0', 'add capacitor CF --at 0 -400',
    'add ground G1 --at -1000 800', 'add ground G2 --at -600 800', 'add ground G3 --at -400 400',
    'connect VIN.p S1.a', 'connect S1.b CS.a', 'connect CS.a S2.a', 'connect S2.b G1.gnd',
    'connect CS.b S3.a', 'connect S3.b G2.gnd', 'connect CS.b S4.a', 'connect S4.b U1.im',
    'connect U1.ip G3.gnd', 'connect CF.a U1.im', 'connect CF.b U1.o', 'connect U1.o VOUT.p',
    'timing 1=10 2=01',
  ]);
  const done = runCommand(circuit, 'analyze switched-cap --input VIN --output VOUT --noise ktc');
  assert.equal(done.mutated, false);
  assert.match(done.text, /\\frac\{C_\{S\}\}\{C_\{F\}\}/);
  assert.match(done.text, /^kT\/C noise: /m);
  const annotated = runCommand(circuit, 'analyze switched-cap --input VIN --output VOUT --annotate');
  assert.equal(annotated.mutated, true);
  assert.match(table(circuit, 'switched-cap').text, /^\\text\{Transfer function\} & /);
  assert.throws(() => runCommand(circuit, 'analyze switched-cap --input VIN --output VOUT --sampling often'), /--sampling is period or slot/);
});

test('notes append keeps an empty line and the indentation; notes load takes a file sent with the command', () => {
  const circuit = new Circuit();
  runCommand(circuit, 'notes set # Title');
  runCommand(circuit, 'notes append');
  runCommand(circuit, 'notes append - item');
  runCommand(circuit, 'notes append   - nested');
  runCommand(circuit, 'notes append ""');
  runCommand(circuit, 'notes append after');
  assert.equal(circuit.notes, '# Title\n\n- item\n  - nested\n\nafter');
  const io = { readDataFile: (file) => { assert.equal(file, 'notes.md'); return '# From a file\n\nText.\n'; } };
  const loaded = runCommand(circuit, 'notes load notes.md', io);
  assert.equal(loaded.mutated, true);
  assert.equal(circuit.notes, '# From a file\n\nText.\n');
  assert.throws(() => runCommand(circuit, 'notes load notes.md'), /notes load reads a file/);
  assert.throws(() => runCommand(circuit, 'notes load'), /usage: notes load FILE/);
});

test('analyze bode: the gain\'s corners at the Values; --annotate puts magnitude and phase on the drawing, in place again', () => {
  const circuit = commonSource();
  runCommand(circuit, 'add capacitor CL --at 240 80 --rot 90');
  runCommand(circuit, 'connect CL.a VOUT.p');
  runCommand(circuit, 'connect CL.b GND.gnd');
  const printed = runCommand(circuit, 'analyze bode VOUT --input VIN');
  assert.equal(printed.mutated, false);
  assert.match(printed.text, /^Voltage gain: \\frac\{VOUT\}\{VIN\}/);
  assert.match(printed.text, /pole at ω = /);
  assert.deepEqual(figures(circuit), []);
  const annotated = runCommand(circuit, 'analyze bode VOUT --input VIN --annotate');
  assert.match(annotated.text, /annotated the magnitude plot[\s\S]*annotated the phase plot/);
  assert.deepEqual(figures(circuit), ['plot:small-signal', 'plot:small-signal']);
  const plots = [...circuit.labels.values()].filter((label) => label.plot);
  assert.deepEqual(plots.map((label) => label.plot.quantity || 'magnitude').sort(), ['magnitude', 'phase']);
  // Again: the same two plots rewritten, none added; one quantity alone.
  assert.match(runCommand(circuit, 'analyze bode VOUT --input VIN --magnitude --annotate').text, /updated the magnitude plot/);
  assert.equal(figures(circuit).length, 2);
  assert.throws(() => runCommand(circuit, 'analyze bode VOUT --input VIN --quantity gain'), /--quantity is one of/);
  assert.throws(() => runCommand(circuit, 'analyze bode VOUT --input VIN --quantity loop'), /needs --loop AT/);
  // Values in the plot's units, kept as the sliders keep them.
  const valued = runCommand(circuit, 'analyze bode VOUT --input VIN --values gm1=2,CL=4');
  assert.match(valued.text, /^set 2 values/);
  assert.equal(valued.mutated, true);
  assert.equal(circuit.analysisValues.bode.multipliers.gm1, 2);
  assert.throws(() => runCommand(circuit, 'analyze bode VOUT --input VIN --values gm9=1'), /no parameter "gm9"; the parameters are/);
  assert.throws(() => runCommand(circuit, 'analyze bode VOUT --input VIN --values gm1=-1'), /each value positive/);
});
