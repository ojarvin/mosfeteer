/**
 * Generate conservative high-intrinsic-gain orders for exact primitives.
 *
 * Each selected finite-go MOS gets an independent scale coordinate.  go has
 * order -1, gm has order 0, and ro (when present) has order +1.  Thus go/gm
 * tends to zero without imposing any order on passive parameters.
 */

const OWN = Object.prototype.hasOwnProperty;
const MOS_KINDS = new Set(['mos', 'nmos', 'pmos', 'nmosb', 'pmosb']);
const ZERO_VALUES = new Set([0, 0n, '0', '0.0', 'zero', 'none', 'infinity', 'inf', '∞']);

function asEntries(value) {
  if (!value) return [];
  if (value instanceof Map) return [...value.entries()];
  if (Array.isArray(value)) return value.map((entry) => [entry, {}]);
  return Object.entries(value);
}

function firstOwn(record, names) {
  if (!record || typeof record !== 'object') return undefined;
  for (const name of names) if (OWN.call(record, name)) return record[name];
  return undefined;
}

function names(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(names);
  if (value instanceof Set) return [...value].flatMap(names);
  if (typeof value === 'string') return value.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  return [String(value)];
}

function idOf(value, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'object') return String(value);
  return String(firstOwn(value, ['component', 'device', 'refdes', 'id', 'name']) ?? fallback);
}

function parameter(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return parameter(firstOwn(value, ['parameter', 'symbol', 'name', 'value']), fallback);
  return String(value);
}

function isZeroLike(value) {
  if (typeof value === 'string') return ZERO_VALUES.has(value.trim().toLowerCase());
  return ZERO_VALUES.has(value);
}

function isFiniteGo(value) {
  if (value === undefined || value === null || value === '') return false;
  if (isZeroLike(value)) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'bigint') return value !== 0n;
  return !['infinity', '+infinity', '-infinity', 'inf', '+inf', '-inf', '∞'].includes(String(value).trim().toLowerCase());
}

function selectedSet(options) {
  return new Set(names(
    options.selectedDevices
      ?? options.highIntrinsicGainDevices
      ?? options.gmroLargeDevices
      ?? options.intrinsicGainDevices,
  ));
}

function settingSources(options) {
  return [options.devices, options.deviceOptions, options.deviceOverrides, options.parameters, options.deviceParameters]
    .filter(Boolean);
}

function settingFor(options, id) {
  for (const source of settingSources(options)) {
    const value = source instanceof Map ? source.get(id) : source[id];
    if (value && typeof value === 'object') return value;
  }
  return {};
}

function enabled(record, options, selected) {
  const local = firstOwn(record, ['highIntrinsicGain', 'gmroLarge', 'intrinsicGainLarge']);
  if (local !== undefined) return Boolean(local);
  if (selected.has(record.id)) return true;
  const global = firstOwn(options, ['highIntrinsicGain', 'gmroLarge', 'intrinsicGainLarge']);
  return global === undefined ? false : Boolean(global);
}

function roInfinity(record, options) {
  const local = firstOwn(record, ['roInfinity', 'go0', 'ignoreRo', 'ignoreChannelLengthModulation', 'neglectChannelLengthModulation']);
  if (local !== undefined) return Boolean(local);
  const global = firstOwn(options, ['roInfinity', 'go0', 'ignoreRo', 'ignoreChannelLengthModulation', 'neglectChannelLengthModulation']);
  return Boolean(global);
}

function primitiveParameter(primitive, kind) {
  const value = kind === 'gm'
    ? firstOwn(primitive, ['gmSymbol', 'gm', 'transconductance', 'parameter', 'value'])
    : firstOwn(primitive, ['goSymbol', 'go', 'conductance', 'parameter', 'value']);
  return parameter(value);
}

function primitiveKind(primitive) {
  return String(primitive?.device || primitive?.model || primitive?.type || '').toLowerCase();
}

function isMosPrimitive(primitive) {
  return primitiveKind(primitive) === 'mos' || MOS_KINDS.has(String(primitive?.type || '').toLowerCase());
}

