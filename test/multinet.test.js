import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Circuit } from '../src/core/model.js';

/** Assert the structural invariants the editor must preserve after any wiring
 *  and dragging: every branch is orthogonal, every branch endpoint is attached
 *  to a terminal or a real junction, and the solder-dot count equals the number
 *  of real junctions. */
function assertNetClean(circuit, net, expectedDots) {
  const branches = net.paths();
  for (const path of branches) {
    for (let i = 1; i < path.length; i++) {
      assert.ok(
        path[i].x === path[i - 1].x || path[i].y === path[i - 1].y,
        `no diagonal segment in ${JSON.stringify(path)}`
      );
    }
  }
  const terminalKeys = new Set(
    net.terminals.map((t) => {
      const p = circuit.getComponent(t.comp).terminalWorld(t.term);
      return `${p.x},${p.y}`;
    })
  );
  // A branch endpoint is attached if it is a terminal or is shared with another
  // branch (a corner or junction). Count point occurrences across all branches.
  const occurrence = new Map();
  for (const path of branches) for (const p of path) {
    const k = `${p.x},${p.y}`;
    occurrence.set(k, (occurrence.get(k) || 0) + 1);
  }
  for (const path of branches) {
    for (const p of [path[0], path[path.length - 1]]) {
      const k = `${p.x},${p.y}`;
      assert.ok(terminalKeys.has(k) || (occurrence.get(k) || 0) >= 2, `branch endpoint ${k} is attached`);
    }
  }
  const dots = [...circuit.components.values()].filter((c) => c.type === 'solder');
  assert.equal(dots.length, expectedDots, `solder dot count (branches=${JSON.stringify(branches)})`);
  return net;
}

function scenario() {
  const c = new Circuit();
  // Centered-origin symbols use these world terminals.
  // R1.a(0,0) R1.b(160,0)   R2.a(400,0) R2.b(560,0)   R3.a(280,-200) R3.b(440,-200)
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 360, y: -200 });
  return c;
}

test('two terminals wired, then a third joined mid-wire: one junction, one dot', () => {
  const c = scenario();
  const n = c.wireTo('R1.b', { x: 400, y: 0 }); // R1.b -> R2.a straight
  assert.equal(n.terminals.length, 2);
  assertNetClean(c, n, 0);

  const joined = c.wireTo('R3.b', { x: 280, y: 0 }); // join mid-wire at (280,0)
  assert.equal(joined, n);
  assert.equal(n.terminals.length, 3);
  assertNetClean(c, n, 1);
});

test('third terminal joined onto an existing terminal: one junction, one dot', () => {
  const c = scenario();
  const n = c.wireTo('R1.b', { x: 400, y: 0 });
  c.wireTo('R3.b', { x: 160, y: 0 }); // join at R1.b position
  assert.equal(n.terminals.length, 3);
  assertNetClean(c, n, 1);
});

test('four terminals joined in stages keep exactly the real junction count', () => {
  const c = new Circuit();
  c.addComponent('resistor', { refdes: 'R1', x: 80, y: 0 });
  c.addComponent('resistor', { refdes: 'R2', x: 480, y: 0 });
  c.addComponent('resistor', { refdes: 'R3', x: 360, y: -200 });
  c.addComponent('resistor', { refdes: 'R4', x: 360, y: 200 });
  const n = c.wireTo('R1.b', { x: 400, y: 0 }); // R1.b -> R2.a
  c.wireTo('R3.b', { x: 280, y: 0 }); // join mid-wire
  c.wireTo('R4.a', { x: 280, y: 0 }); // join at the same junction
  assert.equal(n.terminals.length, 4);
  // R3/R4 both land at (280,0): still a single junction, so one dot.
  assertNetClean(c, n, 1);
});

test('dragging the joined devices around never detaches or adds dots', () => {
  const c = scenario();
  const n = c.wireTo('R1.b', { x: 400, y: 0 });
  c.wireTo('R3.b', { x: 280, y: 0 });
  assertNetClean(c, n, 1);

  // Move R1 (source end) and R3 (joined branch) in several steps like a real drag.
  const moves = [
    ['R1', 80, 120],
    ['R3', 360, -360],
    ['R1', 200, 120],
    ['R2', 480, 160],
    ['R3', 480, -360],
  ];
  for (const [refdes, x, y] of moves) {
    const comp = c.getComponent(refdes);
    const dx = x - comp.transform.x;
    const dy = y - comp.transform.y;
    c.moveComponent(refdes, x, y);
    c.rerouteNet(n, new Map([[refdes, { dx, dy }]]));
    assert.equal(c.netOfTerminal('R1.b'), n, 'R1.b stays connected');
    assert.equal(c.netOfTerminal('R2.a'), n, 'R2.a stays connected');
    assert.equal(c.netOfTerminal('R3.b'), n, 'R3.b stays connected');
    assertNetClean(c, n, 1);
  }
});

