import {
  add,
  integer,
  multiply,
  negate,
  polynomialCoefficients,
  power,
  rational,
  rationalFunction,
  symbol,
} from './rational.js';

const DEFAULT_VARIABLE = 's';
const ZERO = integer(0);
const ONE = integer(1);

function asRational(value, variable, options) {
  if (value?.kind === 'rational') {
    return rationalFunction(value.numerator, value.denominator, {
      ...options,
      variable,
    });
  }
  return rationalFunction(value ?? ONE, ONE, { ...options, variable });
}

function quotient(numerator, denominator) {
  if (denominator.kind === 'number') {
    if (numerator.kind === 'number') {
      return rational(
        numerator.numerator * denominator.denominator,
        numerator.denominator * denominator.numerator,
      );
    }
    return multiply(numerator, rational(denominator.denominator, denominator.numerator));
  }
  return multiply(numerator, power(denominator, -1));
}

function coefficientAt(coefficients, exponent) {
  return coefficients.find(({ power: powerValue }) => powerValue === exponent)?.coefficient || ZERO;
}

function polynomialInfo(expression, variable, options) {
  const coefficients = polynomialCoefficients(expression, variable, options);
  if (!coefficients) return null;
  return Object.freeze({
    coefficients,
    degree: coefficients.length ? coefficients[0].power : null,
    valuation: coefficients.length ? coefficients[coefficients.length - 1].power : null,
  });
}

function limitAtZero(numeratorInfo, denominatorInfo) {
  if (!numeratorInfo || !denominatorInfo) {
    return Object.freeze({ kind: 'unknown', value: null, order: null, coefficient: null });
  }
  if (numeratorInfo.valuation === null) {
    return Object.freeze({ kind: 'zero', value: ZERO, order: null, coefficient: ZERO });
  }
  if (denominatorInfo.valuation === null) {
    return Object.freeze({ kind: 'unknown', value: null, order: null, coefficient: null });
  }

  const numeratorCoefficient = coefficientAt(numeratorInfo.coefficients, numeratorInfo.valuation);
  const denominatorCoefficient = coefficientAt(denominatorInfo.coefficients, denominatorInfo.valuation);
  const order = denominatorInfo.valuation - numeratorInfo.valuation;
  if (order > 0) {
    return Object.freeze({
      kind: 'pole',
      value: null,
      order,
      coefficient: quotient(numeratorCoefficient, denominatorCoefficient),
    });
  }
  if (order < 0) {
    return Object.freeze({
      kind: 'zero',
      value: ZERO,
      order: -order,
      coefficient: quotient(numeratorCoefficient, denominatorCoefficient),
    });
  }
  const value = quotient(numeratorCoefficient, denominatorCoefficient);
  return Object.freeze({
    kind: value === ZERO ? 'zero' : 'finite',
    value,
    order: 0,
    coefficient: value,
  });
}

function limitAtInfinity(numeratorInfo, denominatorInfo) {
  if (!numeratorInfo || !denominatorInfo) {
    return Object.freeze({ kind: 'unknown', value: null, order: null, coefficient: null });
  }
  if (numeratorInfo.degree === null) {
    return Object.freeze({ kind: 'zero', value: ZERO, order: null, coefficient: ZERO });
  }
  if (denominatorInfo.degree === null) {
    return Object.freeze({ kind: 'unknown', value: null, order: null, coefficient: null });
  }

  const numeratorCoefficient = coefficientAt(numeratorInfo.coefficients, numeratorInfo.degree);
  const denominatorCoefficient = coefficientAt(denominatorInfo.coefficients, denominatorInfo.degree);
  const order = numeratorInfo.degree - denominatorInfo.degree;
  if (order > 0) {
    return Object.freeze({
      kind: 'pole',
      value: null,
      order,
      coefficient: quotient(numeratorCoefficient, denominatorCoefficient),
    });
  }
  if (order < 0) {
    return Object.freeze({
      kind: 'zero',
      value: ZERO,
      order: -order,
      coefficient: quotient(numeratorCoefficient, denominatorCoefficient),
    });
  }
  const value = quotient(numeratorCoefficient, denominatorCoefficient);
  return Object.freeze({
    kind: value === ZERO ? 'zero' : 'finite',
    value,
    order: 0,
    coefficient: value,
  });
}

function polynomialExpression(coefficients, variable) {
  return add(coefficients.map(({ power: exponent, coefficient }) => (
    exponent === 0 ? coefficient : multiply(coefficient, power(symbol(variable), exponent))
  )));
}

function isZeroExpression(value) {
  return value?.kind === 'number' && value.numerator === 0n;
}

function integerSquareRoot(value) {
  if (value < 0n) return null;
  if (value < 2n) return value;
  let x = BigInt(Math.floor(Math.sqrt(Number(value))));
  while (x * x > value) x -= 1n;
  while ((x + 1n) * (x + 1n) <= value) x += 1n;
  return x * x === value ? x : null;
}

/** Exact square root of a monomial with even exponents (e.g. `4 C_M^2 g_m^2`), or null. */
function monomialSquareRoot(value) {
  if (value.kind === 'number') {
    const numerator = integerSquareRoot(value.numerator);
    const denominator = integerSquareRoot(value.denominator);
    return numerator === null || denominator === null ? null : rational(numerator, denominator);
  }
  if (value.kind === 'symbol') return null;
  if (value.kind === 'power') {
    return value.exponent % 2 === 0 && value.base.kind !== 'number' ? power(value.base, value.exponent / 2) : null;
  }
  if (value.kind === 'multiply') {
    const roots = value.factors.map(monomialSquareRoot);
    return roots.some((root) => root === null) ? null : multiply(roots);
  }
  return null;
}

