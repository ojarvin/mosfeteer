import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { evaluate } from '../src/core/commands.js';
import { getSymbol } from '../src/core/components/index.js';
import { svgString } from '../src/core/render.js';

const SIGNAL_TYPES = [
  ['signal_sum', 'SUM'],
  ['signal_multiply', 'MUL'],
];

test('signal-flow operators expose four cardinal terminals and their textbook marks', () => {
  for (const [type, prefix, mark] of [
    ['signal_sum', 'SUM', ['M -20 0 L 20 0', 'M 0 -20 L 0 20']],
    ['signal_multiply', 'MUL', ['M -20 -20 L 20 20', 'M -20 20 L 20 -20']],
  ]) {
    const def = getSymbol(type);
    assert.equal(def.refPrefix, prefix);
    assert.deepEqual(def.terminals, [
      { name: 'n', x: 0, y: -40, direction: 'passive', signalRole: 'input', dir: { x: 0, y: -1 } },
      { name: 'e', x: 40, y: 0, direction: 'passive', signalRole: 'output', dir: { x: 1, y: 0 } },
      { name: 's', x: 0, y: 40, direction: 'passive', signalRole: 'input', dir: { x: 0, y: 1 } },
      { name: 'w', x: -40, y: 0, direction: 'passive', signalRole: 'input', dir: { x: -1, y: 0 } },
    ]);
    assert.deepEqual(def.terminals.filter((terminal) => terminal.signalRole === 'input').map((terminal) => terminal.name), ['n', 's', 'w']);
    assert.deepEqual(def.terminals.filter((terminal) => terminal.signalRole === 'output').map((terminal) => terminal.name), ['e']);
    assert.deepEqual(def.bbox, { x: -40, y: -40, w: 80, h: 80 });
    assert.equal(def.labelOffset, null);
    assert.equal(def.graphics.filter((graphic) => graphic.kind === 'path').length, 2);
    assert.deepEqual(def.graphics.filter((graphic) => graphic.kind === 'circle'), [
      { kind: 'circle', cx: 0, cy: 0, r: 40, style: 'emph' },
    ]);
    assert.deepEqual(def.graphics.filter((graphic) => graphic.kind === 'path').slice(-2).map((graphic) => graphic.d), mark);
    assert.equal(def.allowFloatingTerminals, true);
  }
});

test('signal-flow input polarity is an option projected to entry-side owned signs', () => {
  const empty = new Circuit();
  empty.addComponent('signal_sum', { refdes: 'SUM0' });
  assert.equal(empty.labels.size, 0);

  const circuit = new Circuit();
  const sum = circuit.addComponent('signal_sum', { refdes: 'SUM1' });
  circuit.addComponent('resistor', { refdes: 'RN', x: 80, y: -40 });
  circuit.addComponent('resistor', { refdes: 'RS', x: 80, y: 40 });
  circuit.addComponent('resistor', { refdes: 'RW', x: 40, y: 0 });
  circuit.setSignalInputNegative('SUM1', 'n', true);
  circuit.setSignalInputNegative('SUM1', 's', true);
  assert.equal(circuit.components.size, 4);
  assert.equal(circuit.labels.size, 5);
  const signData = [...circuit.labels.values()]
    .filter((label) => label.role === 'signal-input-sign')
    .sort((a, b) => a.signalTerminal.localeCompare(b.signalTerminal));
  assert.deepEqual(signData.map((label) => ({
    text: label.text,
    owner: label.owner,
    role: label.role,
    terminal: label.signalTerminal,
    offset: label.offset,
  })), [
    { text: '−', owner: 'SUM1', role: 'signal-input-sign', terminal: 'n', offset: { x: 40, y: -80 } },
    { text: '−', owner: 'SUM1', role: 'signal-input-sign', terminal: 's', offset: { x: -40, y: 80 } },
  ]);
  assert.equal(signData.every((label) => label.selectable === false && label.style.width === 'thick'), true);
  assert.equal(circuit.labelOf('SUM1'), null);
  assert.deepEqual(circuit.toJSON().components[0].negativeInputs, ['n', 's']);
  const svg = svgString(circuit);
  assert.match(svg, /font-size="52"[^>]*>−<\/text>/);
  assert.doesNotMatch(svg, new RegExp(`data-label-id="${signData[0].id}"`));
  assert.match(svg, /pointer-events="none"/);

  circuit.setSignalInputNegative('SUM1', 'n', false);
  circuit.setSignalInputNegative('SUM1', 'w', true);
  assert.deepEqual([...circuit.components.get('SUM1').negativeInputs], ['s', 'w']);
  assert.deepEqual([...circuit.labels.values()]
    .filter((label) => label.role === 'signal-input-sign')
    .map((label) => label.signalTerminal).sort(), ['s', 'w']);

  const restored = Circuit.fromJSON(circuit.toJSON());
  assert.deepEqual([...restored.components.get('SUM1').negativeInputs], ['s', 'w']);
  assert.deepEqual([...restored.labels.values()]
    .filter((label) => label.role === 'signal-input-sign')
    .map((label) => label.signalTerminal).sort(), ['s', 'w']);
  assert.deepEqual(restored.labels.get([...restored.labels.keys()].find((id) => restored.labels.get(id).signalTerminal === 'w')).offset, { x: -80, y: -40 });
  assert.equal(restored.components.size, 4);
  assert.equal([...restored.labels.values()].filter((label) => label.role === 'signal-input-sign').length, 2);

  const deletedSign = [...restored.labels.values()].find((label) => label.signalTerminal === 'w');
  restored.removeLabel(deletedSign.id);
  assert.deepEqual([...restored.components.get('SUM1').negativeInputs], ['s']);

  restored.setTransform('SUM1', { rotation: 90 });
  const rotated = [...restored.labels.values()].find((label) => label.signalTerminal === 's');
  assert.deepEqual(rotated.anchorWorld(), { x: -80, y: -40 });

  restored.disconnect('SUM1.s');
  assert.deepEqual([...restored.components.get('SUM1').negativeInputs], []);
  assert.equal([...restored.labels.values()].some((label) => label.role === 'signal-input-sign'), false);
});

