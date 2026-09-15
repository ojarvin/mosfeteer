// Primitive contract: terminals.a -> terminals.b is the branch direction;
// VCCS control.a -> control.b is its voltage-control direction.
const PASSIVE_TYPES = new Map([
  ['resistor', 'resistor'],
  ['variable_resistor', 'resistor'],
  ['capacitor', 'capacitor'],
  ['variable_capacitor', 'capacitor'],
  ['inductor', 'inductor'],
  ['variable_inductor', 'inductor'],
]);

const MOS_TYPES = new Set(['nmos', 'pmos', 'nmosb', 'pmosb']);
const MOS_CURRENT_SOURCE_MODELS = new Set([
  'current-source',
  'current_source',
  'ideal-current-source',
  'open',
]);
const TRIODE_MODELS = new Set(['triode', 'rds', 'r-ds', 'resistor']);
const IGNORED_TYPES = new Set([
  'ground', 'supply', 'vcm', 'port', 'port_filled',
  'input', 'output', 'inputoutput', 'solder',
]);

function diagnostic(code, message, component = null, severity = 'error', migration = null) {
  return {
    code,
    severity,
    ...(component ? { component: component.refdes, type: component.type } : {}),
    message,
    ...(migration ? { migration } : {}),
  };
}

function asNode(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value !== 'object') return String(value);
  if (value.node !== undefined) return asNode(value.node);
  if (value.nodeId !== undefined) return asNode(value.nodeId);
  if (value.netId !== undefined) return asNode(value.netId);
  if (value.id !== undefined) return asNode(value.id);
  if (value.name !== undefined) return asNode(value.name);
  return null;
}

function lookupMap(map, key) {
  if (!map) return null;
  if (typeof map.get === 'function') return asNode(map.get(key));
  if (Object.hasOwn(map, key)) return asNode(map[key]);
  return null;
}

function terminalKey(refdes, terminal) {
  return `${refdes}.${terminal}`;
}

function terminalNet(circuit, component, terminal) {
  return circuit.netOfTerminal({ comp: component.refdes, term: terminal });
}

function contextTerminalNode(circuit, component, terminal, context) {
  const ref = { comp: component.refdes, term: terminal };
  const key = terminalKey(component.refdes, terminal);
  const resolver = context.nodeOfTerminal || context.resolveNode || context.nodeForTerminal;
  if (typeof resolver === 'function') {
    const resolved = resolver(ref, component);
    const node = asNode(resolved);
    if (node) return node;
  }
  for (const map of [context.terminalNodes, context.nodes, context.nodeByTerminal]) {
    const node = lookupMap(map, key) || lookupMap(map, ref);
    if (node) return node;
  }
  const net = terminalNet(circuit, component, terminal);
  if (!net) return null;
  return lookupMap(context.nodeAliases, net.id) || asNode(net.id);
}

function referenceNode(context, rail) {
  for (const map of [context.referenceNodes, context.referenceNets, context.rails]) {
    const node = lookupMap(map, rail);
    if (node) return node;
  }
  const references = context.references;
  if (references && typeof references === 'object' && !(references instanceof Set)) {
    const node = lookupMap(references, rail);
    if (node) return node;
  }
  if (context.acGroundNode !== undefined) return asNode(context.acGroundNode);
  if (context.groundNode !== undefined) return asNode(context.groundNode);
  return rail;
}

function nodeFor(circuit, component, terminal, context, { required = true } = {}) {
  const node = contextTerminalNode(circuit, component, terminal, context);
  if (!node && required) {
    return {
      node: null,
      error: diagnostic(
        'missing-terminal-node',
        `${component.refdes}.${terminal} has no resolved physical net`,
        component,
      ),
    };
  }
  return { node, error: null };
}

function modelOverride(component, context) {
  const fromContext = lookupDeviceRegion(context.deviceRegions, component.refdes);
  if (fromContext) return normalizeModel(modelName(fromContext));
  return normalizeModel(component.analysis?.model);
}

function modelName(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.region !== undefined) return value.region;
  if (value.model !== undefined) return value.model;
  return value.triode === true ? 'triode' : value.triode;
}

function lookupDeviceRegion(models, refdes) {
  if (!models) return null;
  if (typeof models.get === 'function') return models.get(refdes) ?? null;
  if (Object.hasOwn(models, refdes)) {
    return models[refdes];
  }
  return null;
}

function modelMetadata(component, context, model) {
  const region = lookupDeviceRegion(context.deviceRegions, component.refdes);
  return {
    model,
    ...(region && typeof region === 'object' ? { deviceRegion: { ...region } } : {}),
  };
}

function primitiveMetadata(component, context, model, extra = {}) {
  return {
    component: component.refdes,
    ...modelMetadata(component, context, model),
    ...extra,
  };
}

