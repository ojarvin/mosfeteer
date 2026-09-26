import { OWN, firstDefined } from './shared.js';
import { analyzeResponse } from './response.js';
import {
  joinProvenanceRenders,
  renderExpression,
  renderExpressionWithProvenance,
  renderRootEquation,
  renderRootEquationWithProvenance,
} from './present.js';
import { infinity } from './rational.js';

const QUANTITIES = Object.freeze([
  ['input', 'Zin', 'input-impedance', 'Z_{in}'],
  ['output', 'Zout', 'output-impedance', 'Z_{out}'],
  ['transfer', 'Av', 'voltage-transfer', 'A_v'],
  ['transimpedance', 'Zm', 'transimpedance', 'Z_m'],
  ['transconductance', 'Gm', 'transconductance', 'G_m'],
  ['currentGain', 'Ai', 'current-gain', 'A_i'],
]);

/** Each transfer function's report key and the name its rows go by. */
const TRANSFERS = Object.freeze([
  ['Av', 'transfer', 'voltage gain'],
  ['Zm', 'transimpedance', 'transimpedance'],
  ['Gm', 'transconductance', 'transconductance'],
  ['Ai', 'currentGain', 'current gain'],
]);

const SOURCE_NAMES = Object.freeze({
  Av: ['Av', 'av', 'transfer', 'voltageTransfer', 'voltage-transfer'],
  Zin: ['Zin', 'zin', 'inputImpedance', 'input-impedance'],
  Zout: ['Zout', 'zout', 'outputImpedance', 'output-impedance'],
  Zm: ['transimpedance'],
  Gm: ['transconductance'],
  Ai: ['currentGain'],
});

/** The transfer functions a report shows; one without the list shows A_v. */
function selectedTransfers(report) {
  const names = Array.isArray(report?.transferFunctions) ? report.transferFunctions : ['Av'];
  return TRANSFERS.filter(([name]) => names.includes(name));
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function unique(values) {
  return [...new Set(values.flatMap(asArray).filter((value) => value !== undefined && value !== null && value !== ''))];
}

function lookup(source, names) {
  if (!source || typeof source !== 'object') return undefined;
  for (const name of names) {
    if (OWN.call(source, name) && source[name] !== undefined && source[name] !== null) return source[name];
  }
  return undefined;
}

function isExpression(value) {
  return value && typeof value === 'object' && typeof value.kind === 'string';
}

function expressionOf(value) {
  if (value === undefined || value === null) return undefined;
  if (value.kind === 'rational') return value;
  if (isExpression(value)) return value;
  if (typeof value === 'object' && OWN.call(value, 'expression')) return value.expression;
  return value;
}

function hasFrequency(value) {
  if (value?.kind === 'rational') return hasFrequency(value.numerator) || hasFrequency(value.denominator);
  if (value?.kind === 'symbol') return value.name === 's' || /(?:^|[^A-Za-z])s(?:[^A-Za-z]|$)/.test(String(value.name || ''));
  if (value?.kind === 'power') return hasFrequency(value.base);
  if (value?.kind === 'add' || value?.kind === 'multiply') {
    const values = value.kind === 'add' ? value.terms : value.factors;
    return values.some(hasFrequency);
  }
  return typeof value === 'string' && /(?:^|[^A-Za-z])s(?:[^A-Za-z]|$)/.test(value);
}

function responseRecord(value) {
  if (value === undefined || value === null) return null;
  if (value.response && typeof value.response === 'object') return responseRecord(value.response);
  if (value.expression && typeof value === 'object' && (value.hasFrequency !== undefined || value.dc || value.poles || value.zeros)) {
    return value;
  }
  const expression = expressionOf(value);
  if (expression === undefined || expression === null) return null;
  if (expression?.kind === 'rational' || isExpression(expression)) return analyzeResponse(expression);
  return { expression, hasFrequency: hasFrequency(expression), poles: [], zeros: [] };
}

function pairFor(source) {
  if (!source) return { selected: null, exact: null, source: null };
  const selectedRaw = firstDefined(
    source.selectedResponse,
    source.selectedResult,
    source.selected,
    source.display,
    source.approximate,
    source.expression !== undefined ? source : undefined,
    isExpression(source) ? source : undefined,
  );
  const exactRaw = firstDefined(
    source.exactResponse,
    source.exactResult,
    source.exact,
    source.exactExpression !== undefined ? { expression: source.exactExpression } : undefined,
    selectedRaw,
  );
  return {
    selected: responseRecord(selectedRaw),
    exact: responseRecord(exactRaw),
    source,
  };
}

function valueKey(value) {
  if (value?.kind === 'rational') return `${value.variable}:${valueKey(value.numerator)}/${valueKey(value.denominator)}`;
  if (value?.kind === 'number') return `n:${value.numerator}/${value.denominator}`;
  if (value?.kind === 'symbol') return `s:${value.name}`;
  if (value?.kind === 'power') return `p:${valueKey(value.base)}^${value.exponent}`;
  if (value?.kind === 'add') return `a:${value.terms.map(valueKey).join(',')}`;
  if (value?.kind === 'multiply') return `m:${value.factors.map(valueKey).join(',')}`;
  return JSON.stringify(value);
}

function sameValue(left, right) {
  if (left === right) return true;
  if (left === undefined || right === undefined || left === null || right === null) return false;
  try {
    return valueKey(left) === valueKey(right);
  } catch {
    return false;
  }
}

function render(value, options) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (value.kind === 'infinity') return renderExpression(value, options);
  if (value.kind === 'rational' || isExpression(value)) return renderExpression(value, options);
  return String(value);
}

