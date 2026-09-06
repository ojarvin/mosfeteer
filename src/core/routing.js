/** Phase 3: deterministic batch routing and candidate scoring for placed topology. */
import { evaluate } from './commands.js';
import { normalizeCircuitSpec } from './circuitSpec.js';
import { placeCircuit } from './placement.js';
import { Circuit } from './model.js';
import { segmentsCross } from './router.js';
import { crossNetOverlaps, pathSegments } from './wiring.js';
import { GRID } from './grid.js';
import { checkSemantics } from './semantic.js';

export const ROUTING_VERSION = 1;
export const MAX_ROUTING_ATTEMPTS = 3;

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const number = (value) => typeof value === 'number' && Number.isFinite(value);
const pointKey = (p) => `${p.x},${p.y}`;
const lexLess = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
};

function sourceSpec(input) {
  if (input?.spec?.components && input?.spec?.nets) return input.spec;
  if (input?.components && input?.nets) return input;
  throw new Error('routing requires a normalized spec or placement result');
}

function sourcePlacement(input, placement) {
  if (placement?.placements) return placement;
  if (input?.placements) return input;
  if (input?.placement?.placements) return input.placement;
  return null;
}

function sourceCircuit(input) {
  if (input instanceof Circuit) return input;
  // generateCircuit() includes a zero-position validation circuit; routing must
  // use the placement it computes instead of treating that staging circuit as authored geometry.
  if (input?.topology) return null;
  if (input?.circuit instanceof Circuit) return input.circuit;
  return null;
}

function netPriority(net) {
  const kind = String(net.kind || '').toLowerCase();
  const kindRank = /supply|power|ground|rail/.test(kind) ? 0 : /feedback|bias/.test(kind) ? 1 : 2;
  // Larger nets claim the environment first; IDs are the final stable tie-break.
  return [kindRank, -(net.terminals?.length || 0), net.name || '', net.id];
}

function comparePriority(a, b) {
  const pa = netPriority(a);
  const pb = netPriority(b);
  for (let i = 0; i < pa.length; i++) {
    const result = compare(pa[i], pb[i]);
    if (result) return result;
  }
  return 0;
}

function routeOrder(spec, attempt) {
  const nets = [...spec.nets].sort(comparePriority);
  if (attempt === 0 || nets.length < 2) return nets;
  if (attempt === 1) return nets.slice().reverse();
  const shift = attempt % nets.length;
  return nets.slice(shift).concat(nets.slice(0, shift));
}

function placementState(spec, placement, existing = null) {
  if (existing) return existing.toJSON();
  const refs = new Map(spec.components.map((component) => [component.id, component.refdes || component.id]));
  const components = [...placement.placements, ...placement.ports].map((item) => ({
    refdes: item.refdes || item.id,
    type: item.type,
    value: item.value || '',
    transform: { ...item.transform },
    style: { color: '#111', lineStyle: 'solid', width: 'normal' },
  }));
  const portByNet = new Map((spec.ports || []).map((port) => [port.id, port]));
  const nets = spec.nets.map((net) => ({
    id: net.id,
    name: net.name || '',
    kind: net.kind,
    logicalGroup: net.logicalGroup,
    terminals: [
      ...net.terminals.map((terminal) => ({ comp: refs.get(terminal.component), term: terminal.terminal })),
      ...[...portByNet.values()].filter((port) => port.net === net.id).map((port) => ({ comp: port.id, term: 'p' })),
    ],
    routingMode: 'managed',
    allowDiagonal: false,
    route: null,
    branches: null,
    junctions: [],
  }));
  return { version: 2, grid: 40, components, nets, labels: [] };
}

function addOwnedLabels(circuit) {
  for (const component of circuit.components.values()) {
    if (!component.def.labelOffset || component.type === 'solder') continue;
    circuit.addLabel({
      id: `label-${component.refdes}`,
      text: component.refdes,
      owner: component.refdes,
      offset: component.def.labelOffset,
      align: 'center',
      style: { color: component.style.color },
    });
  }
}

