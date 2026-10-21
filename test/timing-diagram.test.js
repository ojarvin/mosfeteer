import test from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';
import { runCommand } from '../src/core/commands.js';
import { plainTexText, svgString } from '../src/core/render.js';
import { addBeat, setSwitchFrom, switchStateAt } from '../src/core/beats.js';
import { addTimingDiagram, annotateTimingDiagram, defaultTimingPairs, drawnTimingDiagram, existingTimingDiagram, removeTimingDiagram, setTimingDiagram, timingMissing, parseTimingBits, timingBeatBands, timingBeatStates, timingColumns, timingPairs, timingRowEdges, timingRowGeometry, timingRowSources, timingStates } from '../src/core/timing-diagram.js';

const run = (circuit, ...lines) => lines.map((line) => runCommand(circuit, line));

function clocked() {
  const circuit = new Circuit();
  run(circuit,
    'add switch_open S1 --at 0 0', 'value S1 $\\varphi_1$',
    'add switch_open S2 --at 400 0', 'value S2 $\\varphi_2$',
    'add switch_open S3 --at 800 0', 'value S3 $\\overline{\\varphi_1}$');
  return circuit;
}
const rowsOf = (circuit, line) => runCommand(circuit, line).json;
const wavesOf = (circuit) => [...circuit.labels.values()].filter((l) => l.timing && l.kind === 'line');

test('a wave is typed as slots: 1 high, 0 low', () => {
  assert.equal(parseTimingBits('10 H L'), '1010');
  assert.throws(() => parseTimingBits('1x0'), /not "x"/);
});

test('waves repeat past both ends, and a gap keeps a pair from overlapping', () => {
  // φ1 = 10, φ2 = 01, kept apart: lead-in (last slot), slots, lead-out (first
  // slot), with a one-cell gap wherever one falls as the other rises.
  const { columns, levels } = timingColumns(['10', '01'], { slotCells: 4, pairs: [[0, 1]] });
  assert.deepEqual(columns.map((c) => `${c.kind}${c.w / 40}`), ['lead2', 'gap1', 'slot4', 'gap1', 'slot4', 'gap1', 'lead2']);
  assert.deepEqual(levels, [['0', '0', '1', '0', '0', '0', '1'], ['1', '0', '0', '0', '1', '0', '0']]);
  // With no pair, the columns abut.
  assert.deepEqual(timingColumns(['10', '01']).columns.map((c) => c.kind), ['lead', 'slot', 'slot', 'lead']);
  // A phase outside the pair changes as the gap opens.
  const three = timingColumns(['10', '01', '10'], { pairs: [[0, 1]] });
  assert.deepEqual(three.levels[2], ['0', '1', '1', '0', '0', '1', '1']);
  // A complement is its phase inverted, gaps included: high in them.
  assert.deepEqual(timingColumns(['10', '', '01'], { inverted: [null, 0, null], pairs: [[0, 2]] }).levels[1], ['1', '1', '0', '1', '1', '1', '0']);
  // A short wave holds its last level; no wave at all is low.
  assert.ok(timingColumns(['1', '0011']).levels[0].every((level) => level === '1'));
  assert.ok(timingColumns(['', '01']).levels[0].every((level) => level === '0'));
});

test('by default the phases kept apart are those never high together', () => {
  // φ1 and φ2 alternate; φ3 overlaps both; φ4 is never high.
  assert.deepEqual(defaultTimingPairs(['1000', '0010', '1110', '0000']), [[0, 1]]);
  // A complement row takes no part.
  assert.deepEqual(defaultTimingPairs(['10', '01'], new Set([1])), []);
});

test('a row draws with vertical edges', () => {
  const columns = [{ w: 80 }, { w: 160 }, { w: 80 }, { w: 40 }];
  assert.deepEqual(timingRowGeometry(['0', '1', '0', '0'], columns, 0, 0), [
    { x: 0, y: 80 }, { x: 80, y: 80 }, { x: 80, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 80 }, { x: 360, y: 80 },
  ]);
});

test('the diagram sits under the drawing, one named row per phase, complements after their phase', () => {
  const circuit = clocked();
  const drawn = circuit.bounds();
  const rows = rowsOf(circuit, 'timing φ1=10 φ2=01');
  assert.deepEqual(rows.map((row) => [row.phase, row.bits, row.from]), [
    ['$\\varphi_{1}$', '10', 'typed'], ['$\\overline{\\varphi_{1}}$', '', 'complement'], ['$\\varphi_{2}$', '01', 'typed'],
  ]);
  const names = rows.map((row) => circuit.labels.get(row.label));
  assert.ok(names.every((label) => label.align === 'right' && label.math));
  // Clear of every part by three cells (here the drawing leaves room only below).
  const parts = [...circuit.components.values()].map((part) => part.bboxWorld());
  for (const line of wavesOf(circuit)) {
    const r = line.bbox();
    assert.ok(parts.every((p) => r.y >= p.y + p.h + 120 || p.y >= r.y + r.h + 120 || r.x >= p.x + p.w + 120 || p.x >= r.x + r.w + 120), 'clear of the parts');
  }
  void drawn;
  // The waves are centered on the drawing's width.
  const drawing = (() => { const copy = Circuit.fromJSON(circuit.toJSON()); for (const l of [...copy.labels.values()]) if (l.timing) copy.removeLabel(l.id); return copy.inkBounds(); })();
  const left = Math.min(...wavesOf(circuit).map((l) => l.bbox().x));
  const right = Math.max(...wavesOf(circuit).map((l) => l.bbox().x + l.bbox().w));
  assert.ok(Math.abs((left + right) / 2 - (drawing.x + drawing.w / 2)) <= 20, `centered (${left}..${right} under ${drawing.x}+${drawing.w})`);
  assert.throws(() => runCommand(circuit, 'timing φ9=01'), /no row "φ9"/);
  assert.throws(() => runCommand(circuit, 'timing 01'), /not PHASE=WAVE/);
  assert.match(runCommand(circuit, 'help').text, /timing \[ROW=WAVE \.\.\.\] \[--add NAME,\.\.\.\]/);
  const empty = new Circuit();
  run(empty, 'add switch_open S1 --at 0 0');
  assert.throws(() => runCommand(empty, 'timing'), /no switch has a phase/);
});

