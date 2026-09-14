/**
 * Extract small-signal queries from one solved multi-RHS MNA system.
 *
 * MNA voltage-source currents are positive from the source's `a` terminal to
 * its `b` terminal. Query currents are positive into the circuit, so a
 * voltage-source branch normally uses `sign: -1`. An injected current RHS
 * may use `sign: 1` when its reported unknown already follows that direction.
 * The sign is explicit in the excitation metadata and is returned with each
 * impedance result.
 *
 * Metadata shape:
 * {
 *   inputDrive: {
 *     rhsColumn: 0,
 *     voltageUnknown: 'V(IN)',
 *     currentUnknown: 'I(VIN)',
 *     currentSign: -1,
 *   },
 *   outputTest: {
 *     rhsColumn: 1,
 *     inputZeroed: true,
 *     voltageUnknown: 'V(OUT)',
 *     currentUnknown: 'I(VTEST)',
 *     currentSign: -1,
 *   },
 *   inputVoltageUnknown: 'V(IN)',
 *   outputVoltageUnknown: 'V(OUT)',
 * }
 *
 * `inputNode`/`outputNode` may replace the voltage unknowns; they are mapped
 * to `V(node)`. Branch names may replace current unknowns and are mapped to
 * `I(branch)`. The extractor only reads solved values and applies ratios. It
 * does not stamp, simplify, or replace direct gain with a cross-check.
 */

import { MNA_OPS } from './mna.js';
import { infinity } from './rational.js';

const NO_VALUE = null;

function diagnostic(code, message, details = {}) {
  return { code, message, ...details };
}

