/**
 * Exact multi-RHS linear solver for the matrix produced by mna.js.
 *
 * The solver uses only the MNA algebra contract: `zero`, `one`, `add`, `sub`,
 * `mul`, `div`, `neg`, and `isZero`. Pivoting chooses the first nonzero row in
 * each column, making results deterministic for symbolic values. Bareiss
 * elimination keeps intermediate values fraction-free when the injected
 * algebra supports exact division; set `fractionFree: false` for a plain
 * normalized elimination pass.
 */

import { numberOps, validateMnaOps } from './mna.js';

const DEFAULT_MAX_MATRIX_SIZE = 256;
const DEFAULT_MAX_WORK = 1_000_000;

function isMatrix(value) {
  return Array.isArray(value) && (value.length === 0 || Array.isArray(value[0]));
}

function cloneMatrix(matrix) {
  return matrix.map((row) => [...row]);
}

function assertMatrix(matrix, name, rows = null, columns = null) {
  if (!isMatrix(matrix)) throw new TypeError(`${name} must be a matrix`);
  const width = matrix.length ? matrix[0].length : columns ?? 0;
  if (matrix.some((row) => !Array.isArray(row) || row.length !== width)) {
    throw new RangeError(`${name} rows must have equal length`);
  }
  if (rows !== null && matrix.length !== rows) throw new RangeError(`${name} must have ${rows} rows`);
  if (columns !== null && width !== columns) throw new RangeError(`${name} must have ${columns} columns`);
  return { rows: matrix.length, columns: width };
}

function normalizeRhs(rhs, rowCount, ops) {
  if (rhs === undefined) return Array.from({ length: rowCount }, () => [ops.zero]);
  if (rowCount === 0 && Array.isArray(rhs) && rhs.length === 0) return [];
  if (!isMatrix(rhs)) {
    if (!Array.isArray(rhs) || rhs.length !== rowCount) throw new RangeError(`B must have ${rowCount} rows`);
    return rhs.map((value) => [value]);
  }
  const shape = assertMatrix(rhs, 'B', rowCount);
  if (shape.columns < 1) throw new RangeError('B must have at least one RHS column');
  return cloneMatrix(rhs);
}

function failure(code, message, details = {}) {
  return { ok: false, code, error: message, ...details };
}

function finiteLimit(value, fallback, name) {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError(`${name} must be a finite non-negative integer`);
  return limit;
}

function budgetFailure(ops, phase) {
  const budget = ops.budget;
  if (!budget?.exceeded) return null;
  return failure('operation-budget', `symbolic operation budget exhausted during ${phase}`, {
    phase,
    budget: { used: budget.used, limit: budget.limit },
  });
}

function workGuard(limit) {
  let used = 0;
  return {
    step(amount = 1) {
      used += amount;
      return used <= limit;
    },
    get used() { return used; },
  };
}

function workFailure(guard) {
  return failure('solver-work-limit', `solver work limit exhausted after ${guard.used} operations`, {
    work: guard.used,
  });
}

function singularResult(variables, pivotColumn, pivotRow, rhs, ops) {
  const variable = variables?.[pivotColumn] || `column ${pivotColumn}`;
  const inconsistent = rhs[pivotRow]?.some((value) => !ops.isZero(value)) || false;
  return failure(
    inconsistent ? 'inconsistent' : 'singular',
    inconsistent
      ? `inconsistent system: no pivot for ${variable} but a RHS is nonzero`
      : `singular system: no nonzero pivot for ${variable}`,
    { pivotColumn, pivotRow, variables: variables || undefined },
  );
}

