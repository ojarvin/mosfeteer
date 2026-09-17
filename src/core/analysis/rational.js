const ZERO = Object.freeze({ kind: 'number', numerator: 0n, denominator: 1n });
const ONE = Object.freeze({ kind: 'number', numerator: 1n, denominator: 1n });
const MINUS_ONE = Object.freeze({ kind: 'number', numerator: -1n, denominator: 1n });
const DEFAULT_MAX_OPERATIONS = 200000;

function gcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x || 1n;
}

function integerValue(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^[-+]?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new TypeError(`expected an exact integer, got ${String(value)}`);
}

function exactNumber(numerator, denominator = 1n) {
  let n = integerValue(numerator);
  let d = integerValue(denominator);
  if (d === 0n) throw new RangeError('rational denominator must not be zero');
  if (d < 0n) [n, d] = [-n, -d];
  const divisor = gcd(n, d);
  n /= divisor;
  d /= divisor;
  if (n === 0n) return ZERO;
  if (n === 1n && d === 1n) return ONE;
  if (n === -1n && d === 1n) return MINUS_ONE;
  return Object.freeze({ kind: 'number', numerator: n, denominator: d });
}

function isNumber(value) {
  return value?.kind === 'number';
}

function isZero(value) {
  return isNumber(value) && value.numerator === 0n;
}

function isInfinity(value) {
  return value?.kind === 'infinity';
}

function isOne(value) {
  return isNumber(value) && value.numerator === 1n && value.denominator === 1n;
}

function isMinusOne(value) {
  return value === MINUS_ONE;
}

function asExpression(value) {
  if (value?.kind === 'rational' && value.infinite === true) return value.numerator;
  if (value?.kind) return value;
  return exactNumber(value);
}

function argumentList(values) {
  return values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
}

function expressionKey(value) {
  switch (value.kind) {
    case 'number': return `n:${value.numerator}/${value.denominator}`;
    case 'symbol': return `s:${value.name}`;
    case 'infinity': return `i:${value.sign < 0 ? -1 : 1}`;
    case 'power': return `p:${expressionKey(value.base)}^${value.exponent}`;
    case 'multiply': return `m:${value.factors.map(expressionKey).join(',')}`;
    case 'add': return `a:${value.terms.map(expressionKey).join(',')}`;
    default: throw new TypeError(`unknown expression kind ${value.kind}`);
  }
}

function factorRank(value) {
  if (isNumber(value)) return 0;
  if (value.kind === 'symbol') return 1;
  if (value.kind === 'power') return 2;
  if (value.kind === 'multiply') return 3;
  return 4;
}