test('joining into a wire at different points never creates diagonals or extra dots', () => {
  for (const [mx, my] of [[200, 0], [320, 0], [280, 0]]) {
    const c = scenario();
    const n = c.wireTo('R1.b', { x: 400, y: 0 });
    c.wireTo('R3.b', { x: mx, y: my });
    assert.equal(n.terminals.length, 3, `meet (${mx},${my})`);
    assertNetClean(c, n, 1);
  }
});

test('deleting a segment shortens the net and preserves the remaining branches', () => {
  const c = scenario();
  const n = c.wireTo('R1.b', { x: 400, y: 0 });
  c.wireTo('R3.b', { x: 280, y: 0 });
  const before = n.length();
  c.deleteWireSegment(n.id, 0, 1); // delete the R1.b side of the junction
  // The junction branch to R2/R3 survives; R1.b is now a dangling stub.
  const byTerminal = (id) => c.netOfTerminal(id);
  assert.ok(byTerminal('R1.b') !== byTerminal('R2.a'), 'R1.b detached from R2.a');
  const remaining = c.nets.get(byTerminal('R2.a').id);
  assert.equal(remaining.terminals.length, 2, 'R2.a and R3.b stay connected');
  // total length shrank, and no branch was auto-regenerated (no growth)
  const after = [...c.nets.values()].reduce((s, x) => s + x.length(), 0);
  assert.ok(after < before, `net shrank: ${before} -> ${after}`);
  assert.equal(remaining.branches.length, 2, 'remaining branches preserved, not re-routed');
  assertNetClean(c, remaining, 0);
});

test('loading stale overlapping branches splits them so dragging never loops or adds dots', () => {
  // Loaded branches must split at the junction so each side of the dot is its
  // own segment and dragging the far terminal stays clean.
  const c = Circuit.fromJSON({
    version: 1, grid: 40,
    components: [
      { refdes: 'C1', type: 'capacitor', value: '', transform: { x: -160, y: -400, rotation: 0, mirrorX: false, mirrorY: false } },
      { refdes: 'C2', type: 'capacitor', value: '', transform: { x: -160, y: 80, rotation: 0, mirrorX: false, mirrorY: false } },
      { refdes: 'C3', type: 'capacitor', value: '', transform: { x: 560, y: 80, rotation: 0, mirrorX: false, mirrorY: false } },
      { refdes: 'C4', type: 'capacitor', value: '', transform: { x: -160, y: 600, rotation: 0, mirrorX: false, mirrorY: false } },
    ],
    nets: [{
      id: 'N1', name: '',
      terminals: [{ comp: 'C4', term: 'b' }, { comp: 'C3', term: 'b' }, { comp: 'C1', term: 'b' }, { comp: 'C2', term: 'b' }],
      route: [{ x: -120, y: 600 }, { x: 720, y: 600 }, { x: 720, y: 80 }, { x: 600, y: 80 }],
      junctions: [{ x: 360, y: 600 }],
      branches: [
        [{ x: -120, y: 600 }, { x: 720, y: 600 }, { x: 720, y: 80 }, { x: 600, y: 80 }],
        [{ x: 360, y: 600 }, { x: 720, y: 600 }, { x: 720, y: 80 }, { x: 600, y: 80 }],
        [{ x: -120, y: -400 }, { x: 720, y: -400 }, { x: 720, y: 80 }, { x: 600, y: 80 }],
        [{ x: -120, y: 80 }, { x: 160, y: 80 }, { x: 160, y: 600 }, { x: 360, y: 600 }],
      ],
    }],
    labels: [],
  });
  const n = c.nets.get('N1');
  // No branch may pass through another branch's vertex (no unsplit interior).
  for (const path of n.branches) {
    for (let i = 1; i < path.length; i++) {
      assert.ok(path[i].x === path[i - 1].x || path[i].y === path[i - 1].y, 'orthogonal');
    }
  }
  const snap = n.branches.map((b) => b.map((p) => ({ ...p })));
  const c4 = c.getComponent('C4');
  const sx = c4.transform.x, sy = c4.transform.y;
  const attached = () => n.terminals.every((t) => {
    const p = c.getComponent(t.comp).terminalWorld(t.term);
    return n.branches.some((b) => b.some((q) => q.x === p.x && q.y === p.y));
  });
  const dots = () => [...c.components.values()].filter((x) => x.type === 'solder').length;
  // The branches below were authored for the pre-160-wide capacitor geometry:
  // with the current 160-wide body every terminal (C4.b -80,600, C3.b 640,80,
  // C1.b -80,-400, C2.b -80,80) lands mid-wire, so each terminal-on-wire is a
  // real 3-arm junction dot (4) plus the T at (160,600) -> 5 dots total. The
  // invariant this test guards is that DRAGGING never adds (or removes) dots.
  const loadDots = dots();
  for (const [x, y] of [[-160, 480], [-160, 360], [-160, 240]]) {
    const dx = x - sx, dy = y - sy;
    c.moveComponent('C4', x, y);
    n.branches = snap.map((b) => b.map((p) => ({ ...p })));
    c.rerouteNet(n, new Map([['C4', { dx, dy }]]));
    assert.ok(attached(), `terminals attached after C4@${x},${y}`);
    assert.equal(dots(), loadDots, `dot count stable after C4@${x},${y}`);
  }
});