function pathAnchors(paths) {
  const result = [];
  const seen = new Set();
  const add = (p) => {
    if (!number(p?.x) || !number(p?.y)) return;
    const key = pointKey(p);
    if (!seen.has(key)) { seen.add(key); result.push({ x: p.x, y: p.y }); }
  };
  for (const path of paths) {
    for (let i = 0; i < path.length; i++) add(path[i]);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (a.x === b.x || a.y === b.y) {
        const steps = Math.floor(length / GRID);
        for (let step = 1; step < steps; step++) add({
          x: a.x + Math.sign(b.x - a.x) * step * GRID,
          y: a.y + Math.sign(b.y - a.y) * step * GRID,
        });
      }
    }
  }
  return result;
}

function labelOverlapScore(circuit, label) {
  const box = label.bbox();
  let component = 0;
  let labels = 0;
  for (const item of circuit.components.values()) {
    if (item.type !== 'solder' && !(item.refdes === label.owner) && overlap(box, item.bboxWorld())) component++;
  }
  for (const other of circuit.labels.values()) if (other !== label && overlap(box, other.bbox())) labels++;
  return [component, labels];
}

function overlap(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function addNetLabels(circuit, spec) {
  for (const declared of spec.nets) {
    if (!declared.name) continue;
    const net = circuit.nets.get(declared.id);
    if (!net) continue;
    const candidates = pathAnchors(net.paths());
    if (!candidates.length) continue;
    let best = null;
    for (let index = 0; index < candidates.length; index++) {
      const anchor = candidates[index];
      const label = circuit.addNetLabel(net, declared.name, { id: `net-label-${net.id}`, anchor });
      const score = [...labelOverlapScore(circuit, label), index];
      circuit.removeLabel(label.id);
      if (!best || lexLess(score, best.score)) best = { anchor, score };
    }
    if (best) circuit.addNetLabel(net, declared.name, { id: `net-label-${net.id}`, anchor: best.anchor });
  }
}

function terminalReachability(circuit, net) {
  if (net.terminals.length < 2) return true;
  const paths = net.paths();
  if (!paths.length) return false;
  const terminals = net.terminalWorlds().filter(Boolean);
  const onPath = (point, path) => path.some((p) => pointKey(p) === pointKey(point)) || pathSegments(path).some(({ a, b }) =>
    (a.x === b.x && point.x === a.x && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) ||
    (a.y === b.y && point.y === a.y && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)));
  if (terminals.some((point) => !paths.some((path) => onPath(point, path)))) return false;
  const parent = paths.map((_, index) => index);
  const find = (index) => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    if (paths[i].some((p) => onPath(p, paths[j])) || paths[j].some((p) => onPath(p, paths[i]))) join(i, j);
  }
  return paths.every((_, index) => find(index) === find(0));
}

function crossings(circuit) {
  const nets = [...circuit.nets.values()];
  let count = 0;
  for (let i = 0; i < nets.length; i++) for (let j = i + 1; j < nets.length; j++) {
    for (const left of nets[i].wireSegments()) for (const right of nets[j].wireSegments()) {
      if (segmentsCross(left.a, left.b, right.a, right.b)) count++;
    }
  }
  return count;
}

function routeClearance(circuit) {
  let minimum = Infinity;
  const terminalPoints = new Set([...circuit.components.values()].flatMap((component) =>
    component.worldTerminals().map(pointKey)));
  for (const net of circuit.nets.values()) for (const segment of net.wireSegments()) {
    if (terminalPoints.has(pointKey(segment.a)) || terminalPoints.has(pointKey(segment.b))) continue;
    for (const component of circuit.components.values()) {
      if (component.type === 'solder') continue;
      const rect = component.bboxWorld();
      const x0 = Math.max(rect.x, Math.min(segment.a.x, segment.b.x));
      const x1 = Math.min(rect.x + rect.w, Math.max(segment.a.x, segment.b.x));
      const y0 = Math.max(rect.y, Math.min(segment.a.y, segment.b.y));
      const y1 = Math.min(rect.y + rect.h, Math.max(segment.a.y, segment.b.y));
      const dx = x1 < x0 ? x0 - x1 : 0;
      const dy = y1 < y0 ? y0 - y1 : 0;
      minimum = Math.min(minimum, Math.hypot(dx, dy));
    }
  }
  return Number.isFinite(minimum) ? minimum : GRID;
}

