/** Versioned, topology-only input and compiler boundary for generated circuits. */
import { getSymbol } from './components/index.js';
import { Circuit } from './model.js';
import { checkSemantics } from './semantic.js';

export const CIRCUIT_SPEC_VERSION = 1;
export const HARD_CONSTRAINTS = Object.freeze([
  'terminal ownership must be valid and unambiguous',
  'required topology must be satisfiable',
  'component and net identifiers must be unique',
]);
export const SOFT_CONSTRAINTS = Object.freeze([
  'prefer compact placement',
  'prefer readable signal flow',
  'prefer balanced symmetry',
]);
export const CANDIDATE_SCORE_FIELDS = Object.freeze([
  'hardViolations', 'topologyViolations', 'wireCrossings',
  'componentClearance', 'labelClearance', 'pinConformity', 'turns', 'length',
]);

/** Names with a small, deterministic expansion. Explicit topology may still
 * be supplied for a known motif, which keeps templates additive. */
export const SUPPORTED_TEMPLATES = Object.freeze([
  '5t-ota', 'common-source', 'current-mirror', 'differential-pair', 'rc-filter', 'resistor-divider',
]);

export class CircuitSpecError extends Error {
  constructor(message, code = 'invalid-spec', path = null) {
    super(`invalid CircuitSpec: ${message}`);
    this.name = 'CircuitSpecError';
    this.code = code;
    this.path = path;
  }
}

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const id = (value, what) => {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
    throw new CircuitSpecError(`${what} must be a non-empty identifier`);
  }
  return value;
};
const terminal = (value, what = 'terminal') => {
  if (typeof value === 'string') {
    const split = value.lastIndexOf('.');
    if (split > 0 && split < value.length - 1) value = { component: value.slice(0, split), terminal: value.slice(split + 1) };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CircuitSpecError(`${what} must be a terminal reference`);
  return { component: id(value.component, `${what} component`), terminal: id(value.terminal, `${what} name`) };
};
const sorted = (items, key) => items.sort((a, b) => compare(key(a), key(b)));

const template = (components, nets) => ({ version: 1, components, nets });
const TEMPLATES = {
  'resistor-divider': template(
    [{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }],
    [{ id: 'vin', name: 'VIN', terminals: [['R1', 'a']] }, { id: 'vout', name: 'VOUT', terminals: [['R1', 'b'], ['R2', 'a']] }, { id: 'gnd', name: 'GND', terminals: [['R2', 'b']] }]),
  'rc-filter': template(
    [{ id: 'R1', type: 'resistor' }, { id: 'C1', type: 'capacitor' }],
    [{ id: 'vin', name: 'VIN', terminals: [['R1', 'a']] }, { id: 'vout', name: 'VOUT', terminals: [['R1', 'b'], ['C1', 'a']] }, { id: 'gnd', name: 'GND', terminals: [['C1', 'b']] }]),
  'common-source': template(
    [{ id: 'M1', type: 'nmos' }],
    [{ id: 'gate', name: 'VIN', terminals: [['M1', 'g']] }, { id: 'drain', name: 'VOUT', terminals: [['M1', 'd']] }, { id: 'source', name: 'GND', terminals: [['M1', 's']] }]),
  'differential-pair': template(
    [{ id: 'M1', type: 'nmos' }, { id: 'M2', type: 'nmos' }],
    [{ id: 'inp', terminals: [['M1', 'g']] }, { id: 'inn', terminals: [['M2', 'g']] }, { id: 'outp', terminals: [['M1', 'd']] }, { id: 'outn', terminals: [['M2', 'd']] }, { id: 'tail', terminals: [['M1', 's'], ['M2', 's']] }]),
  'current-mirror': template(
    [{ id: 'M1', type: 'nmos' }, { id: 'M2', type: 'nmos' }],
    [{ id: 'gate', terminals: [['M1', 'g'], ['M2', 'g'], ['M1', 'd']] }, { id: 'out', terminals: [['M2', 'd']] }, { id: 'common', name: 'GND', terminals: [['M1', 's'], ['M2', 's']] }]),
  '5t-ota': template(
    [{ id: 'M1', type: 'nmos' }, { id: 'M2', type: 'nmos' }, { id: 'M3', type: 'pmos' }, { id: 'M4', type: 'pmos' }, { id: 'M5', type: 'nmos' }],
    [{ id: 'inp', terminals: [['M1', 'g']] }, { id: 'inn', terminals: [['M2', 'g']] }, { id: 'tail', terminals: [['M1', 's'], ['M2', 's'], ['M5', 'd']] }, { id: 'out', terminals: [['M2', 'd'], ['M4', 'd']] }, { id: 'bias', terminals: [['M3', 'g'], ['M4', 'g'], ['M3', 'd']] }, { id: 'vdd', name: 'VDD', terminals: [['M3', 's'], ['M4', 's']] }, { id: 'gnd', name: 'GND', terminals: [['M5', 's']] }] ),
};

function templateValue(motif, input) {
  const base = TEMPLATES[motif];
  if (!base) throw new CircuitSpecError(`unsupported template "${motif}"`);
  const values = input.values || input.parameters?.values;
  if (values !== undefined && (!values || typeof values !== 'object' || Array.isArray(values))) {
    throw new CircuitSpecError('template values must be an object');
  }
  const components = base.components.map((component) => ({
    ...component,
    ...(values?.[component.id] === undefined ? {} : { value: String(values[component.id]) }),
  }));
  const nets = base.nets.map((net) => ({
    ...net,
    terminals: net.terminals.map(([component, name]) => ({ component, terminal: name })),
  }));
  return { version: 1, motif, components, nets };
}

/** Expand a known small template, or detach explicitly supplied topology. */
export function expandCircuitSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CircuitSpecError('spec must be an object');
  const motif = input.motif ?? input.template;
  if (typeof motif !== 'string' || (!SUPPORTED_TEMPLATES.includes(motif) && !(Array.isArray(input.components) && Array.isArray(input.nets)))) {
    throw new CircuitSpecError(`unsupported template "${motif ?? ''}"`);
  }
  if (input.template !== undefined && input.motif !== undefined && input.template !== input.motif) {
    throw new CircuitSpecError('motif and template must agree');
  }
  const hasComponents = input.components !== undefined;
  const hasNets = input.nets !== undefined;
  if (hasComponents !== hasNets) throw new CircuitSpecError('components and nets must be supplied together');
  const expanded = hasComponents
    ? { ...input, motif, template: undefined }
    : { ...templateValue(motif, input), ...input, motif, template: undefined };
  delete expanded.template;
  delete expanded.values;
  if (expanded.parameters?.values !== undefined) {
    const parameters = { ...expanded.parameters };
    delete parameters.values;
    expanded.parameters = parameters;
  }
  return expanded;
}