test('drawing it again replaces the diagram where its waves start, keeping each wave', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=1100 φ2=0011');
  const start = (c) => Math.min(...wavesOf(c).map((l) => l.bbox().x));
  const x = start(circuit);
  const count = circuit.labels.size;
  for (let i = 0; i < 3; i += 1) runCommand(circuit, 'timing');
  assert.equal(start(circuit), x, 'the waves stay put');
  assert.equal(circuit.labels.size, count, 'replaced, not added');
  assert.deepEqual(rowsOf(circuit, 'timing ~φ1=0100').map((row) => row.bits), ['1100', '0100', '0011']);
  // Saved and loaded, the diagram still knows its waves and its pairs.
  runCommand(circuit, 'timing --gaps φ1:φ2');
  const loaded = Circuit.fromJSON(circuit.toJSON());
  assert.deepEqual(rowsOf(loaded, 'timing').map((row) => row.bits), ['1100', '0100', '0011']);
  assert.deepEqual(wavesOf(loaded)[0].timing.gaps, [['$\\varphi_{1}$', '$\\varphi_{2}$']]);
  runCommand(loaded, 'timing --no-gaps');
  assert.ok(wavesOf(loaded).every((line) => line.timing.gaps === false));
  assert.throws(() => runCommand(loaded, 'timing --gaps φ1'), /pairs such as/);
});

test('a complement drawn inverted keeps following its phase, until it has a wave of its own', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=10 φ2=01');
  assert.deepEqual(rowsOf(circuit, 'timing φ1=1100').map((row) => row.from), ['typed', 'complement', 'diagram']);
  runCommand(circuit, 'timing ~φ1=0000');
  assert.deepEqual(rowsOf(circuit, 'timing φ1=11').map((row) => row.bits), ['11', '0000', '01']);
});

test('without typed waves, the beats set the timing; a phase with neither is low', () => {
  const circuit = clocked();
  assert.deepEqual(rowsOf(circuit, 'timing').map((row) => row.from), ['low', 'complement', 'low']);
  addBeat(circuit);
  addBeat(circuit);
  addBeat(circuit);
  setSwitchFrom(circuit, 0, '$\\varphi_1$', 'closed');
  setSwitchFrom(circuit, 1, '$\\varphi_1$', 'open');
  setSwitchFrom(circuit, 1, '$\\varphi_2$', 'closed');
  setSwitchFrom(circuit, 2, '$\\varphi_2$', 'open');
  assert.deepEqual(rowsOf(circuit, 'timing --beats').map((row) => row.bits), ['100', '', '010']);
  runCommand(circuit, 'timing φ2=111');
  setSwitchFrom(circuit, 2, '$\\varphi_1$', 'closed');
  assert.deepEqual(rowsOf(circuit, 'timing').map((row) => row.bits), ['100', '', '111']);
  assert.deepEqual(rowsOf(circuit, 'timing --beats').map((row) => row.bits), ['101', '', '010']);
});

test('line vertices can be removed down to two distinct points', () => {
  const circuit = new Circuit();
  const line = circuit.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 160, y: 80 }] });
  assert.equal(line.removeVertex(2), true);
  assert.deepEqual(line.points, [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 160, y: 80 }]);
  assert.equal(line.removeVertex(0), true);
  assert.deepEqual(line.anchor, { x: 80, y: 0 });
  assert.deepEqual(line.end, { x: 160, y: 80 });
  assert.equal(line.canRemoveVertex(0), false, 'a line keeps two points');
  assert.equal(line.removeVertex(1), false);
  assert.equal(line.points.length, 2);

  // Removing a vertex between two coincident neighbors leaves no zero-length leg.
  const back = circuit.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 80 }] });
  assert.equal(back.removeVertex(1), true);
  assert.deepEqual(back.points, [{ x: 0, y: 0 }, { x: 0, y: 80 }]);
  assert.equal(circuit.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 0, y: 0 }] }).canRemoveVertex(1), false);
});

test('an arrow keeps its two-cell minimum length when a vertex goes', () => {
  const circuit = new Circuit();
  const arrow = circuit.addAnnotation('arrow', { points: [{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 80, y: 40 }] });
  assert.equal(arrow.canRemoveVertex(1), true);
  assert.equal(arrow.canRemoveVertex(2), false, 'one cell left');
});

test('annotation vertex-rm removes one vertex by index', () => {
  const circuit = new Circuit();
  const line = circuit.addAnnotation('line', { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }] });
  runCommand(circuit, `annotation vertex-rm ${line.id} 1`);
  assert.deepEqual(line.points, [{ x: 0, y: 0 }, { x: 80, y: 80 }]);
  assert.throws(() => runCommand(circuit, `annotation vertex-rm ${line.id} 0`), /cannot remove vertex 0/);
  assert.throws(() => runCommand(circuit, 'annotation vertex-rm nope 0'), /unknown line or arrow/);
});