function collectDevices(input, options) {
  const primitives = Array.isArray(input) ? input : input?.primitives || [];
  const records = new Map();
  const add = (id, patch) => {
    if (!id) return;
    const current = records.get(id) || { id, gm: null, go: null, ro: null, mos: false };
    records.set(id, { ...current, ...patch });
  };

  for (const [index, primitive] of primitives.entries()) {
    if (!primitive || typeof primitive !== 'object') continue;
    const id = idOf(primitive, `device-${index + 1}`);
    if (!isMosPrimitive(primitive) && !['vccs', 'conductance'].includes(String(primitive.kind || '').toLowerCase())) continue;
    const kind = String(primitive.kind || '').toLowerCase().replaceAll('-', '_');
    const patch = { mos: isMosPrimitive(primitive) || primitive.device === 'mos' };
    if (kind === 'vccs' && !records.get(id)?.gm) patch.gm = primitiveParameter(primitive, 'gm');
    if ((kind === 'conductance' || kind === 'resistor') && !records.get(id)?.go) patch.go = primitiveParameter(primitive, 'go');
    if (primitive.ro !== undefined || primitive.roSymbol !== undefined) patch.ro = parameter(primitive.ro ?? primitive.roSymbol);
    add(id, patch);
  }

  for (const entry of asEntries(options.devices || options.deviceParameters)) {
    const id = String(entry[0]);
    const value = entry[1];
    if (!value || typeof value !== 'object') continue;
    add(id, {
      gm: parameter(firstOwn(value, ['gmSymbol', 'gm']), records.get(id)?.gm),
      go: parameter(firstOwn(value, ['goSymbol', 'go']), records.get(id)?.go),
      ro: parameter(firstOwn(value, ['roSymbol', 'ro']), records.get(id)?.ro),
      mos: Boolean(records.get(id)?.mos || value.device === 'mos' || value.type === 'mos' || value.model === 'mos'),
    });
  }
  return [...records.values()]
    .map((record) => ({ ...record, ...settingFor(options, record.id) }))
    .filter((record) => record.mos)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function vector(length, index, value) {
  const result = Array(length).fill(0);
  if (index !== undefined) result[index] = value;
  return Object.freeze(result);
}

function freezeRecord(record) {
  return Object.freeze(record);
}

function compareVectors(left, right) {
  const a = left || [];
  const b = right || [];
  let less = false;
  let greater = false;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) < (b[index] || 0)) less = true;
    if ((a[index] || 0) > (b[index] || 0)) greater = true;
  }
  if (less && greater) return null;
  return greater ? 1 : less ? -1 : 0;
}

function lexicographicVectors(left, right) {
  const a = left || [];
  const b = right || [];
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (b[index] || 0) - (a[index] || 0);
  }
  return 0;
}

function addVectors(values, length) {
  const result = Array(length).fill(0);
  for (const value of values) for (let index = 0; index < length; index += 1) result[index] += value?.[index] || 0;
  return Object.freeze(result.map((entry) => entry === 0 ? 0 : entry));
}

function scaleVector(value, multiplier) {
  return value
    ? Object.freeze(value.map((entry) => {
      const scaled = entry * multiplier;
      return scaled === 0 ? 0 : scaled;
    }))
    : null;
}

function orderFromSymbol(value, metadata) {
  if (value?.kind !== 'symbol') return null;
  return metadata.parameterOrders.get(value.name) || vector(metadata.variables.length);
}

const MAX_ORDER_TERMS = 4096;

function monomialTerms(order, metadata, source = null) {
  return [{ order, source }];
}

function combineTermProducts(left, right, metadata) {
  if (left.length * right.length > MAX_ORDER_TERMS) return null;
  return left.flatMap((a) => right.map((b) => ({
    order: a.order && b.order
      ? addVectors([a.order, b.order], metadata.variables.length)
      : null,
    source: [a.source, b.source],
  })));
}

function maximalTerms(terms) {
  if (terms.some(({ order }) => !order)) return terms.map((_, index) => index);
  return terms.reduce((result, candidate, index) => {
    const dominated = terms.some((other, otherIndex) => (
      otherIndex !== index && compareVectors(candidate.order, other.order) === -1
    ));
    if (!dominated) result.push(index);
    return result;
  }, []);
}