function detachedConstraint(value) {
  if (Array.isArray(value)) return value.map(detachedConstraint);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, detachedConstraint(value[key])]));
  return value;
}

function normalizeSemantics(input) {
  if (input === undefined || input === null) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CircuitSpecError('semantics must be an object');
  return detachedConstraint(input);
}

function normalizeConstraints(input) {
  if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) {
    throw new CircuitSpecError('constraints must be an object');
  }
  const out = {};
  for (const field of ['hard', 'soft']) {
    if (input?.[field] !== undefined && !Array.isArray(input[field])) throw new CircuitSpecError(`constraints.${field} must be an array`);
    out[field] = [...(input?.[field] || [])].map((value) => {
      if (typeof value !== 'string' || !value.trim()) throw new CircuitSpecError(`constraints.${field} entries must be non-empty strings`);
      return value.trim();
    }).sort(compare);
  }
  if (input?.flow !== undefined) {
    if (typeof input.flow !== 'string' || !input.flow.trim()) throw new CircuitSpecError('constraints.flow must be a non-empty string');
    out.flow = input.flow.trim();
  }
  for (const field of ['groups', 'rows', 'columns']) {
    if (input?.[field] === undefined) continue;
    if (!Array.isArray(input[field])) throw new CircuitSpecError(`constraints.${field} must be an array`);
    out[field] = input[field].map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CircuitSpecError(`constraints.${field} entries must be objects`);
      const item = detachedConstraint(value);
      if (item.members !== undefined) {
        if (!Array.isArray(item.members) || item.members.some((member) => typeof member !== 'string')) throw new CircuitSpecError(`constraints.${field} members must be strings`);
        item.members.sort(compare);
      }
      return item;
    }).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  }
  if (input?.spacing !== undefined) {
    if (!input.spacing || typeof input.spacing !== 'object' || Array.isArray(input.spacing)) throw new CircuitSpecError('constraints.spacing must be an object');
    out.spacing = detachedConstraint(input.spacing);
    if (out.spacing.minCells !== undefined && (!Number.isInteger(out.spacing.minCells) || out.spacing.minCells < 0)) throw new CircuitSpecError('constraints.spacing.minCells must be a non-negative integer');
  }
  if (input?.corridors !== undefined) {
    if (!Array.isArray(input.corridors)) throw new CircuitSpecError('constraints.corridors must be an array');
    out.corridors = input.corridors.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CircuitSpecError('constraints.corridors entries must be objects');
      return detachedConstraint(value);
    }).sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  }
  return out;
}