function solveNormalized(a, b, ops, variables, guard) {
  const n = a.length;
  const rhsCount = b[0]?.length || 0;
  for (let column = 0; column < n; column++) {
    const budgetError = budgetFailure(ops, 'normalized elimination');
    if (budgetError) return budgetError;
    const pivotRow = a.slice(column).findIndex((row) => !ops.isZero(row[column]));
    if (pivotRow < 0) return singularResult(variables, column, column, b, ops);
    const actual = column + pivotRow;
    if (actual !== column) {
      [a[column], a[actual]] = [a[actual], a[column]];
      [b[column], b[actual]] = [b[actual], b[column]];
    }
    const pivot = a[column][column];
    if (ops.isZero(pivot)) return singularResult(variables, column, column, b, ops);
    for (let j = column; j < n; j++) {
      if (!guard.step()) return workFailure(guard);
      a[column][j] = ops.div(a[column][j], pivot);
      const budgetError = budgetFailure(ops, 'normalized elimination');
      if (budgetError) return budgetError;
    }
    for (let rhsColumn = 0; rhsColumn < rhsCount; rhsColumn++) {
      if (!guard.step()) return workFailure(guard);
      b[column][rhsColumn] = ops.div(b[column][rhsColumn], pivot);
      const budgetError = budgetFailure(ops, 'normalized elimination');
      if (budgetError) return budgetError;
    }
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      if (!guard.step()) return workFailure(guard);
      const factor = a[row][column];
      if (ops.isZero(factor)) continue;
      for (let j = column; j < n; j++) {
        if (!guard.step(2)) return workFailure(guard);
        a[row][j] = ops.sub(a[row][j], ops.mul(factor, a[column][j]));
        const budgetError = budgetFailure(ops, 'normalized elimination');
        if (budgetError) return budgetError;
      }
      for (let rhsColumn = 0; rhsColumn < rhsCount; rhsColumn++) {
        if (!guard.step(2)) return workFailure(guard);
        b[row][rhsColumn] = ops.sub(b[row][rhsColumn], ops.mul(factor, b[column][rhsColumn]));
        const budgetError = budgetFailure(ops, 'normalized elimination');
        if (budgetError) return budgetError;
      }
      a[row][column] = ops.zero;
    }
  }
  return b;
}

function solveBareiss(a, b, ops, variables, guard) {
  const n = a.length;
  const rhsCount = b[0]?.length || 0;
  let previousPivot = ops.one;
  for (let column = 0; column < n - 1; column++) {
    const budgetError = budgetFailure(ops, 'fraction-free elimination');
    if (budgetError) return budgetError;
    const pivotRow = a.slice(column).findIndex((row) => !ops.isZero(row[column]));
    if (pivotRow < 0) return singularResult(variables, column, column, b, ops);
    const actual = column + pivotRow;
    if (actual !== column) {
      [a[column], a[actual]] = [a[actual], a[column]];
      [b[column], b[actual]] = [b[actual], b[column]];
    }
    const pivot = a[column][column];
    if (ops.isZero(pivot)) return singularResult(variables, column, column, b, ops);
    if (ops.isZero(previousPivot)) {
      return failure('singular', `cannot divide by zero Bareiss pivot before ${variables?.[column] || `column ${column}`}`, {
        pivotColumn: column,
        pivotRow: column,
        variables,
      });
    }
    for (let row = column + 1; row < n; row++) {
      if (!guard.step()) return workFailure(guard);
      const left = a[row][column];
      if (ops.isZero(left)) continue;
      for (let j = column + 1; j < n; j++) {
        if (!guard.step(5)) return workFailure(guard);
        const numerator = ops.sub(ops.mul(pivot, a[row][j]), ops.mul(left, a[column][j]));
        a[row][j] = ops.div(numerator, previousPivot);
        const budgetError = budgetFailure(ops, 'fraction-free elimination');
        if (budgetError) return budgetError;
      }
      for (let rhsColumn = 0; rhsColumn < rhsCount; rhsColumn++) {
        if (!guard.step(5)) return workFailure(guard);
        const numerator = ops.sub(ops.mul(pivot, b[row][rhsColumn]), ops.mul(left, b[column][rhsColumn]));
        b[row][rhsColumn] = ops.div(numerator, previousPivot);
        const budgetError = budgetFailure(ops, 'fraction-free elimination');
        if (budgetError) return budgetError;
      }
      a[row][column] = ops.zero;
    }
    previousPivot = pivot;
  }
  if (n && ops.isZero(a[n - 1][n - 1])) return singularResult(variables, n - 1, n - 1, b, ops);

  const solution = Array.from({ length: n }, () => Array(rhsCount).fill(ops.zero));
  for (let row = n - 1; row >= 0; row--) {
    const budgetError = budgetFailure(ops, 'back substitution');
    if (budgetError) return budgetError;
    const pivot = a[row][row];
    if (ops.isZero(pivot)) return singularResult(variables, row, row, b, ops);
    for (let rhsColumn = 0; rhsColumn < rhsCount; rhsColumn++) {
      let remainder = b[row][rhsColumn];
      for (let j = row + 1; j < n; j++) {
        if (!guard.step(2)) return workFailure(guard);
        remainder = ops.sub(remainder, ops.mul(a[row][j], solution[j][rhsColumn]));
        const budgetError = budgetFailure(ops, 'back substitution');
        if (budgetError) return budgetError;
      }
      if (!guard.step()) return workFailure(guard);
      solution[row][rhsColumn] = ops.div(remainder, pivot);
      const budgetError = budgetFailure(ops, 'back substitution');
      if (budgetError) return budgetError;
    }
  }
  return solution;
}

