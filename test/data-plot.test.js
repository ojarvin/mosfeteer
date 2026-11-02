import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { loadDocument } from '../src/core/document.js';
import { svgString } from '../src/core/render.js';
import { listFigures } from '../src/core/figures.js';
import { dataPlotFromText, replaceDataPlotTraces } from '../src/core/data-plot.js';

const SCOPE = 'Scope export\nTime (s),CH1 (V),CH2 (V)\n0,0.1,1\n1e-6,0.2,2\n2e-6,0.3,3\n';
const io = (files) => ({ readDataFile: (file) => {
  if (!(file in files)) throw new Error(`no ${file}`);
  return files[file];
} });

function plotted(files = { 'runs/scope.csv': SCOPE }, line = 'annotation dataplot runs/scope.csv') {
  const circuit = new Circuit();
  runCommand(circuit, 'add resistor R1 --at 0 0');
  const out = runCommand(circuit, line, io(files));
  return { circuit, out, box: circuit.labels.get(out.json.id) };
}

test('dataplot plots a file\'s columns as a figure with its legend, keeping the traces and never the file', () => {
  const { circuit, out, box } = plotted();
  assert.equal(out.mutated, true);
  assert.match(out.text, /plotted 2 traces from scope\.csv/);
  assert.equal(box.plot.kind, 'data');
  assert.equal(box.plot.file, 'scope.csv');
  assert.deepEqual(box.plot.x, { label: 'Time (s)', scale: 'linear' });
  assert.deepEqual(box.plot.traces.map((t) => t.label), ['CH1 (V)', 'CH2 (V)']);
  assert.deepEqual(circuit.plotLegend(box).map((l) => l.text), ['CH1 (V)', 'CH2 (V)']);
  assert.equal(box.style.blackTraces, true);
  assert.deepEqual(listFigures(circuit).map((f) => [f.kind, f.source]), [['plot', 'data']]);
  const saved = JSON.stringify(circuit.toJSON());
  assert.doesNotMatch(saved, /Scope export/);
  const loaded = loadDocument(JSON.parse(saved));
  assert.deepEqual(loaded.labels.get(box.id).plot, box.plot);
  assert.match(svgString(loaded), /class="plot-annotation"/);
});

test('dataplot takes columns by number or name, the row number, scales, and where to put it', () => {
  const { box } = plotted(undefined, 'annotation dataplot runs/scope.csv --x row --y "ch2 (v)" --yscale log --at 400 400');
  assert.equal(box.plot.x.label, 'Row');
  assert.equal(box.plot.y.label, 'CH2 (V)');
  assert.equal(box.plot.y.scale, 'log');
  assert.deepEqual(box.plot.traces[0].points, [[0, 1], [1, 2], [2, 3]]);
  assert.deepEqual(box.anchor, { x: 400, y: 400 });
  const semi = plotted({ 'a.txt': 'x;y\n0,5;1,5\n1,5;2,5\n' }, 'annotation dataplot a.txt --sep semicolon --decimal comma --y 2').box;
  assert.deepEqual(semi.plot.traces[0].points, [[0.5, 1.5], [1.5, 2.5]]);
});

test('dataplot says what is wrong, and changes nothing then', () => {
  const circuit = new Circuit();
  const fails = (line, pattern, files = { 'scope.csv': SCOPE }) => {
    const before = JSON.stringify(circuit.toJSON());
    assert.throws(() => runCommand(circuit, line, io(files)), pattern);
    assert.equal(JSON.stringify(circuit.toJSON()), before);
  };
  fails('annotation dataplot', /usage: annotation dataplot FILE/);
  fails('annotation dataplot missing.csv', /no missing\.csv/);
  fails('annotation dataplot scope.csv --y 9', /no column "9" \(columns: 1 Time \(s\), 2 CH1 \(V\), 3 CH2 \(V\)\)/);
  fails('annotation dataplot scope.csv --sep pipe', /--sep is tab, semicolon, comma, or space/);
  fails('annotation dataplot scope.csv --xscale ln', /--xscale is log or linear/);
  fails('annotation dataplot words.txt', /no column of numbers to plot/, { 'words.txt': 'a b\nc d\n' });
  assert.throws(() => runCommand(circuit, 'annotation dataplot scope.csv'), /use the CLI, or Insert → Data plot/);
});

