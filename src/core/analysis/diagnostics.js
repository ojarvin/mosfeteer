import { firstDefined } from './shared.js';
const STAGES = Object.freeze([
  'context', 'primitive', 'primitives', 'conversion', 'devices', 'graph', 'mna', 'solver', 'solve',
]);

const CODE_ORDER = Object.freeze([
  'missing-port',
  'ambiguous-port',
  'unconnected-port',
  'same-port',
  'reference-port',
  'unconnected-bulk',
  'legacy-mos-current-source',
  'unknown-mos-model',
  'unsupported-component',
  'missing-analysis-roots',
  'missing-reference',
  'floating-coupled-node',
  'contradictory-voltage-constraints',
  'inconsistent-system',
  'singular-system',
  'mna-error',
  'analysis-error',
]);

const CODE_ALIASES = new Map([
  ['ambiguous', 'ambiguous-port'],
  ['missing-roots', 'missing-analysis-roots'],
  ['singular', 'singular-system'],
  ['inconsistent', 'inconsistent-system'],
  ['contradictory-voltage-source', 'contradictory-voltage-constraints'],
  ['contradictory-voltage-sources', 'contradictory-voltage-constraints'],
  ['floating-node', 'floating-coupled-node'],
  ['floating-nodes', 'floating-coupled-node'],
  ['missing-ground', 'missing-reference'],
  ['missing-reference-node', 'missing-reference'],
  ['legacy-current-source', 'legacy-mos-current-source'],
  ['legacy-mos-current-source-override', 'legacy-mos-current-source'],
]);

const SEVERITY_ORDER = Object.freeze({ error: 0, warning: 1, info: 2 });

function asText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function cleanCode(value) {
  const raw = asText(value).toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return CODE_ALIASES.get(raw) || raw || 'analysis-error';
}

function severityOf(value, fallback = 'error') {
  const severity = asText(value).toLowerCase();
  return Object.hasOwn(SEVERITY_ORDER, severity) ? severity : fallback;
}

function asList(value) {
  if (value === undefined || value === null || value === '') return [];
  return value instanceof Set || Array.isArray(value) ? [...value] : [value];
}

function stableValue(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value) || value instanceof Set) {
    return asList(value).map(stableValue).sort().join(',');
  }
  if (typeof value === 'object') {
    return Object.keys(value).sort().map((key) => `${key}:${stableValue(value[key])}`).join('|');
  }
  return String(value);
}

function stageName(value) {
  const stage = asText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return stage || 'analysis';
}

function roleName(value) {
  const role = asText(value).toLowerCase();
  return role === 'input' || role === 'output' ? role : '';
}

function metadataOf(item, source) {
  const values = [
    item?.metadata,
    item?.metadata?.singularity,
    item?.details,
    item?.details?.singularity,
    item?.cause,
    item?.causes,
    source?.metadata,
    source?.metadata?.singularity,
    source?.singularity,
    source?.causes,
  ];
  return values.filter((value) => value && typeof value === 'object')
    .reduce((result, value) => ({ ...result, ...value }), {});
}

function singularCauseEntries(source, stage) {
  const metadata = metadataOf(source, source);
  const entries = [];
  const add = (code, values, extra = {}) => {
    for (const value of asList(values)) {
      const detail = typeof value === 'object' ? value : { value };
      const supplied = Object.entries(detail)
        .filter(([key]) => !['message', 'detail', 'code', 'severity'].includes(key))
        .map(([key, item]) => `${key}=${stableValue(item)}`)
        .join(', ');
      entries.push({
        code,
        severity: 'error',
        stage,
        ...detail,
        ...extra,
        ...(supplied ? { detail: supplied } : {}),
        metadata: { cause: code },
      });
    }
  };

  const missing = firstDefined(
    metadata.missingReference,
    metadata.missingReferences,
    metadata.referenceMissing,
    metadata.missingReferenceNode,
    metadata.referenceRequired,
  );
  if (missing === true) add('missing-reference', [{ reference: metadata.reference }]);
  else if (missing) add('missing-reference', missing);

  const floating = firstDefined(
    metadata.floatingNode,
    metadata.floatingNodes,
    metadata.floatingCoupledNode,
    metadata.floatingCoupledNodes,
  );
  if (floating) add('floating-coupled-node', floating);

  const contradictory = firstDefined(
    metadata.contradictoryVoltageSource,
    metadata.contradictoryVoltageSources,
    metadata.contradictoryVoltageConstraints,
    metadata.voltageConstraintConflict,
    metadata.contradictorySources,
    metadata.voltageConflicts,
    metadata.idealVoltageConflicts,
  );
  if (contradictory) add('contradictory-voltage-constraints', contradictory);
  return entries;
}