/** Cancel common factors of a root fraction (as a rational function). */
function rootValue(numerator, denominator, variable) {
  return rationalFunction(numerator, denominator, { variable });
}

/** A root location expression from its cancelled fraction. */
function rootExpression(numerator, denominator, variable) {
  const value = rootValue(numerator, denominator, variable);
  return isOneExpression(value.denominator) ? value.numerator : quotient(value.numerator, value.denominator);
}

function rootRecords(coefficients, role, variable) {
  if (!coefficients?.length) return [];
  const degree = coefficients[0].power;
  if (degree === 0) return [];
  const polynomial = polynomialExpression(coefficients, variable);
  const base = { role, order: degree, polynomial, coefficients };
  // Roots at the origin are exact and need no formula: s^k * P(s).
  const valuation = coefficients[coefficients.length - 1].power;
  if (valuation > 0) {
    const reduced = coefficients.map(({ power: exponent, coefficient }) => ({ power: exponent - valuation, coefficient }));
    const origin = Array.from({ length: valuation }, () => ({ ...base, kind: 'root', root: ZERO }));
    return [...origin, ...rootRecords(reduced, role, variable)]
      .map((record, index) => ({ ...record, ...base, index }));
  }
  if (degree === 1) {
    const linear = coefficientAt(coefficients, 1);
    const constant = coefficientAt(coefficients, 0);
    return [{ ...base, index: 0, kind: 'root', root: rootExpression(negate(constant), linear, variable) }];
  }
  if (degree === 2) {
    const a = coefficientAt(coefficients, 2);
    const b = coefficientAt(coefficients, 1);
    const c = coefficientAt(coefficients, 0);
    const discriminant = add(multiply(b, b), negate(multiply(integer(4), a, c)));
    // Monic form s^2 + B s + C, B = b/a and C = c/a, both cancelled, so
    // s = (-B_n +- sqrt(B_n^2 - 4 C B_d^2)) / (2 B_d).
    const monicLinear = rootValue(b, a, variable);
    const monicConstant = rootValue(c, a, variable);
    const reducedDiscriminant = rootValue(
      add(
        multiply(monicLinear.numerator, monicLinear.numerator, monicConstant.denominator),
        negate(multiply(integer(4), monicConstant.numerator, power(monicLinear.denominator, 2))),
      ),
      monicConstant.denominator,
      variable,
    );
    const monic = isOneExpression(reducedDiscriminant.denominator);
    const shownDiscriminant = monic ? reducedDiscriminant.numerator : discriminant;
    const linear = monic ? negate(monicLinear.numerator) : negate(b);
    const denominator = monic ? multiply(integer(2), monicLinear.denominator) : multiply(integer(2), a);
    const squareRoot = monomialSquareRoot(shownDiscriminant);
    return [-1, 1].map((sign, index) => {
      if (squareRoot) {
        return {
          ...base, index, kind: 'root',
          root: rootExpression(add(linear, sign < 0 ? negate(squareRoot) : squareRoot), denominator, variable),
        };
      }
      return {
        ...base,
        index,
        kind: 'quadratic-root',
        root: {
          kind: 'quadratic-formula',
          sign,
          numerator: { kind: 'quadratic-numerator', linear, discriminant: shownDiscriminant },
          denominator,
          a,
          b,
          c,
          discriminant: shownDiscriminant,
        },
      };
    });
  }
  return [{ ...base, index: 0, kind: 'polynomial' }];
}

function isOneExpression(value) {
  return value?.kind === 'number' && value.numerator === 1n && value.denominator === 1n;
}

function responseRecord(value, options = {}) {
  const variable = options.variable || value?.variable || DEFAULT_VARIABLE;
  const expression = asRational(value, variable, options);
  const numeratorInfo = polynomialInfo(expression.numerator, variable, options);
  const denominatorInfo = polynomialInfo(expression.denominator, variable, options);
  const hasFrequency = Boolean(
    numeratorInfo?.coefficients.some(({ power: exponent }) => exponent > 0)
    || denominatorInfo?.coefficients.some(({ power: exponent }) => exponent > 0),
  );
  return Object.freeze({
    expression,
    numerator: expression.numerator,
    denominator: expression.denominator,
    numeratorCoefficients: numeratorInfo?.coefficients || null,
    denominatorCoefficients: denominatorInfo?.coefficients || null,
    numeratorDegree: numeratorInfo?.degree ?? null,
    denominatorDegree: denominatorInfo?.degree ?? null,
    numeratorValuation: numeratorInfo?.valuation ?? null,
    denominatorValuation: denominatorInfo?.valuation ?? null,
    degrees: Object.freeze({ numerator: numeratorInfo?.degree ?? null, denominator: denominatorInfo?.degree ?? null }),
    dc: limitAtZero(numeratorInfo, denominatorInfo),
    infinity: limitAtInfinity(numeratorInfo, denominatorInfo),
    hasFrequency,
    poles: hasFrequency ? rootRecords(denominatorInfo?.coefficients, 'pole', variable) : [],
    zeros: hasFrequency ? rootRecords(numeratorInfo?.coefficients, 'zero', variable) : [],
  });
}

/** Canonicalize one exact response and derive limits, degrees, poles, and zeros. */
export function analyzeResponse(value, options = {}) {
  return responseRecord(value, options);
}

/** Process the Av/Zin/Zout response set through one topology-independent path. */
export function processResponses(responses = {}, options = {}) {
  const variable = options.variable || DEFAULT_VARIABLE;
  const result = {};
  for (const name of ['Av', 'Zin', 'Zout']) {
    if (responses[name] !== undefined && responses[name] !== null) {
      result[name] = responseRecord(responses[name], { ...options, variable });
    }
  }
  return Object.freeze(result);
}