/** Validate and return a deterministic, detached CircuitSpec. */
export function normalizeCircuitSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CircuitSpecError('spec must be an object');
  if (input.version !== CIRCUIT_SPEC_VERSION) throw new CircuitSpecError(`version must be ${CIRCUIT_SPEC_VERSION}`);
  if (typeof input.motif !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(input.motif)) throw new CircuitSpecError('motif must be a non-empty identifier');
  if (!Array.isArray(input.components)) throw new CircuitSpecError('components must be an array');
  if (!Array.isArray(input.nets)) throw new CircuitSpecError('nets must be an array');

  const components = input.components.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CircuitSpecError('component must be an object');
    const componentId = id(value.id, 'component id');
    if (typeof value.type !== 'string') throw new CircuitSpecError(`component ${componentId} type is required`);
    try { getSymbol(value.type); } catch { throw new CircuitSpecError(`component ${componentId} has unknown type "${value.type}"`); }
    const refdes = value.refdes === undefined ? undefined : id(value.refdes, `component ${componentId} refdes`);
    const metadata = {};
    for (const field of ['role', 'group', 'template']) {
      if (value[field] !== undefined) {
        if (typeof value[field] !== 'string' || !value[field].trim()) throw new CircuitSpecError(`component ${componentId} ${field} must be a non-empty string`);
        metadata[field] = value[field].trim();
      }
    }
    return { id: componentId, ...(refdes === undefined ? {} : { refdes }), type: value.type, ...(value.value === undefined ? {} : { value: String(value.value) }), ...metadata };
  });
  const componentIds = new Set();
  const refdes = new Set();
  for (const component of components) {
    if (componentIds.has(component.id)) throw new CircuitSpecError(`duplicate component id "${component.id}"`);
    componentIds.add(component.id);
    const name = component.refdes || component.id;
    if (refdes.has(name)) throw new CircuitSpecError(`duplicate refdes "${name}"`);
    refdes.add(name);
  }
  const componentById = new Map(components.map((component) => [component.id, component]));
  const owned = new Set();
  const nets = input.nets.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CircuitSpecError('net must be an object');
    const netId = id(value.id, 'net id');
    if (!Array.isArray(value.terminals) || value.terminals.length === 0) throw new CircuitSpecError(`net ${netId} terminals must be a non-empty array`);
    const terminals = value.terminals.map((item) => {
      const point = terminal(item, `net ${netId} terminal`);
      if (!componentIds.has(point.component)) throw new CircuitSpecError(`net ${netId} owns terminal ${point.component}.${point.terminal}, but component does not exist`);
      const symbol = getSymbol(componentById.get(point.component).type);
      if (!symbol.terminals.some((item) => item.name === point.terminal)) throw new CircuitSpecError(`net ${netId} owns unknown terminal ${point.component}.${point.terminal}`);
      const key = `${point.component}.${point.terminal}`;
      if (owned.has(key)) throw new CircuitSpecError(`terminal ${key} is owned by more than one net`);
      owned.add(key);
      return point;
    });
    sorted(terminals, (point) => `${point.component}.${point.terminal}`);
    if (value.name !== undefined && typeof value.name !== 'string') throw new CircuitSpecError(`net ${netId} name must be a string`);
    const metadata = {};
    if (value.kind !== undefined) {
      if (typeof value.kind !== 'string' || !value.kind.trim()) throw new CircuitSpecError(`net ${netId} kind must be a non-empty string`);
      metadata.kind = value.kind.trim();
    }
    if (value.logicalGroup !== undefined) {
      metadata.logicalGroup = id(value.logicalGroup, `net ${netId} logicalGroup`);
    }
    return { id: netId, ...(value.name === undefined ? {} : { name: value.name.trim() }), ...metadata, terminals };
  });
  const netIds = new Set();
  for (const net of nets) if (!netIds.add(net.id)) throw new CircuitSpecError(`duplicate net id "${net.id}"`);

  if (input.openTerminals !== undefined && !Array.isArray(input.openTerminals)) throw new CircuitSpecError('openTerminals must be an array');
  const openTerminals = (input.openTerminals || []).map((item) => terminal(item, 'open terminal'));
  const open = new Set();
  for (const point of openTerminals) {
    const key = `${point.component}.${point.terminal}`;
    if (!componentIds.has(point.component) || !getSymbol(componentById.get(point.component).type).terminals.some((item) => item.name === point.terminal)) {
      throw new CircuitSpecError(`open terminal ${key} does not exist`);
    }
    if (owned.has(key)) throw new CircuitSpecError(`open terminal ${key} is already owned by a net`);
    if (open.has(key)) throw new CircuitSpecError(`duplicate open terminal ${key}`);
    open.add(key);
  }
  sorted(openTerminals, (point) => `${point.component}.${point.terminal}`);

  if (input.ports !== undefined && !Array.isArray(input.ports)) throw new CircuitSpecError('ports must be an array');
  const ports = (input.ports || []).map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CircuitSpecError('port must be an object');
    const portId = id(value.id ?? value.name, 'port id');
    const netId = value.netId ?? value.net;
    if (typeof netId !== 'string' || !netIds.has(netId)) throw new CircuitSpecError(`port ${portId} references unknown net "${netId ?? ''}"`);
    const type = value.type ?? value.direction;
    if (type !== undefined && !['input', 'output', 'inputoutput', 'inout'].includes(String(type))) throw new CircuitSpecError(`port ${portId} has unknown type "${type}"`);
    return { id: portId, ...(type === undefined ? {} : { type: String(type) === 'inout' ? 'inputoutput' : String(type) }), net: netId };
  });
  const portIds = new Set();
  for (const port of ports) if (!portIds.add(port.id)) throw new CircuitSpecError(`duplicate port id "${port.id}"`);
  sorted(ports, (port) => port.id);

  const constraints = normalizeConstraints(input.constraints);
  const semantics = normalizeSemantics(input.semantics ?? input.semantic ?? input.constraints?.semantic);
  const hard = new Set(constraints.hard);
  if ((hard.has('no-open-terminals') || hard.has('require-all-terminals-connected')) && openTerminals.length) {
    throw new CircuitSpecError('hard constraints forbid explicit open terminals');
  }
  if (hard.has('ports-required') && ports.length === 0) throw new CircuitSpecError('hard constraint ports-required cannot be satisfied');
  return {
    version: 1,
    motif: input.motif,
    components: sorted(components, (component) => component.id),
    nets: sorted(nets, (net) => net.id),
    ...(openTerminals.length ? { openTerminals } : {}),
    ...(ports.length ? { ports } : {}),
    ...(semantics === undefined ? {} : { semantics }),
    constraints,
  };
}