function sourceItems(source, stage = 'analysis') {
  if (!source) return [];
  if (Array.isArray(source)) return source.flatMap((item) => sourceItems(item, stage));
  if (source instanceof Error) return [{ stage, error: source }];
  if (typeof source !== 'object') return [];

  const items = [];
  const add = (value, severity, itemStage = stage) => {
    for (const item of asList(value)) {
      if (!item) continue;
      items.push({
        ...(typeof item === 'object' ? item : { message: item }),
        severity: item?.severity || severity,
        stage: item?.stage || itemStage,
      });
    }
  };

  const isDiagnostic = source.code
    || source.error instanceof Error
    || (source.message && !source.diagnostics && !source.errors && !source.warnings && source.ok === undefined && !source.log);
  if (isDiagnostic) {
    add(source, source.severity || 'error', stage);
    const singular = ['singular', 'singular-system', 'inconsistent', 'inconsistent-system']
      .includes(cleanCode(source.code));
    if (stage === 'solve' || stage === 'solver' || stage === 'mna' || source.singularity || singular) {
      items.push(...singularCauseEntries(source, stage));
    }
    return items;
  }

  if (source.diagnostics && typeof source.diagnostics === 'object' && !Array.isArray(source.diagnostics)) {
    add(source.diagnostics.errors, 'error', stage);
    add(source.diagnostics.warnings, 'warning', stage);
    add(source.diagnostics.info, 'info', stage);
    add(source.diagnostics.items, 'error', stage);
  } else {
    add(source.diagnostics, 'error', stage);
  }
  add(source.errors, 'error', stage);
  add(source.warnings, 'warning', stage);

  const failed = source.ok === false || source.error instanceof Error || (source.error && !source.diagnostics);
  if (failed) add({
    code: source.code,
    error: source.error,
    message: source.message || (source.error instanceof Error ? source.error.message : source.error),
    ...source,
  }, 'error', stage);

  const causeSource = source.solve || source.mna || source.singularity
    || stage === 'solve' || stage === 'solver' || stage === 'mna'
    ? source
    : null;
  if (causeSource) items.push(...singularCauseEntries(causeSource, stage));
  return items;
}

function stageEntries(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return sourceItems(source);
  const hasStages = STAGES.some((stage) => Object.hasOwn(source, stage));
  if (!hasStages) return sourceItems(source);
  const entries = [];
  for (const stage of STAGES) {
    if (Object.hasOwn(source, stage)) entries.push(...sourceItems(source[stage], stage));
  }
  if (Object.hasOwn(source, 'diagnostics') || Object.hasOwn(source, 'error')) {
    entries.push(...sourceItems(source, 'analysis'));
  }
  return entries;
}

function defaultMessage(item, code, detail) {
  const role = roleName(item.role || item.port);
  const name = asText(item.name || item.value || item.net);
  const component = asText(item.component || item.refdes);
  const node = asText(item.node || item.nodeId || item.reference || item.value);
  switch (code) {
    case 'missing-port': return `${role ? `${role[0].toUpperCase()}${role.slice(1)} ` : ''}net is required.`;
    case 'ambiguous-port': return `${role ? `${role[0].toUpperCase()}${role.slice(1)} ` : ''}port${name ? ` "${name}"` : ''} matches multiple physical nets; choose one.`;
    case 'unconnected-port': return `${role ? `${role[0].toUpperCase()} ` : 'Selected '}port is not connected to a net.`;
    case 'same-port': return 'Input and output must be different physical nets.';
    case 'reference-port': return 'Input and output must not be AC-reference rails.';
    case 'unconnected-bulk': return `${component || 'MOS device'} has an unconnected bulk terminal.`;
    case 'legacy-mos-current-source': return `${component || 'MOS device'} uses the removed current-source override; remove it and use the exact MOS model.`;
    case 'unknown-mos-model': return `${component || 'MOS device'} has an unknown small-signal model override.`;
    case 'unsupported-component': return `${component || item.type || 'Component'} has no small-signal model.`;
    case 'missing-analysis-roots': return 'An input or output analysis node is required.';
    case 'missing-reference': return `Analysis needs an AC reference${node ? ` (${node})` : ''}.`;
    case 'floating-coupled-node': return `Coupled node${node ? ` ${node}` : ''} is floating; add a reference or return path.`;
    case 'contradictory-voltage-constraints': return 'Ideal voltage sources impose contradictory voltages.';
    case 'inconsistent-system': return 'The small-signal equations are inconsistent.';
    case 'singular-system': return 'The small-signal equations are singular.';
    case 'mna-error': return 'The small-signal matrix could not be built.';
    case 'analysis-error': return 'Small-signal analysis could not be completed.';
    default: return asText(item.message || item.error) || 'Small-signal analysis reported an error.';
  }
}

