import { createRationalOps } from './algebra-ops.js';
import { solveMNA } from './solve.js';
import { compactRational } from './compact.js';
import { applyApproximations, intrinsicallyDominates } from './approximation.js';

function reachable(edges, start, excluded = -1) {
  const seen = new Set();
  const queue = start === excluded ? [] : [start];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    if (seen.has(node) || node === excluded) continue;
    seen.add(node);
    queue.push(...edges[node].filter((next) => !seen.has(next) && next !== excluded));
  }
  return seen;
}

/**
 * A matrix entry A[row][column] is a directed dependency column -> row.
 * Reciprocal loading and controlled-source feedback therefore remain in
 * one coupled block. A signal cut must dominate the output and have no
 * return path from the output; merely lying on a drawn signal path is not
 * sufficient to license multiplying independent stage gains.
 */
export function findSignalCuts(pipeline, ops) {
  const { system, context, excitations } = pipeline;
  const input = system.unknowns.indexOf(`V(${context.input.node})`);
  const output = system.unknowns.indexOf(`V(${context.output.node})`);
  const source = system.unknowns.indexOf(`I(${excitations.input.name})`);
  const edges = system.unknowns.map(() => []);
  const reverse = system.unknowns.map(() => []);
  for (let row = 0; row < edges.length; row++) {
    if (row === input || row === source) continue;
    for (let column = 0; column < edges.length; column++) {
      if (column === source || column === row || ops.isZero(system.A[row][column])) continue;
      edges[column].push(row);
      reverse[row].push(column);
    }
  }
  const fromInput = reachable(edges, input);
  const fromOutput = reachable(edges, output);
  const cuts = [...fromInput].filter((index) => index !== input && index !== output
    && system.unknowns[index].startsWith('V(') && !fromOutput.has(index)
    && !reachable(edges, input, index).has(output));
  // Dominators of one output form an ordered chain. Reachability gives its
  // order without depending on the circuit's insertion order or geometry.
  cuts.sort((a, b) => reachable(edges, a).has(b) ? -1 : 1);
  return { input, output, cuts, edges, reverse };
}

function drivingImpedance(pipeline, index, graph, ops) {
  if (index === graph.output) return pipeline.queries.outputImpedance.branchValue || pipeline.queries.outputImpedance.value;
  const forward = reachable(graph.edges, index);
  const backward = reachable(graph.reverse, index);
  const block = [...forward].filter((node) => backward.has(node));
  const local = block.indexOf(index);
  const system = {
    A: block.map((row) => block.map((column) => pipeline.system.A[row][column])),
    B: block.map((_, row) => [row === local ? ops.one : ops.zero]),
    unknowns: block.map((row) => pipeline.system.unknowns[row]),
  };
  const solved = solveMNA(system, { ops });
  return solved.ok ? compactRational(solved.columns[0][local], ops) : null;
}

function shortCircuitTransadmittance(pipeline, index, previous, graph, ops) {
  const forward = reachable(graph.edges, index);
  const backward = reachable(graph.reverse, index);
  const block = [...forward].filter((node) => backward.has(node));
  const internal = block.filter((node) => node !== index);
  const upstream = pipeline.solution.columns[0][previous];
  const rhs = (row) => pipeline.system.A[row].reduce((sum, coefficient, column) => {
    if (block.includes(column) || ops.isZero(coefficient)) return sum;
    const voltage = pipeline.solution.columns[0][column];
    if (ops.isZero(voltage)) return sum;
    const normalized = column === previous ? ops.one : compactRational(ops.div(voltage, upstream), ops);
    return ops.sub(sum, ops.mul(coefficient, normalized));
  }, ops.zero);
  const system = {
    A: internal.map((row) => internal.map((column) => pipeline.system.A[row][column])),
    B: internal.map((row) => [rhs(row)]),
    unknowns: internal.map((row) => pipeline.system.unknowns[row]),
  };
  const solved = internal.length ? solveMNA(system, { ops }) : { ok: true, columns: [[]] };
  if (!solved.ok) return null;
  return compactRational(internal.reduce((current, column, i) => ops.sub(
    current, ops.mul(pipeline.system.A[index][column], solved.columns[0][i]),
  ), rhs(index)), ops);
}

/** Apply the selected assumptions to each physical stage before recombining. */
/**
 * Whether an expression carries a sum. A product is worth showing factored
 * while one of its factors is a combination -- `g_m (r_o || R_D)` reads far
 * better than the ratio it expands to -- but two monomials multiplied are
 * always shorter multiplied out: `g_{m1} (1/g_{m2})` is `g_{m1}/g_{m2}`, and
 * `g_m (1/g_m)` is 1.
 */
function carriesSum(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.kind === 'add') return true;
  if (value.kind === 'rational') return carriesSum(value.numerator) || carriesSum(value.denominator);
  if (value.kind === 'multiply') return value.factors.some(carriesSum);
  if (value.kind === 'power') return carriesSum(value.base);
  return false;
}