test('signal-flow input polarity resets when a wire is detached', () => {
  const circuit = new Circuit();
  circuit.addComponent('signal_sum', { refdes: 'SUM1' });
  circuit.addComponent('resistor', { refdes: 'R1', x: 200, y: -40 });
  const net = circuit.wireDirectTo('SUM1.n', 'R1.a');
  circuit.setSignalInputNegative('SUM1', 'n', true);
  assert.deepEqual([...circuit.components.get('SUM1').negativeInputs], ['n']);

  circuit.deleteWireSegments(net.id, [{ branch: 0, segment: 1 }]);

  assert.deepEqual([...circuit.components.get('SUM1').negativeInputs], []);
  assert.equal([...circuit.labels.values()].some((label) => label.role === 'signal-input-sign'), false);
});

test('floating signal-flow terminals are intentional, but the symbols remain real obstacles', () => {
  for (const [type] of SIGNAL_TYPES) {
    const circuit = new Circuit();
    const component = circuit.addComponent(type, { x: 0, y: 0 });
    assert.equal(circuit.labels.size, 0);
    const report = evaluate(circuit);
    assert.equal(component.refdes.startsWith(type === 'signal_sum' ? 'SUM' : 'MUL'), true);
    assert.deepEqual(report.unconnectedTerminals, []);
    assert.equal(report.ok, true);

    const restored = Circuit.fromJSON(circuit.toJSON());
    assert.deepEqual(restored.components.get(component.refdes).worldTerminals(), component.worldTerminals());
    assert.equal(evaluate(restored).ok, true);
    assert.match(svgString(restored, { terminals: false, junctions: false }), /r="40"/);
  }

  const overlap = new Circuit();
  overlap.addComponent('signal_sum', { refdes: 'SUM1', x: 0, y: 0 });
  overlap.addComponent('resistor', { refdes: 'R1', x: 0, y: 0 });
  const report = evaluate(overlap);
  assert.deepEqual(report.unconnectedTerminals, ['R1.a@(-80,0)', 'R1.b@(80,0)']);
  assert.equal(report.overlappingBBoxes.length, 1);
  assert.equal(report.ok, false);
});

test('signal-flow connector arrowheads meet the circle edge', () => {
  for (const [type, refdes] of SIGNAL_TYPES) {
    const circuit = new Circuit();
    circuit.addComponent(type, { refdes, x: 0, y: 0 });
    circuit.addComponent('resistor', { refdes: 'R1', x: 320, y: 0 });
    const net = circuit.wireDirectTo('R1.a', `${refdes}.e`);
    net.style.arrowhead = 'end';

    const svg = svgString(circuit);
    // The circle uses the 9.6-unit emphasis stroke, so its visible edge is
    // 4.8 units beyond the terminal centerline at x=40.
    assert.match(svg, /<polygon points="44\.80 0 76\.80 18 76\.80 -18"/);
  }
});
