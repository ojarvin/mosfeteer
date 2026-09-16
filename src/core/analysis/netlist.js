import { formatExpression } from './rational.js';
import { renderExpression } from './present.js';

const AC_GROUND_NAMES = new Set(['0', '@AC_GROUND', 'AC_GROUND', 'GND', 'VSS', 'VDD', 'VCM']);

const KIND_ORDER = new Map([
  ['resistor', 10],
  ['capacitor', 20],
  ['inductor', 30],
  ['voltage-source', 40],
  ['current-source', 50],
  ['conductance', 60],
  ['admittance', 65],
  ['triode-resistance', 70],
  ['vccs', 80],
]);

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function lookup(map, key) {
  if (!map || key == null) return undefined;
  if (typeof map === 'function') return map(key);
  if (typeof map.get === 'function') return map.get(key);
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

function nodeOf(primitive, role) {
  if (role === 'a' || role === 'positive') return primitive.terminals.a;
  if (role === 'b' || role === 'negative') return primitive.terminals.b;
  if (role === 'controlPlus') return primitive.control?.a;
  if (role === 'controlMinus') return primitive.control?.b;
  if (role === 'source') return primitive.metadata?.source ?? primitive.terminals.b;
  if (role === 'bulk') return primitive.metadata?.bulk?.node;
  return undefined;
}

function normalizedKind(primitive) {
  return String(primitive?.kind || '').toLowerCase();
}

function primitiveName(primitive) {
  return String(firstDefined(primitive.metadata?.component, primitive.id, primitive.kind, 'primitive'));
}

function primitiveId(primitive) {
  return String(primitive.id || primitive.kind || 'primitive');
}

/** Normalize legacy report descriptors at this output boundary only. */
function normalizePrimitive(primitive) {
  if (!primitive || typeof primitive !== 'object') throw new TypeError('small-signal primitives must be objects');
  if (primitive.terminals?.a !== undefined && primitive.terminals?.b !== undefined && primitive.id && primitive.value !== undefined) {
    return primitive;
  }
  const nodes = primitive.nodes || {};
  const output = primitive.output || {};
  const control = primitive.control || {};
  const kind = normalizedKind({ kind: primitive.kind || primitive.type });
  const terminals = {
    a: firstDefined(primitive.a, primitive.outPlus, nodes.a, nodes.positive, output.a, output.positive, primitive.positive),
    b: firstDefined(primitive.b, primitive.outMinus, nodes.b, nodes.negative, output.b, output.negative, primitive.negative),
  };
  const controlTerminals = kind === 'vccs' ? {
    a: firstDefined(primitive.controlPlus, control.a, control.plus, control.positive),
    b: firstDefined(primitive.controlMinus, control.b, control.minus, control.negative),
  } : null;
  const metadata = {
    ...(primitive.metadata || {}),
    ...(primitive.component || primitive.refdes ? { component: primitive.component || primitive.refdes } : {}),
    ...(primitive.model ? { model: primitive.model } : {}),
    ...(primitive.bulk ? { bulk: primitive.bulk } : {}),
    ...(nodes.source ? { source: nodes.source } : {}),
  };
  let value = firstDefined(primitive.value, primitive.resistance, primitive.capacitance, primitive.inductance, primitive.conductance, primitive.transconductance, primitive.gm);
  if (kind === 'voltage-source' || kind === 'current-source') value = firstDefined(primitive.acValue, value, 0);
  const canonicalKind = kind === 'rds' || kind === 'triode-resistance' ? 'resistor' : kind;
  return {
    kind: canonicalKind,
    id: String(primitive.id || primitive.component || primitive.refdes || kind || 'primitive'),
    terminals,
    value,
    ...(controlTerminals ? { control: controlTerminals } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

function stableCompare(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true })
    || String(left).localeCompare(String(right));
}

function sortedPrimitives(primitives) {
  return [...primitives].sort((left, right) => {
    const leftKind = normalizedKind(left);
    const rightKind = normalizedKind(right);
    return (KIND_ORDER.get(leftKind) ?? 900) - (KIND_ORDER.get(rightKind) ?? 900)
      || stableCompare(primitiveName(left), primitiveName(right))
      || stableCompare(primitiveId(left), primitiveId(right));
  });
}

function rawName(value) {
  if (value && typeof value === 'object' && value.kind) {
    if (value.kind === 'symbol') return value.name;
    if (value.kind === 'rational') {
      const numeratorText = rawName(value.numerator);
      const unitDenominator = value.denominator?.kind === 'number'
        && value.denominator.numerator === 1n && value.denominator.denominator === 1n;
      return unitDenominator ? numeratorText : `${numeratorText}/${rawName(value.denominator)}`;
    }
    return formatExpression(value);
  }
  return String(value);
}

function textbookName(value) {
  const raw = rawName(value);
  if (raw === '0' || raw === '@AC_GROUND') return '0';
  if (raw.includes('_{') || raw.includes('^{')) return raw;
  if (/^V[A-Za-z0-9]+$/.test(raw)) return `V_{${raw.slice(1)}}`;
  if (/^g(?:m|mb|o)[A-Za-z0-9_]*$/.test(raw)) {
    const match = raw.match(/^(g)(m|mb|o)(.*)$/);
    return `${match[1]}_{${match[2]}${match[3]}}`;
  }
  if (/^rds[A-Za-z0-9_]*$/.test(raw)) return `r_{ds${raw.slice(3)}}`;
  if (/^ro[A-Za-z0-9_]*$/.test(raw)) return `r_{o${raw.slice(2)}}`;
  if (/^[RCL][A-Za-z0-9_]+$/.test(raw)) return `${raw[0]}_{${raw.slice(1)}}`;
  return raw;
}

function nodeResolver(options) {
  const groundNodes = new Set([
    ...AC_GROUND_NAMES,
    ...(options.groundNodes || []),
    ...(options.acGroundNodes || []),
    ...(options.acGroundIds || []),
  ].map(String));
  const maps = [options.nodeNames, options.nodeLabels, options.netNames, options.nodeAliases];
  return (value) => {
    if (value === undefined || value === null || value === '') return '0';
    const raw = String(value);
    if (groundNodes.has(raw)) return '0';
    const mapped = firstDefined(...maps.map((map) => lookup(map, value) ?? lookup(map, raw)));
    if (mapped !== undefined && mapped !== null && String(mapped) !== raw) {
      const mappedText = String(mapped);
      return groundNodes.has(mappedText) ? '0' : textbookName(mappedText);
    }
    return textbookName(raw);
  };
}

function parameterOf(primitive, fallback) {
  return firstDefined(primitive.parameter, primitive.value, fallback);
}

function lineName(prefix, primitive, suffix = '') {
  return `${prefix}_${primitiveName(primitive)}${suffix}`;
}

function branchLine(prefix, primitive, positive, negative, value) {
  return `${lineName(prefix, primitive)} ${positive} ${negative} ${textbookName(value)}`;
}

function vccsData(primitive, resolveNode) {
  const outputPlus = resolveNode(nodeOf(primitive, 'positive'));
  const outputMinus = resolveNode(nodeOf(primitive, 'negative'));
  const controlPlus = resolveNode(nodeOf(primitive, 'controlPlus'));
  const controlMinus = resolveNode(nodeOf(primitive, 'controlMinus'));
  const value = textbookName(parameterOf(primitive, 'gm'));
  return {
    outputPlus,
    outputMinus,
    controlPlus,
    controlMinus,
    value,
    controlExpression: `${value}(${controlPlus}-${controlMinus})`,
  };
}

function bulkNote(primitive, resolveNode) {
  const bulk = primitive.metadata?.bulk;
  if (!bulk?.implicit) return null;
  const source = nodeOf(primitive, 'source');
  const bulkNode = resolveNode(firstDefined(bulk.node, bulk.reference, '@AC_GROUND'));
  const sourceNode = resolveNode(source);
  if (bulkNode === sourceNode) return null;
  const reference = textbookName(firstDefined(bulk.reference, 'VSS'));
  return `* ${primitiveName(primitive)} bulk: implicit ${reference} is AC ground; v_{bs} = ${bulkNode}-${sourceNode}`;
}

function describePrimitive(primitive, resolveNode, options = {}) {
  const kind = normalizedKind(primitive);
  const name = primitiveName(primitive);
  const a = resolveNode(nodeOf(primitive, 'a'));
  const b = resolveNode(nodeOf(primitive, 'b'));
  if (kind === 'resistor' && primitive.metadata?.model === 'triode') {
    return { kind: 'triode-resistance', id: primitiveId(primitive), line: branchLine('RDS', primitive, a, b, parameterOf(primitive, 'rds')), notes: [] };
  }
  if (kind === 'resistor' && primitive.metadata?.device === 'mos') {
    return { kind, id: primitiveId(primitive), line: branchLine('RO', primitive, a, b, parameterOf(primitive, 'ro')), notes: [] };
  }
  if (kind === 'resistor') {
    return { kind, id: primitiveId(primitive), line: branchLine('R', primitive, a, b, parameterOf(primitive, 'R')), notes: [] };
  }
  if (kind === 'capacitor') {
    return { kind, id: primitiveId(primitive), line: branchLine('C', primitive, a, b, parameterOf(primitive, 'C')), notes: [] };
  }
  if (kind === 'inductor') {
    return { kind, id: primitiveId(primitive), line: branchLine('L', primitive, a, b, parameterOf(primitive, 'L')), notes: [] };
  }
  if (kind === 'voltage-source') {
    return { kind: 'voltage-source', id: primitiveId(primitive), line: branchLine('V', primitive, resolveNode(nodeOf(primitive, 'positive')), resolveNode(nodeOf(primitive, 'negative')), firstDefined(primitive.acValue, primitive.value, 0)), notes: [] };
  }
  if (kind === 'current-source') {
    return { kind: 'current-source', id: primitiveId(primitive), line: branchLine('I', primitive, resolveNode(nodeOf(primitive, 'positive')), resolveNode(nodeOf(primitive, 'negative')), firstDefined(primitive.acValue, primitive.value, 0)), notes: [] };
  }
  if (kind === 'conductance') {
    const value = textbookName(parameterOf(primitive, 'go'));
    return {
      kind,
      id: primitiveId(primitive),
      line: branchLine('GO', primitive, a, b, value),
      notes: [],
    };
  }
  if (kind === 'admittance') {
    const metadata = primitive.metadata || {};
    const format = (value) => value?.kind ? renderExpression(value, options) : textbookName(value);
    const notes = metadata.millerBridge ? [
      `* Miller bridge ${(metadata.feedbackComponents || [name]).join(', ')} replaced by two shunts: ${resolveNode(metadata.gate)} -> ${resolveNode(metadata.drain)}; Z_fb = ${format(metadata.feedbackImpedance)}; A_v0 = ${format(metadata.gain)} (bridge removed)`,
      `* ${primitiveId(primitive)}: ${metadata.millerSide} shunt admittance from the Miller approximation`,
    ] : [];
    return { kind, id: primitiveId(primitive), line: `Y_${primitiveId(primitive)} ${a} ${b} ${format(primitive.value)}`, notes };
  }
  if (kind === 'vccs') {
    const data = vccsData(primitive, resolveNode);
    const notes = [`* G_${name} current: ${data.controlExpression}`];
    const note = bulkNote(primitive, resolveNode);
    if (note) notes.unshift(note);
    return {
      kind,
      id: primitiveId(primitive),
      line: `G_${name} ${data.outputPlus} ${data.outputMinus} ${data.controlPlus} ${data.controlMinus} ${data.value}`,
      annotation: data.controlExpression,
      notes,
    };
  }
  return {
    kind,
    id: primitiveId(primitive),
    line: `* UNSUPPORTED ${name}: ${kind || 'unknown primitive'}`,
    notes: [],
  };
}

function zeroedInputNote(options) {
  const query = options.query || {};
  const zeroed = firstDefined(options.zeroedInput, options.inputZeroed, query.zeroedInput, query.inputZeroed);
  if (!zeroed) return null;
  const value = typeof zeroed === 'object' ? firstDefined(zeroed.node, zeroed.name) : zeroed === true ? firstDefined(options.inputNode, options.inputName, query.inputNode, query.inputName) : zeroed;
  const name = firstDefined(
    options.zeroedInputName,
    query.zeroedInputName,
    typeof zeroed === 'object' ? zeroed.name : undefined,
    value,
    options.inputName,
    query.inputName,
    'V_{IN}',
  );
  return `* ${textbookName(name)} = 0 (input source zeroed for output impedance)`;
}

function formatDetails(input, options = {}) {
  const primitives = Array.isArray(input) ? input : input?.primitives || [];
  if (!Array.isArray(primitives)) throw new TypeError('small-signal primitives must be an array');
  const canonical = primitives.map(normalizePrimitive);
  const resolveNode = nodeResolver(options);
  const entries = sortedPrimitives(canonical).map((primitive) => describePrimitive(primitive, resolveNode, options));
  const notes = [...new Set(entries.flatMap((entry) => entry.notes))];
  const lines = ['* Small-signal equivalent (symbolic; no numerical values)'];
  const queryNote = zeroedInputNote(options);
  if (queryNote) lines.push(queryNote);
  const emittedNotes = new Set();
  for (const entry of entries) {
    for (const note of entry.notes) {
      if (emittedNotes.has(note)) continue;
      emittedNotes.add(note);
      lines.push(note);
    }
    if (entry.line) lines.push(entry.line);
  }
  if (entries.length === 0) lines.push('* (no small-signal primitives)');
  return { lines, entries, notes, text: lines.join('\n') };
}

/** Format exact v2 primitive descriptors without changing or evaluating them. */
export function formatSmallSignalNetlist(primitives, options = {}) {
  return formatDetails(primitives, options).text;
}

/** Return deterministic netlist text together with its structured entries. */
export function describeSmallSignalNetlist(primitives, options = {}) {
  return formatDetails(primitives, options);
}