function responseExpression(response) {
  return expressionOf(response);
}

function equation(label, expression, approximate = false, options) {
  const body = render(expression, options);
  return body === null ? null : `${label} ${approximate ? '\\approx' : '='} ${body}`;
}

/**
 * The same equation rendered with provenance markers, so the GUI can map a
 * clicked sub-expression back to the devices it came from.
 *
 * This is built here, beside the string it mirrors, for the reason AGENTS.md
 * gives about `equivalenceOptions`: a row rendered anywhere else would have to
 * reproduce this function's label, approximation flag, and equivalence options,
 * and getting any of them wrong fails silently on that row alone.
 */
function equationProvenance(label, expression, approximate = false, options) {
  if (expression === undefined || expression === null || typeof expression === 'string') return undefined;
  if (!(expression.kind === 'infinity' || expression.kind === 'rational' || isExpression(expression))) return undefined;
  // Mirrors `equation()` above exactly, including its relation symbol.
  const { tex, nodes } = renderExpressionWithProvenance(expression, options);
  return { tex: `${label} ${approximate ? '\\approx' : '='} ${tex}`, nodes };
}

function dcValue(limit) {
  if (!limit) return undefined;
  if (limit.value !== undefined && limit.value !== null) return limit.value;
  if (limit.kind === 'zero') return { kind: 'number', numerator: 0n, denominator: 1n };
  if (limit.kind === 'pole' || limit.kind === 'infinite' || limit.kind === 'infinity') {
    const sign = limit.sign ?? limit.coefficient?.sign ?? 1;
    return infinity(sign);
  }
  return undefined;
}

function equivalenceOptions(source) {
  return {
    ...(source?.equivalence ? { equivalence: source.equivalence } : {}),
    ...(source?.equivalences ? { equivalences: source.equivalences } : {}),
  };
}

function dcResult(label, selected, exact, source) {
  const selectedLimit = selected?.dc || source?.dc;
  const exactLimit = exact?.dc || selectedLimit;
  const selectedValue = dcValue(selectedLimit);
  const exactValue = dcValue(exactLimit);
  if (selectedValue === undefined) {
    return {
      ok: false,
      error: selectedLimit?.kind === 'unknown' ? 'DC limit is unavailable' : 'DC analysis could not be solved',
    };
  }
  const changed = !sameValue(selectedValue, exactValue);
  const options = equivalenceOptions(source);
  return {
    ok: true,
    equation: equation(label, selectedValue, changed, options),
    exactEquation: equation(label, exactValue, false, options),
    equationProvenance: equationProvenance(label, selectedValue, changed, options),
    expression: selectedValue,
    exactExpression: exactValue,
  };
}