test('a data plot\'s axes are named and scaled, zoomed and fitted, and its traces taken off, by command', () => {
  const { circuit, box } = plotted();
  const run = (line) => runCommand(circuit, line);
  assert.equal(run(`annotation plotaxis ${box.id} y --label "Voltage (V)" --scale log`).mutated, true);
  assert.deepEqual(box.plot.y, { label: 'Voltage (V)', scale: 'log' });
  assert.equal(run(`annotation plotaxis ${box.id} y --scale log`).mutated, false);
  run(`annotation plotview ${box.id} x 0 1e-6`);
  assert.deepEqual(box.plot.view, { x: [0, 1e-6] });
  assert.throws(() => run(`annotation plotview ${box.id} y -1 1`), /a log axis shows only positive values/);
  assert.throws(() => run(`annotation plotview ${box.id} x 2 1`), /low under high/);
  run(`annotation plotview ${box.id} x fit`);
  assert.equal(box.plot.view, undefined);
  run(`annotation plottrace ${box.id} 1 rm`);
  assert.deepEqual(box.plot.traces.map((t) => t.label), ['CH2 (V)']);
  assert.deepEqual(circuit.plotLegend(box).map((l) => l.text), ['CH2 (V)']);
  assert.throws(() => run(`annotation plottrace ${box.id} 1 rm`), /keeps one trace/);
  assert.throws(() => run(`annotation plotaxis ${box.id} z --scale log`), /usage: annotation plotaxis/);
  const plain = circuit.addAnnotation('box', { x: 0, y: 800, end: { x: 400, y: 1000 } });
  assert.throws(() => run(`annotation plotaxis ${plain.id} x --scale log`), /is not a data plot/);
});

test('a data plot read again keeps its place, axes, and zoom, and writes its legend where it was', () => {
  const { circuit, box } = plotted();
  runCommand(circuit, `annotation plotaxis ${box.id} x --label t`);
  runCommand(circuit, `annotation plotview ${box.id} y 0 2`);
  const where = circuit.plotLegend(box)[0].bbox();
  replaceDataPlotTraces(circuit, box, dataPlotFromText('t,a,b,c\n0,1,2,3\n1,2,3,4\n', { file: 'new.csv' }));
  assert.equal(box.plot.file, 'new.csv');
  assert.equal(box.plot.x.label, 't');
  assert.deepEqual(box.plot.view, { y: [0, 2] });
  const legend = circuit.plotLegend(box);
  assert.deepEqual(legend.map((l) => l.text), ['a', 'b', 'c']);
  assert.equal(legend[0].bbox().x, where.x);
});

test('a data plot\'s trace is renamed and recolored by command, its legend entry with it', () => {
  const { circuit, box } = plotted();
  const out = runCommand(circuit, `annotation plottrace ${box.id} 2 --label "Out" --color crimson`);
  assert.equal(out.mutated, true);
  assert.deepEqual([box.plot.traces[1].label, box.plot.traces[1].color], ['Out', '#cd2a46']);
  const entry = circuit.plotLegend(box)[1];
  assert.deepEqual([entry.text, entry.style.color], ['Out', '#cd2a46']);
  // A shorter name keeps the entry's left edge beside the plot.
  assert.ok(Math.abs(entry.bbox().x - circuit.plotLegend(box)[0].bbox().x) <= 20, `${entry.bbox().x} ${circuit.plotLegend(box)[0].bbox().x}`);
  assert.equal(runCommand(circuit, `annotation plottrace ${box.id} 2 --color #cd2a46`).mutated, false);
  assert.throws(() => runCommand(circuit, `annotation plottrace ${box.id} 2 --color #123456`), /a color is one of red, orange/);
  assert.throws(() => runCommand(circuit, `annotation plottrace ${box.id} 5 --label x`), /no trace 5/);
  assert.throws(() => runCommand(circuit, `annotation plottrace ${box.id} 2`), /usage: annotation plottrace/);
});