test('a row\'s edges shift by whole cells: a bottom plate opening before its top plate', () => {
  const columns = [{ w: 80 }, { w: 160 }, { w: 160 }, { w: 80 }];
  const levels = ['0', '1', '0', '0'];
  // Falling a cell early; rising a cell late.
  assert.deepEqual(timingRowGeometry(levels, columns, 0, 0, { fall: -1 }).map((p) => p.x), [0, 80, 80, 200, 200, 480]);
  assert.deepEqual(timingRowGeometry(levels, columns, 0, 0, { rise: 1 }).map((p) => p.x), [0, 120, 120, 240, 240, 480]);
  // An edge stays within the columns beside it.
  assert.ok(timingRowGeometry(levels, columns, 0, 0, { fall: -8 }).every((p) => p.x >= 0 && p.x <= 480));
});

test('shifts are kept per phase, and a following complement mirrors its phase\'s', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=10 φ2=01 --fall φ1=-1');
  const line = (phase) => wavesOf(circuit).find((l) => l.timing.phase === phase).points;
  const fallX = (points) => points.find((p, i) => i > 0 && points[i - 1].x === p.x && points[i - 1].y < p.y).x;
  const riseX = (points) => points.find((p, i) => i > 0 && points[i - 1].x === p.x && points[i - 1].y > p.y).x;
  const plain = Circuit.fromJSON(circuit.toJSON());
  runCommand(plain, 'timing --fall φ1=0');
  // φ1 falls a cell early; its complement rises a cell early with it.
  assert.equal(fallX(line('$\\varphi_{1}$')), fallX(wavesOf(plain).find((l) => l.timing.phase === '$\\varphi_{1}$').points) - 40);
  assert.equal(riseX(line('$\\overline{\\varphi_{1}}$')), riseX(wavesOf(plain).find((l) => l.timing.phase === '$\\overline{\\varphi_{1}}$').points) - 40);
  // Kept through redraws and a save; an edge not named keeps its shift.
  runCommand(circuit, 'timing --rise φ1=1');
  const loaded = Circuit.fromJSON(circuit.toJSON());
  assert.deepEqual(rowsOf(loaded, 'timing')[0].shift, { fall: -1, rise: 1 });
  assert.throws(() => runCommand(loaded, 'timing --fall φ1=early'), /PHASE=N/);
});

test('a new diagram floats up into the drawing where it has room, and then stays put', () => {
  const circuit = new Circuit();
  // Two tall columns of switches with an empty middle between them.
  run(circuit,
    'add switch_open S1 --at 0 0', 'value S1 $\\varphi_1$', 'add switch_open S2 --at 0 1600', 'value S2 $\\varphi_2$',
    'add switch_open S3 --at 2000 0', 'value S3 $\\varphi_1$', 'add switch_open S4 --at 2000 1600', 'value S4 $\\varphi_2$');
  runCommand(circuit, 'timing φ1=10 φ2=01');
  const top = () => Math.min(...wavesOf(circuit).map((l) => l.bbox().y));
  const left = () => Math.min(...wavesOf(circuit).map((l) => l.bbox().x));
  assert.ok(top() < 1600, `in the middle, not below (${top()})`);
  // Moved by hand, a redraw keeps it there; asked to, it is placed again.
  for (const label of [...circuit.labels.values()].filter((l) => l.timing)) label.moveTo(label.anchorWorld().x + 400, label.anchorWorld().y + 400);
  const moved = [left(), top()];
  runCommand(circuit, 'timing φ1=1100');
  assert.deepEqual([left(), top()], moved);
  runCommand(circuit, 'timing --place');
  assert.notDeepEqual([left(), top()], moved);
});

test('beats follow the timing diagram: one per state, overlapping phases closed together', () => {
  const circuit = clocked();
  // φ1 alone, then φ1 with φ2, then φ2 alone; φ̄1 follows inverted.
  runCommand(circuit, 'timing φ1=110 φ2=011');
  const states = timingStates(circuit);
  assert.deepEqual(states.map((s) => [...s.closed].length), [1, 2, 2]);
  // One name per state, a single math expression (no `$`s left inside).
  assert.deepEqual(states.map((s) => s.name), ['$\\varphi_1$', '$\\varphi_1,\\ \\varphi_2$', '$\\overline{\\varphi_1},\\ \\varphi_2$']);
  assert.equal(plainTexText(states[2].name), 'φ\u03051\u0305, φ2');
  const result = runCommand(circuit, 'beat phases');
  assert.match(result.text, /timing diagram/);
  assert.deepEqual(circuit.beats.map((beat) => beat.name), states.map((s) => s.name));
  assert.equal(switchStateAt(circuit, 'S1', 1), 'closed');
  assert.equal(switchStateAt(circuit, 'S2', 1), 'closed');
  assert.equal(switchStateAt(circuit, 'S3', 1), 'open');
});

test('rows keep the order they were given', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=10 φ2=01 --order φ2,φ1');
  const order = () => [...circuit.labels.values()].filter((l) => l.timing && l.kind === 'label')
    .sort((a, b) => a.anchorWorld().y - b.anchorWorld().y).map((l) => l.timing.phase);
  assert.deepEqual(order(), ['$\\varphi_{2}$', '$\\varphi_{1}$', '$\\overline{\\varphi_{1}}$']);
  runCommand(circuit, 'timing φ1=1100');
  assert.deepEqual(order(), ['$\\varphi_{2}$', '$\\varphi_{1}$', '$\\overline{\\varphi_{1}}$'], 'kept through a redraw');
});