test('a partial move leaves no junction anchor behind at the old position', () => {
  // A diode-connected device on a net that also reaches something stationary:
  // the net cannot translate rigidly, so its branches re-anchor.
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: -400, rotation: 90 });
  circuit.connect('M1.d', 'R1.b');
  circuit.connect('M1.g', 'M1.d');
  circuit.syncJunctionSolders();
  const net = [...circuit.nets.values()][0];
  assert.deepEqual(net.junctions, [{ x: 0, y: -120 }]);

  const move = (to) => {
    const moved = new Map([['M1', { dx: to - circuit.getComponent('M1').transform.x, dy: 0 }]]);
    circuit.moveComponent('M1', to, 0);
    for (const one of [...circuit.nets.values()]) circuit.rerouteNet(one, moved);
    circuit.syncJunctionSolders();
  };
  const solderAt = () => [...circuit.components.values()]
    .filter((component) => component.type === 'solder')
    .map((component) => ({ x: component.transform.x, y: component.transform.y }));

  move(120);
  // The dot was always derived from the drawn geometry; the net's own anchor
  // used to keep the pre-move coordinate, and `anchorWorlds` routes to it, so
  // the next edit pulled a wire back to a point nothing occupies.
  assert.deepEqual(solderAt(), [{ x: 120, y: -120 }]);
  assert.deepEqual(net.junctions, [{ x: 120, y: -120 }]);

  // Still true after a second move: staleness must not accumulate.
  move(240);
  assert.deepEqual(solderAt(), [{ x: 240, y: -120 }]);
  assert.deepEqual(net.junctions, [{ x: 240, y: -120 }]);
  assertNetClean(circuit, net, 1);
});

test('a junction held by a moved device travels with it, not with the drawing', () => {
  // The editor sees this net already split into arms meeting at the junction:
  // a preview clone reloads from JSON, which reduces the overlapping legs into
  // a T. That is the shape the move has to handle.
  const circuit = new Circuit();
  circuit.addComponent('nmos', { refdes: 'M1', x: 0, y: 0 });
  circuit.addComponent('resistor', { refdes: 'R1', x: 0, y: -400, rotation: 90 });
  circuit.connect('M1.d', 'R1.b');
  circuit.connect('M1.g', 'M1.d');
  const reloaded = Circuit.fromJSON(JSON.parse(JSON.stringify(circuit.toJSON())));
  reloaded.syncJunctionSolders();
  const net = [...reloaded.nets.values()][0];
  // The loop reaches out past the gate; its far edge is what must ride along.
  const leftEdge = () => Math.min(...net.paths().flat().map((point) => point.x));
  const before = leftEdge();
  assert.ok(before < -120, `the diode loop reaches past the gate: ${before}`);

  const moved = new Map([['M1', { dx: 120, dy: 0 }]]);
  reloaded.moveComponent('M1', 120, 0);
  for (const one of [...reloaded.nets.values()]) reloaded.rerouteNet(one, moved);
  reloaded.syncJunctionSolders();

  // It rides the device rather than staying behind at the old position.
  assert.equal(leftEdge(), before + 120);
  assertNetClean(reloaded, net, 1);
});
