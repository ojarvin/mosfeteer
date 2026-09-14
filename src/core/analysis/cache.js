const OWN = Object.prototype.hasOwnProperty;
const DEFAULT_LIMIT = 8;
const MAX_KEY_NODES = 10000;
const MAX_ARTIFACT_NODES = 10000;

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function stableValue(value, seen = new Set(), allowFunctions = false, state = { nodes: 0 }) {
  if (++state.nodes > MAX_KEY_NODES) throw new RangeError('analysis cache key is too large');
  if (typeof value === 'function') {
    if (!allowFunctions) throw new TypeError('analysis cache custom functions require an explicit fingerprint');
    return 'function';
  }
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && Number.isNaN(value)) return 'number:NaN';
    if (typeof value === 'number' && !Number.isFinite(value)) return 'number:' + String(value);
    if (typeof value === 'bigint') return 'bigint:' + String(value) + 'n';
    if (typeof value === 'symbol') return 'symbol:' + String(value);
    return typeof value + ':' + String(value);
  }
  if (seen.has(value)) throw new TypeError('analysis cache key must not contain cycles');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = '[' + value.map((item) => stableValue(item, seen, allowFunctions, state)).join(',') + ']';
  } else if (value instanceof Set) {
    result = 'set{' + [...value].map((item) => stableValue(item, seen, allowFunctions, state)).sort().join(',') + '}';
  } else if (value instanceof Map) {
    result = 'map{' + [...value]
      .map(([key, item]) => stableValue(key, seen, allowFunctions, state) + '=>' + stableValue(item, seen, allowFunctions, state))
      .sort()
      .join(',') + '}';
  } else {
    const keys = Object.keys(value).sort();
    result = '{' + keys.map((key) => stableValue(key, seen, allowFunctions, state) + ':' + stableValue(value[key], seen, allowFunctions, state)).join(',') + '}';
  }
  seen.delete(value);
  return result;
}

function values(value) {
  if (value === undefined || value === null || value === '') return [];
  if (value instanceof Set || Array.isArray(value)) return [...value];
  return [value];
}

function physicalPort(value, role) {
  const port = value && typeof value === 'object'
    ? firstDefined(value.physicalNetId, value.netId, value.physicalId, value.node, value.id, value.name)
    : value;
  if (port === undefined || port === null || port === '') {
    throw new TypeError('analysis cache ' + role + ' port is required');
  }
  return String(port);
}

function exactDeviceRegionOverrides(request) {
  const source = firstDefined(
    request.exactDeviceRegionOverrides,
    request.deviceRegionOverrides,
    request.deviceRegions,
    request.deviceModels,
    request.modelOverrides,
    request.models,
    request.deviceParameters,
    request.deviceParameterOverrides,
    request.devices,
    request.deviceOptions,
    request.deviceOverrides,
  );
  if (source === undefined || source === null) return [];
  const entries = source instanceof Map
    ? [...source.entries()]
    : Array.isArray(source)
      ? source.map((entry) => {
        if (Array.isArray(entry)) return entry;
        const match = String(entry).trim().match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
        return match ? [match[1], match[2]] : null;
      }).filter(Boolean)
    : typeof source === 'string'
      ? source.split(',').map((entry) => {
        const match = entry.trim().match(/^([^:=\s]+)\s*[:=]\s*(\S+)$/);
        return match ? [match[1], match[2]] : null;
      }).filter(Boolean)
      : Object.entries(source);
  return entries
    .map(([device, value]) => [String(device), value])
    .sort(([left], [right]) => left.localeCompare(right));
}

function revisionOf(circuit, request) {
  const revision = firstDefined(
    request.revision,
    request.committedRevision,
    request.revisionKey,
    request.revisionToken,
    request.revisionFingerprint,
    request.fallbackRevision,
    request.fallback,
    circuit.revision,
    circuit.committedRevision,
  );
  if (revision === undefined) {
    throw new TypeError('analysis cache requires a committed revision or deterministic revision fallback');
  }
  return revision;
}

const PRESENTATION_FIELDS = new Set([
  'assumptions',
  'approximation',
  'approximations',
  'dominantPole',
  'dominantPoleApproximation',
  'dominantPoleReduction',
  'applyDominantPoleApproximation',
  'miller',
  'millerApproximation',
  'applyMiller',
  'cascodeDominant',
  'cascodeDominantTermReduction',
  'applyCascodeReduction',
  'gmroLarge',
  'highIntrinsicGain',
  'intrinsicGainLarge',
  'ignoreBodyEffect',
  'gmb0',
  'ignoreGmb',
  'bodyEffectIgnored',
  'ignoreChannelLengthModulation',
  'roInfinity',
  'go0',
  'ignoreRo',
  'neglectChannelLengthModulation',
]);

