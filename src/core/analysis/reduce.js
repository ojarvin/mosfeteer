/**
 * Textbook series/parallel reduction of a network of passive primitives
 * (resistor/capacitor/inductor/conductance/admittance). A human reduces a
 * feedback or load network this way before ever writing KCL; this is the
 * same operation. Used both to collapse an isolated Miller bridge to one
 * equivalent impedance (`miller.js`, via `reduceTwoTerminalNetwork`) and,
 * more generally, to simplify series/parallel branches anywhere in the
 * coupled graph before the exact MNA solve (`pipeline.js`, via
 * `reduceNetwork`), recording each parallel merge so the result can render
 * as `Z1 \| Z2` instead of the expanded fraction.
 *
 * Deliberately narrow: only series-merge (a private degree-2 node untouched
 * by anything else, including a VCCS control or terminal) and parallel-merge
 * (multiple edges between the same node pair) are attempted. A network that
 * needs a star-mesh/Y-Δ transform to reduce further (a bridge/lattice
 * topology) is left as-is rather than guessed at.
 */
import { PASSIVE_KINDS } from './shared.js';

/** Whether a primitive is a plain two-terminal passive this module understands. */
export function isReduciblePassive(primitive) {
  return PASSIVE_KINDS.has(primitive?.kind);
}

/** Exact impedance of one passive primitive, given a resolved (non-string) `.value`. */
export function primitiveImpedance(primitive, ops) {
  const s = ops.s();
  switch (primitive.kind) {
    case 'resistor': return primitive.value;
    case 'conductance':
    case 'admittance': return ops.div(ops.one, primitive.value);
    case 'capacitor': return ops.div(ops.one, ops.mul(s, primitive.value));
    case 'inductor': return ops.mul(s, primitive.value);
    default: return null;
  }
}

function nodeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Merge every group of 2+ edges sharing a node pair into one, via `Z1*Z2/(Z1+Z2)`. */
function mergeParallel(edges, ops, proofs) {
  const groups = new Map();
  for (const edge of edges) {
    const key = nodeKey(edge.a, edge.b);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  }
  const merged = [];
  let changed = false;
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }
    changed = true;
    let impedance = group[0].impedance;
    for (let index = 1; index < group.length; index += 1) {
      const next = group[index].impedance;
      impedance = ops.div(ops.mul(impedance, next), ops.add(impedance, next));
    }
    const sources = group.flatMap((edge) => edge.sources);
    proofs?.push({ impedance, operands: group.map((edge) => edge.impedance) });
    merged.push({ a: group[0].a, b: group[0].b, impedance, sources });
  }
  return { edges: merged, changed };
}

/** Eliminate one private (boundary-excluded, degree-2) node via `Z1+Z2`. */
function mergeOneSeriesNode(edges, boundary, ops) {
  const degree = new Map();
  for (const edge of edges) {
    degree.set(edge.a, (degree.get(edge.a) || 0) + 1);
    degree.set(edge.b, (degree.get(edge.b) || 0) + 1);
  }
  for (const [node, count] of degree) {
    if (count !== 2 || boundary.has(node)) continue;
    const touching = edges.filter((edge) => edge.a === node || edge.b === node);
    if (touching.length !== 2) continue;
    const [first, second] = touching;
    if (first === second) continue;
    const other1 = first.a === node ? first.b : first.a;
    const other2 = second.a === node ? second.b : second.a;
    const impedance = ops.add(first.impedance, second.impedance);
    const remaining = edges.filter((edge) => edge !== first && edge !== second);
    remaining.push({ a: other1, b: other2, impedance, sources: [...first.sources, ...second.sources] });
    return remaining;
  }
  return null;
}