function failure(code, message, details = {}) {
  const item = diagnostic(code, message, details);
  return {
    ok: false,
    value: NO_VALUE,
    code,
    error: message,
    diagnostic: item,
    diagnostics: [item],
  };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function isMatrix(value) {
  return Array.isArray(value) && (value.length === 0 || Array.isArray(value[0]));
}

function validOps(ops) {
  if (!ops || typeof ops !== 'object') return false;
  return MNA_OPS.every((name) => {
    if (name === 'zero' || name === 'one') return Object.prototype.hasOwnProperty.call(ops, name);
    return typeof ops[name] === 'function';
  });
}

function normalizeColumns(solved, unknowns) {
  if (Array.isArray(solved.columns)) {
    if (solved.columns.some((column) => !Array.isArray(column) || column.length !== unknowns.length)) {
      return failure('invalid-solutions', 'Solved RHS columns must match the unknown count');
    }
    if (solved.columns.length === 0) return failure('invalid-solutions', 'Solved data has no RHS columns');
    return { ok: true, columns: solved.columns.map((column) => [...column]) };
  }

  const rows = firstDefined(solved.values, solved.solution);
  if (isMatrix(rows)) {
    if (rows.length !== unknowns.length || rows.some((row) => !Array.isArray(row) || row.length < 1)) {
      return failure('invalid-solutions', 'Solved row-major values must be unknown-count by RHS-count');
    }
    return {
      ok: true,
      columns: Array.from({ length: rows[0].length }, (_, column) => rows.map((row) => row[column])),
    };
  }

  if (Array.isArray(solved.byVariable)) {
    const maps = solved.byVariable;
    if (maps.length === 0 || maps.some((map) => !(map instanceof Map))) {
      return failure('invalid-solutions', 'Solved byVariable data must contain RHS maps');
    }
    return {
      ok: true,
      columns: maps.map((map) => unknowns.map((unknown) => map.get(unknown))),
    };
  }

  return failure('invalid-solutions', 'Solved data must provide columns, values, solution, or byVariable');
}

function prepare(solved, options) {
  if (!solved || typeof solved !== 'object') return failure('invalid-solutions', 'Solved MNA data is required');
  if (solved.ok === false) return failure('invalid-solutions', solved.error || 'Solved MNA data is not valid');
  const rawUnknowns = firstDefined(solved.unknowns, solved.variables);
  if (!Array.isArray(rawUnknowns) || rawUnknowns.some((unknown) => unknown === undefined || unknown === null)) {
    return failure('invalid-unknowns', 'Solved data must provide an ordered unknown list');
  }
  const unknowns = rawUnknowns.map(String);
  const unique = new Set(unknowns);
  if (unique.size !== unknowns.length) return failure('invalid-unknowns', 'Solved unknowns must be unique');
  const settings = options && typeof options === 'object' ? options : {};
  const ops = firstDefined(settings.ops, solved.ops);
  if (!validOps(ops)) return failure('invalid-ops', 'A complete MNA algebra ops object is required');
  const normalized = normalizeColumns(solved, unknowns);
  if (!normalized.ok) return normalized;
  if (solved.rhsCount !== undefined && solved.rhsCount !== normalized.columns.length) {
    return failure('invalid-solutions', 'Solved RHS count does not match its columns');
  }
  return { ok: true, ops, unknowns, columns: normalized.columns };
}

function rhsColumn(prepared, value, role) {
  const column = Number(value);
  if (!Number.isInteger(column) || column < 0 || column >= prepared.columns.length) {
    return failure('missing-rhs-column', `${role} RHS column ${String(value)} does not exist`, {
      rhsColumn: value,
      rhsCount: prepared.columns.length,
    });
  }
  return { ok: true, column };
}

function unknownName(prepared, descriptor, role, kind) {
  const raw = typeof descriptor === 'object' && descriptor !== null
    ? firstDefined(descriptor.unknown, descriptor.name, descriptor.node, descriptor.branch)
    : descriptor;
  if (raw === undefined || raw === null || raw === '') {
    return failure('missing-unknown', `${role} ${kind} unknown is required`, { role, kind });
  }
  const text = String(raw);
  const candidates = kind === 'voltage'
    ? [text, `V(${text})`]
    : [text, `I(${text})`];
  const match = candidates.find((candidate) => prepared.unknowns.includes(candidate));
  if (!match) {
    return failure('missing-unknown', `${role} ${kind} unknown "${text}" is not in the solved system`, {
      role, kind, unknown: text,
    });
  }
  return { ok: true, unknown: match, index: prepared.unknowns.indexOf(match) };
}

function valueAt(prepared, column, descriptor, role, kind) {
  const unknown = unknownName(prepared, descriptor, role, kind);
  if (!unknown.ok) return unknown;
  const value = prepared.columns[column][unknown.index];
  if (value === undefined || (typeof value === 'number' && Number.isNaN(value))) {
    return failure('invalid-solved-value', `${role} ${kind} value is missing or NaN`, {
      role, kind, unknown: unknown.unknown, rhsColumn: column,
    });
  }
  return { ok: true, unknown: unknown.unknown, value };
}

function resolveSpec(metadata, key, fallback = {}) {
  const direct = metadata[key];
  if (!direct || typeof direct !== 'object') return fallback;
  const nested = firstDefined(direct.source, direct.excitation);
  return nested && typeof nested === 'object' ? { ...nested, ...direct } : { ...direct };
}

function resolveColumn(prepared, spec, role) {
  return rhsColumn(prepared, firstDefined(spec.rhsColumn, spec.column, spec.rhs), role);
}

function resolveVoltage(prepared, spec, column, fallback, role) {
  const descriptor = firstDefined(
    spec.voltageUnknown,
    spec.testVoltageUnknown,
    spec.voltage,
    spec.nodeVoltage,
    spec.node,
    fallback,
  );
  return valueAt(prepared, column, descriptor, role, 'voltage');
}

function currentSign(spec, defaultSign) {
  const sign = firstDefined(spec.currentSign, spec.sign, defaultSign);
  if (sign === 1 || sign === -1) return { ok: true, sign };
  return failure('invalid-current-sign', 'Current sign must be +1 or -1', { sign });
}

function signOf(value) {
  const number = value?.kind === 'number'
    ? value
    : value?.kind === 'rational' ? value.numerator : null;
  return number?.kind === 'number' && number.numerator < 0n ? -1 : 1;
}

function resolveCurrent(prepared, spec, column, fallback, role, defaultSign = -1) {
  const descriptor = firstDefined(
    spec.currentUnknown,
    spec.testCurrentUnknown,
    spec.sourceCurrentUnknown,
    spec.current,
    spec.branchCurrent,
    spec.branch,
    fallback,
  );
  const current = valueAt(prepared, column, descriptor, role, 'current');
  if (!current.ok) return current;
  const sign = currentSign(
    typeof descriptor === 'object' && descriptor !== null ? { ...spec, ...descriptor } : spec,
    defaultSign,
  );
  if (!sign.ok) return sign;
  return {
    ok: true,
    unknown: current.unknown,
    rawValue: current.value,
    value: sign.sign === 1 ? current.value : prepared.ops.neg(current.value),
    sign: sign.sign,
  };
}

function ratio(prepared, numerator, denominator, role) {
  if (prepared.ops.isZero(denominator.value)) {
    if (!prepared.ops.isZero(numerator.value)) {
      const sign = signOf(numerator.value);
      return {
        ok: true,
        value: typeof prepared.ops.infinity === 'function' ? prepared.ops.infinity(sign) : infinity(sign),
      };
    }
    return failure('undefined-result', `${role} is zero divided by zero`, {
      role, numerator: numerator.value, denominator: denominator.value,
    });
  }
  const value = prepared.ops.div(numerator.value, denominator.value);
  if (value === undefined || (typeof value === 'number' && Number.isNaN(value))) {
    return failure('invalid-result', `${role} produced an undefined or NaN value`, { role });
  }
  return { ok: true, value };
}

function queryResult(prepared, role, column, numerator, denominator, crossCheck = null) {
  const quotient = ratio(prepared, numerator, denominator, role);
  if (!quotient.ok) return quotient;
  return {
    ok: true,
    value: quotient.value,
    expression: quotient.value,
    rhsColumn: column,
    numerator,
    denominator,
    crossCheck,
  };
}

function crossCheck(prepared, spec, column, role) {
  if (!spec || spec.value !== undefined) {
    return spec?.value === undefined ? null : {
      ok: true,
      value: spec.value,
      source: 'optional-cross-check',
    };
  }
  const numerator = valueAt(prepared, column, spec.numeratorUnknown, role, 'cross-check numerator');
  const denominator = valueAt(prepared, column, spec.denominatorUnknown, role, 'cross-check denominator');
  if (!numerator.ok || !denominator.ok) {
    return {
      ok: false,
      source: 'optional-cross-check',
      diagnostic: diagnostic('invalid-cross-check', `${role} cross-check metadata is incomplete`),
    };
  }
  const quotient = ratio(prepared, numerator, denominator, `${role} cross-check`);
  return quotient.ok ? { ...quotient, source: 'optional-cross-check' } : {
    ...quotient,
    source: 'optional-cross-check',
  };
}

function invalidQueries(prepared) {
  const reason = prepared;
  const result = (role) => ({
    ok: false,
    value: NO_VALUE,
    code: reason.code,
    error: `${role}: ${reason.error}`,
    diagnostic: reason.diagnostic,
    diagnostics: reason.diagnostics,
  });
  return { ok: false, diagnostics: reason.diagnostics, av: result('Av'), zin: result('Zin'), zout: result('Zout') };
}

/** Extract Av(s), Zin(s), and Zout(s) from solved MNA columns. */
export function extractSmallSignalQueries(solved, metadata = {}, options = {}) {
  const prepared = prepare(solved, options);
  if (!prepared.ok) return invalidQueries(prepared);
  const context = metadata && typeof metadata === 'object' ? metadata : {};

  const input = resolveSpec(context, 'inputDrive', resolveSpec(context, 'input'));
  const output = resolveSpec(context, 'output');
  const test = resolveSpec(context, 'outputTest', resolveSpec(context, 'zout'));
  const inputColumn = resolveColumn(prepared, input, 'Input drive');
  const testColumn = resolveColumn(prepared, test, 'Output test');
  const diagnostics = [];

  const failed = (role, item) => {
    return {
      ok: false,
      value: NO_VALUE,
      code: item.code,
      error: `${role}: ${item.error}`,
      diagnostic: item.diagnostic,
      diagnostics: item.diagnostics || [item.diagnostic],
    };
  };

  let av;
  if (!inputColumn.ok) {
    av = failed('Av', inputColumn);
  } else {
    const inputVoltage = resolveVoltage(prepared, input, inputColumn.column, firstDefined(context.inputVoltageUnknown, context.inputNode), 'Av input');
    const outputVoltage = resolveVoltage(prepared, output, inputColumn.column, firstDefined(context.outputVoltageUnknown, context.outputNode), 'Av output');
    if (!inputVoltage.ok) av = failed('Av', inputVoltage);
    else if (!outputVoltage.ok) av = failed('Av', outputVoltage);
    else av = queryResult(prepared, 'Av', inputColumn.column, outputVoltage, inputVoltage,
      crossCheck(prepared, context.avCrossCheck, inputColumn.column, 'Av'));
  }

  let zin;
  if (!inputColumn.ok) {
    zin = failed('Zin', inputColumn);
  } else {
    const inputVoltage = resolveVoltage(prepared, input, inputColumn.column, firstDefined(context.inputVoltageUnknown, context.inputNode), 'Zin input');
    const inputCurrent = resolveCurrent(prepared, input, inputColumn.column, firstDefined(context.inputCurrentUnknown, context.inputBranch), 'Zin input', -1);
    if (!inputVoltage.ok) zin = failed('Zin', inputVoltage);
    else if (!inputCurrent.ok) zin = failed('Zin', inputCurrent);
    else zin = queryResult(prepared, 'Zin', inputColumn.column, inputVoltage, inputCurrent);
  }

  let zout;
  if (!testColumn.ok) {
    zout = failed('Zout', testColumn);
  } else if (inputColumn.ok && testColumn.column === inputColumn.column) {
    zout = failed('Zout', failure('non-independent-test', 'Output test must use a separate RHS column'));
  } else if (test.inputZeroed === false || test.independentInputZeroed === false) {
    zout = failed('Zout', failure('input-not-zeroed', 'Output test metadata must state that the independent input is zeroed'));
  } else {
    const testVoltage = resolveVoltage(prepared, test, testColumn.column, firstDefined(context.outputTestVoltageUnknown, context.outputNode), 'Zout test');
    const testCurrent = resolveCurrent(prepared, test, testColumn.column, firstDefined(context.outputTestCurrentUnknown, context.outputTestBranch), 'Zout test', -1);
    if (!testVoltage.ok) zout = failed('Zout', testVoltage);
    else if (!testCurrent.ok) zout = failed('Zout', testCurrent);
    else zout = queryResult(prepared, 'Zout', testColumn.column, testVoltage, testCurrent);
  }

  for (const query of [av, zin, zout]) {
    if (!query.ok) {
      for (const item of query.diagnostics || []) {
        if (!diagnostics.some((existing) => existing.code === item.code && existing.message === item.message)) {
          diagnostics.push(item);
        }
      }
    }
  }
  return { ok: av.ok && zin.ok && zout.ok, diagnostics, av, zin, zout };
}

export const extractQueries = extractSmallSignalQueries;
export const extractAvZinZout = extractSmallSignalQueries;
