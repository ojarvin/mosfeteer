import { performance } from 'node:perf_hooks';
import { chooseWireHitCandidate } from '../src/web/selection.js';
import { buildWireHitIndex, queryWireHitIndex } from '../src/web/wire-index.js';
import { smartRoute, steinerBranches } from '../src/core/router.js';

function measure(name, fn, n = 100) {
  const start = performance.now();
  for (let i = 0; i < n; i++) fn();
  console.log(`${name}: ${((performance.now() - start) / n).toFixed(3)}ms`);
}

const nets = Array.from({ length: 2000 }, (_, i) => ({
  id: `n${i}`,
  paths: () => [[{ x: i * 40, y: 0 }, { x: i * 40 + 20, y: 0 }]],
}));
const wireIndex = buildWireHitIndex(nets);
measure('wire-hit selection (production index, Euclidean segment distance)', () => {
  const p = { x: 1999 * 40 + 10, y: 3 };
  const candidates = queryWireHitIndex(wireIndex, p, { x: Math.round(p.x / 40) * 40, y: 0 }, 12);
  chooseWireHitCandidate({ candidates, selectedNets: new Set(), diagnosticNets: new Set() });
});

const blocked = { rects: Array.from({ length: 20 }, (_, i) => ({ x: 40, y: i * 40 - 400, w: 40, h: 40 })), pins: new Map(), pinRects: new Map(), wires: [], labelRects: [] };
measure('heap-backed A* fallback', () => smartRoute({ x: 0, y: 0 }, { x: 400, y: 0 }, blocked));
measure('bounded exact Steiner', () => steinerBranches([{ x: 0, y: 0 }, { x: 160, y: 80 }, { x: 320, y: 0 }], { rects: [], pins: new Map(), pinRects: new Map(), wires: [], labelRects: [] }), 20);