function normalizeModel(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim().toLowerCase().replace(/_/g, '-');
}

/** Convert legacy context options once at the device boundary. */
function normalizeDeviceContext(context = {}) {
  if (context.deviceRegions) return context;
  const legacy = context.modelOverrides || context.models || context.overrides;
  return legacy ? { ...context, deviceRegions: legacy } : context;
}

function parameterName(prefix, refdes) {
  const raw = String(refdes);
  if (['R', 'C', 'L'].includes(prefix) && raw.startsWith(prefix)) return raw;
  const suffix = raw.replace(/^M(?=[A-Za-z0-9_])/, '').replace(/[^A-Za-z0-9]/g, '_');
  return `${prefix}${suffix}`;
}

function twoTerminalPrimitive(component, kind, a, b) {
  const parameter = parameterName(kind === 'resistor' ? 'R' : kind === 'capacitor' ? 'C' : 'L', component.refdes);
  return {
    kind,
    id: `${component.refdes}.${kind}`,
    terminals: { a, b },
    value: parameter,
    metadata: { component: component.refdes },
  };
}

function sourcePrimitive(component, kind, positive, negative) {
  return {
    kind,
    id: `${component.refdes}.${kind}`,
    terminals: { a: positive, b: negative },
    value: 0,
    metadata: { component: component.refdes, dcValue: component.value },
  };
}

function mosOrientation(type) {
  const pmos = type.startsWith('pmos');
  return {
    channel: pmos ? 'p' : 'n',
    currentDirection: 'drain-to-source',
    polarity: 1,
    convention: 'i_ds = gm(v_g-v_s) + gmb(v_b-v_s) + (v_d-v_s)/ro',
  };
}

function mosPrimitives(component, nodes, model, metadata) {
  const names = {
    gm: parameterName('gm', component.refdes),
    gmb: parameterName('gmb', component.refdes),
    ro: parameterName('ro', component.refdes),
  };
  const orientation = mosOrientation(component.type);
  const explicitBulk = component.def.terminals.some((terminal) => terminal.name === 'b');
  const deviceMetadata = {
    ...metadata,
    device: 'mos',
    channel: orientation.channel,
    bulk: {
      node: nodes.b,
      implicit: !explicitBulk,
      ...(!explicitBulk ? { reference: orientation.channel === 'p' ? 'VDD' : 'VSS' } : {}),
    },
  };
  return [
    {
      kind: 'resistor',
      id: `${component.refdes}.ro`,
      terminals: { a: nodes.d, b: nodes.s },
      value: names.ro,
      metadata: deviceMetadata,
    },
    {
      kind: 'vccs',
      id: `${component.refdes}.gm`,
      terminals: { a: nodes.d, b: nodes.s },
      value: names.gm,
      control: { a: nodes.g, b: nodes.s },
      metadata: { ...deviceMetadata, controlExpression: `${names.gm}(v_g-v_s)` },
    },
    {
      kind: 'vccs',
      id: `${component.refdes}.gmb`,
      terminals: { a: nodes.d, b: nodes.s },
      value: names.gmb,
      control: { a: nodes.b, b: nodes.s },
      metadata: { ...deviceMetadata, controlExpression: `${names.gmb}(v_b-v_s)` },
    },
  ];
}

function triodePrimitive(component, nodes, metadata) {
  const parameter = parameterName('rds', component.refdes);
  return {
    kind: 'resistor',
    id: `${component.refdes}.rds`,
    terminals: { a: nodes.d, b: nodes.s },
    value: parameter,
    metadata: { ...metadata, device: 'mos', model: 'triode' },
  };
}

function convertMos(circuit, component, context) {
  const diagnostics = [];
  const override = lookupDeviceRegion(context.deviceRegions, component.refdes);
  const model = modelOverride(component, context);
  if (MOS_CURRENT_SOURCE_MODELS.has(model)) {
    diagnostics.push(diagnostic(
      'legacy-mos-current-source',
      `${component.refdes} uses the removed MOS current-source override`,
      component,
      'error',
      'Remove the override. Use the exact MOS model; a zero-controlled device naturally contributes no gm/gmb current, while r_o -> infinity is the channel-length-modulation approximation.',
    ));
    return { primitives: [], diagnostics, nodes: [] };
  }
  if (model && !TRIODE_MODELS.has(model) && !['ro', 'r-o', 'output-resistance', 'small-signal'].includes(model)) {
    diagnostics.push(diagnostic(`unknown-mos-model`, `unknown MOS small-signal model override "${model}"`, component));
    return { primitives: [], diagnostics, nodes: [] };
  }

  const nodeResults = ['d', 's', 'g'].map((terminal) => [terminal, nodeFor(circuit, component, terminal, context)]);
  const nodes = Object.fromEntries(nodeResults.map(([terminal, result]) => [terminal, result.node]));
  diagnostics.push(...nodeResults.map(([, result]) => result.error).filter(Boolean));
  const hasBulk = component.def.terminals.some((terminal) => terminal.name === 'b');
  if (hasBulk) {
    const bulk = nodeFor(circuit, component, 'b', context);
    nodes.b = bulk.node;
    if (bulk.error) diagnostics.push(bulk.error);
  } else {
    const rail = component.type.startsWith('pmos') ? 'VDD' : 'VSS';
    nodes.b = referenceNode(context, rail);
  }
  if (diagnostics.length) return { primitives: [], diagnostics, nodes: Object.values(nodes).filter(Boolean) };
  const metadata = primitiveMetadata(component, context, model, override && typeof override === 'object'
    ? { deviceRegion: { ...override } }
    : {});
  if (model && TRIODE_MODELS.has(model)) {
    return { primitives: [triodePrimitive(component, nodes, metadata)], diagnostics, nodes: Object.values(nodes) };
  }
  return { primitives: mosPrimitives(component, nodes, 'saturation', metadata), diagnostics, nodes: Object.values(nodes) };
}