function rootValue(root) {
  return firstDefined(root?.root, root?.value, root?.expression, root?.location);
}

/**
 * The provenance render of one pole or zero. It must mirror the
 * `renderRootEquation` call beside it exactly, options included — a pole row
 * rendered under different options would highlight terms the displayed row
 * does not contain.
 */
function rootProvenance(kind, index, value) {
  if (value === undefined || value === null || typeof value === 'string') return undefined;
  if (!(value.kind === 'infinity' || value.kind === 'rational' || isExpression(value))) return undefined;
  return renderRootEquationWithProvenance(kind === 'poles' ? 'pole' : 'zero', index, value);
}

function rootsOf(response, kind) {
  const roots = response?.[kind] || [];
  return roots.map((root, index) => {
    const value = rootValue(root);
    return {
      ...root,
      index,
      ...(value !== undefined
        ? {
          root: value,
          equation: renderRootEquation(kind === 'poles' ? 'pole' : 'zero', index, value),
          equationProvenance: rootProvenance(kind, index, value),
        }
        : { ...(root.equation ? { equation: root.equation.replace(/([pz])_\{?\d+\}?/i, `$1_{${index}}`) } : {}) }),
    };
  });
}

function frequencyResponse(selected, exact, source) {
  const has = Boolean(firstDefined(
    selected?.hasFrequency,
    exact?.hasFrequency,
    hasFrequency(responseExpression(selected)) || hasFrequency(responseExpression(exact)),
  ));
  if (!has) return null;
  const base = source?.frequencyResponse && typeof source.frequencyResponse === 'object' ? source.frequencyResponse : {};
  return {
    ...base,
    hasFrequency: true,
    expression: responseExpression(selected),
    exactExpression: responseExpression(exact),
    numerator: selected?.numerator,
    denominator: selected?.denominator,
    poles: rootsOf(selected || exact, 'poles'),
    zeros: rootsOf(selected || exact, 'zeros'),
  };
}

function detailsFor(combined, source) {
  const details = [combined?.details, source?.details].filter((value) => value && typeof value === 'object');
  const get = (...names) => firstDefined(...details.map((item) => lookup(item, names)), ...names.map((name) => lookup(source, [name])), ...names.map((name) => lookup(combined, [name])));
  const equations = firstDefined(get('nodeEquations', 'equations'), source?.nodeEquations, combined?.nodeEquations, combined?.equations);
  const solution = get('solution');
  const log = get('log', 'logDetails');
  return {
    ...(equations !== undefined ? { equations, nodeEquations: equations } : {}),
    ...(solution !== undefined ? { solution } : {}),
    ...(log !== undefined ? { log } : {}),
    ...(get('equationCount') !== undefined ? { equationCount: get('equationCount') } : {}),
    ...(get('unknowns', 'nodeUnknowns') !== undefined ? { unknowns: get('unknowns', 'nodeUnknowns'), nodeUnknowns: get('unknowns', 'nodeUnknowns') } : {}),
    ...(get('unknownCount') !== undefined ? { unknownCount: get('unknownCount') } : {}),
  };
}

function childSource(combined, key, quantity) {
  const containers = [combined?.results, combined?.responses, combined?.quantities, combined?.reports, combined];
  const names = SOURCE_NAMES[quantity];
  for (const container of containers) {
    const found = lookup(container, [key, ...names]);
    if (found !== undefined) return found;
  }
  return null;
}

function childMetadata(combined, source, key) {
  const context = combined?.context || {};
  const metadata = {
    target: firstDefined(source?.target, key === 'input' ? context.input : context.output, combined?.target),
    input: firstDefined(source?.input, context.input, combined?.input),
    reference: firstDefined(source?.reference, context.reference, combined?.reference),
  };
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null));
}