export const validateCircuitSpec = normalizeCircuitSpec;
export { checkSemantics };
export const evaluateSemantics = checkSemantics;
export const semanticChecks = checkSemantics;

function topologyState(spec) {
  const refdes = new Map(spec.components.map((component) => [component.id, component.refdes || component.id]));
  return {
    version: 2,
    grid: 40,
    components: spec.components.map((component) => ({
      refdes: refdes.get(component.id),
      type: component.type,
      value: component.value || '',
      transform: { x: 0, y: 0, rotation: 0, mirrorX: false, mirrorY: false },
      style: { color: '#111', lineStyle: 'solid', width: 'normal' },
    })),
    nets: spec.nets.map((net) => ({
      id: net.id,
      name: net.name || '',
      terminals: net.terminals.map((point) => ({ comp: refdes.get(point.component), term: point.terminal })),
      routingMode: 'managed', allowDiagonal: false, route: null, branches: null, junctions: [],
    })),
    labels: [],
  };
}

/**
 * Compile topology only. The temporary Circuit is deliberately built through
 * the model's public deserializer; no caller-owned Circuit is ever changed,
 * and no generated path or placement is produced.
 */
export function generateCircuit(input, maybeCircuit) {
  const specInput = input instanceof Circuit ? maybeCircuit : input;
  const expanded = expandCircuitSpec(specInput);
  const spec = normalizeCircuitSpec(expanded);
  const topology = topologyState(spec);
  let circuit;
  try { circuit = Circuit.fromJSON(topology); } catch (error) { throw new CircuitSpecError(error.message); }
  const report = {
    ok: true,
    version: spec.version,
    motif: spec.motif,
    componentCount: spec.components.length,
    netCount: spec.nets.length,
    openTerminalCount: spec.openTerminals?.length || 0,
    portCount: spec.ports?.length || 0,
    errors: [],
    semantic: checkSemantics(spec),
  };
  return { ok: true, success: true, report, semantic: report.semantic, spec, topology: spec, circuit };
}

/** Non-throwing adapter for callers that want a structured failure report. */
export function tryGenerateCircuit(input, maybeCircuit) {
  try { return generateCircuit(input, maybeCircuit); }
  catch (error) { return { ok: false, success: false, report: { ok: false, errors: [error.message] }, error }; }
}

export const compileCircuitSpec = generateCircuit;

/** Canonical candidate score. */
export function candidateScore(candidate = {}) {
  return CANDIDATE_SCORE_FIELDS.map((field) => Number.isFinite(candidate[field]) ? candidate[field] : 0);
}
