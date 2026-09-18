import { PASSIVE_KINDS } from './shared.js';
import { AC_GROUND } from './context.js';

const SUPPORTED_KINDS = new Set([...PASSIVE_KINDS, 'voltage-source', 'current-source', 'vccs']);

function asNode(value) {
  if (value == null) return null;
  return String(value);
}

function addNode(nodes, node) {
  if (node && node !== AC_GROUND) nodes.add(node);
}

function primitiveNodes(primitive, canonicalNode) {
  const nodes = [];
  const add = (value) => {
    const node = canonicalNode(asNode(value));
    if (node && node !== AC_GROUND && !nodes.includes(node)) nodes.push(node);
  };
  add(primitive.terminals?.a);
  add(primitive.terminals?.b);
  add(primitive.control?.a);
  add(primitive.control?.b);
  return nodes;
}

function controlledNodes(primitive, canonicalNode) {
  return [primitive.terminals.a, primitive.terminals.b, primitive.control?.a, primitive.control?.b]
    .map((value) => canonicalNode(asNode(value)))
    .filter((node, index, all) => node && node !== AC_GROUND && all.indexOf(node) === index);
}

function isZero(value) {
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'bigint') return value === 0n;
  if (value?.kind === 'number') return value.numerator === 0n;
  if (value?.kind === 'rational') {
    return value.budgetExceeded !== true && isZero(value.numerator);
  }
  return false;
}

function connects(primitive) {
  if (primitive.couples === false) return false;
  if (primitive.kind === 'current-source') return false;
  if (['capacitor', 'conductance', 'admittance'].includes(primitive.kind)) {
    return !isZero(primitive.value ?? primitive.admittance);
  }
  return SUPPORTED_KINDS.has(primitive.kind);
}

function canonicalizer(options = {}) {
  const ground = new Set(options.acGroundIds || options.referenceIds || []);
  const aliases = options.nodeAliases instanceof Map ? options.nodeAliases : new Map(Object.entries(options.nodeAliases || {}));
  return (node) => {
    if (!node || node === AC_GROUND || ground.has(node)) return node === AC_GROUND || ground.has(node) ? AC_GROUND : null;
    return aliases.get(node) || node;
  };
}

function rootsFrom(value, canonicalNode) {
  const values = value instanceof Set || Array.isArray(value) ? [...value] : [value];
  return [...new Set(values.map((root) => canonicalNode(asNode(root))).filter((root) => root && root !== AC_GROUND))];
}

/**
 * Split a coupled primitive set at `node`, treating it (like ground) as a
 * non-traversable boundary. Each returned component is a maximal set of
 * primitives whose non-ground, non-`node` nodes are mutually reachable
 * without passing through `node`; a VCCS's control nodes count toward its
 * reach exactly as they do for the relevance walk above, so a primitive
 * that couples two would-be components (directly, or through a control
 * terminal) forces them into one component instead of a false split.
 * Returns `null` when `node` is not an articulation point (fewer than two
 * components result), so the caller's single combined solve remains the
 * only correct option. `shunts` lists primitives touching only `node` and
 * ground (a direct node-to-ground branch, no other real node); callers
 * that cannot fold those in separately should treat their presence as a
 * reason not to split.
 */
export function splitAtNode(primitives = [], node, options = {}) {
  const canonicalNode = canonicalizer(options);
  const target = canonicalNode(asNode(node));
  if (!target || target === AC_GROUND) return null;

  const parent = new Map();
  const find = (value) => {
    if (!parent.has(value)) parent.set(value, value);
    let root = value;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(value, root);
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  const entries = primitives.map((primitive, index) => {
    if (!connects(primitive)) return { index, realNodes: [], touchesTarget: false };
    const nodes = primitive.kind === 'vccs'
      ? controlledNodes(primitive, canonicalNode)
      : primitiveNodes(primitive, canonicalNode);
    const touchesTarget = nodes.includes(target);
    const realNodes = nodes.filter((candidate) => candidate !== target);
    return { index, realNodes, touchesTarget };
  });

  for (const { realNodes } of entries) {
    for (let i = 1; i < realNodes.length; i++) union(realNodes[0], realNodes[i]);
  }

  const groups = new Map();
  const shunts = [];
  for (const entry of entries) {
    if (entry.realNodes.length === 0) {
      if (entry.touchesTarget) shunts.push(entry.index);
      continue;
    }
    const root = find(entry.realNodes[0]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(entry.index);
  }

  if (groups.size + (options.includeShunts ? shunts.length : 0) < 2) return null;
  return {
    target,
    components: [...groups.entries()].map(([root, primitiveIndices]) => ({ root, primitiveIndices })),
    shunts,
    componentOf(rawNode) {
      const canonical = canonicalNode(asNode(rawNode));
      if (!canonical || canonical === AC_GROUND || canonical === target) return null;
      return find(canonical);
    },
  };
}

/**
 * Return the primitive subgraph coupled to the supplied analysis ports.
 * Ground is a terminal boundary, never a traversable bridge between islands.
 */
export function coupledSubgraph(primitives = [], roots = [], options = {}) {
  const canonicalNode = canonicalizer(options);
  const normalizedPrimitives = primitives.map((primitive, index) => ({
    ...primitive,
    index,
    nodes: primitiveNodes(primitive, canonicalNode),
  }));
  const adjacency = new Map();
  const connectNodes = (nodes, primitiveIndex) => {
    for (const node of nodes) {
      if (node === AC_GROUND) continue;
      if (!adjacency.has(node)) adjacency.set(node, []);
      adjacency.get(node).push(primitiveIndex);
    }
  };
  normalizedPrimitives.forEach((primitive) => {
    if (!connects(primitive)) return;
    const nodes = primitive.kind === 'vccs'
      ? controlledNodes(primitive, canonicalNode)
      : primitive.nodes;
    connectNodes(nodes, primitive.index);
  });

  const rootNodes = rootsFrom(roots, canonicalNode);
  const visited = new Set(rootNodes);
  const included = new Set();
  const queue = [...rootNodes];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const primitiveIndex of adjacency.get(node) || []) {
      included.add(primitiveIndex);
      for (const next of normalizedPrimitives[primitiveIndex].nodes) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }

  const selectedEntries = normalizedPrimitives
    .filter(({ index }) => included.has(index))
    .map((primitive) => ({ ...primitive }));
  const selected = selectedEntries.map(({ index, nodes, ...primitive }) => primitive);
  const nodeOrder = [];
  const nodeSet = new Set();
  for (const root of rootNodes) {
    addNode(nodeSet, root);
    if (!nodeOrder.includes(root)) nodeOrder.push(root);
  }
  for (const primitive of selectedEntries) {
    for (const node of primitive.nodes) {
      addNode(nodeSet, node);
      if (!nodeOrder.includes(node)) nodeOrder.push(node);
    }
  }
  return {
    roots: rootNodes,
    nodes: nodeSet,
    nodeOrder,
    primitives: selected,
    primitiveIndices: selectedEntries.map(({ index }) => index),
    diagnostics: rootNodes.length ? [] : [{ code: 'missing-roots', message: 'at least one non-ground analysis root is required' }],
  };
}
