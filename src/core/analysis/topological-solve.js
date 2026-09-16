import { solveMNA } from './solve.js';
import { compactRational } from './compact.js';

function articulation(system, ops) {
  const count = system.A.length;
  for (let pivot = 0; pivot < count; pivot++) {
    if (!system.unknowns[pivot].startsWith('V(')) continue;
    const unseen = new Set(system.unknowns.map((_, index) => index).filter((index) => index !== pivot));
    const groups = [];
    while (unseen.size) {
      const queue = [unseen.values().next().value];
      const group = [];
      for (let head = 0; head < queue.length; head++) {
        const node = queue[head];
        if (!unseen.delete(node)) continue;
        group.push(node);
        for (const next of unseen) {
          if (!ops.isZero(system.A[node][next]) || !ops.isZero(system.A[next][node])) queue.push(next);
        }
      }
      groups.push(group);
    }
    if (groups.length >= 2) return { pivot, groups };
  }
  return null;
}

/** Schur-combine independent branches at a voltage junction, recursively. */
function solvePartitioned(system, ops, partitions) {
  const split = system.A.length >= 3 ? articulation(system, ops) : null;
  if (!split) return solveMNA(system, { ops });
  const { pivot, groups } = split;
  const rhsCount = system.B[0].length;
  let admittance = system.A[pivot][pivot];
  const currents = [...system.B[pivot]];
  const pieces = [];
  for (const group of groups) {
    const local = {
      A: group.map((row) => group.map((column) => system.A[row][column])),
      B: group.map((row) => [...system.B[row], system.A[row][pivot]]),
      unknowns: group.map((index) => system.unknowns[index]),
    };
    const solved = solvePartitioned(local, ops, partitions);
    if (!solved.ok) {
      if (solved.code === 'operation-budget') return solved;
      // An ideal branch may have a singular open-port admittance despite
      // a uniquely solvable combined system. Keep the exact coupled solve.
      return solveMNA(system, { ops });
    }
    group.forEach((row, i) => {
      admittance = ops.sub(admittance, ops.mul(system.A[pivot][row], solved.values[i][rhsCount]));
      for (let rhs = 0; rhs < rhsCount; rhs++) currents[rhs] = ops.sub(currents[rhs], ops.mul(system.A[pivot][row], solved.values[i][rhs]));
    });
    pieces.push({ group, solved });
  }
  admittance = compactRational(admittance, ops);
  if (ops.isZero(admittance)) return solveMNA(system, { ops });
  const values = system.unknowns.map(() => []);
  values[pivot] = currents.map((current) => ops.div(compactRational(current, ops), admittance));
  for (const { group, solved } of pieces) group.forEach((row, i) => {
    values[row] = currents.map((_, rhs) => ops.sub(solved.values[i][rhs], ops.mul(solved.values[i][rhsCount], values[pivot][rhs])));
  });
  partitions.push({ node: system.unknowns[pivot], branches: groups.map((group) => group.map((index) => system.unknowns[index])) });
  return { ok: true, values };
}

function coupledBlocks(indices, dependencies) {
  const order = new Map();
  const low = new Map();
  const stack = [];
  const active = new Set();
  const blocks = [];
  let next = 0;
  function visit(node) {
    order.set(node, next);
    low.set(node, next++);
    stack.push(node);
    active.add(node);
    for (const dependency of dependencies.get(node)) {
      if (!order.has(dependency)) {
        visit(dependency);
        low.set(node, Math.min(low.get(node), low.get(dependency)));
      } else if (active.has(dependency)) low.set(node, Math.min(low.get(node), order.get(dependency)));
    }
    if (low.get(node) !== order.get(node)) return;
    const block = [];
    let member;
    do {
      member = stack.pop();
      active.delete(member);
      block.push(member);
    } while (member !== node);
    blocks.push(block.sort((a, b) => a - b));
  }
  indices.forEach((node) => { if (!order.has(node)) visit(node); });
  return blocks;
}

/**
 * Remove the imposed input voltage, then solve coupled blocks in dependency
 * order. Bilateral loading and feedback stay in the same strongly connected
 * block; a unilateral cascade never needs one giant determinant. Both port
 * excitations travel through these same blocks together. Recover the input
 * source current last from its KCL row, preserving Zin and all MNA details.
 */
export function solveByTopology(system, excitations, context, ops, options = {}) {
  if (typeof ops.s !== 'function') return null;
  const input = system.unknowns.indexOf(`V(${context.input.node})`);
  const source = system.unknowns.indexOf(`I(${excitations.input.name})`);
  if (input < 0 || source < 0 || ops.isZero(system.A[source][input])) return null;
  if (system.A[source].some((value, column) => column !== input && !ops.isZero(value))) return null;
  const indices = system.unknowns.map((_, index) => index).filter((index) => index !== input && index !== source);
  if (indices.some((row) => !ops.isZero(system.A[row][source]))) return null;
  const dependencies = new Map(indices.map((row) => [row, indices.filter((column) => column !== row && !ops.isZero(system.A[row][column]))]));
  const blocks = coupledBlocks(indices, dependencies);
  const rhsCount = system.B[0].length;
  const values = system.unknowns.map(() => null);
  values[input] = system.B[source].map((value) => ops.div(value, system.A[source][input]));
  const solvedBlocks = [];
  const partitions = [];
  for (const block of blocks) {
    const members = new Set(block);
    const local = {
      A: block.map((row) => block.map((column) => system.A[row][column])),
      B: block.map((row) => system.B[row].map((value, rhs) => system.A[row].reduce((sum, coefficient, column) => {
        if (members.has(column) || column === source || ops.isZero(coefficient)) return sum;
        if (!values[column]) throw new Error('topological solve dependency order is invalid');
        return ops.sub(sum, ops.mul(coefficient, values[column][rhs]));
      }, value))),
      unknowns: block.map((index) => system.unknowns[index]),
    };
    const solved = options.splitBranches ? solvePartitioned(local, ops, partitions) : solveMNA(local, { ops });
    if (!solved.ok) return { ...solved, block: local.unknowns };
    block.forEach((index, row) => { values[index] = solved.values[row]; });
    solvedBlocks.push(local.unknowns);
  }
  if (ops.isZero(system.A[input][source])) return null;
  values[source] = system.B[input].map((value, rhs) => ops.div(system.A[input].reduce((sum, coefficient, column) => (
    column === source || ops.isZero(coefficient) ? sum : ops.sub(sum, ops.mul(coefficient, values[column][rhs]))
  ), value), system.A[input][source]));
  if (ops.budget?.exceeded) return { ok: false, code: 'operation-budget', error: 'symbolic operation budget exhausted during topological solve' };
  const columns = Array.from({ length: rhsCount }, (_, rhs) => values.map((row) => row[rhs]));
  return {
    ok: true, method: 'topological', blocks: solvedBlocks, partitions, values, solution: values, columns,
    variables: system.unknowns,
    byVariable: columns.map((column) => new Map(system.unknowns.map((name, index) => [name, column[index]]))),
  };
}