const CANONICAL_FIELDS = new Set([
  'ports',
  'inputPort', 'input', 'inputNode',
  'outputPort', 'output', 'outputNode',
  'acGrounds', 'acGround', 'reference', 'references',
  'revision', 'committedRevision', 'revisionKey', 'revisionToken', 'revisionFingerprint',
  'fallbackRevision', 'fallback',
  'exactDeviceRegionOverrides', 'deviceRegionOverrides', 'deviceRegions', 'deviceModels',
  'modelOverrides', 'models', 'deviceParameters', 'deviceParameterOverrides',
  'devices', 'deviceOptions', 'deviceOverrides',
  'values', 'parameters', 'params',
  's', 'sValue', 'frequency', 'variable',
  'valueOf', 'resolveValue', 'ops', 'algebra', 'algebraOps', 'operators',
  'exactFingerprint', 'cacheFingerprint', 'analysisFingerprint', 'fingerprint',
]);

function hasFunction(value, seen = new Set()) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'function') return true;
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (current instanceof Map) {
      for (const [key, item] of current) pending.push(key, item);
    } else if (current instanceof Set || Array.isArray(current)) {
      for (const item of current) pending.push(item);
    } else {
      for (const key of Object.keys(current)) pending.push(current[key]);
    }
  }
  return false;
}

function exactRequestFields(request) {
  const fields = {};
  for (const key of Object.keys(request)) {
    if (PRESENTATION_FIELDS.has(key) || CANONICAL_FIELDS.has(key)) continue;
    fields[key] = request[key];
  }
  fields.values = firstDefined(request.values, request.parameters, request.params);
  fields.frequency = firstDefined(request.s, request.sValue, request.frequency);
  fields.variable = request.variable || request.ops?.variable || 's';
  fields.exactDeviceRegionOverrides = exactDeviceRegionOverrides(request);
  for (const key of ['valueOf', 'resolveValue', 'ops', 'algebra', 'algebraOps', 'operators']) {
    if (OWN.call(request, key)) fields[key] = request[key];
  }
  return fields;
}

function exactFingerprint(request) {
  return firstDefined(
    request.exactFingerprint,
    request.cacheFingerprint,
    request.analysisFingerprint,
    request.fingerprint,
  );
}

/** Build a stable key for an exact artifact; presentation assumptions are excluded. */
export function exactAnalysisKey(circuit, request = {}) {
  if (!circuit || (typeof circuit !== 'object' && typeof circuit !== 'function')) {
    throw new TypeError('analysis cache circuit must be an object');
  }
  if (!request || typeof request !== 'object') throw new TypeError('analysis cache request must be an object');
  const ports = request.ports || {};
  const input = firstDefined(request.inputPort, request.input, request.inputNode, ports.input, ports.inputPort);
  const output = firstDefined(request.outputPort, request.output, request.outputNode, ports.output, ports.outputPort);
  const grounds = firstDefined(request.acGrounds, request.acGround, request.reference, request.references);
  const acGrounds = [...new Set(values(grounds).map((value) => physicalPort(value, 'AC-ground')))].sort();
  const exact = exactRequestFields(request);
  const customFingerprint = exactFingerprint(request);
  const customFunctions = hasFunction(exact);
  if (customFunctions && customFingerprint === undefined) {
    throw new TypeError('analysis cache custom functions require an explicit fingerprint');
  }
  const key = {
    circuit,
    revision: stableValue(revisionOf(circuit, request)),
    input: physicalPort(input, 'input'),
    output: physicalPort(output, 'output'),
    acGrounds: Object.freeze(acGrounds),
    exact,
    ...(customFingerprint !== undefined ? { customFingerprint: stableValue(customFingerprint) } : {}),
  };
  return Object.freeze(key);
}

function keyText(key) {
  const { circuit, ...parts } = key;
  return stableValue(parts, new Set(), key.customFingerprint !== undefined);
}

function isFailureMarker(key, value) {
  const normalized = String(value ?? '').toLowerCase();
  if ((key === 'budgetExceeded' || key === 'failed') && value === true) return true;
  if (key === 'ok' && value === false) return true;
  if ((key === 'error' || key === 'failure') && value !== undefined && value !== null && value !== false && value !== '') return true;
  return (key === 'code' || key === 'status') &&
    (normalized === 'error' || normalized === 'failed' || normalized === 'failure' ||
      /(?:budget|timeout|time[-_ ]?limit|operation[-_ ]?limit)/.test(normalized));
}

