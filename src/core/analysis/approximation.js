import {
  add,
  equals,
  integer,
  multiply,
  polynomialCoefficients,
  power,
  rationalFunction,
  substituteRational,
  symbol,
} from './rational.js';

const ZERO = integer(0);
const OWN = Object.prototype.hasOwnProperty;

function entries(value) {
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

function booleanOption(local, global, names, selected = false) {
  const value = firstOwn(local, names);
  if (value !== undefined) return Boolean(value);
  const inherited = firstOwn(global, names);
  return inherited === undefined ? selected : Boolean(inherited);
}

function parameterValue(device, names) {
  const value = firstOwn(device, names);
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

function defaultParameter(refdes, prefix) {
  const suffix = String(refdes).replace(/^M(?=[A-Za-z0-9_])/, '').replace(/[^A-Za-z0-9]/g, '_');
  return `${prefix}${suffix}`;
}

function deviceParameter(device, prefix, aliases) {
  return parameterValue(device, aliases) || defaultParameter(device.id, prefix);
}

function deviceRecords(options) {
  const parameterSource = options.parameters || options.deviceParameters || {};
  const settingSource = options.devices || options.deviceOptions || options.deviceOverrides || {};
  const records = new Map();
  for (const [id, value] of [...entries(parameterSource), ...entries(settingSource)]) {
    const key = String(id);
    const current = records.get(key) || { id: key };
    records.set(key, { ...current, ...(value && typeof value === 'object' ? value : {}) });
  }
  return [...records.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function symbolNames(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(symbolNames);
  if (typeof value === 'string') return value.split(/[\s,]+/).map((name) => name.trim()).filter(Boolean);
  return [String(value)];
}

function globalSymbols(options, names) {
  const sources = [options.symbols, options.parameters, options.deviceParameters];
  return sources.flatMap((source) => names.flatMap((name) => {
    const value = source instanceof Map ? source.get(name) : source?.[name];
    return symbolNames(value);
  }));
}

function settingObjects(options) {
  const global = {
    ...(options.global || {}),
    ...(options.assumptions && typeof options.assumptions === 'object' ? options.assumptions : {}),
    ...options,
  };
  return { global };
}

function rationalEqual(left, right) {
  return left.variable === right.variable
    && equals(left.numerator, right.numerator)
    && equals(left.denominator, right.denominator);
}

function applySubstitution(current, replacements) {
  if (!replacements.size) return current;
  return substituteRational(current, replacements);
}

function assumptionName(kind, device = null) {
  const suffix = device ? ` (${device})` : '';
  if (kind === 'body') return `g_mb = 0${suffix}`;
  if (kind === 'output') return `r_o -> infinity${suffix}`;
  if (kind === 'intrinsic') return `g_m r_o >> 1${suffix}`;
  return 'dominant-pole approximation';
}

function scalingEntries(value) {
  if (!value || typeof value !== 'object') return [];
  const source = value.symbols || value.scale || value;
  const rawEntries = source instanceof Map ? [...source.entries()] : Object.entries(source);
  return rawEntries
    .filter(([name, exponent]) => name !== 'gm' && name !== 'ro' && name !== 'go')
    .map(([name, exponent]) => [String(name), Number(exponent)])
    .filter(([, exponent]) => Number.isInteger(exponent) && exponent !== 0);
}

function deviceScaling(device, options) {
  const source = device.scaling || device.scale;
  const direct = scalingEntries(source);
  if (direct.length) return direct;

  const gm = deviceParameter(device, 'gm', ['gmSymbol', 'gm']);
  const ro = parameterValue(device, ['roSymbol', 'ro']);
  const go = parameterValue(device, ['goSymbol', 'go']);
  const scale = source && typeof source === 'object' ? source : {};
  const result = [];
  if (Number.isInteger(Number(scale.gm)) && Number(scale.gm) !== 0) result.push([gm, Number(scale.gm)]);
  if (ro && Number.isInteger(Number(scale.ro)) && Number(scale.ro) !== 0) result.push([ro, Number(scale.ro)]);
  if (go && Number.isInteger(Number(scale.go)) && Number(scale.go) !== 0) result.push([go, Number(scale.go)]);
  if (result.length) return result;

  const global = options.scaling;
  if (!global || typeof global !== 'object') return [];
  const byDevice = global instanceof Map ? global.get(device.id) : global[device.id];
  if (byDevice) return scalingEntries(byDevice);
  return scalingEntries(global);
}

function leadingExpression(value, scales) {
  if (value.kind === 'number') return { degree: 0, expression: value };
  if (value.kind === 'symbol') return {
    degree: scales.get(value.name) || 0,
    expression: value,
    supported: true,
  };
  if (value.kind === 'power') {
    const base = leadingExpression(value.base, scales);
    if (base.supported === false) return base;
    return {
      degree: base.degree * value.exponent,
      expression: power(base.expression, value.exponent),
      supported: true,
    };
  }
  if (value.kind === 'multiply') {
    const parts = value.factors.map((factor) => leadingExpression(factor, scales));
    if (parts.some((part) => part.supported === false)) return { supported: false };
    return {
      degree: parts.reduce((sum, part) => sum + part.degree, 0),
      expression: multiply(parts.map((part) => part.expression)),
      supported: true,
    };
  }
  if (value.kind === 'add') {
    const parts = value.terms.map((term) => leadingExpression(term, scales));
    if (parts.some((part) => part.supported === false)) return { supported: false };
    const degree = Math.max(...parts.map((part) => part.degree));
    const expression = add(parts.filter((part) => part.degree === degree).map((part) => part.expression));
    if (equals(expression, ZERO)) return { supported: false };
    return { degree, expression, supported: true };
  }
  return { supported: false };
}

function leadingRational(current, scales) {
  const numerator = leadingExpression(current.numerator, scales);
  const denominator = leadingExpression(current.denominator, scales);
  if (numerator.supported === false || denominator.supported === false) return null;
  return rationalFunction(numerator.expression, denominator.expression, { variable: current.variable });
}

function monomial(value) {
  const result = new Map();
  for (const factor of value.kind === 'multiply' ? value.factors : [value]) {
    if (factor.kind === 'number') {
      if (factor.numerator !== factor.denominator) return null;
      continue;
    }
    const base = factor.kind === 'power' ? factor.base : factor;
    const exponent = factor.kind === 'power' ? factor.exponent : 1;
    if (base.kind !== 'symbol' || exponent < 0) return null;
    result.set(base.name, (result.get(base.name) || 0) + exponent);
  }
  return result;
}

function monomialTerms(value) {
  // A factored positive sum, e.g. ro2*(gm1+gm2), can dominate 1 just
  // like either summand. Inspect a bounded expansion for comparison only;
  // preserve the useful original factors in the resulting expression.
  function expand(node) {
    if (node.kind === 'add') return node.terms.flatMap(expand);
    if (node.kind !== 'multiply') return [node];
    let terms = [integer(1)];
    for (const factor of node.factors) {
      const choices = expand(factor);
      if (terms.length * choices.length > 64) throw new RangeError('intrinsic product comparison limit');
      terms = terms.flatMap((term) => choices.map((choice) => multiply(term, choice)));
    }
    return terms;
  }
  try {
    const terms = expand(value);
    if (terms.length > 64) return null;
    const powers = terms.map(monomial);
    return powers.every(Boolean) ? powers : null;
  } catch { return null; }
}

function intrinsicProductReduction(current, records, global, options) {
  const selectedDevices = records.filter((device) => device.intrinsicProduct
    && !deviceScaling(device, options).length
    && booleanOption(device, global, ['gmroLarge', 'highIntrinsicGain', 'intrinsicGainLarge'])
    && !booleanOption(device, global, ['roInfinity', 'ignoreChannelLengthModulation', 'go0']))
    .map((device) => ({ device: device.id, gm: deviceParameter(device, 'gm', ['gmSymbol', 'gm']), ro: deviceParameter(device, 'ro', ['roSymbol', 'ro']) }));
  // The textbook gm*ro assumption covers interactions between the selected
  // devices as well (e.g. a cascode's gm2*ro1). External resistances are not
  // output-resistance symbols, so gm*RS and gm*RD remain independent.
  const pairs = selectedDevices.flatMap((transistor) => selectedDevices.map((load) => ({
    device: transistor.device, gm: transistor.gm, ro: load.ro,
  })));
  const used = new Set();
  function reduce(value) {
    if (value.kind === 'multiply') return multiply(value.factors.map(reduce));
    if (value.kind === 'power') return power(reduce(value.base), value.exponent);
    if (value.kind !== 'add') return value;
    const terms = value.terms.map(reduce);
    const powers = terms.map(monomialTerms);
    return add(terms.filter((_, i) => !powers.some((higherTerms, j) => {
      const lowerTerms = powers[i];
      if (i === j || !higherTerms || !lowerTerms) return false;
      const usedHere = new Set();
      const dominated = lowerTerms.every((lower) => higherTerms.some((higher) => {
        const ratio = new Map(higher);
        for (const [name, exponent] of lower) {
          if ((ratio.get(name) || 0) < exponent) return false;
          ratio.set(name, ratio.get(name) - exponent);
        }
        const devices = [];
        for (const pair of pairs) {
          const count = Math.min(ratio.get(pair.gm) || 0, ratio.get(pair.ro) || 0);
          if (!count) continue;
          ratio.set(pair.gm, ratio.get(pair.gm) - count);
          ratio.set(pair.ro, ratio.get(pair.ro) - count);
          devices.push(pair.device);
        }
        if (!devices.length || [...ratio.values()].some((exponent) => exponent !== 0)) return false;
        devices.forEach((id) => usedHere.add(id));
        return true;
      }));
      if (dominated) usedHere.forEach((id) => used.add(id));
      return dominated;
    })));
  }
  const numerator = reduce(current.numerator);
  const denominator = reduce(current.denominator);
  // Leading terms can cancel in an unreduced global expression. Keep the
  // exact value here; the topological path can still simplify its local Gm
  // and load branches without that cancellation.
  if (equals(denominator, ZERO)) return { selected: current, assumptions: [] };
  const selected = rationalFunction(numerator, denominator, { variable: current.variable });
  return { selected, assumptions: [...used].map((id) => assumptionName('intrinsic', id)) };
}

function intrinsicScales(options, records, global) {
  const scales = new Map();
  let hasProof = false;
  const selectedGo = new Set(symbolNames(options.ignoreRoDevices || options.ignoreChannelLengthModulationDevices));
  for (const device of records) {
    const goInfinity = booleanOption(device, global, ['go0', 'roInfinity', 'ignoreChannelLengthModulation', 'neglectChannelLengthModulation', 'ignoreRo'], selectedGo.has(device.id));
    const highGain = booleanOption(device, global, ['gmroLarge', 'highIntrinsicGain', 'intrinsicGainLarge']);
    if (!highGain || goInfinity) continue;
    const metadata = deviceScaling(device, options);
    if (!metadata.length) continue;
    for (const [name, exponent] of metadata) {
      if (scales.has(name) && scales.get(name) !== exponent) return { scales: new Map(), hasProof: false };
      scales.set(name, exponent);
    }
    const gm = deviceParameter(device, 'gm', ['gmSymbol', 'gm']);
    const ro = parameterValue(device, ['roSymbol', 'ro']);
    const go = parameterValue(device, ['goSymbol', 'go']);
    const gmDegree = scales.get(gm) || 0;
    const roDegree = ro ? (scales.get(ro) || 0) : -(scales.get(go) || 0);
    if (gmDegree + roDegree > 0) hasProof = true;
  }
  return { scales, hasProof };
}

/**
 * `r_o -> infinity` (ignore channel-length modulation) is the same
 * leading-term limit as the intrinsic-gain reduction above, scoped to just
 * the flagged devices' own `r_o` symbol: declaring it the sole growing
 * quantity and keeping only the dominant additive term wherever it appears.
 */
// Unlike `deviceScaling` (which collapses a joint gm*ro proof into one flat
// list), this distinguishes "no scaling info given" (default to degree 1,
// r_o -> infinity is trusted at face value) from "explicitly declared 0"
// (no proof, leave the exact expression alone) for a single symbol.
function declaredExponent(source, genericName, specificName) {
  if (!source || typeof source !== 'object') return undefined;
  const symbols = source.symbols || source.scale;
  if (symbols && typeof symbols === 'object') {
    const bySpecific = symbols instanceof Map ? symbols.get(specificName) : symbols[specificName];
    if (bySpecific !== undefined) return Number(bySpecific);
  }
  if (source[genericName] !== undefined) return Number(source[genericName]);
  return undefined;
}

function outputScales(options, records, global) {
  const scales = new Map();
  let hasProof = false;
  const selectedGo = new Set(symbolNames(options.ignoreRoDevices || options.ignoreChannelLengthModulationDevices));
  for (const device of records) {
    const roInfinity = booleanOption(device, global, ['go0', 'roInfinity', 'ignoreChannelLengthModulation', 'neglectChannelLengthModulation', 'ignoreRo'], selectedGo.has(device.id));
    if (!roInfinity) continue;
    const ro = parameterValue(device, ['roSymbol', 'ro']) || deviceParameter(device, 'ro', ['roSymbol', 'ro']);
    const declared = declaredExponent(device.scaling || device.scale, 'ro', ro);
    const degree = declared === undefined ? 1 : declared;
    if (!degree) continue;
    if (scales.has(ro) && scales.get(ro) !== degree) continue;
    scales.set(ro, degree);
    hasProof = true;
  }
  for (const name of globalSymbols(options, ['ro', 'roSymbols'])) {
    if (scales.has(name) && scales.get(name) !== 1) continue;
    scales.set(name, 1);
    hasProof = true;
  }
  return { scales, hasProof };
}

function firstOrderDenominator(current, options) {
  const coefficients = polynomialCoefficients(current.denominator, current.variable, options.rational || {});
  if (!coefficients || coefficients.length === 0 || coefficients[0].power <= 1) return null;
  const kept = coefficients.filter(({ power: exponent }) => exponent <= 1);
  if (!kept.length) return null;
  const denominator = add(kept.map(({ power: exponent, coefficient }) => (
    exponent === 0 ? coefficient : multiply(coefficient, power(symbol(current.variable), exponent))
  )));
  if (equals(denominator, current.denominator)) return null;
  return rationalFunction(current.numerator, denominator, { variable: current.variable });
}

/**
 * Apply selected post-solve assumptions to a canonical rational expression.
 * `parameters` names device symbols; `devices` supplies per-device flags.
 * A `scaling` map such as `{ M1: { gm: 1, ro: 0 } }` proves the high-gain
 * limit by making the declared `g_m r_o` product grow with one formal scale.
 */
export function applyApproximations(input, options = {}) {
  const exact = input?.kind === 'rational'
    ? input
    : rationalFunction(input, integer(1), { variable: options.variable || 's', ...(options.rational || {}) });
  let selected = exact;
  const assumptions = [];
  const { global } = settingObjects(options);
  const records = deviceRecords(options);

  const substitutions = [];
  const selectedGo = new Set(symbolNames(options.ignoreRoDevices || options.ignoreChannelLengthModulationDevices));
  for (const device of records) {
    const gmb = parameterValue(device, ['gmbSymbol', 'gmb']) || deviceParameter(device, 'gmb', ['gmbSymbol', 'gmb']);
    if (booleanOption(device, global, ['gmb0', 'ignoreBodyEffect', 'bodyEffectIgnored', 'neglectBodyEffect', 'ignoreGmb', 'gmbZero'])) substitutions.push({ kind: 'body', device: device.id, name: gmb });
  }
  for (const name of globalSymbols(options, ['gmb', 'gmbSymbols'])) substitutions.push({ kind: 'body', device: null, name });

  const seen = new Set();
  for (const substitution of substitutions) {
    if (seen.has(substitution.name)) continue;
    seen.add(substitution.name);
    const next = applySubstitution(selected, new Map([[substitution.name, ZERO]]));
    if (!rationalEqual(next, selected)) {
      selected = next;
      assumptions.push(assumptionName(substitution.kind, substitution.device));
    }
  }

  const output = outputScales(options, records, global);
  if (output.hasProof) {
    const before = selected;
    const next = leadingRational(selected, output.scales);
    if (next && !rationalEqual(next, selected)) {
      selected = next;
      for (const device of records) {
        const roInfinity = booleanOption(device, global, ['go0', 'roInfinity', 'ignoreChannelLengthModulation', 'neglectChannelLengthModulation', 'ignoreRo'], selectedGo.has(device.id));
        if (!roInfinity) continue;
        const ro = parameterValue(device, ['roSymbol', 'ro']) || deviceParameter(device, 'ro', ['roSymbol', 'ro']);
        const degree = output.scales.get(ro);
        const local = degree ? leadingRational(before, new Map([[ro, degree]])) : null;
        if (local && !rationalEqual(local, before)) assumptions.push(assumptionName('output', device.id));
      }
    }
  }

  const products = intrinsicProductReduction(selected, records, global, options);
  if (!rationalEqual(products.selected, selected)) {
    selected = products.selected;
    assumptions.push(...products.assumptions);
  }

  const scale = intrinsicScales(options, records, global);
  if (scale.hasProof) {
    const before = selected;
    const next = leadingRational(selected, scale.scales);
    if (next && !rationalEqual(next, selected)) {
      selected = next;
      for (const device of records) {
        const goInfinity = booleanOption(device, global, ['go0', 'roInfinity', 'ignoreChannelLengthModulation', 'neglectChannelLengthModulation', 'ignoreRo'], selectedGo.has(device.id));
        const highGain = booleanOption(device, global, ['gmroLarge', 'highIntrinsicGain', 'intrinsicGainLarge']);
        if (!highGain || goInfinity) continue;
        const parameters = new Set([
          deviceParameter(device, 'gm', ['gmSymbol', 'gm']),
          parameterValue(device, ['roSymbol', 'ro']),
          parameterValue(device, ['goSymbol', 'go']),
        ].filter(Boolean));
        const localScales = new Map(deviceScaling(device, options).filter(([name]) => parameters.has(name)));
        const local = localScales.size ? leadingRational(before, localScales) : null;
        if (local && !rationalEqual(local, before)) assumptions.push(assumptionName('intrinsic', device.id));
      }
    }
  }

  if (booleanOption({}, global, ['dominantPole', 'dominantPoleApproximation'])) {
    const next = firstOrderDenominator(selected, options);
    if (next && !rationalEqual(next, selected)) {
      selected = next;
      assumptions.push(assumptionName('pole'));
    }
  }

  return Object.freeze({
    exact,
    selected,
    changed: !rationalEqual(exact, selected),
    assumptions: Object.freeze(assumptions),
  });
}

export const applyPostSolveApproximations = applyApproximations;
export const reduceApproximations = applyApproximations;