function normalizeEntry(item, index) {
  const rawCode = item.code || (item.error?.code) || (item.error?.name === 'RangeError' ? 'mna-error' : '');
  const code = cleanCode(rawCode || (asText(item.error || item.message).toLowerCase().includes('singular') ? 'singular-system' : 'analysis-error'));
  const severity = severityOf(item.severity, code === 'unsupported-component' ? 'warning' : 'error');
  const details = {
    ...(item && typeof item === 'object' ? item : {}),
    code,
    severity,
    stage: stageName(item.stage),
  };
  const message = defaultMessage(details, code, details);
  const detailParts = [asText(details.detail || details.error?.message || details.error || details.originalMessage || details.message)];
  if (details.migration) detailParts.push(`Migration: ${asText(details.migration)}`);
  const detail = detailParts.filter(Boolean).join(' ');
  const key = [
    code,
    details.component || details.refdes || '',
    details.node || details.nodeId || '',
    details.role || details.port || '',
    details.name || details.value || '',
    stableValue(details.candidates),
    stableValue(details.sources || details.constraints),
  ].join('|');
  return {
    code,
    severity,
    message,
    detail: detail && detail !== message ? detail : message,
    ...(details.stage !== 'analysis' ? { stage: details.stage } : {}),
    ...(['component', 'refdes', 'type', 'node', 'nodeId', 'role', 'port', 'name', 'candidates', 'migration', 'metadata'].reduce((result, keyName) => {
      if (details[keyName] !== undefined) result[keyName] = details[keyName];
      return result;
    }, {})),
    _key: key,
    _index: index,
  };
}

function orderOf(code) {
  const index = CODE_ORDER.indexOf(code);
  return index < 0 ? CODE_ORDER.length : index;
}

function sortDiagnostics(a, b) {
  return (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    || (orderOf(a.code) - orderOf(b.code))
    || a.code.localeCompare(b.code)
    || String(a.component || a.refdes || a.node || '').localeCompare(String(b.component || b.refdes || b.node || ''))
    || a._index - b._index;
}

/** Convert producer results into stable, deduplicated diagnostics. */
export function normalizeDiagnostics(source) {
  const normalized = stageEntries(source).map(normalizeEntry);
  const unique = new Map();
  for (const item of normalized) {
    if (!unique.has(item._key)) unique.set(item._key, item);
  }
  const diagnostics = [...unique.values()].sort(sortDiagnostics)
    .map(({ _key, _index, ...item }) => item);
  const errors = diagnostics.filter((item) => item.severity === 'error');
  const warnings = diagnostics.filter((item) => item.severity === 'warning');
  const log = diagnostics.map((item) => {
    const prefix = [item.severity.toUpperCase(), item.code, item.stage].filter(Boolean).join(' ');
    return `${prefix}: ${item.detail || item.message}`;
  });
  return {
    ok: errors.length === 0,
    diagnostics,
    errors,
    warnings,
    message: errors.concat(warnings).map((item) => item.message).join(' '),
    log,
    logText: log.join('\n'),
  };
}

/** Return concise display messages and a stage/source-oriented diagnostic log. */
export function presentDiagnostics(source) {
  const result = normalizeDiagnostics(source);
  const log = result.log;
  return {
    ...result,
    messages: result.diagnostics.map((item) => item.message),
    log,
    logText: log.join('\n'),
  };
}

export function formatDiagnosticLog(source) {
  return presentDiagnostics(source).logText;
}