function symmetryPenalty(spec, placement) {
  const groups = spec.constraints.groups || [];
  const items = new Map(placement.placements.map((item) => [item.id, item]));
  let penalty = 0;
  for (const group of groups) {
    if (group.symmetric === false || group.matched === false) continue;
    const members = (group.members || []).map((id) => items.get(id)).filter(Boolean);
    if (members.length < 2) continue;
    const center = members.reduce((sum, item) => sum + item.transform.x, 0) / members.length;
    for (const item of members) {
      const mirror = members.find((other) => other !== item &&
        other.transform.y === item.transform.y &&
        other.transform.x === 2 * center - item.transform.x);
      if (!mirror) penalty++;
    }
  }
  return penalty;
}

function metrics(circuit, spec, placement) {
  const report = evaluate(circuit);
  const refdes = new Map(spec.components.map((component) => [component.id, component.refdes || component.id]));
  const declared = new Set(spec.nets.flatMap((net) => net.terminals.map((t) => `${refdes.get(t.component)}.${t.terminal}`)));
  const unowned = new Set(spec.openTerminals?.map((t) => `${refdes.get(t.component)}.${t.terminal}`) || []);
  const hardIssues = report.issues.filter((issue) => issue.kind !== 'unconnected-terminal' ||
    (!unowned.has(issue.refs?.[0]) && declared.has(issue.refs?.[0])));
  const unreachable = [...circuit.nets.values()].filter((net) => !terminalReachability(circuit, net)).map((net) => net.id);
  const overlaps = crossNetOverlaps([...circuit.nets.values()].map((net) => ({ id: net.id, paths: net.paths() })));
  const turns = [...circuit.nets.values()].reduce((sum, net) => sum + net.paths().reduce((n, path) => n + Math.max(0, path.length - 2), 0), 0);
  const length = Math.round([...circuit.nets.values()].reduce((sum, net) => sum + net.length(), 0));
  const hardViolations = hardIssues.length + unreachable.length;
  const clearance = routeClearance(circuit);
  const placementPenalty = placement.report?.errors?.length || 0;
  const score = [
    hardViolations,
    report.overlappingBBoxes.length + report.wireThroughBBoxes.length + report.diagonalWireSegments.length,
    overlaps.length,
    crossings(circuit),
    placementPenalty,
    symmetryPenalty(spec, placement),
    report.labelComponentOverlaps.length + report.labelOverlaps.length,
    turns,
    length,
    -clearance,
  ];
  return {
    ok: hardViolations === 0,
    hardViolations,
    unreachableNets: unreachable,
    componentOverlaps: report.overlappingBBoxes.length,
    bodyDrills: report.wireThroughBBoxes.length,
    diagonalSegments: report.diagonalWireSegments.length,
    crossNetOverlaps: overlaps.length,
    crossings: score[3],
    placementPenalty,
    symmetryPenalty: score[5],
    labelOverlaps: report.labelComponentOverlaps.length + report.labelOverlaps.length,
    turns,
    length,
    clearance,
    placementScore: placement.score || [],
    score,
    evaluation: report,
  };
}

function routeAttempt(spec, placement, attempt, options, existing = null) {
  const circuit = Circuit.fromJSON(placementState(spec, placement, existing));
  if (!existing) addOwnedLabels(circuit);
  const fresh = !existing;
  const failures = [];
  for (const declared of routeOrder(spec, attempt)) {
    const net = circuit.nets.get(declared.id);
    if (!net) { failures.push(`${declared.id}: missing physical net`); continue; }
    // A declared one-terminal net is a port/label anchor, not a wire; the
    // model's fresh router intentionally only lays paths for two or more anchors.
    if (net.terminals.length < 2 || net.routingMode === 'fixed' || (!fresh && (net.route?.length >= 2 || net.branches?.length))) continue;
    try {
      if (circuit.rerouteNet(net, 'refresh') === false) failures.push(`${net.id}: unable to route safely`);
    } catch (error) {
      failures.push(`${net.id}: ${error.message}`);
    }
  }
  if (failures.length) return { circuit, failures, metrics: null };
  circuit.syncJunctionSolders();
  if (!existing) addNetLabels(circuit, spec);
  const result = metrics(circuit, spec, placement);
  return { circuit, failures: [], metrics: result };
}

