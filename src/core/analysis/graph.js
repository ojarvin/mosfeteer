import { AC_GROUND } from './context.js';

const PASSIVE_KINDS = new Set([
  'resistor', 'capacitor', 'inductor', 'conductance',
]);
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

function connects(primitive) {
  if (primitive.couples === false) return false;
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