function convertOneComponent(circuit, component, context) {
  if (IGNORED_TYPES.has(component.type)) return { primitives: [], diagnostics: [], nodes: [] };
  if (MOS_TYPES.has(component.type)) return convertMos(circuit, component, context);
  if (component.type === 'voltage_source' || component.type === 'current_source') {
    const terminals = ['a', 'b'].map((terminal) => [terminal, nodeFor(circuit, component, terminal, context)]);
    const diagnostics = terminals.map(([, result]) => result.error).filter(Boolean);
    if (diagnostics.length) return { primitives: [], diagnostics, nodes: terminals.map(([, result]) => result.node).filter(Boolean) };
    const nodes = Object.fromEntries(terminals.map(([terminal, result]) => [terminal, result.node]));
    return {
      primitives: [sourcePrimitive(component, component.type === 'voltage_source' ? 'voltage-source' : 'current-source', nodes.a, nodes.b)],
      diagnostics: [],
      nodes: [nodes.a, nodes.b],
    };
  }
  const kind = PASSIVE_TYPES.get(component.type);
  if (kind) {
    const terminals = ['a', 'b'].map((terminal) => [terminal, nodeFor(circuit, component, terminal, context)]);
    const diagnostics = terminals.map(([, result]) => result.error).filter(Boolean);
    if (diagnostics.length) return { primitives: [], diagnostics, nodes: terminals.map(([, result]) => result.node).filter(Boolean) };
    const nodes = Object.fromEntries(terminals.map(([terminal, result]) => [terminal, result.node]));
    // "Treat as R = infinity" (model.js `setComponentAnalysis`, a per-component
    // small-signal attribute, mirroring the MOS triode `analysis.model`
    // override) removes the branch entirely — an open circuit is exactly "no
    // primitive here", not a primitive carrying an infinite value.
    if (kind === 'resistor' && component.analysis?.resistance === 'infinite') {
      return { primitives: [], diagnostics: [], nodes: [nodes.a, nodes.b] };
    }
    return { primitives: [twoTerminalPrimitive(component, kind, nodes.a, nodes.b)], diagnostics: [], nodes: [nodes.a, nodes.b] };
  }
  const terminals = component.def?.terminals
    ?.map((terminal) => nodeFor(circuit, component, terminal.name, context, { required: false }).node)
    .filter(Boolean) || [];
  if (terminals.length) {
    return {
      primitives: [],
      diagnostics: [diagnostic('unsupported-component', `${component.type} has no exact small-signal primitive conversion`, component, 'warning')],
      nodes: terminals,
    };
  }
  return { primitives: [], diagnostics: [], nodes: [] };
}

/** Convert one circuit component into flat, exact MNA-ready primitive descriptors. */
export function componentToPrimitives(circuit, component, context = {}) {
  if (!circuit || !component) throw new TypeError('component conversion requires a Circuit and component');
  return convertOneComponent(circuit, component, normalizeDeviceContext(context || {}));
}

/** Convert every supported electrical component in a Circuit. */
export function convertCircuitToPrimitives(circuit, context = {}) {
  if (!circuit?.components?.values) throw new TypeError('primitive conversion requires a Circuit');
  context = normalizeDeviceContext(context || {});
  const primitives = [];
  const diagnostics = [];
  const nodes = new Set();
  for (const component of circuit.components.values()) {
    const converted = convertOneComponent(circuit, component, context);
    primitives.push(...converted.primitives);
    diagnostics.push(...converted.diagnostics);
    converted.nodes.forEach((node) => nodes.add(node));
  }
  return {
    ok: !diagnostics.some((entry) => entry.severity === 'error'),
    primitives,
    diagnostics,
    nodes: [...nodes].sort(),
  };
}