// Series-merging a reactive element (L or C) hands Bareiss elimination a
// pre-divided, `s`-dependent admittance instead of the simple denominator-1
// entries it expects, defeating its fraction-free efficiency for more solver
// budget than the smaller matrix saves. Enable series-merge only where the
// result feeds a small isolated sub-solve (Miller's bridge collapse), never
// in the general network pre-reduction.
function reduceToFixedPoint(edges, boundary, ops, proofs, { seriesMerge = true } = {}) {
  let changed = true;
  while (changed) {
    changed = false;
    const parallel = mergeParallel(edges, ops, proofs);
    edges = parallel.edges;
    if (parallel.changed) changed = true;
    if (!seriesMerge) continue;
    const afterSeries = mergeOneSeriesNode(edges, boundary, ops);
    if (afterSeries) {
      edges = afterSeries;
      changed = true;
    }
  }
  return edges;
}

/**
 * Reduce a primitive set that is electrically isolated except at its two
 * named terminals to one equivalent impedance between them. `primitives`
 * must already have resolved (non-string) `.value`s. Returns
 * `{ ok: true, impedance }` or `{ ok: false }` — never throws for a network
 * this module simply can't finish reducing.
 */
export function reduceTwoTerminalNetwork(primitives, nodeA, nodeB, ops) {
  if (!primitives.length || nodeA === nodeB) return { ok: false };
  let edges = [];
  for (const primitive of primitives) {
    const impedance = primitiveImpedance(primitive, ops);
    if (impedance === null) return { ok: false };
    edges.push({ a: primitive.terminals.a, b: primitive.terminals.b, impedance, sources: [primitive] });
  }

  const boundary = new Set([nodeA, nodeB]);
  try {
    edges = reduceToFixedPoint(edges, boundary, ops, null);
  } catch {
    return { ok: false };
  }

  if (edges.length !== 1) return { ok: false };
  const [edge] = edges;
  const matchesBoundary = (edge.a === nodeA && edge.b === nodeB) || (edge.a === nodeB && edge.b === nodeA);
  if (!matchesBoundary) return { ok: false };
  return { ok: true, impedance: edge.impedance };
}

/**
 * Reduce as much of `primitives` as textbook series/parallel merging allows,
 * never eliminating a node in `boundaryNodes` (the caller must include every
 * node any non-passive primitive — e.g. a VCCS terminal or control — touches,
 * plus whichever query/excitation nodes must stay addressable). Non-passive
 * or otherwise unreducible primitives pass through untouched; merged edges
 * become `admittance`-kind primitives. Returns the (possibly smaller)
 * primitive list plus one `{ impedance, operands }` record per parallel
 * merge performed, for the caller to turn into `provenParallel` display
 * metadata. Never throws.
 */
export function reduceNetwork(primitives, boundaryNodes, ops) {
  const fixed = [];
  let edges = [];
  for (const primitive of primitives) {
    const impedance = isReduciblePassive(primitive) ? primitiveImpedance(primitive, ops) : null;
    if (impedance === null) {
      fixed.push(primitive);
      continue;
    }
    edges.push({ a: primitive.terminals.a, b: primitive.terminals.b, impedance, sources: [primitive] });
  }
  if (!edges.length) return { primitives, proofs: [] };

  const boundary = new Set(boundaryNodes);
  for (const primitive of fixed) {
    for (const node of [primitive.terminals?.a, primitive.terminals?.b, primitive.control?.a, primitive.control?.b]) {
      if (node !== undefined && node !== null) boundary.add(node);
    }
  }

  const proofs = [];
  try {
    edges = reduceToFixedPoint(edges, boundary, ops, proofs, { seriesMerge: false });
  } catch {
    return { primitives, proofs: [] };
  }

  // An edge that traces back to exactly one original primitive and was never
  // touched by a merge is returned exactly as it came in — preserving its
  // kind, id, and metadata (e.g. a triode `resistor`'s model, or a plain
  // `R1` for netlist/report labeling) matters to callers, and rebuilding it
  // as a generic `admittance` would silently lose that.
  const reducedPrimitives = edges.map((edge, index) => (
    edge.sources.length === 1 ? edge.sources[0] : {
      kind: 'admittance',
      id: `@reduced-${index}`,
      terminals: { a: edge.a, b: edge.b },
      value: ops.div(ops.one, edge.impedance),
      metadata: { reduced: true, sources: edge.sources.map((source) => source.id) },
    }
  ));
  return { primitives: [...fixed, ...reducedPrimitives], proofs };
}
