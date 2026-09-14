/**
 * Adapt rational.js to the small algebra contract used by MNA and solve.
 *
 * MNA values are always rational-function nodes. Keeping quotients inside the
 * adapter avoids mixing raw expression nodes with rational nodes during a
 * solve, while rational.js remains responsible for canonicalization.
 */

import {
  integer,
  rationalAdd,
  rationalDivide,
  rationalFunction,
  rationalMultiply,
  infinity,
  createOperationBudget,
  isInfinite,
  symbol as makeSymbol,
} from './rational.js';

const DEFAULT_MAX_OPERATIONS = 10000;
const INFINITY_NAMES = new Set(['inf', 'infinity', 'infty', '∞', '\\infty']);

function isRational(value) {
  return value?.kind === 'rational';
}

function expressionIsZero(value) {
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'bigint') return value === 0n;
  return value?.kind === 'number' && value.numerator === 0n;
}

function rationalIsZero(value) {
  return isRational(value) && value.budgetExceeded !== true && expressionIsZero(value.numerator);
}

function withBudgetFlag(value) {
  if (!isRational(value) || value.budgetExceeded === true) return value;
  return Object.freeze({ ...value, budgetExceeded: true });
}

function normalize(value, variable, budget = null) {
  if (isInfinite(value)) return value;
  if (isRational(value)) {
    if (value.variable !== variable) {
      throw new RangeError(`rational variable must be ${variable}`);
    }
    return value;
  }
  return rationalFunction(value, integer(1), { variable, ...(budget ? { budget } : {}) });
}

/**
 * Build an exact rational algebra implementation for MNA and solve.
 *
 * `maxOperations` is a shared dispatch budget. Each adapter operation passes
 * the same budget to rational.js. Exhaustion is terminal for the analysis.
 */
export function createRationalOps(options = {}) {
  const variable = String(options.variable || 's');
  if (!variable) throw new TypeError('rational variable must not be empty');
  const budget = options.budget || createOperationBudget(options.maxOperations ?? DEFAULT_MAX_OPERATIONS);
  if (!Number.isFinite(budget.limit) || !Number.isSafeInteger(budget.limit) || budget.limit < 0) {
    throw new RangeError('budget.limit must be a finite non-negative integer');
  }

  const zero = normalize(integer(0), variable);
  const one = normalize(integer(1), variable);

  function operation(run, inputs = []) {
    const values = inputs.map((value) => normalize(value, variable, budget));
    if (budget.exceeded || values.some((value) => value?.budgetExceeded === true)) {
      budget.exceeded = true;
      return withBudgetFlag(zero);
    }
    let result;
    try {
      budget.step();
      result = run(values, { budget });
    } catch (error) {
      if (!budget.exceeded) throw error;
      return withBudgetFlag(zero);
    }
    if (!isRational(result)) result = normalize(result, variable);
    if (budget.exceeded || values.some((value) => value.budgetExceeded === true) || result.budgetExceeded === true) {
      budget.exceeded = true;
      return withBudgetFlag(result);
    }
    return result;
  }

  const ops = {
    zero,
    one,
    add: (left, right) => operation(
      ([a, b], { budget: shared }) => rationalAdd(a, b, { variable, budget: shared }),
      [left, right],
    ),
    sub: (left, right) => operation(
      ([a, b], { budget: shared }) => rationalAdd(a, rationalMultiply(b, normalize(integer(-1), variable, shared), {
        variable,
        budget: shared,
      }), { variable, budget: shared }),
      [left, right],
    ),
    mul: (left, right) => operation(
      ([a, b], { budget: shared }) => rationalMultiply(a, b, { variable, budget: shared }),
      [left, right],
    ),
    div: (left, right) => operation(
      ([a, b], { budget: shared }) => rationalDivide(a, b, { variable, budget: shared }),
      [left, right],
    ),
    neg: (value) => operation(
      ([a], { budget: shared }) => rationalMultiply(a, normalize(integer(-1), variable, shared), {
        variable,
        budget: shared,
      }),
      [value],
    ),
    isZero: (value) => isRational(value) ? rationalIsZero(value) : expressionIsZero(value),
    infinity: (sign = 1) => infinity(sign),
    symbol: (name) => INFINITY_NAMES.has(String(name).trim().toLowerCase())
      ? infinity()
      : normalize(makeSymbol(name), variable, budget),
    s: () => normalize(makeSymbol(variable), variable, budget),
  };

  Object.defineProperties(ops, {
    variable: { value: variable, enumerable: true },
    budget: { value: budget, enumerable: true },
  });
  return Object.freeze(ops);
}

export const rationalOps = createRationalOps;
export const makeRationalOps = createRationalOps;