test('signals of the diagram\'s own: no switches needed, kept by the drawing, removed by name', async () => {
  const { removeTimingDiagram, timingRowSources: sourcesOf } = await import('../src/core/timing-diagram.js');
  const circuit = new Circuit();
  runCommand(circuit, 'add dff U1 --at 0 0');
  assert.throws(() => runCommand(circuit, 'timing'), /no switch has a phase .*timing --add CLK/);
  runCommand(circuit, 'timing --add CLK,EN CLK=1010 EN=0011');
  runCommand(circuit, 'timing --add $\\overline{EN}$');
  // Saved and loaded, the rows stay, with their waves; the barred one follows EN.
  const loaded = Circuit.fromJSON(circuit.toJSON());
  assert.deepEqual(sourcesOf(loaded).map(({ source, bits, from, signal }) => [source, bits, from, signal]), [
    ['CLK', '1010', 'diagram', true], ['EN', '0011', 'diagram', true], ['$\\overline{EN}$', '', 'complement', true],
  ]);
  assert.throws(() => runCommand(loaded, 'timing --add CLK'), /has CLK already/);
  // Signals switch nothing: no beats come from them.
  assert.equal(timingStates(loaded), null);
  runCommand(loaded, 'timing --rm CLK');
  assert.deepEqual(sourcesOf(loaded).map((row) => row.source), ['EN', '$\\overline{EN}$']);
  // The last rows gone, so is the diagram.
  const { text } = runCommand(loaded, 'timing --rm EN,~EN');
  assert.match(text, /removed the timing diagram/);
  assert.equal([...loaded.labels.values()].filter((label) => label.timing).length, 0);
  assert.equal(removeTimingDiagram(loaded), false);
});

test('a signal beside switch phases is kept apart from them only when asked', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=10 φ2=01 --add CLK CLK=0101');
  const sources = timingRowSources(circuit);
  assert.deepEqual(sources.map((row) => row.source).at(-1), 'CLK');
  assert.throws(() => runCommand(circuit, 'timing --rm φ1'), /is a switch phase/);
  // CLK is never high with φ1, yet no pair with it is kept apart by default.
  const pairs = timingPairs(sources, 'auto').map((pair) => pair.map((i) => sources[i].source));
  assert.ok(pairs.every((pair) => !pair.includes('CLK')), JSON.stringify(pairs));
  // Beats come from the phases alone.
  assert.ok(timingStates(circuit).every((state) => ![...state.closed].includes('CLK')));
});

test('shifting an edge leaves the diagram where it stands', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=00 φ2=10');
  const names = () => [...circuit.labels.values()].filter((l) => l.timing && l.kind === 'label').map((l) => l.anchorWorld());
  const firstWave = () => wavesOf(circuit)[0].points[0];
  const where = names();
  // The top row is low throughout, so the waves' own top is below the
  // diagram's: it is drawn again where it stood, edges shifted or not.
  for (const line of ['timing --fall φ2=-1', 'timing --rise φ1=-1', 'timing --rise φ1=1', 'timing --fall φ2=0']) {
    runCommand(circuit, line);
    assert.deepEqual(names(), where, line);
  }
  assert.ok(firstWave());
});

test('a row knows its edges and the slot boundary each belongs to, gaps and shifts included', () => {
  const { columns, levels } = timingColumns(['10', '01'], { slotCells: 4, pairs: [[0, 1]] });
  // φ1 = 10: rises at the start (from the lead-in), falls into the gap.
  assert.deepEqual(timingRowEdges(levels[0], columns, 0, 0).map(({ at, rise }) => [at, rise]), [[0, true], [1, false], [2, true]]);
  // The gap's rise comes late, at the slot after it, yet belongs to the same boundary.
  const late = timingRowEdges(levels[1], columns, 0, 0);
  assert.deepEqual(late.map(({ at, rise }) => [at, rise]), [[0, false], [1, true], [2, false]]);
  const gap = columns.findIndex((column) => column.kind === 'gap' && column.at === 1);
  assert.equal(late[1].x, columns.slice(0, gap + 1).reduce((sum, column) => sum + column.w, 0), 'φ2 rises at the end of the gap');
  // A shifted fall moves with its edge.
  const early = timingRowEdges(levels[0], columns, 0, 0, { fall: -1 });
  assert.equal(early[1].x, timingRowEdges(levels[0], columns, 0, 0)[1].x - 40);
});