test('a data plot\'s legend entry renamed on its own renames its trace', () => {
  const { circuit, box } = plotted();
  const entry = circuit.plotLegend(box)[0];
  runCommand(circuit, `annotation rename ${entry.id} "Channel 1"`);
  assert.equal(box.plot.traces[0].label, 'Channel 1');
  assert.equal(box.plot.traces[1].label, 'CH2 (V)');
});

test('dataplot --into adds a file\'s traces to a data plot, their legend entries under the others', () => {
  const files = { 'runs/scope.csv': SCOPE, 'sim.csv': 'Time (s),Sim (V)\n0,0.15\n2e-6,0.25\n' };
  const { circuit, box } = plotted(files);
  runCommand(circuit, `annotation plotview ${box.id} x 0 1e-6`);
  const legend = circuit.plotLegend(box);
  const out = runCommand(circuit, `annotation dataplot sim.csv --into ${box.id}`, io(files));
  assert.match(out.text, /added 1 trace from sim\.csv/);
  assert.deepEqual(box.plot.traces.map((t) => t.label), ['CH1 (V)', 'CH2 (V)', 'Sim (V)']);
  assert.equal(new Set(box.plot.traces.map((t) => t.color)).size, 3);
  assert.equal(box.plot.file, 'scope.csv, sim.csv');
  assert.deepEqual(box.plot.view, { x: [0, 1e-6] });
  const [, second, third] = circuit.plotLegend(box);
  assert.equal(third.text, 'Sim (V)');
  assert.equal(third.bbox().x, legend[0].bbox().x);
  assert.ok(third.bbox().y >= second.bbox().y + second.bbox().h);
  assert.throws(() => runCommand(circuit, `annotation dataplot sim.csv --into R1`, io(files)), /is not a data plot/);
  for (let i = 0; i < 5; i++) runCommand(circuit, `annotation dataplot sim.csv --into ${box.id}`, io(files));
  assert.throws(() => runCommand(circuit, `annotation dataplot sim.csv --into ${box.id}`, io(files)), /at most 8 traces/);
});

test('a data plot\'s trace moves to another place, a later one drawn on top, its legend entry with it', () => {
  const files = { 'runs/scope.csv': SCOPE, 'sim.csv': 'Time (s),Sim (V)\n0,0.15\n2e-6,0.25\n' };
  const { circuit, box } = plotted(files);
  runCommand(circuit, `annotation dataplot sim.csv --into ${box.id}`, io(files));
  const slots = circuit.plotLegend(box).map((l) => l.bbox().y);
  const left = circuit.plotLegend(box)[0].bbox().x;
  const out = runCommand(circuit, `annotation plottrace ${box.id} 3 --position 1`);
  assert.equal(out.mutated, true);
  assert.deepEqual(box.plot.traces.map((t) => t.label), ['Sim (V)', 'CH1 (V)', 'CH2 (V)']);
  const legend = circuit.plotLegend(box);
  assert.deepEqual(legend.map((l) => l.text), ['Sim (V)', 'CH1 (V)', 'CH2 (V)']);
  assert.deepEqual(legend.map((l) => l.bbox().y), slots);
  assert.ok(legend.every((l) => Math.abs(l.bbox().x - left) <= 20));
  // Saved and loaded in that order; the last drawn last.
  const loaded = loadDocument(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(loaded.plotLegend(loaded.labels.get(box.id)).map((l) => l.text), ['Sim (V)', 'CH1 (V)', 'CH2 (V)']);
  assert.equal(runCommand(circuit, `annotation plottrace ${box.id} 1 --position 1`).mutated, false);
  assert.throws(() => runCommand(circuit, `annotation plottrace ${box.id} 1 --position 9`), /no position 9/);
});