/**
 * Solve `A * X = B`, returning values in the original variable order.
 * `B` is row-major (`B[row][rhsColumn]`); a single RHS may also be a vector.
 * Row swaps affect equations only, so no source-row metadata is used when
 * mapping the resulting rows back to variables.
 */
export function solveLinearSystem(A, B, options = {}) {
  const ops = validateMnaOps(options.ops || numberOps());
  const aShape = assertMatrix(A, 'A');
  if (aShape.rows !== aShape.columns) throw new RangeError('A must be square');
  const maxMatrixSize = finiteLimit(options.maxMatrixSize, DEFAULT_MAX_MATRIX_SIZE, 'maxMatrixSize');
  if (aShape.rows > maxMatrixSize) {
    return failure('matrix-size-limit', `solver matrix has ${aShape.rows} unknowns; limit is ${maxMatrixSize}`, {
      size: aShape.rows,
      limit: maxMatrixSize,
    });
  }
  const maxWork = finiteLimit(options.maxWork, DEFAULT_MAX_WORK, 'maxWork');
  const guard = workGuard(maxWork);
  const b = normalizeRhs(B, aShape.rows, ops);
  const variables = options.variables || options.unknowns || null;
  if (variables && variables.length !== aShape.rows) throw new RangeError('variables must match A dimensions');
  if (aShape.rows === 0) {
    const values = [];
    return { ok: true, values, solution: values, columns: [], variables: variables || [] };
  }

  const solved = options.fractionFree === false
    ? solveNormalized(cloneMatrix(A), b, ops, variables, guard)
    : solveBareiss(cloneMatrix(A), b, ops, variables, guard);
  if (!Array.isArray(solved)) return solved;
  const values = cloneMatrix(solved);
  const columns = Array.from({ length: values[0]?.length || 0 }, (_, column) => values.map((row) => row[column]));
  const result = { ok: true, values, solution: values, columns, variables: variables || undefined };
  if (variables) {
    result.byVariable = columns.map((column) => new Map(variables.map((name, index) => [name, column[index]])));
  }
  return result;
}

/** Solve an object returned by `buildMNA`. */
export function solveMNA(system, options = {}) {
  if (!system || !Array.isArray(system.A) || !Array.isArray(system.B)) {
    throw new TypeError('solveMNA requires a system returned by buildMNA');
  }
  return solveLinearSystem(system.A, system.B, {
    ...options,
    ops: options.ops || system.ops,
    variables: options.variables || system.unknowns,
  });
}

export const solve = solveLinearSystem;
export const solveSystem = solveLinearSystem;
export const solveMna = solveMNA;