test('arrows, marks and spans sit on the edges, follow them, and wait while an edge is gone', () => {
  const circuit = new Circuit();
  run(circuit, 'timing --add CLK,D,Q', 'timing CLK=0101 D=0011 Q=0001');
  const edgeX = (row, at) => {
    const label = [...circuit.labels.values()].find((l) => l.timing?.phase === row && l.kind === 'line' && !l.timing.part);
    return label.points.filter((p, i, all) => i && p.x === all[i - 1].x).map((p) => p.x);
  };
  const result = runCommand(circuit, 'timing --arrow CLK:4>Q:4 --mark CLK:2 --span "D:3>CLK:4=$t_{su}$"');
  assert.match(result.text, /1 arrow, 1 mark, 1 span/);
  const parts = () => [...circuit.labels.values()].filter((l) => l.timing?.part);
  const arrow = parts().find((l) => l.timing.part === 'arrow');
  assert.equal(arrow.kind, 'arrow');
  assert.equal(arrow.curve, true);
  // From the middle of CLK's fourth-slot rise to the middle of Q's.
  const names = Object.fromEntries([...circuit.labels.values()].filter((l) => l.timing && l.kind === 'label' && !l.timing.part).map((l) => [l.timing.phase, l.anchorWorld().y]));
  assert.deepEqual(arrow.points.map((p) => p.y), [names.CLK, names.Q]);
  assert.ok(edgeX('CLK').includes(arrow.points[0].x) && edgeX('Q').includes(arrow.points[1].x));
  // The mark and the span's ends are dashed guides; the span's text is a label under its arrow.
  const guides = parts().filter((l) => l.kind === 'line' && l.style.lineStyle === 'dashed');
  assert.equal(guides.length, 3);
  const note = parts().find((l) => l.timing.part === 'note');
  assert.equal(note.text, '$t_{su}$');
  const spanLine = parts().find((l) => l.timing.part === 'span' && l.style.lineStyle !== 'dashed');
  assert.equal(spanLine.style.arrowhead, 'both');
  assert.ok(note.anchorWorld().y > spanLine.points[0].y && spanLine.points[0].y > names.Q);
  // An edge shifted later carries what sits on it.
  run(circuit, 'timing --rise Q=1');
  assert.equal(parts().find((l) => l.timing.part === 'arrow').points[1].x, arrow.points[1].x + 40);
  // D's rise gone: the span waits, the rest stays drawn; back, it is drawn again.
  assert.match(runCommand(circuit, 'timing D=0001').text, /1 annotation waits for an edge that has gone/);
  assert.equal(parts().filter((l) => l.timing.part === 'span' || l.timing.part === 'note').length, 0);
  assert.deepEqual(existingTimingDiagram(circuit).missing, [{ kind: 'span', index: 0 }]);
  run(circuit, 'timing D=0011');
  assert.deepEqual(existingTimingDiagram(circuit).missing, []);
  assert.ok(parts().some((l) => l.timing.part === 'note'));
  // Saved and loaded, the diagram keeps them and still knows its rows.
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  const again = existingTimingDiagram(loaded);
  assert.deepEqual(again.order, ['CLK', 'D', 'Q']);
  assert.equal(again.arrows.length + again.marks.length + again.spans.length, 3);
  assert.equal([...loaded.labels.values()].filter((l) => l.curve).length, 1);
  run(circuit, 'timing --clear arrows,marks');
  assert.deepEqual(parts().map((l) => l.timing.part).sort(), ['note', 'span', 'span', 'span']);
  run(circuit, 'timing --clear all');
  assert.equal(parts().length, 0);
});

test('a break leaves time out of its slot, through every row or through each, above the waves', () => {
  const circuit = new Circuit();
  run(circuit, 'timing --add CLK,Q', 'timing CLK=0101 Q=0011 --slot 4');
  const result = runCommand(circuit, 'timing --break 2,4:rows');
  assert.match(result.text, /2 breaks/);
  const cuts = () => [...circuit.labels.values()].filter((l) => l.timing?.part === 'break');
  const waves = [...circuit.labels.values()].filter((l) => l.timing && l.kind === 'line' && !l.timing.part);
  const top = Math.min(...waves.map((l) => l.bbox().y));
  const bottom = Math.max(...waves.map((l) => l.bbox().y + l.bbox().h));
  const left = Math.min(...waves.map((l) => l.bbox().x));
  // Slot 2 through every row: one box over the slot, top row to bottom row.
  const across = cuts().filter((l) => l.timing.item === 0);
  assert.equal(across.length, 1);
  assert.equal(across[0].kind, 'box');
  assert.equal(across[0].drawOrder, 1);
  const lead = 2 * 40;
  assert.deepEqual([across[0].anchor.x, across[0].end.x], [left + lead + 160, left + lead + 320]);
  assert.deepEqual([across[0].anchor.y, across[0].end.y], [top, bottom]);
  // Slot 4 through each row: a box per row, each that row's height.
  const each = cuts().filter((l) => l.timing.item === 1);
  assert.deepEqual(each.map((l) => l.timing.phase), ['CLK', 'Q']);
  assert.ok(each.every((l) => l.end.y - l.anchor.y === 80));
  // Two S curves on paper, reaching past what they cut: one S each even
  // through every row (a curve is two cubic pieces).
  const svg = svgString(circuit);
  assert.equal(svg.match(/class="timing-break"/g).length, 3);
  const strokes = [...svg.matchAll(/class="timing-break"><path [^>]*\/><path d="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(strokes.every((d) => (d.match(/C/g) || []).length === 4), 'two curves of two pieces each');
  // Through every row a cell past the waves; through each, a little past its row.
  assert.deepEqual([across[0].inkRect().y, across[0].inkRect().y + across[0].inkRect().h], [top - 40, bottom + 40]);
  assert.equal(each[0].inkRect().y, each[0].anchor.y - 10);
  // One break a slot: the last asked for wins.
  run(circuit, 'timing --break 2:rows');
  assert.deepEqual(existingTimingDiagram(circuit).breaks, [{ at: 3, rows: true }, { at: 1, rows: true }]);
  // A slot gone waits; back, it is drawn again. Saved and loaded, it stays.
  run(circuit, 'timing CLK=01 Q=00');
  assert.deepEqual(existingTimingDiagram(circuit).missing, [{ kind: 'break', index: 0 }]);
  run(circuit, 'timing CLK=0101 Q=0011');
  assert.deepEqual(existingTimingDiagram(circuit).missing, []);
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.equal(existingTimingDiagram(loaded).breaks.length, 2);
  // A slot past the end, or anything but N and N:rows, is refused.
  const before = JSON.stringify(circuit.toJSON());
  assert.throws(() => runCommand(circuit, 'timing --break 5'), /no slot 5: it has 4/);
  assert.throws(() => runCommand(circuit, 'timing --break 2:each'), /N:rows/);
  assert.equal(JSON.stringify(circuit.toJSON()), before);
  run(circuit, 'timing --clear breaks');
  assert.equal(cuts().length, 0);
});

test('an arrow or mark asked for must land on an edge; nothing changes when it does not', () => {
  const circuit = new Circuit();
  run(circuit, 'timing --add CLK,Q', 'timing CLK=0101 Q=0001');
  const before = JSON.stringify(circuit.toJSON());
  assert.throws(() => runCommand(circuit, 'timing --arrow CLK:2>Q:2'), /Q at the start of slot 2 has no edge/);
  assert.throws(() => runCommand(circuit, 'timing --mark CLK:9'), /no edge/);
  assert.throws(() => runCommand(circuit, 'timing --arrow CLK:2>CLK:2'), /two different edges/);
  assert.throws(() => runCommand(circuit, 'timing --span "CLK:2>Q"'), /ROW:N/);
  assert.throws(() => runCommand(circuit, 'timing --arrow X:2>Q:4'), /no row "X"/);
  assert.throws(() => runCommand(circuit, 'timing --clear wires'), /--clear takes/);
  assert.equal(JSON.stringify(circuit.toJSON()), before);
});

test('a narrow span is pointed at from outside; overlapping spans take lanes of their own', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'value S1 P1', 'add switch_open S2 --at 400 0', 'value S2 P2', 'timing P1=10 P2=01 --gaps auto');
  // P1 falls into the gap, P2 rises out of it: one cell apart.
  run(circuit, 'timing --span "P1:2>P2:2=nov;P1:1>P1:3=T"');
  const spans = [...circuit.labels.values()].filter((l) => l.timing?.part === 'span' && l.style.lineStyle !== 'dashed');
  const narrow = spans.filter((l) => l.style.arrowhead === 'end');
  assert.equal(narrow.length, 2, 'two arrows pointing in');
  const wide = spans.find((l) => l.style.arrowhead === 'both');
  assert.notEqual(wide.points[0].y, narrow[0].points[0].y, 'the overlapping span in another lane');
});