function childPairs(combined) {
  return Object.fromEntries(QUANTITIES.filter(([key]) => childKeys(combined).includes(key)).map(([key, quantity]) => {
    const source = childSource(combined, key, quantity);
    return [key, pairFor(source)];
  }));
}

function adaptChild(combined, key, quantity) {
  const [, , query, labelBase] = QUANTITIES.find(([role]) => role === key);
  const raw = childSource(combined, key, quantity);
  const pair = pairFor(raw);
  const source = pair.source || {};
  const selectedExpression = firstDefined(responseExpression(pair.selected), source.expression);
  const exactExpression = firstDefined(responseExpression(pair.exact), source.exactExpression, selectedExpression);
  const selected = pair.selected || responseRecord(selectedExpression);
  const exact = pair.exact || responseRecord(exactExpression);
  const details = detailsFor(combined, source);
  const failed = source?.ok === false || (!selectedExpression && source?.error);
  const reactive = Boolean(frequencyResponse(selected, exact, source));
  const label = reactive ? `${labelBase}(s)` : labelBase;
  const changed = !sameValue(selectedExpression, exactExpression);
  const renderOptions = equivalenceOptions(source);
  const result = {
    ...source,
    ok: failed ? false : Boolean(selectedExpression || source?.ok === true),
    query,
    ...childMetadata(combined, source, key),
    ...(selectedExpression !== undefined ? { expression: selectedExpression } : {}),
    ...(exactExpression !== undefined ? { exactExpression } : {}),
    ...(selectedExpression !== undefined ? { equation: equation(label, selectedExpression, changed, renderOptions) } : {}),
    ...(exactExpression !== undefined ? { exactEquation: equation(label, exactExpression, false, renderOptions) } : {}),
    ...(selectedExpression !== undefined
      ? { equationProvenance: equationProvenance(label, selectedExpression, changed, renderOptions) }
      : {}),
    ...details,
    assumptions: unique([combined?.assumptions, source?.assumptions]),
    approximations: unique([combined?.approximations, source?.approximations]),
    dependencies: unique([combined?.dependencies, source?.dependencies]),
    ...(reactive ? { frequencyResponse: frequencyResponse(selected, exact, source) } : {}),
  };
  if (reactive && key !== 'transfer') delete result.acTransfer;
  if (!reactive) {
    delete result.frequencyResponse;
    delete result.acTransfer;
  }
  if (result.smallSignalNetlist === undefined && combined?.smallSignalNetlist !== undefined) {
    result.smallSignalNetlist = combined.smallSignalNetlist;
  }
  if (key === 'transfer' && reactive && result.expression !== undefined) {
    result.acTransfer = {
      ok: result.ok,
      equation: result.equation,
      exactEquation: result.exactEquation,
      equationProvenance: result.equationProvenance,
      expression: result.expression,
      exactExpression: result.exactExpression,
    };
  }
  if (!result.ok) {
    if (!result.error) result.error = source?.error || combined?.error || `${query} is unavailable`;
    if (result.stage === undefined && combined?.stage !== undefined) result.stage = combined.stage;
    if (result.diagnostics === undefined && combined?.diagnostics !== undefined) result.diagnostics = combined.diagnostics;
  }
  return result;
}

function transferCompanions(combined, children) {
  const transfer = children.transfer;
  const input = children.input;
  const output = children.output;
  const dcGain = dcResult('A_v(0)', transfer._selected, transfer._exact, transfer._source);
  const dcInput = dcResult('Z_{in}(0)', input._selected, input._exact, input._source);
  const dcOutput = dcResult('Z_{out}(0)', output._selected, output._exact, output._source);
  for (const [child, value] of [[input, dcInput], [output, dcOutput]]) {
    child[`dc${child === input ? 'Input' : 'Output'}Impedance`] = value;
  }
  for (const [key, , , label] of QUANTITIES.slice(3)) {
    const child = children[key];
    if (child) child.dcValue = dcResult(`${label}(0)`, child._selected, child._exact, child._source);
  }
  transfer.dcValue = dcGain;
  transfer.dcGain = dcGain;
  transfer.dcInputImpedance = dcInput;
  transfer.dcOutputImpedance = dcOutput;
  return { dcGain, dcInputImpedance: dcInput, dcOutputImpedance: dcOutput };
}

