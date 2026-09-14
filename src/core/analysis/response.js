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

function rootRecords(coefficients, role, variable) {
  if (!coefficients?.length) return [];
  const degree = coefficients[0].power;
  if (degree === 0) return [];
  const polynomial = polynomialExpression(coefficients, variable);
  const base = { role, order: degree, polynomial, coefficients };
  if (degree === 1) {
    const linear = coefficientAt(coefficients, 1);
    const constant = coefficientAt(coefficients, 0);
    return [{ ...base, index: 0, kind: 'root', root: quotient(negate(constant), linear) }];
  }
  if (degree === 2) {
    const a = coefficientAt(coefficients, 2);
    const b = coefficientAt(coefficients, 1);
    const c = coefficientAt(coefficients, 0);
    const discriminant = add(multiply(b, b), negate(multiply(integer(4), a, c)));
    return [-1, 1].map((sign, index) => ({
      ...base,
      index,
      kind: 'quadratic-root',
      root: {
        kind: 'quadratic-formula',
        sign,
        numerator: { kind: 'quadratic-numerator', linear: negate(b), discriminant },
        denominator: multiply(integer(2), a),
        a,
        b,
        c,
        discriminant,
      },
    }));
  }
  return [{ ...base, index: 0, kind: 'polynomial' }];
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

export const canonicalResponse = analyzeResponse;
export const canonicalResponses = processResponses;