test('a narrow span\'s text goes before it when the next span starts where it would be; a text keeps out of the next span\'s way', () => {
  const circuit = new Circuit();
  run(circuit, 'timing --add CLK,D', 'timing CLK=010101 D=001100 --slot 4 --rise D=-1');
  run(circuit, 'timing --span "D:3>CLK:3=t_{setup};CLK:4>CLK:5=t_{low};CLK:5>CLK:6=t_{high}"');
  const parts = (part) => [...circuit.labels.values()].filter((l) => l.timing?.part === part);
  const arrows = parts('span').filter((l) => l.style.lineStyle !== 'dashed');
  // One lane: every arrow at one height.
  assert.equal(new Set(arrows.map((l) => l.points[0].y)).size, 1, 'one lane');
  const setup = parts('note').find((l) => l.text === 't_{setup}');
  const tails = arrows.filter((l) => l.timing.item === 0).map((l) => l.points[0].x);
  assert.equal(setup.align, 'right');
  assert.ok(setup.bbox().x + setup.bbox().w <= Math.min(...tails), 'before the left arrow\'s tail');
  // Alone, it goes after the right one, as before.
  run(circuit, 'timing --clear spans', 'timing --span "D:3>CLK:3=t_{setup}"');
  assert.equal(parts('note')[0].align, 'left');
  // A long text after a narrow span pushes the span next to it to another lane.
  run(circuit, 'timing --clear spans', 'timing --span "CLK:2>CLK:3=x;D:3>CLK:3=a much longer note;CLK:4>CLK:5=y"');
  const lanes = Object.fromEntries(parts('span').filter((l) => l.style.lineStyle !== 'dashed').map((l) => [l.timing.item, l.points[0].y]));
  const note = parts('note').find((l) => l.text === 'a much longer note');
  const next = parts('span').filter((l) => l.timing.item === 2 && l.style.lineStyle !== 'dashed')[0];
  const overlaps = lanes[1] === lanes[2] && note.inkRect().x < Math.max(...next.points.map((p) => p.x)) && note.inkRect().x + note.inkRect().w > Math.min(...next.points.map((p) => p.x));
  assert.ok(!overlaps, 'no text across the next span in its lane');
});

test('a lane whose texts are all beside its arrows is two cells above the next; a text no other span\'s line crosses', () => {
  const circuit = new Circuit();
  run(circuit, 'timing --add A,B,C', 'timing A=01 B=01 C=01 --slot 4 --rise B=1,C=2');
  run(circuit, 'timing --span "A:2>B:2=x;B:2>C:2=y"');
  const arrowsY = (item) => [...circuit.labels.values()].find((l) => l.timing?.part === 'span' && l.timing.item === item && l.style.lineStyle !== 'dashed').points[0].y;
  assert.equal(arrowsY(1) - arrowsY(0), 80, 'two cells: lane 0\'s text is beside its arrows');
  // A wide span's text is under its arrow: the next lane three cells down.
  run(circuit, 'timing --fall B=1', 'timing --clear spans', 'timing --span "A:2>A:3=wide;A:3>B:3=x"');
  assert.equal(arrowsY(1) - arrowsY(0), 120);
});