export function approximateTopology(topology, queries, options) {
  if (!topology.stages.length) return null;
  const ops = createRationalOps({ variable: options.variable || 's', maxOperations: 12000 });
  const localOptions = { ...options, budget: ops.budget, rational: { budget: ops.budget } };
  try {
    const identities = [];
    const stages = topology.stages.map((stage, index) => {
      const gm = applyApproximations(stage.transadmittance, localOptions);
      let load = applyApproximations(stage.impedance, localOptions);
      const parallel = index === topology.stages.length - 1 ? queries.outputImpedance.equivalence : null;
      if (parallel) {
        const branches = parallel.operands.map((branch) => applyApproximations(branch, localOptions));
        // Leave singular/infinite branches to the complete rational limit.
        if (branches.every((branch) => branch.selected.kind !== 'infinity')) {
          const reduced = branches.map((branch) => branch.selected);
          // The branches also compete with each other: a parallel combination
          // is set by its smallest impedance, so `g_m r_o >> 1` drops an r_o
          // branch beside a 1/g_m one. It never drops R_S or R_D, which that
          // assumption says nothing about.
          const dropped = new Set();
          const devices = [];
          reduced.forEach((branch, index) => {
            const swamped = reduced.some((other, otherIndex) => {
              if (index === otherIndex || dropped.has(otherIndex)) return false;
              const verdict = intrinsicallyDominates(branch, other, localOptions);
              if (verdict.dominated) devices.push(...verdict.devices);
              return verdict.dominated;
            });
            if (swamped) dropped.add(index);
          });
          const operands = dropped.size && dropped.size < reduced.length
            ? reduced.filter((_, index) => !dropped.has(index))
            : reduced;
          const combined = operands.reduce((a, b) => a === null ? b : ops.div(ops.mul(a, b), ops.add(a, b)), null);
          load = {
            ...load,
            selected: combined,
            assumptions: [
              ...branches.flatMap((branch) => branch.assumptions),
              ...(operands.length === reduced.length ? [] : devices.map((id) => `g_m r_o >> 1 (${id})`)),
            ],
          };
          if (operands.length > 1) identities.push({ kind: 'parallel-resistance', equivalent: combined, operands });
        }
      }
      const gain = compactRational(ops.mul(gm.selected, load.selected), ops);
      // Keep the proven product only while the factored form is the shorter
      // read. Once the load has collapsed to 1/g_m, `g_m (1/g_m)` says less
      // than the 1 it multiplies out to.
      if (carriesSum(gm.selected) || carriesSum(load.selected)) {
        identities.push({ kind: 'product', equivalent: gain, operands: [gm.selected, load.selected] });
      }
      return { gain, gm, load };
    });
    const selected = stages.reduce((a, stage) => ops.mul(a, stage.gain), ops.one);
    if (stages.length > 1) identities.push({ kind: 'product', equivalent: selected, operands: stages.map((stage) => stage.gain) });
    if (ops.budget.exceeded) return null;
    return { selected, output: stages.at(-1).load, identities,
      assumptions: [...new Set(stages.flatMap((stage) => [...stage.gm.assumptions, ...stage.load.assumptions]))] };
  } catch {
    return null;
  }
}

/**
 * Construct a hierarchy of exact port identities: stage gain = signed
 * short-circuit transadmittance times driving-point impedance, and total
 * gain = the gains across successive unilateral signal cuts. All loading
 * inside a stage stays in its coupled block. Optional factoring has its
 * own bounded budget so it cannot invalidate an already successful solve.
 */
export function buildTopologyIdentities(pipeline, options = {}) {
  const empty = { identities: [], stages: [] };
  if (options.topologicalPresentation === false || pipeline.queries.transfer.value?.kind !== 'rational'
      || !pipeline.selectedMna.some((primitive) => primitive.kind === 'vccs')) return empty;
  const ops = createRationalOps({ variable: options.variable || 's', maxOperations: 12000 });
  try {
    const graph = findSignalCuts(pipeline, ops);
    const stages = [];
    const identities = [];
    const gains = [];
    let previous = graph.input;
    for (const index of [...graph.cuts, graph.output]) {
      const upstream = pipeline.solution.columns[0][previous];
      const voltage = pipeline.solution.columns[0][index];
      if (ops.isZero(upstream) || ops.isZero(voltage)) return empty;
      const impedance = drivingImpedance(pipeline, index, graph, ops);
      if (!impedance || ops.isZero(impedance) || impedance.kind === 'infinity') return empty;
      const transadmittance = shortCircuitTransadmittance(pipeline, index, previous, graph, ops);
      if (!transadmittance) return empty;
      const gain = ops.mul(transadmittance, impedance);
      identities.push({ kind: 'product', equivalent: gain, operands: [transadmittance, impedance] });
      gains.push(gain);
      stages.push({
        from: pipeline.system.unknowns[previous], to: pipeline.system.unknowns[index],
        gain, transadmittance, impedance,
      });
      previous = index;
    }
    if (gains.length > 1) identities.push({ kind: 'product', equivalent: pipeline.queries.transfer.value, operands: gains });
    if (ops.budget.exceeded) return empty;
    return { identities, stages };
  } catch {
    return empty;
  }
}