function compareKeys(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareFactors(left, right) {
  return factorRank(left) - factorRank(right) || compareKeys(expressionKey(left), expressionKey(right));
}

function variableDegree(value, variable = 's') {
  if (value?.kind === 'symbol') return value.name === variable ? 1 : 0;
  if (value?.kind === 'power' && value.exponent >= 0) {
    return value.base?.kind === 'symbol' && value.base.name === variable ? value.exponent : 0;
  }
  if (value?.kind === 'multiply') return value.factors.reduce((sum, factor) => sum + variableDegree(factor, variable), 0);
  return 0;
}

function numericAdd(left, right) {
  return exactNumber(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function numericMultiply(left, right) {
  return exactNumber(left.numerator * right.numerator, left.denominator * right.denominator);
}

function numericPower(value, exponent) {
  if (exponent === 0) return ONE;
  if (value.numerator === 0n && exponent < 0) throw new RangeError('zero cannot have a negative power');
  if (exponent > 0) return exactNumber(value.numerator ** BigInt(exponent), value.denominator ** BigInt(exponent));
  return exactNumber(value.denominator ** BigInt(-exponent), value.numerator ** BigInt(-exponent));
}

function factorEntries(value) {
  if (value.kind === 'multiply') return value.factors.flatMap(factorEntries);
  if (value.kind === 'power' && value.exponent !== 0) return [[value.base, value.exponent]];
  return [[value, 1]];
}

function factorsFromEntries(entries) {
  const factors = [];
  for (const [factor, exponent] of entries) {
    if (exponent === 0 || isOne(factor)) continue;
    factors.push(exponent === 1 ? factor : power(factor, exponent));
  }
  return factors;
}

function nonNumericFactors(value) {
  return factorEntries(value).filter(([factor]) => !isNumber(factor));
}

function makeMultiply(values) {
  return multiply(...values);
}

// A term shaped like `numericCoefficient * (sum)` (and nothing else) is kept
// factored by default so unrelated `add()` calls elsewhere in the pipeline
// can still find it as a shared multiplicative factor. It is only expanded
// here, on a trial basis, when doing so lets its pieces cancel against
// sibling terms (for example `-1*(gm1+gm2) + gm1 + gm2` collapsing to `0`);
// see `combineTerms`/`distributeScaledSum` below.
function distributeScaledSum(term) {
  if (term.kind !== 'multiply') return null;
  const nonNumeric = term.factors.filter((factor) => !isNumber(factor));
  if (nonNumeric.length !== 1 || nonNumeric[0].kind !== 'add') return null;
  const coefficient = term.factors.find((factor) => isNumber(factor)) || ONE;
  return nonNumeric[0].terms.map((subterm) => makeMultiply([coefficient, subterm]));
}

function combineTerms(terms) {
  const combined = new Map();
  for (const rawTerm of terms) {
    const term = asExpression(rawTerm);
    const entries = term.kind === 'multiply' ? term.factors : [term];
    const coefficient = entries.length && isNumber(entries[0]) ? entries[0] : ONE;
    const core = entries.length && isNumber(entries[0]) ? makeMultiply(entries.slice(1)) : term;
    const key = expressionKey(core);
    const previous = combined.get(key);
    combined.set(key, previous
      ? { coefficient: numericAdd(previous.coefficient, coefficient), core: previous.core }
      : { coefficient, core });
  }
  const result = [];
  for (const { coefficient, core } of combined.values()) {
    if (isZero(coefficient)) continue;
    result.push(isOne(core) ? coefficient : makeMultiply([coefficient, core]));
  }
  return result;
}

function makeAdd(values, factorCommon) {
  const terms = values.flatMap(value => value.kind === 'add' ? value.terms : [value]).map(asExpression);
  const infinities = terms.filter(isInfinity);
  if (infinities.length) {
    const signs = new Set(infinities.map(value => value.sign < 0 ? -1 : 1));
    if (signs.size > 1) throw new RangeError('undefined infinity addition');
    return infinity(infinities[0].sign);
  }
  const direct = combineTerms(terms);
  let normalized = direct;
  if (terms.some(term => distributeScaledSum(term) !== null)) {
    const expandedTerms = terms.flatMap(term => distributeScaledSum(term) || [term]);
    const expanded = combineTerms(expandedTerms);
    if (expanded.length < direct.length) normalized = expanded;
  }
  if (!normalized.length) return ZERO;
  if (normalized.length === 1) return normalized[0];

  const allNegative = normalized.every(term => {
    const coefficient = term.kind === 'multiply' && isNumber(term.factors[0]) ? term.factors[0] : (isNumber(term) ? term : ONE);
    return coefficient.numerator < 0n;
  });
  if (allNegative) {
    return makeMultiply([MINUS_ONE, makeAdd(normalized.map(term => negate(term)), factorCommon)]);
  }

  if (factorCommon) {
    const factorMaps = normalized.map(term => {
      const coefficient = term.kind === 'multiply' && isNumber(term.factors[0]) ? term.factors[0] : (isNumber(term) ? term : ONE);
      const core = term.kind === 'multiply' && isNumber(term.factors[0]) ? makeMultiply(term.factors.slice(1)) : term;
      const counts = new Map();
      for (const [factor, exponent] of nonNumericFactors(core)) {
        const key = expressionKey(factor);
        counts.set(key, { factor, exponent: (counts.get(key)?.exponent || 0) + exponent });
      }
      return { coefficient, core, counts };
    });
    const common = [];
    for (const [key, first] of factorMaps[0].counts) {
      const exponent = Math.min(...factorMaps.map(({ counts }) => counts.get(key)?.exponent || 0));
      if (exponent) common.push([first.factor, exponent]);
    }
    if (common.length) {
      const residual = factorMaps.map(({ coefficient, counts }) => {
        const remaining = [];
        for (const [key, entry] of counts) remaining.push([entry.factor, entry.exponent - (common.find(([factor]) => expressionKey(factor) === key)?.[1] || 0)]);
        return makeMultiply([coefficient, ...factorsFromEntries(remaining)]);
      });
      return makeMultiply([...factorsFromEntries(common), makeAdd(residual, false)]);
    }
  }

  normalized.sort((left, right) => compareKeys(expressionKey(left), expressionKey(right)));
  return Object.freeze({ kind: 'add', terms: Object.freeze(normalized) });
}

/** Create an exact integer or rational number node. */
export function rational(numerator, denominator = 1n) {
  return exactNumber(numerator, denominator);
}

/** Create an exact integer node. */
export function integer(value) {
  return exactNumber(value);
}

/** Create a named symbolic parameter node. */
export function symbol(name) {
  const text = String(name);
  if (!text) throw new TypeError('symbol name must not be empty');
  return Object.freeze({ kind: 'symbol', name: text });
}

/** Create a normalized sum of exact expressions. */
export function add(...values) {
  return makeAdd(argumentList(values).map(asExpression), true);
}

/** Create a normalized product of exact expressions. */
export function multiply(...values) {
  const factors = argumentList(values).map(asExpression);
  const infinities = factors.filter(isInfinity);
  if (infinities.length) {
    if (factors.some(isZero)) throw new RangeError('undefined zero times infinity');
    const sign = infinities.reduce((result, value) => result * (value.sign < 0 ? -1 : 1), 1)
      * factors.filter(isNumber).reduce((result, value) => result * (value.numerator < 0n ? -1 : 1), 1);
    return infinity(sign);
  }
  let coefficient = ONE;
  const counts = new Map();
  for (const factor of factors) {
    if (isZero(factor)) return ZERO;
    for (const [base, exponent] of factorEntries(factor)) {
      if (isNumber(base)) {
        coefficient = numericMultiply(coefficient, numericPower(base, exponent));
        continue;
      }
      const key = expressionKey(base);
      counts.set(key, { base, exponent: (counts.get(key)?.exponent || 0) + exponent });
    }
  }
  if (isZero(coefficient)) return ZERO;
  const combined = factorsFromEntries([...counts.values()].map(({ base, exponent }) => [base, exponent]));
  combined.sort(compareFactors);
  if (!isOne(coefficient)) combined.unshift(coefficient);
  if (!combined.length) return ONE;
  if (combined.length === 1) return combined[0];
  return Object.freeze({ kind: 'multiply', factors: Object.freeze(combined) });
}

/** Create a normalized integer power. */
export function power(base, exponent) {
  const value = asExpression(base);
  const powerValue = Number(integerValue(exponent));
  if (!Number.isSafeInteger(powerValue)) throw new RangeError('power exponent must be a safe integer');
  if (powerValue === 0) return ONE;
  if (powerValue === 1) return value;
  if (isNumber(value)) return numericPower(value, powerValue);
  if (value.kind === 'power') return power(value.base, value.exponent * powerValue);
  return Object.freeze({ kind: 'power', base: value, exponent: powerValue });
}

/** Create the exact additive inverse. */
export function negate(value) {
  return multiply(MINUS_ONE, asExpression(value));
}

/** Create an exact difference. */
export function subtract(left, right) {
  return add(left, negate(right));
}

/** Create an exact quotient as a rational function with the default variable. */
export function divide(left, right) {
  return rationalFunction(left, right);
}

/** Substitute exact expressions by symbol name without mutating the source. */
export function substitute(value, replacements) {
  const source = asExpression(value);
  if (isInfinity(source)) return source;
  const lookup = replacements instanceof Map ? replacements : new Map(Object.entries(replacements || {}));
  if (source.kind === 'symbol') return lookup.has(source.name) ? asExpression(lookup.get(source.name)) : source;
  if (source.kind === 'number') return source;
  if (source.kind === 'power') return power(substitute(source.base, lookup), source.exponent);
  if (source.kind === 'multiply') return multiply(source.factors.map(factor => substitute(factor, lookup)));
  return add(source.terms.map(term => substitute(term, lookup)));
}

/** Test exact structural equality after canonical construction. */
export function equals(left, right) {
  return expressionKey(asExpression(left)) === expressionKey(asExpression(right));
}

function cancelFactors(numerator, denominator, budget = null) {
  budget?.step();
  if (equals(numerator, denominator)) return [ONE, ONE];
  const exponents = new Map();
  for (const [factor, exponent] of factorEntries(numerator)) {
    const key = expressionKey(factor);
    exponents.set(key, { factor, exponent: (exponents.get(key)?.exponent || 0) + exponent });
  }
  for (const [factor, exponent] of factorEntries(denominator)) {
    const key = expressionKey(factor);
    exponents.set(key, { factor, exponent: (exponents.get(key)?.exponent || 0) - exponent });
  }
  const reducedNumerator = [];
  const reducedDenominator = [];
  for (const { factor, exponent } of exponents.values()) {
    if (exponent > 0) reducedNumerator.push([factor, exponent]);
    if (exponent < 0) reducedDenominator.push([factor, -exponent]);
  }
  return [makeMultiply(factorsFromEntries(reducedNumerator)), makeMultiply(factorsFromEntries(reducedDenominator))];
}

function splitNumericFactor(value) {
  if (isNumber(value)) return { coefficient: value, rest: ONE };
  if (value.kind !== 'multiply' || !isNumber(value.factors[0])) return { coefficient: ONE, rest: value };
  return { coefficient: value.factors[0], rest: makeMultiply(value.factors.slice(1)) };
}

function absoluteNumeric(value) {
  return value.numerator < 0n ? exactNumber(-value.numerator, value.denominator) : value;
}

function numericGcd(values) {
  const numbers = values.map(absoluteNumeric);
  let numerator = numbers.reduce((result, value) => gcd(result, value.numerator), 0n);
  let denominator = numbers.reduce((result, value) => {
    return result / gcd(result, value.denominator) * value.denominator;
  }, 1n);
  if (numerator === 0n) return ONE;
  return exactNumber(numerator, denominator);
}

function factorCounts(value) {
  const counts = new Map();
  for (const [factor, exponent] of nonNumericFactors(value)) {
    const key = expressionKey(factor);
    counts.set(key, { factor, exponent: (counts.get(key)?.exponent || 0) + exponent });
  }
  return counts;
}

function commonFactor(values) {
  const expressions = values.filter(value => !isZero(value));
  if (!expressions.length) return ONE;
  const parts = expressions.map(splitNumericFactor);
  const coefficient = numericGcd(parts.map(({ coefficient }) => coefficient));
  const first = factorCounts(parts[0].rest);
  const common = [];
  for (const [key, entry] of first) {
    const exponent = Math.min(...parts.slice(1).map(({ rest }) => factorCounts(rest).get(key)?.exponent || 0), entry.exponent);
    if (exponent > 0) common.push([entry.factor, exponent]);
  }
  return makeMultiply([coefficient, ...factorsFromEntries(common)]);
}

function divideByFactor(value, factor, budget = null) {
  if (isOne(factor)) return value;
  budget?.step();
  const valueParts = splitNumericFactor(value);
  const factorParts = splitNumericFactor(factor);
  const numeric = exactNumber(
    valueParts.coefficient.numerator * factorParts.coefficient.denominator,
    valueParts.coefficient.denominator * factorParts.coefficient.numerator,
  );
  const [rest, remainder] = cancelFactors(valueParts.rest, factorParts.rest, budget);
  if (!isOne(remainder)) return null;
  return makeMultiply([numeric, rest]);
}

function cancelPolynomialContent(map, factor, budget) {
  if (isOne(factor)) return map;
  const result = new Map();
  for (const [powerValue, coefficient] of map) {
    budget.step();
    const reduced = divideByFactor(coefficient, factor, budget);
    if (reduced === null) return null;
    if (!isZero(reduced)) result.set(powerValue, reduced);
  }
  return result;
}

function fallbackRational(numerator, denominator, variable, budgetExceeded = false) {
  if (isInfinity(numerator)) {
    return Object.freeze({ kind: 'rational', variable, numerator, denominator: ONE, budgetExceeded, infinite: true });
  }
  if (isInfinity(denominator)) {
    return Object.freeze({ kind: 'rational', variable, numerator: ZERO, denominator: ONE, budgetExceeded });
  }
  if (isZero(denominator)) throw new RangeError('rational denominator must not be zero');
  if (isZero(numerator)) return Object.freeze({ kind: 'rational', variable, numerator: ZERO, denominator: ONE, budgetExceeded });
  return Object.freeze({ kind: 'rational', variable, numerator, denominator, budgetExceeded });
}

function canonicalRational(numerator, denominator, variable, budgetExceeded = false, budget = null) {
  const fallback = () => fallbackRational(numerator, denominator, variable, budgetExceeded);
  if (isInfinity(numerator) || isInfinity(denominator)) return fallback();
  if (isZero(denominator)) throw new RangeError('rational denominator must not be zero');
  budget?.step();
  let [n, d] = cancelFactors(numerator, denominator, budget);
  if (isZero(n)) return fallbackRational(ZERO, ONE, variable, budgetExceeded);
  const nc = splitNumericFactor(n);
  const dc = splitNumericFactor(d);
  const coefficient = numericMultiply(nc.coefficient, exactNumber(dc.coefficient.denominator, dc.coefficient.numerator));
  n = makeMultiply([coefficient, nc.rest]);
  d = dc.rest;
  if (isMinusOne(d)) {
    n = negate(n);
    d = ONE;
  }
  return Object.freeze({ kind: 'rational', variable, numerator: n, denominator: d, budgetExceeded });
}

class OperationBudget {
  constructor(limit = DEFAULT_MAX_OPERATIONS) {
    if (!Number.isFinite(limit)) throw new RangeError('maxOperations must be finite');
    this.limit = Math.max(0, Math.floor(limit));
    this.used = 0;
    this.exceeded = false;
  }

  step(amount = 1) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('budget step must be a non-negative integer');
    if (this.exceeded || this.used + amount > this.limit) {
      this.used = this.limit;
      this.exceeded = true;
      throw new BudgetExceeded();
    }
    this.used += amount;
  }
}

class BudgetExceeded extends Error {}

function polynomialMap(value, variable, budget) {
  budget.step();
  if (isNumber(value)) return new Map([[0, value]]);
  if (value.kind === 'symbol') return new Map([[value.name === variable ? 1 : 0, value.name === variable ? ONE : value]]);
  if (value.kind === 'add') {
    const result = new Map();
    for (const term of value.terms) {
      const termMap = polynomialMap(term, variable, budget);
      if (!termMap) return null;
      mergeCoefficientMap(result, termMap, budget);
    }
    return result;
  }
  if (value.kind === 'multiply') {
    let result = new Map([[0, ONE]]);
    for (const factor of value.factors) {
      const factorMap = polynomialMap(factor, variable, budget);
      if (!factorMap) return null;
      result = multiplyPolynomialMaps(result, factorMap, budget);
    }
    return result;
  }
  if (value.kind === 'power' && value.exponent >= 0) {
    let result = new Map([[0, ONE]]);
    const base = polynomialMap(value.base, variable, budget);
    if (!base) return null;
    for (let index = 0; index < value.exponent; index += 1) result = multiplyPolynomialMaps(result, base, budget);
    return result;
  }
  return null;
}

function mergeCoefficientMap(target, source, budget) {
  for (const [powerValue, coefficient] of source) {
    budget.step();
    target.set(powerValue, target.has(powerValue) ? add(target.get(powerValue), coefficient) : coefficient);
  }
}

function multiplyPolynomialMaps(left, right, budget) {
  const result = new Map();
  for (const [leftPower, leftCoefficient] of left) {
    for (const [rightPower, rightCoefficient] of right) {
      budget.step();
      const powerValue = leftPower + rightPower;
      const coefficient = multiply(leftCoefficient, rightCoefficient);
      result.set(powerValue, result.has(powerValue) ? add(result.get(powerValue), coefficient) : coefficient);
    }
  }
  return result;
}

function polynomialExpression(coefficients, variable) {
  const terms = [];
  for (const { power: powerValue, coefficient } of coefficients) {
    if (isZero(coefficient)) continue;
    terms.push(powerValue === 0 ? coefficient : multiply(coefficient, power(symbol(variable), powerValue)));
  }
  return makeAdd(terms, true);
}

function coefficientsFromMap(map) {
  return Object.freeze([...map.entries()]
    .filter(([, coefficient]) => !isZero(coefficient))
    .sort(([left], [right]) => right - left)
    .map(([powerValue, coefficient]) => Object.freeze({ power: powerValue, coefficient })));
}

/** Return polynomial coefficients in descending powers of the chosen variable. */
export function polynomialCoefficients(value, variable = 's', options = {}) {
  const budget = options.budget || new OperationBudget(options.maxOperations ?? DEFAULT_MAX_OPERATIONS);
  try {
    const map = polynomialMap(asExpression(value), variable, budget);
    if (!map) return null;
    return coefficientsFromMap(map);
  } catch (error) {
    if (error instanceof BudgetExceeded) return null;
    throw error;
  }
}

/** Normalize a rational function and cancel structurally provable factors. */
export function rationalFunction(numerator, denominator = ONE, options = {}) {
  const variable = options.variable || 's';
  const rawNumerator = asExpression(numerator);
  const rawDenominator = asExpression(denominator);
  const budget = options.budget || new OperationBudget(options.maxOperations ?? DEFAULT_MAX_OPERATIONS);
  let result;
  try {
    result = canonicalRational(rawNumerator, rawDenominator, variable, false, budget);
    const numeratorMap = polynomialMap(result.numerator, variable, budget);
    const denominatorMap = polynomialMap(result.denominator, variable, budget);
    if (numeratorMap && denominatorMap) {
      const content = commonFactor([
        commonFactor([...numeratorMap.values()]),
        commonFactor([...denominatorMap.values()]),
      ]);
      const reducedNumeratorMap = cancelPolynomialContent(numeratorMap, content, budget);
      const reducedDenominatorMap = cancelPolynomialContent(denominatorMap, content, budget);
      if (!reducedNumeratorMap || !reducedDenominatorMap) throw new BudgetExceeded();
      const numeratorCoefficients = coefficientsFromMap(reducedNumeratorMap);
      const denominatorCoefficients = coefficientsFromMap(reducedDenominatorMap);
      budget.step(numeratorCoefficients.length + denominatorCoefficients.length);
      const normalizedNumerator = polynomialExpression(numeratorCoefficients, variable);
      const normalizedDenominator = polynomialExpression(denominatorCoefficients, variable);
      result = canonicalRational(normalizedNumerator, normalizedDenominator, variable, false, budget);
    }
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    budget.exceeded = true;
    result = fallbackRational(rawNumerator, rawDenominator, variable, true);
  }
  return result;
}

function asRational(value, variable = 's', options = {}) {
  if (isInfinity(value)) return value;
  if (value?.kind === 'rational' && value.infinite === true) return value.numerator;
  return value?.kind === 'rational' ? value : rationalFunction(value, ONE, { ...options, variable });
}

/** Add two rational functions, preserving a valid factored fallback on budget exhaustion. */
export function rationalAdd(left, right, options = {}) {
  const variable = options.variable || left?.variable || right?.variable || 's';
  const budget = options.budget || new OperationBudget(options.maxOperations ?? DEFAULT_MAX_OPERATIONS);
  const a = asRational(left, variable, { ...options, budget });
  const b = asRational(right, variable, { ...options, budget });
  if (isInfinity(a)) {
    if (isInfinity(b) && a.sign !== b.sign) throw new RangeError('undefined infinity addition');
    return infinity(a.sign);
  }
  if (isInfinity(b)) return infinity(b.sign);
  try {
    budget.step(2);
    const numerator = add(multiply(a.numerator, b.denominator), multiply(b.numerator, a.denominator));
    const denominator = multiply(a.denominator, b.denominator);
    return rationalFunction(numerator, denominator, { ...options, budget });
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    budget.exceeded = true;
    return fallbackRational(a.numerator, a.denominator, variable, true);
  }
}

/** Multiply two rational functions. */
export function rationalMultiply(left, right, options = {}) {
  const variable = options.variable || left?.variable || right?.variable || 's';
  const budget = options.budget || new OperationBudget(options.maxOperations ?? DEFAULT_MAX_OPERATIONS);
  const a = asRational(left, variable, { ...options, budget });
  const b = asRational(right, variable, { ...options, budget });
  if (isInfinity(a) || isInfinity(b)) {
    if (isInfinity(a) && isInfinity(b)) return infinity(a.sign * b.sign);
    const other = isInfinity(a) ? b : a;
    if (isZero(other?.numerator)) throw new RangeError('undefined zero times infinity');
    const sign = (isInfinity(a) ? a.sign : b.sign)
      * (other?.numerator?.numerator < 0n ? -1 : 1);
    return infinity(sign);
  }
  try {
    budget.step(2);
    return rationalFunction(
      multiply(a.numerator, b.numerator),
      multiply(a.denominator, b.denominator),
      { ...options, budget },
    );
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    budget.exceeded = true;
    return fallbackRational(a.numerator, a.denominator, variable, true);
  }
}

/** Divide two rational functions. */
export function rationalDivide(left, right, options = {}) {
  const variable = options.variable || left?.variable || right?.variable || 's';
  const budget = options.budget || new OperationBudget(options.maxOperations ?? DEFAULT_MAX_OPERATIONS);
  const a = asRational(left, variable, { ...options, budget });
  const b = asRational(right, variable, { ...options, budget });
  if (isInfinity(a)) {
    if (isInfinity(b) || isZero(b.numerator)) throw new RangeError('undefined infinity division');
    return infinity(a.sign);
  }
  if (isInfinity(b)) return ZERO;
  if (isZero(b.numerator)) {
    if (isZero(a.numerator)) throw new RangeError('undefined zero divided by zero');
    return infinity(a.numerator?.kind === 'number' && a.numerator.numerator < 0n ? -1 : 1);
  }
  try {
    budget.step(2);
    return rationalFunction(
      multiply(a.numerator, b.denominator),
      multiply(a.denominator, b.numerator),
      { ...options, budget },
    );
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    budget.exceeded = true;
    return fallbackRational(a.numerator, a.denominator, variable, true);
  }
}

/** Substitute exact expressions into a rational function. */
export function substituteRational(value, replacements, options = {}) {
  if (isInfinity(value)) return value;
  if (value?.kind === 'rational' && value.infinite === true) return value.numerator;
  const budget = options.budget || new OperationBudget(options.maxOperations ?? DEFAULT_MAX_OPERATIONS);
  const rationalValue = asRational(value, 's', { ...options, budget });
  if (rationalValue.budgetExceeded === true) return rationalValue;
  try {
    budget.step();
    return rationalFunction(
      substitute(rationalValue.numerator, replacements),
      substitute(rationalValue.denominator, replacements),
      { ...options, budget, variable: rationalValue.variable },
    );
  } catch (error) {
    if (!(error instanceof BudgetExceeded)) throw error;
    budget.exceeded = true;
    return fallbackRational(rationalValue.numerator, rationalValue.denominator, rationalValue.variable, true);
  }
}

/** Evaluate a rational function at an exact value. */
export function rationalAt(value, argument, options = {}) {
  if (isInfinity(value)) return value;
  if (value?.kind === 'rational' && value.infinite === true) return value.numerator;
  const rationalValue = asRational(value, 's', options);
  const replacements = new Map([[rationalValue.variable, asExpression(argument)]]);
  const numerator = substitute(rationalValue.numerator, replacements);
  const denominator = substitute(rationalValue.denominator, replacements);
  if (isZero(denominator)) throw new RangeError('rational function is singular at this value');
  if (isZero(numerator)) return ZERO;
  if (isNumber(numerator) && isNumber(denominator)) {
    return rational(numerator.numerator * denominator.denominator, numerator.denominator * denominator.numerator);
  }
  return rationalFunction(numerator, denominator, { ...options, variable: rationalValue.variable });
}

/** Rebuild an already canonical expression under an optional operation budget. */
export function simplify(value, options = {}) {
  const expression = asExpression(value);
  const budget = options.budget || new OperationBudget(options.maxOperations ?? DEFAULT_MAX_OPERATIONS);
  try {
    budget.step(expressionNodeCount(expression));
    return substitute(expression, new Map());
  } catch (error) {
    if (error instanceof BudgetExceeded) return expression;
    throw error;
  }
}

function expressionNodeCount(value) {
  if (value.kind === 'number' || value.kind === 'symbol') return 1;
  if (value.kind === 'power') return 1 + expressionNodeCount(value.base);
  return 1 + value[`${value.kind === 'add' ? 'terms' : 'factors'}`].reduce((count, child) => count + expressionNodeCount(child), 0);
}

/** Return a deterministic structural string for diagnostics and focused tests. */
export function formatExpression(value) {
  const expression = asExpression(value);
  if (isInfinity(expression)) return expression.sign < 0 ? '-infinity' : 'infinity';
  if (isNumber(expression)) return expression.denominator === 1n ? String(expression.numerator) : `${expression.numerator}/${expression.denominator}`;
  if (expression.kind === 'symbol') return expression.name;
  if (expression.kind === 'power') {
    const base = expression.base.kind === 'symbol' ? formatExpression(expression.base) : `(${formatExpression(expression.base)})`;
    return `${base}^${expression.exponent}`;
  }
  if (expression.kind === 'multiply') {
    const negative = isMinusOne(expression.factors[0]);
    const factors = negative ? expression.factors.slice(1) : expression.factors;
    const body = factors.map(factor => factor.kind === 'add' ? `(${formatExpression(factor)})` : formatExpression(factor)).join('*');
    if (negative) return `-${body}`;
    return body;
  }
  const terms = [...expression.terms].sort((left, right) => variableDegree(right) - variableDegree(left)
    || compareKeys(expressionKey(left), expressionKey(right)));
  return terms.map((term, index) => {
    const negative = term.kind === 'multiply' && isMinusOne(term.factors[0]);
    if (negative) return `${index ? ' - ' : '-'}${formatExpression(negate(term))}`;
    if (isNumber(term) && term.numerator < 0n) return `${index ? ' - ' : '-'}${formatExpression(negate(term))}`;
    return `${index ? ' + ' : ''}${formatExpression(term)}`;
  }).join('');
}

/** Return a canonical expression's stable identity. */
export function keyOf(value) {
  return expressionKey(asExpression(value));
}

/** Return an exact signed infinity sentinel. */
export function infinity(sign = 1) {
  return Object.freeze({ kind: 'infinity', sign: sign < 0 ? -1 : 1 });
}

/** Test the exact infinity sentinel. */
export function isInfinite(value) {
  return isInfinity(value);
}

/** Create the finite mutable budget shared by one exact analysis. */
export function createOperationBudget(limit = DEFAULT_MAX_OPERATIONS) {
  return new OperationBudget(limit);
}

/** Return whether a shared exact-analysis budget has been exhausted. */
export function isBudgetExceeded(budget) {
  return Boolean(budget?.exceeded);
}

export const int = integer;
export const sym = symbol;
export const mul = multiply;
export const addRational = rationalAdd;
export const mulRational = rationalMultiply;
export const divRational = rationalDivide;
export const normalizeRational = rationalFunction;