test('a narrow span\'s text goes under it when neither side is free, so the span after it shares the lane', () => {
  const circuit = new Circuit();
  run(circuit, 'timing --add P1,P1b,P2,CLS,CLSb', 'timing P1=01100 P1b=01100 P2=10010 CLS=10010 CLSb=01101 --slot 6 --fall P2=-1,P1=-1,P1b=-2,CLSb=2 --rise CLS=2');
  run(circuit, 'timing --span "P2:2>P1:2=t_{non-overlap};P1b:4>P1:4=t_{bottom-plate};CLS:4>CLS:5=t_{level-shift}"');
  const labels = [...circuit.labels.values()];
  const arrows = labels.filter((l) => l.timing?.part === 'span' && l.style.lineStyle !== 'dashed');
  assert.equal(new Set(arrows.map((l) => l.points[0].y)).size, 1, 'one lane');
  const note = (text) => labels.find((l) => l.timing?.part === 'note' && l.text === text);
  assert.equal(note('t_{bottom-plate}').align, 'center');
  assert.ok(note('t_{bottom-plate}').anchorWorld().y > arrows[0].points[0].y, 'under its arrow');
  // No text is crossed by another span's dashed line.
  const lines = labels.filter((l) => l.timing?.part === 'span' && l.style.lineStyle === 'dashed');
  for (const text of labels.filter((l) => l.timing?.part === 'note')) {
    const r = text.inkRect();
    for (const line of lines.filter((l) => l.timing.item !== text.timing.item)) {
      const [top, bottom] = [Math.min(...line.points.map((p) => p.y)), Math.max(...line.points.map((p) => p.y))];
      const x = line.points[0].x;
      assert.ok(!(x > r.x && x < r.x + r.w && bottom > r.y && top < r.y + r.h), `${text.text} crossed at ${x}`);
    }
  }
});

test('a span\'s text keeps the size the browser measured it at when the diagram is drawn again', () => {
  const circuit = new Circuit();
  run(circuit, 'timing --add CLK', 'timing CLK=0101', 'timing --span "CLK:2>CLK:4=$t_{x}$"');
  const note = () => [...circuit.labels.values()].find((l) => l.timing?.part === 'note');
  note().setRenderedTextBounds(31, 22);
  run(circuit, 'timing CLK=0101 --slot 5');
  assert.deepEqual(note()._renderedTextBounds, { w: 31, h: 22 });
});

test('a new diagram keeps no pair apart; one saved before the setting keeps auto', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'value S1 P1', 'add switch_open S2 --at 400 0', 'value S2 P2', 'timing P1=10 P2=01');
  assert.equal(existingTimingDiagram(circuit).gaps, 'none');
  const width = () => Math.max(...wavesOf(circuit).map((l) => l.bbox().w));
  const narrow = width();
  run(circuit, 'timing --gaps auto');
  assert.equal(existingTimingDiagram(circuit).gaps, 'auto');
  assert.ok(width() > narrow, 'gaps widen the waves');
  // An older file: no gaps key at all.
  const saved = circuit.toJSON();
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(saved)));
  assert.equal(existingTimingDiagram(loaded).gaps, 'auto');
  run(loaded, 'timing P1=10');
  assert.equal(existingTimingDiagram(loaded).gaps, 'auto', 'redrawn, it keeps them');
});

test('spans that only meet at an edge share a lane', () => {
  const circuit = new Circuit();
  run(circuit, 'timing --add CLK', 'timing CLK=0101', 'timing --span "CLK:2>CLK:3=a;CLK:3>CLK:4=b"');
  const spans = [...circuit.labels.values()].filter((l) => l.timing?.part === 'span' && l.style.lineStyle !== 'dashed');
  assert.equal(spans.length, 2);
  assert.equal(spans[0].points[0].y, spans[1].points[0].y, '|--|--| is one line');
});

test('an arrow may carry text: just after the edge it points at, in that row, kept with the diagram', () => {
  const circuit = new Circuit();
  run(circuit, 'timing --add CLK,D,Q', 'timing CLK=0101 D=0110 Q=0011', 'timing --rise Q=1');
  // With text, several arrows part at ';' (TeX may hold commas).
  run(circuit, 'timing --arrow "CLK:2>Q:3=$t_{c,q}$;CLK:4>D:4"');
  const diagram = existingTimingDiagram(circuit);
  assert.deepEqual(diagram.arrows, [
    { from: { row: 'CLK', at: 1 }, to: { row: 'Q', at: 2 }, text: '$t_{c,q}$' },
    { from: { row: 'CLK', at: 3 }, to: { row: 'D', at: 3 } },
  ]);
  const notes = [...circuit.labels.values()].filter((l) => l.timing?.part === 'arrow-note');
  assert.equal(notes.length, 1, 'only the arrow with text has a label');
  const arrow = [...circuit.labels.values()].find((l) => l.timing?.part === 'arrow' && l.timing.item === 0);
  const tip = arrow.points[1];
  assert.equal(notes[0].anchorWorld().y, tip.y, 'in the middle of the row it points into');
  assert.ok(notes[0].bbox().x >= tip.x && notes[0].bbox().x < tip.x + 40, 'starting at the edge');
  // Saved, the text stays; the edge gone, the label waits with its arrow.
  const loaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  assert.equal(existingTimingDiagram(loaded).arrows[0].text, '$t_{c,q}$');
  run(circuit, 'timing Q=0000');
  assert.equal([...circuit.labels.values()].filter((l) => l.timing?.part === 'arrow-note').length, 0);
  assert.deepEqual(existingTimingDiagram(circuit).missing, [{ kind: 'arrow', index: 0 }]);
});

