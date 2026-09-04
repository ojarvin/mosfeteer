/** Phase 0 CircuitSpec contract. This is deliberately a pure boundary: later
 * generators may consume the normalized value, while the editor continues to
 * use Circuit directly. */
import { getSymbol } from './components/index.js';

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

// Scores compare lexicographically: lower is better. Keep this list stable;
// later phases may add fields only at the end.
export const CANDIDATE_SCORE_FIELDS = Object.freeze([
  'hardViolations', 'topologyViolations', 'wireCrossings',
  'componentClearance', 'labelClearance', 'pinConformity', 'turns', 'length',
]);

export class CircuitSpecError extends Error {
  constructor(message) {
    super(`invalid CircuitSpec: ${message}`);
    this.name = 'CircuitSpecError';
  }
}

const id = (value, what) => {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
    throw new CircuitSpecError(`${what} must be a non-empty identifier`);
  }
  return value;
};
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Validate and return a deterministic, detached CircuitSpec. No Circuit or
 * other mutable application state is touched by this function. */
export function normalizeCircuitSpec(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CircuitSpecError('spec must be an object');
  if (input.version !== CIRCUIT_SPEC_VERSION) throw new CircuitSpecError(`version must be ${CIRCUIT_SPEC_VERSION}`);
  if (typeof input.motif !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(input.motif)) throw new CircuitSpecError('motif must be a non-empty identifier');
  const motif = input.motif;
  if (!Array.isArray(input.components)) throw new CircuitSpecError('components must be an array');
  if (!Array.isArray(input.nets)) throw new CircuitSpecError('nets must be an array');

  const components = input.components.map((component) => {
    if (!component || typeof component !== 'object' || Array.isArray(component)) throw new CircuitSpecError('component must be an object');
    const componentId = id(component.id, 'component id');
    if (typeof component.type !== 'string') throw new CircuitSpecError(`component ${componentId} type is required`);
    try { getSymbol(component.type); } catch { throw new CircuitSpecError(`component ${componentId} has unknown type "${component.type}"`); }
    return { id: componentId, type: component.type, ...(component.value === undefined ? {} : { value: String(component.value) }) };
  });
  const componentIds = new Set();
  for (const component of components) if (!componentIds.add(component.id)) throw new CircuitSpecError(`duplicate component id "${component.id}"`);

  const owned = new Set();
  const nets = input.nets.map((net) => {
    if (!net || typeof net !== 'object' || Array.isArray(net)) throw new CircuitSpecError('net must be an object');
    const netId = id(net.id, 'net id');
    if (!Array.isArray(net.terminals) || net.terminals.length === 0) throw new CircuitSpecError(`net ${netId} terminals must be a non-empty array`);
    const terminals = net.terminals.map((terminal) => {
      const component = id(terminal?.component, 'terminal component');
      const name = id(terminal?.terminal, 'terminal name');
      if (!componentIds.has(component)) throw new CircuitSpecError(`net ${netId} owns terminal ${component}.${name}, but component does not exist`);
      const symbol = components.find((item) => item.id === component).type;
      if (!getSymbol(symbol).terminals.some((item) => item.name === name)) throw new CircuitSpecError(`net ${netId} owns unknown terminal ${component}.${name}`);
      const key = `${component}.${name}`;
      if (owned.has(key)) throw new CircuitSpecError(`terminal ${key} is owned by more than one net`);
      owned.add(key);
      return { component, terminal: name };
    }).sort((a, b) => compare(`${a.component}.${a.terminal}`, `${b.component}.${b.terminal}`));
    if (net.name !== undefined && typeof net.name !== 'string') {
      throw new CircuitSpecError(`net ${netId} name must be a string`);
    }
    return { id: netId, ...(net.name === undefined ? {} : { name: net.name.trim() }), terminals };
  });
  const netIds = new Set();
  for (const net of nets) if (!netIds.add(net.id)) throw new CircuitSpecError(`duplicate net id "${net.id}"`);
  const constraints = input.constraints;
  if (constraints !== undefined && constraints !== null &&
      (typeof constraints !== 'object' || Array.isArray(constraints))) {
    throw new CircuitSpecError('constraints must be an object');
  }
  for (const field of ['hard', 'soft']) {
    if (constraints?.[field] !== undefined && !Array.isArray(constraints[field])) {
      throw new CircuitSpecError(`constraints.${field} must be an array`);
    }
  }
  return {
    version: CIRCUIT_SPEC_VERSION,
    motif,
    components: components.sort((a, b) => compare(a.id, b.id)),
    nets: nets.sort((a, b) => compare(a.id, b.id)),
    constraints: {
      hard: [...(constraints?.hard || [])].map(String).sort(),
      soft: [...(constraints?.soft || [])].map(String).sort(),
    },
  };
}

export const validateCircuitSpec = normalizeCircuitSpec;

/** Canonical candidate score. Arrays are intentionally used for simple,
 * deterministic lexicographic comparison without a scoring policy object. */
export function candidateScore(candidate = {}) {
  return CANDIDATE_SCORE_FIELDS.map((field) => Number.isFinite(candidate[field]) ? candidate[field] : 0);
}