function expressionOrder(value, metadata) {
  if (!value || typeof value !== 'object') {
    const terms = monomialTerms(vector(metadata.variables.length), metadata, value);
    return { kind: 'constant', terms, maximal: [0], order: terms[0].order, comparable: true };
  }
  if (value.kind === 'number') {
    const terms = monomialTerms(vector(metadata.variables.length), metadata, value);
    return { kind: 'monomial', terms, maximal: [0], order: terms[0].order, comparable: true };
  }
  if (value.kind === 'symbol') {
    const terms = monomialTerms(orderFromSymbol(value, metadata), metadata, value);
    return { kind: 'monomial', terms, maximal: [0], order: terms[0].order, comparable: true };
  }
  if (value.kind === 'power') {
    const base = expressionOrder(value.base, metadata);
    if (base.terms.length !== 1 || !base.terms[0].order) {
      return { kind: 'power', terms: [{ order: null, source: value }], maximal: [0], order: null, comparable: false, base };
    }
    const terms = [{ order: scaleVector(base.terms[0].order, value.exponent), source: value }];
    return { kind: 'power', terms, maximal: [0], order: terms[0].order, comparable: true, base };
  }
  if (value.kind === 'multiply') {
    const factors = value.factors.map((factor) => expressionOrder(factor, metadata));
    let terms = [{ order: vector(metadata.variables.length), source: value }];
    for (const factor of factors) {
      terms = combineTermProducts(terms, factor.terms, metadata);
      if (!terms) return { kind: 'product', terms: [], maximal: [], order: null, comparable: false, factors: Object.freeze(factors) };
    }
    const maximal = maximalTerms(terms);
    return {
      kind: 'product',
      terms: Object.freeze(terms),
      maximal: Object.freeze(maximal),
      order: maximal.length === 1 ? terms[maximal[0]].order : null,
      comparable: maximal.length === 1,
      factors: Object.freeze(factors),
    };
  }
  if (value.kind === 'add') {
    const children = value.terms.map((term) => expressionOrder(term, metadata));
    const terms = children.flatMap((child) => child.terms);
    if (terms.length > MAX_ORDER_TERMS) return { kind: 'sum', terms: [], maximal: [], order: null, comparable: false };
    const maximal = maximalTerms(terms);
    maximal.sort((left, right) => lexicographicVectors(terms[left].order, terms[right].order) || left - right);
    return {
      kind: 'sum',
      terms: Object.freeze(terms),
      maximal: Object.freeze(maximal),
      order: maximal.length === 1 ? terms[maximal[0]].order : null,
      comparable: maximal.length === 1,
    };
  }
  return { kind: 'unknown', terms: [{ order: null, source: value }], maximal: [0], order: null, comparable: false };
}

function approximationProjection(records) {
  return Object.freeze(Object.fromEntries(records.map((record) => [record.id, Object.freeze({
    gm: 0,
    go: -1,
  })])));
}

/** Build independent formal orders for selected finite-go MOS devices. */
export function buildScalingMetadata(input, options = {}) {
  const selected = selectedSet(options);
  const candidates = collectDevices(input, options).filter((record) => (
    enabled(record, options, selected)
    && !roInfinity(record, options)
    && isFiniteGo(record.go)
    && parameter(record.gm)
  ));
  const variables = candidates.map((record) => Object.freeze({
    device: record.id,
    name: `k_${record.id}`,
  }));
  const parameterOrders = new Map();
  const devices = candidates.map((record, index) => {
    const gm = parameter(record.gm);
    const go = parameter(record.go);
    const ro = parameter(record.ro);
    const gmOrder = vector(candidates.length);
    const goOrder = vector(candidates.length, index, -1);
    const roOrder = vector(candidates.length, index, 1);
    parameterOrders.set(gm, gmOrder);
    parameterOrders.set(go, goOrder);
    if (ro) parameterOrders.set(ro, roOrder);
    return freezeRecord({
      id: record.id,
      gm,
      go,
      ro,
      ratio: Object.freeze({ numerator: go, denominator: gm }),
      gmOrder,
      goOrder,
      roOrder: ro ? roOrder : null,
      intrinsicGainOrder: 1,
      scaling: Object.freeze({ gm: 0, go: -1, ...(ro ? { ro: 1 } : {}) }),
    });
  });
  const metadata = {
    kind: 'intrinsic-gain-scaling',
    direction: 'infinity',
    variables: Object.freeze(variables),
    devices: Object.freeze(devices),
    parameterOrders,
    parameterScaling: Object.freeze(Object.fromEntries(devices.flatMap((device) => [
      [device.gm, device.gmOrder],
      [device.go, device.goOrder],
      ...(device.ro ? [[device.ro, device.roOrder]] : []),
    ]))),
    scaling: approximationProjection(devices),
    approximation: Object.freeze({
      highIntrinsicGain: true,
      devices: Object.freeze(Object.fromEntries(devices.map((device) => [device.id, Object.freeze({
        highIntrinsicGain: true,
        gm: device.gm,
        go: device.go,
        ...(device.ro ? { ro: device.ro } : {}),
        scaling: device.scaling,
      })]))),
    }),
    order(value) { return expressionOrder(value, metadata); },
    compare: compareVectors,
  };
  return Object.freeze(metadata);
}

export const generateScalingMetadata = buildScalingMetadata;
export const buildIntrinsicGainScaling = buildScalingMetadata;
export const intrinsicGainScaling = buildScalingMetadata;

/** Adapt generated metadata to the options shape used by approximation.js. */
export function toApproximationOptions(metadata, options = {}) {
  if (!metadata?.approximation) throw new TypeError('scaling metadata is required');
  return {
    ...options,
    highIntrinsicGain: true,
    devices: metadata.approximation.devices,
  };
}

/** Return the independent asymptotic order of an exact rational expression. */
export function monomialOrder(value, metadata) {
  if (!metadata?.variables || !metadata?.parameterOrders) throw new TypeError('scaling metadata is required');
  return metadata.order(value);
}

export const orderExpression = monomialOrder;