test('the design keeps its timing; set, it is not drawn until annotated, and Annotate redraws it in place', () => {
  const circuit = clocked();
  // Set: the design's, read by the analyses and beats, nothing drawn.
  setTimingDiagram(circuit, { bits: { φ1: '10', φ2: '01' }, gaps: [['φ1', 'φ2']] });
  assert.equal(wavesOf(circuit).length, 0);
  assert.deepEqual(circuit.timing.rows.map((row) => [row.source, row.bits ?? '']), [['$\\varphi_1$', '10'], ['$\\overline{\\varphi_1}$', ''], ['$\\varphi_2$', '01']]);
  assert.deepEqual(circuit.timing.gaps, [['$\\varphi_{1}$', '$\\varphi_{2}$']]);
  assert.equal(timingStates(circuit).length, 2);
  assert.equal(existingTimingDiagram(circuit).drawn, false);
  // Saved and loaded with the design.
  assert.deepEqual(Circuit.fromJSON(circuit.toJSON()).timing, circuit.timing);
  // Annotated, drawn as it is; set again, the drawing waits.
  annotateTimingDiagram(circuit);
  const drawnBits = () => [...circuit.labels.values()].filter((l) => l.kind === 'label' && l.timing).map((l) => l.timing.bits ?? '');
  assert.deepEqual(drawnBits(), ['10', '', '01']);
  const at = drawnTimingDiagram(circuit);
  setTimingDiagram(circuit, { bits: { φ1: '110', φ2: '001' } });
  assert.deepEqual(drawnBits(), ['10', '', '01']);
  assert.deepEqual(drawnTimingDiagram(circuit).bits.get('$\\varphi_{1}$'), '10');
  assert.deepEqual(existingTimingDiagram(circuit).bits.get('$\\varphi_{1}$'), '110');
  annotateTimingDiagram(circuit);
  assert.deepEqual(drawnBits(), ['110', '', '001']);
  assert.deepEqual([drawnTimingDiagram(circuit).x, drawnTimingDiagram(circuit).y], [at.x, at.y], 'redrawn where it stood');
  // No rows left: the design has none, the drawing stays until annotated.
  removeTimingDiagram(circuit, { drawing: false });
  assert.equal(existingTimingDiagram(circuit), null);
  assert.equal(timingStates(circuit), null);
  assert.ok(drawnTimingDiagram(circuit));
  annotateTimingDiagram(circuit);
  assert.equal(drawnTimingDiagram(circuit), null);
});

test('a design from before, with only a drawn diagram, has that as its timing', () => {
  const circuit = clocked();
  runCommand(circuit, 'timing φ1=10 φ2=01');
  const state = circuit.toJSON();
  delete state.timing;
  const loaded = Circuit.fromJSON(state);
  assert.equal(loaded.timing, null);
  assert.deepEqual(existingTimingDiagram(loaded).bits.get('$\\varphi_{1}$'), '10');
  assert.equal(timingStates(loaded).length, 2);
  // Its first edit makes it the design's.
  setTimingDiagram(loaded, { bits: { φ1: '01', φ2: '10' } });
  assert.equal(loaded.timing.rows[0].bits, '01');
  assert.deepEqual(timingMissing(loaded), []);
});

test('beats made from the diagram are in step with it; each shades its state\'s slots', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'value S1 P1', 'add switch_open S2 --at 400 0', 'value S2 P2', 'timing P1=1100 P2=0010 --gaps P1:P2', 'beat phases');
  // P1, P2 and an all-open slot: three states, three beats.
  assert.equal(circuit.beats.length, 3);
  assert.deepEqual([...timingBeatStates(circuit)], [[0, 0], [1, 1], [2, 2]]);
  const diagram = existingTimingDiagram(circuit);
  const first = timingBeatBands(circuit, 0);
  // P1's two slots in one band, from the waves' left edge (its lead-out
  // repeats the first slot: a band at the far end too); the gap to φ2 is not in it.
  assert.equal(first.length, 2);
  assert.equal(first[0].w, 8 * 40, 'two slots; the lead-in before them is the last slot, not P1');
  const second = timingBeatBands(circuit, 1);
  assert.equal(second.length, 1);
  assert.equal(second[0].w, 4 * 40);
  assert.equal(second[0].x, first[0].x + first[0].w + 40, 'the gap between them in neither');
  assert.ok(second[0].y < diagram.y && second[0].y + second[0].h > diagram.y + 120 + 80, 'over every row');
  // A beat out of step shades nothing.
  setSwitchFrom(circuit, 1, 'P1', 'closed');
  assert.equal(timingBeatStates(circuit).size, 0);
  assert.deepEqual(timingBeatBands(circuit, 1), []);
});

test('a beat drawn with its bands shades them under the waves; the svg command draws them for --beat', () => {
  const circuit = new Circuit();
  run(circuit, 'add switch_open S1 --at 0 0', 'value S1 P1', 'add switch_open S2 --at 400 0', 'value S2 P2', 'timing P1=10 P2=01', 'beat phases');
  const svg = runCommand(circuit, 'svg --beat 2').json.svg;
  assert.match(svg, /<g class="timing-beat"[^>]*><rect /);
  const firstWave = svg.indexOf('data-label-id');
  assert.ok(svg.indexOf('class="timing-beat"') < firstWave, 'under the waves');
});

test('a timing diagram draws one arrowhead size: its spans\' heads are its arrows\'', async () => {
  const { svgString } = await import('../src/core/render.js');
  const circuit = new Circuit();
  run(circuit, 'timing --add CLK,Q', 'timing CLK=0101 Q=0011', 'timing --arrow CLK:2>Q:3', 'timing --span "CLK:2>CLK:4=T"');
  // Each head's length, tip to the middle of its base, and its base's width.
  const heads = [...svgString(circuit).matchAll(/<polygon points="([^"]+)"/g)].map(([, points]) => {
    const n = points.trim().split(/[\s,]+/).map(Number);
    const [tip, left, right] = [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6)];
    const base = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
    return [Math.round(Math.hypot(tip[0] - base[0], tip[1] - base[1])), Math.round(Math.hypot(left[0] - right[0], left[1] - right[1]))];
  });
  assert.equal(heads.length, 3, 'the arrow\'s, and the span\'s two');
  assert.deepEqual([...new Set(heads.map(String))], ['26,26']);
});
