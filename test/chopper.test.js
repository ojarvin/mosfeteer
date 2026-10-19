import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { evaluate, runCommand } from '../src/core/commands.js';
import { svgString } from '../src/core/render.js';
import { symbolCategories } from '../src/core/components/categories.js';
import { analyzeTransferFunction } from '../src/core/analysis/index.js';
import { analyzeSignalFlow } from '../src/core/analysis/signal-flow.js';

const pins = (component) => component.worldTerminals().map(({ name, x, y }) => `${name} ${x},${y}`);

function drawing(lines) {
  const circuit = new Circuit();
  for (const line of lines) runCommand(circuit, line);
  return circuit;
}

test('a chopper is a box two cells tall with a wire cross from pin to pin, and no name label until named', () => {
  const circuit = new Circuit();
  const chopper = circuit.addComponent('chopper', { x: 0, y: 0 });
  assert.equal(chopper.refdes, 'CH1');
  assert.deepEqual(chopper.bboxWorld(), { x: -160, y: -40, w: 320, h: 80 });
  assert.deepEqual(pins(chopper), ['ip -120,-40', 'im 120,-40', 'op -120,40', 'om 120,40']);
  circuit.addComponent('resistor', { refdes: 'R1', x: -120, y: -240, rotation: 90 });
  circuit.wireDirectTo('CH1.ip', 'R1.b');
  const svg = svgString(circuit);
  assert.match(svg, /<rect x="-160" y="-40" width="320" height="80"/);
  // The cross is drawn in the wires' stroke, from pin to pin.
  const wireWidth = svg.match(/class="wire-ink"[^>]*stroke-width="([\d.]+)"/)[1];
  assert.match(svg, new RegExp(`<path d="M -120 -40 L 120 40"[^>]*stroke-width="${wireWidth}"`));
  assert.match(svg, /<path d="M -120 40 L 120 -40"/);
  assert.equal(circuit.labelOf('CH1'), null);
  assert.ok(symbolCategories().find((group) => group.title === 'Switches').types.includes('chopper'));
  // Named, it shows its name.
  runCommand(circuit, 'rename CH1 CH2');
  assert.ok(circuit.labelOf('CH2'));
});

test('a chopper resizes on both axes, its pins and wires following the edges that moved', () => {
  const circuit = drawing(['add chopper CH1 --at 0 0', 'add resistor R1 --at -120 -240 --rot 90']);
  const chopper = circuit.components.get('CH1');
  circuit.wireDirectTo('CH1.ip', 'R1.b');
  // The west and north edges move out.
  circuit.resizeBlock('CH1', { x: -240, y: -80, w: 400, h: 160 });
  assert.deepEqual(chopper.bboxWorld(), { x: -240, y: -80, w: 400, h: 160 });
  assert.deepEqual(pins(chopper), ['ip -200,-80', 'im 120,-80', 'op -200,80', 'om 120,80']);
  const [net] = circuit.nets.values();
  assert.deepEqual(net.paths()[0][0], { x: -200, y: -80 });
  assert.match(svgString(circuit), /translate\(-40 0\)[^]*M -160 -80 L 160 80/);
  // Saved and loaded at its size.
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.deepEqual(pins(loaded.components.get('CH1')), pins(chopper));
  // At least four cells wide and two tall, in even numbers of cells.
  circuit.resizeBlock('CH1', { x: -240, y: -80, w: 40, h: 40 });
  assert.deepEqual(chopper.blockSize, { w: 160, h: 80 });
  circuit.resizeBlock('CH1', { x: -240, y: -80, w: 200, h: 120 });
  assert.deepEqual(chopper.blockSize, { w: 240, h: 160 });
});

test('a turned chopper resizes along its turned axes', () => {
  const circuit = new Circuit();
  const chopper = circuit.addComponent('chopper', { refdes: 'CH1', x: 0, y: 0, rotation: 90 });
  assert.deepEqual(chopper.bboxWorld(), { x: -40, y: -160, w: 80, h: 320 });
  circuit.resizeBlock('CH1', { x: -40, y: -160, w: 160, h: 480 });
  assert.deepEqual(chopper.bboxWorld(), { x: -40, y: -160, w: 160, h: 480 });
  assert.deepEqual(chopper.blockSize, { w: 480, h: 160 });
  assert.deepEqual(pins(chopper), ['ip 120,-120', 'im 120,280', 'op -40,-120', 'om -40,280']);
});

test('a failed chopper resize leaves it as it was', () => {
  const circuit = new Circuit();
  const chopper = circuit.addComponent('chopper', { refdes: 'CH1', x: 0, y: 0 });
  assert.throws(() => circuit.resizeBlock('CH1', { x: NaN, y: 0, w: 1, h: 1 }), /finite/);
  assert.deepEqual(chopper.bboxWorld(), { x: -160, y: -40, w: 320, h: 80 });
});

test('the small-signal analysis takes a chopper as a short from each input to the output below it', () => {
  const circuit = drawing([
    'add chopper CH1 --at 0 0', 'add input VIN --at -600 -280', 'add resistor R1 --at -320 -280',
    'add resistor R2 --at -120 320 --rot 90', 'add ground G1 --at -120 520', 'add output VOUT --at 400 200',
    'connect VIN.p R1.a', 'connect R1.b CH1.ip', 'connect CH1.op R2.a VOUT.p', 'connect R2.b G1.gnd',
  ]);
  const transfer = analyzeTransferFunction(circuit, 'VOUT', { input: 'VIN' });
  assert.equal(transfer.ok, true, transfer.error);
  assert.equal(transfer.equation, 'A_v = \\frac{R_{2}}{R_{1} + R_{2}}');
});

test('the signal-flow analysis reads the wires through a chopper as one signal', () => {
  const circuit = drawing([
    'add input U --at -720 -280', 'add chopper CH1 --at -240 0', 'add tf_z H1 --at 240 280 --value "tf([0 1], [1 -1])"',
    'add output V --at 640 280', 'connect U.p CH1.ip', 'connect CH1.op H1.in', 'connect H1.out V.p',
  ]);
  const report = analyzeSignalFlow(circuit, { output: 'V', sources: { U: 'input' } });
  assert.equal(report.ok, true, report.error);
  assert.deepEqual(report.entries.map((entry) => entry.equation), ['\\frac{V}{U} = \\frac{z^{-1}}{1 - z^{-1}}']);
});

test('a chopper sent to the back draws under the wires, which may then cross it', () => {
  const circuit = drawing(['add chopper CH1 --at 0 0', 'add resistor R1 --at 0 -240 --rot 90', 'add resistor R2 --at 0 240 --rot 90']);
  // A wire straight down through the box, as a diode connection runs.
  const path = [{ x: 0, y: -160 }, { x: 0, y: 160 }];
  const net = circuit.createWireNet({ route: path, branches: [path] });
  net.terminals.push({ comp: 'R1', term: 'b' }, { comp: 'R2', term: 'a' });
  const crossings = () => evaluate(circuit).issues.filter((issue) => issue.kind === 'wire-through-body').length;
  const order = () => { const svg = svgString(circuit); return svg.indexOf('data-ref="CH1"') < svg.indexOf('class="wire-ink"') ? 'under' : 'over'; };
  assert.equal(order(), 'over');
  assert.equal(crossings(), 1);
  circuit.components.get('CH1').drawOrder = -1;
  assert.equal(order(), 'under');
  assert.equal(crossings(), 0);
});