function cleanChild(child) {
  const result = { ...child };
  delete result._selected;
  delete result._exact;
  delete result._source;
  return result;
}

const ROOT_SEPARATOR = ',\\quad ';

/**
 * One Poles or Zeros row: the roots' own equations shown together. The joined
 * provenance render is kept only when every root has one, so the row's markers
 * can never describe a different string than the one displayed.
 */
function rootRow(roots) {
  const equation = roots.map((root) => root.equation).join(ROOT_SEPARATOR);
  const parts = roots.map((root) => root.equationProvenance);
  return {
    ok: true,
    equation,
    ...(parts.every(Boolean) ? { equationProvenance: joinProvenanceRenders(parts, ROOT_SEPARATOR) } : {}),
  };
}

const NOISE_SEPARATOR = ' + ';

/** A term whose own top level is a sum needs parentheses after a prefix. */
function topLevelSum(value) {
  if (value?.kind === 'add') return true;
  return value?.kind === 'rational' && value.denominator?.kind === 'number'
    && value.denominator.numerator === value.denominator.denominator && value.numerator?.kind === 'add';
}

/**
 * One noise density row: the row's prefix (`4kT` or `1/f`) times one term
 * per generator, kept apart so each device's share stays readable. The
 * provenance render joins the terms' own renders, so it always describes the
 * displayed string.
 */
function noiseRow(row) {
  const approximate = row.terms.some(({ expression, exactExpression }) => !sameValue(expression, exactExpression));
  const relation = approximate ? '\\approx' : '=';
  const wrap = (body) => (row.terms.length > 1 || topLevelSum(row.terms[0].expression)
    ? `${row.prefix}\\left(${body}\\right)`
    : `${row.prefix} ${body}`);
  const body = row.terms.map(({ expression }) => render(expression)).join(NOISE_SEPARATOR);
  const exactBody = row.terms.map(({ exactExpression }) => render(exactExpression)).join(NOISE_SEPARATOR);
  const joined = joinProvenanceRenders(row.terms.map(({ expression }) => renderExpressionWithProvenance(expression)), NOISE_SEPARATOR);
  return {
    ok: true,
    query: `noise-${row.key}`,
    equation: `${row.label} ${relation} ${wrap(body)}`,
    exactEquation: `${row.label} = ${wrap(exactBody)}`,
    equationProvenance: { tex: `${row.label} ${relation} ${wrap(joined.tex)}`, nodes: joined.nodes },
    terms: row.terms,
  };
}

function noiseEntries(report) {
  const rows = report?.noise?.ok ? report.noise.rows : [];
  return rows.map((row) => ({ title: row.title, result: noiseRow(row) }));
}

/** What the quantities are ratios of, named by the nodes they were taken at. */
function portEntry(report) {
  const definitions = Array.isArray(report?.portDefinitions) ? report.portDefinitions : [];
  if (!definitions.length) return null;
  // A definition, not a derived expression: it names nodes rather than device
  // parameters, so there is nothing to trace back to the canvas.
  const lines = definitions.map(({ tex }) => tex);
  return {
    title: 'Ports',
    result: { ok: true, definition: true, lines, equation: lines.join(' \\quad ') },
  };
}