function unpack(input, placementOrOptions, maybeOptions) {
  const placement = sourcePlacement(input, placementOrOptions);
  const options = placementOrOptions?.placements ? (maybeOptions || {}) : (placementOrOptions || {});
  const spec = normalizeCircuitSpec(sourceSpec(input));
  const selected = placement || placeCircuit(spec, options);
  return { spec, placement: selected, options, existing: sourceCircuit(input) };
}

/** Route a placed topology without mutating the spec, placement, or source circuit. */
export function routeCircuit(input, placementOrOptions = {}, maybeOptions = {}) {
  const { spec, placement, options, existing } = unpack(input, placementOrOptions, maybeOptions);
  const semantic = checkSemantics(spec);
  if (!placement?.ok) {
    return { ok: false, success: false, spec, placement, semantic, report: { ok: false, version: ROUTING_VERSION, attempts: 0, errors: placement?.report?.errors || ['placement failed'], semantic } };
  }
  const requested = Number.isInteger(options.maxAttempts) ? options.maxAttempts : MAX_ROUTING_ATTEMPTS;
  const maxAttempts = Math.max(1, Math.min(MAX_ROUTING_ATTEMPTS, requested));
  const candidates = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = routeAttempt(spec, placement, attempt, options, existing);
    if (candidate.metrics) candidates.push({ ...candidate, attempt });
    else candidates.push({ ...candidate, attempt, metrics: { ok: false, score: [1, attempt], failures: candidate.failures } });
  }
  const valid = candidates.filter((candidate) => candidate.metrics?.ok);
  const compareCandidates = (a, b) => {
    const as = a.metrics.score;
    const bs = b.metrics.score;
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
      const result = compare(as[i] ?? 0, bs[i] ?? 0);
      if (result) return result;
    }
    return a.attempt - b.attempt;
  };
  candidates.sort(compareCandidates);
  const best = valid.sort(compareCandidates)[0];
  const report = {
    ok: !!best,
    version: ROUTING_VERSION,
    motif: spec.motif,
    attempts: candidates.length,
    maxAttempts,
    netOrder: routeOrder(spec, 0).map((net) => net.id),
    semantic,
    errors: best ? [] : [...new Set(candidates.flatMap((candidate) => [
      ...(candidate.failures || []),
      ...(candidate.metrics?.evaluation?.issues?.map((issue) => issue.message) || []),
      ...(candidate.metrics?.unreachableNets || []).map((id) => `net ${id} is not fully connected`),
    ]))],
    candidates: candidates.map((candidate) => ({ attempt: candidate.attempt, ok: !!candidate.metrics?.ok, score: candidate.metrics?.score || null, failures: candidate.failures || [] })),
  };
  if (!best) return { ok: false, success: false, spec, placement, report };
  return {
    ok: true,
    success: true,
    spec,
    placement,
    semantic,
    circuit: best.circuit,
    state: best.circuit.toJSON(),
    metrics: best.metrics,
    report: { ...report, score: best.metrics.score, selectedAttempt: best.attempt },
  };
}

export function tryRouteCircuit(input, placementOrOptions = {}, maybeOptions = {}) {
  try { return routeCircuit(input, placementOrOptions, maybeOptions); }
  catch (error) { return { ok: false, success: false, report: { ok: false, version: ROUTING_VERSION, attempts: 0, errors: [error.message] }, error }; }
}

export const routePlacedCircuit = routeCircuit;
export const tryRoutePlacedCircuit = tryRouteCircuit;