function successfulArtifact(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'function') return false;
  if (value instanceof Error) return false;
  if (typeof value !== 'object') return true;
  const pending = [{ value, exit: false }];
  const state = new WeakMap();
  let nodes = 0;
  try {
    while (pending.length) {
      const frame = pending.pop();
      const current = frame.value;
      if (current === null || typeof current !== 'object') continue;
      if (frame.exit) {
        state.set(current, 2);
        continue;
      }
      if (state.get(current) === 1) return false;
      if (state.get(current) === 2) continue;
      if (++nodes > MAX_ARTIFACT_NODES) return false;
      state.set(current, 1);
      if (current instanceof Error || typeof current.then === 'function') return false;
      pending.push({ value: current, exit: true });
      const entries = current instanceof Map
        ? [...current.entries()].flatMap(([key, child]) => {
          if (isFailureMarker(key, child)) return [['failure', true]];
          return [['<map-key>', key], ['<map-value>', child]];
        })
        : current instanceof Set
          ? [...current].map((child) => ['<set-value>', child])
          : Object.keys(current).map((key) => [key, current[key]]);
      for (const [key, child] of entries) {
        if (isFailureMarker(key, child)) return false;
        if (typeof child === 'function') return false;
        if (child && typeof child === 'object') pending.push({ value: child, exit: false });
      }
    }
  } catch {
    return false;
  }
  return true;
}

/** Create a bounded, per-circuit LRU for exact analysis artifacts. */
export function createAnalysisCache(options = {}) {
  const limit = options.maxEntriesPerCircuit ?? options.maxEntries ?? options.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('analysis cache limit must be a positive integer');

  let stores = new WeakMap();
  const totals = { hits: 0, misses: 0, sets: 0, evictions: 0, failures: 0 };

  function storeFor(circuit, create = false) {
    if (!circuit || (typeof circuit !== 'object' && typeof circuit !== 'function')) {
      throw new TypeError('analysis cache circuit must be an object');
    }
    let store = stores.get(circuit);
    if (!store && create) {
      store = new Map();
      stores.set(circuit, store);
    }
    return store;
  }

  function get(circuit, request) {
    const key = keyText(exactAnalysisKey(circuit, request));
    const store = storeFor(circuit);
    if (!store || !store.has(key)) {
      totals.misses++;
      return undefined;
    }
    const entry = store.get(key);
    if (!successfulArtifact(entry.value)) {
      store.delete(key);
      totals.failures++;
      return undefined;
    }
    store.delete(key);
    store.set(key, entry);
    totals.hits++;
    return entry.value;
  }

  function set(circuit, request, artifact) {
    if (!successfulArtifact(artifact)) {
      totals.failures++;
      return artifact;
    }
    const key = keyText(exactAnalysisKey(circuit, request));
    const store = storeFor(circuit, true);
    if (store.has(key)) store.delete(key);
    store.set(key, { value: artifact });
    totals.sets++;
    while (store.size > limit) {
      store.delete(store.keys().next().value);
      totals.evictions++;
    }
    return artifact;
  }

  function getOrCompute(circuit, request, compute) {
    if (typeof compute !== 'function') throw new TypeError('analysis cache compute callback is required');
    const cached = get(circuit, request);
    if (cached !== undefined) return cached;
    let artifact;
    try {
      artifact = compute();
    } catch (error) {
      totals.failures++;
      throw error;
    }
    if (!successfulArtifact(artifact)) {
      totals.failures++;
      return artifact;
    }
    return set(circuit, request, artifact);
  }

  function clear(circuit, request) {
    if (circuit === undefined) {
      stores = new WeakMap();
      return;
    }
    const store = storeFor(circuit);
    if (request !== undefined) {
      if (!store) return;
      store.delete(keyText(exactAnalysisKey(circuit, request)));
      if (!store.size) stores.delete(circuit);
      return;
    }
    store?.clear();
    stores.delete(circuit);
  }

  function stats(circuit) {
    const store = circuit === undefined ? null : storeFor(circuit);
    return Object.freeze({
      ...totals,
      entries: store ? store.size : 0,
    });
  }

  return Object.freeze({ get, set, getOrCompute, clear, stats });
}

export const createExactAnalysisCache = createAnalysisCache;