function equationEntries(reports, report) {
  const entries = [];
  const ports = portEntry(report);
  if (ports) entries.push(ports);
  const add = (title, result) => {
    if (result?.ok && result.equation) entries.push({ title, result });
  };
  if (reports.input.frequencyResponse?.hasFrequency) add('AC input impedance', reports.input);
  add('DC input impedance', reports.transfer.dcInputImpedance || reports.input.dcInputImpedance);
  if (reports.output.frequencyResponse?.hasFrequency) add('AC output impedance', reports.output);
  add('DC output impedance', reports.transfer.dcOutputImpedance || reports.output.dcOutputImpedance);
  const transfers = selectedTransfers(report);
  for (const [, key, name] of transfers) {
    const child = reports[key];
    if (!child) continue;
    if (child.frequencyResponse?.hasFrequency) add(`AC ${name}`, child);
    add(`DC ${name}`, child.dcValue);
  }
  // Each transfer function has its own poles and zeros: a current input or a
  // shorted output terminates the circuit differently. Name whose they are
  // once there is more than one.
  for (const [, key, name] of transfers) {
    const frequency = reports[key]?.frequencyResponse;
    const suffix = transfers.length > 1 ? ` (${name})` : '';
    if (frequency?.poles?.length) add(`Poles${suffix}`, rootRow(frequency.poles));
    if (frequency?.zeros?.length) add(`Zeros${suffix}`, rootRow(frequency.zeros));
  }
  for (const { title, result } of noiseEntries(report)) add(title, result);
  return entries;
}

/** Report keys to adapt: the three always solved, and each derived transfer requested. */
function childKeys(report) {
  const derived = selectedTransfers(report).map(([, key]) => key).filter((key) => key !== 'transfer');
  return ['input', 'output', 'transfer', ...derived];
}

/** Convert one exact/selected v2 response set into the legacy child reports. */
export function adaptCombinedReport(report) {
  if (!report || typeof report !== 'object') {
    return { query: 'combined', ok: false, complete: false, error: 'analysis report is required', reports: {} };
  }
  const pairs = childPairs(report);
  const children = {};
  for (const [key, quantity] of QUANTITIES) {
    if (!childKeys(report).includes(key)) continue;
    const child = adaptChild(report, key, quantity);
    children[key] = child;
  }
  for (const key of Object.keys(children)) {
    children[key]._selected = pairs[key].selected;
    children[key]._exact = pairs[key].exact;
    children[key]._source = pairs[key].source;
  }
  const companions = transferCompanions(report, children);
  const cleaned = Object.fromEntries(Object.entries(children).map(([key, child]) => [key, cleanChild(child)]));
  const details = detailsFor(report, report);
  const reports = { ...cleaned };
  const entries = equationEntries(reports, report);
  const successful = Object.values(reports).filter((child) => child.ok);
  const context = report.context || {};
  const inputPort = firstDefined(context.input);
  const outputPort = firstDefined(context.output);
  const referencePort = firstDefined(context.reference);
  const base = {
    ...report,
    query: 'combined',
    ok: successful.length > 0,
    complete: successful.length === Object.keys(reports).length,
    reports,
    // Port metadata is distinct from the solved impedance and transfer rows.
    input: inputPort,
    output: outputPort,
    reference: referencePort,
    inputPort,
    outputPort,
    referencePort,
    inputImpedance: reports.input,
    outputImpedance: reports.output,
    voltageTransfer: reports.transfer,
    target: firstDefined(report.target, outputPort, reports.output.target, reports.transfer.target),
    ...companions,
    assumptions: unique([report.assumptions, ...Object.values(reports).map((child) => child.assumptions)]),
    approximations: unique([report.approximations, ...Object.values(reports).map((child) => child.approximations)]),
    dependencies: unique([report.dependencies, ...Object.values(reports).map((child) => child.dependencies)]),
    ...details,
    equationEntries: entries,
    equationOrder: entries.map(({ title }) => title),
    smallSignalNetlist: firstDefined(report.smallSignalNetlist, reports.transfer.smallSignalNetlist, reports.output.smallSignalNetlist, reports.input.smallSignalNetlist),
  };
  if (reports.transfer.frequencyResponse) base.frequencyResponse = reports.transfer.frequencyResponse;
  else delete base.frequencyResponse;
  if (reports.transfer.frequencyResponse?.hasFrequency && reports.transfer.expression) {
    base.acTransfer = {
      ok: reports.transfer.ok,
      equation: reports.transfer.equation,
      exactEquation: reports.transfer.exactEquation,
      expression: reports.transfer.expression,
      exactExpression: reports.transfer.exactExpression,
    };
  } else delete base.acTransfer;
  return base;
}
