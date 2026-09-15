import { keyOf } from './rational.js';

const PRECEDENCE = Object.freeze({ sum: 10, product: 20, power: 30, atom: 40 });
const PARALLEL_KINDS = new Set(['parallel', 'parallel-resistance']);
const INFINITY_NAMES = new Set(['inf', 'infinity', 'infty', '∞', '\\infty']);

function isNumber(value) {
  return value?.kind === 'number';
}

function isZero(value) {
  return isNumber(value) && value.numerator === 0n;
}

function isNegativeNumber(value) {
  return isNumber(value) && value.numerator < 0n;
}

function isNegative(value) {
  if (isNegativeNumber(value)) return true;
  if (value?.kind === 'rational') return isNegative(value.numerator);
  return value?.kind === 'multiply' && isNegativeNumber(value.factors[0]);
}

function structuralKey(value) {
  if (value?.kind === 'rational') {
    return `q:${value.variable}:${structuralKey(value.numerator)}/${structuralKey(value.denominator)}`;
  }
  if (value?.kind === 'infinity') return `i:${value.sign < 0 ? -1 : 1}`;
  return keyOf(value);
}

function equivalent(left, right) {
  if (left?.kind !== right?.kind) return false;
  if (left?.kind === 'rational') {
    return left.variable === right.variable
      && equivalent(left.numerator, right.numerator)
      && equivalent(left.denominator, right.denominator);
  }
  if (left?.kind === 'infinity') return (left.sign < 0) === (right.sign < 0);
  return structuralKey(left) === structuralKey(right);
}

function absoluteNumber(value) {
  return value.numerator < 0n
    ? { ...value, numerator: -value.numerator }
    : value;
}

function unsigned(value) {
  if (isNegativeNumber(value)) return absoluteNumber(value);
  if (value?.kind === 'rational' && isNegative(value.numerator)) {
    return Object.freeze({ ...value, numerator: unsigned(value.numerator) });
  }
  if (value?.kind === 'multiply' && isNegativeNumber(value.factors[0])) {
    const [coefficient, ...factors] = value.factors;
    const positive = absoluteNumber(coefficient);
    if (isNumber(positive) && positive.numerator === 1n && positive.denominator === 1n) {
      if (factors.length === 0) return positive;
      return factors.length === 1 ? factors[0] : Object.freeze({ ...value, factors: Object.freeze(factors) });
    }
    return factors.length === 0 ? positive : Object.freeze({ ...value, factors: Object.freeze([positive, ...factors]) });
  }
  return value;
}

function symbolText(name) {
  const raw = String(name);
  if (INFINITY_NAMES.has(raw.toLowerCase())) return '\\infty';
  if (raw === 's') return 's';
  if (raw.includes('_{') || raw.includes('^{')) return raw;
  if (raw.length < 2) return raw;
  const first = raw[0];
  if (!/[A-Za-z]/.test(first)) return raw;
  const rest = raw.slice(1).replace(/^_/, '');
  if (!rest || !/^[A-Za-z0-9]+$/.test(rest)) return raw;
  const shouldSubscript = first === first.toUpperCase()
    || /[0-9]/.test(rest)
    || raw.includes('_')
    || /^[grclviapz][A-Za-z]/i.test(raw);
  if (!shouldSubscript) return raw;
  return `${first}_{${rest}}`;
}

function variableName(context) {
  return context.variable || 's';
}

function isVariable(value, context) {
  return value?.kind === 'symbol' && value.name === variableName(context);
}

function variableDegree(value, context) {
  if (isVariable(value, context)) return 1;
  if (value?.kind === 'power' && value.exponent >= 0 && isVariable(value.base, context)) return value.exponent;
  if (value?.kind === 'multiply') return value.factors.reduce((sum, factor) => sum + variableDegree(factor, context), 0);
  return 0;
}

function sortSumTerms(terms, context) {
  return [...terms].sort((left, right) => variableDegree(right, context) - variableDegree(left, context)
    || structuralKey(left).localeCompare(structuralKey(right)));
}

function isVariablePower(value, context) {
  return isVariable(value, context)
    || (value?.kind === 'power' && value.exponent > 0 && isVariable(value.base, context));
}

function factorRank(value, context) {
  if (isVariablePower(value, context)) return 0;
  if (isNumber(value)) return 1;
  if (value?.kind === 'symbol' || value?.kind === 'power') return 2;
  return 3;
}

function sortProductFactors(factors, context) {
  return [...factors].sort((left, right) => factorRank(left, context) - factorRank(right, context)
    || structuralKey(left).localeCompare(structuralKey(right)));
}

function parenthesize(text) {
  return `\\left(${text}\\right)`;
}

function renderNumber(value) {
  const numerator = value.numerator;
  const denominator = value.denominator;
  if (denominator === 1n) return String(numerator);
  const sign = numerator < 0n ? '-' : '';
  return `${sign}\\frac{${numerator < 0n ? -numerator : numerator}}{${denominator}}`;
}

function renderPower(value, context, options) {
  if (value.exponent < 0) {
    return `\\frac{1}{${renderPower({ ...value, exponent: -value.exponent }, context, options)}}`;
  }
  if (value.exponent === 1) return render(value.base, 0, context, options);
  const baseText = render(value.base, PRECEDENCE.power, context, options);
  return `${baseText}^{${value.exponent}}`;
}

function renderProduct(value, context, options) {
  const factors = sortProductFactors(value.factors, context);
  const negative = isNegativeNumber(factors[0]);
  const visible = negative ? factors.slice(1) : factors;
  const body = visible.length
    ? visible.map((factor) => render(factor, PRECEDENCE.product, context, options)).join(' \\, ')
    : '1';
  if (!negative) return body;
  if (visible.length === 1 && visible[0]?.kind === 'add') return `-${parenthesize(render(visible[0], 0, context, options))}`;
  return `-${body}`;
}

function renderSum(value, context, options) {
  const terms = sortSumTerms(value.terms, context);
  return terms.map((term, index) => {
    const negative = isNegative(term);
    const body = render(unsigned(term), PRECEDENCE.sum, context, options);
    if (index === 0) return negative ? `-${body}` : body;
    return negative ? ` - ${body}` : ` + ${body}`;
  }).join('');
}

function renderRational(value, context, options) {
  if (isZero(value.numerator)) return '0';
  const numeratorNegative = isNegative(value.numerator);
  const denominatorNegative = isNegative(value.denominator);
  const negative = numeratorNegative !== denominatorNegative;
  const numerator = negative ? unsigned(value.numerator) : value.numerator;
  const denominator = denominatorNegative ? unsigned(value.denominator) : value.denominator;
  const numeratorText = render(numerator, 0, context, options);
  const denominatorText = render(denominator, 0, context, options);
  const fraction = isNumber(denominator) && denominator.numerator === 1n && denominator.denominator === 1n
    ? numeratorText
    : `\\frac{${numeratorText}}{${denominatorText}}`;
  return negative ? `-${fraction}` : fraction;
}

function operandsOf(metadata) {
  if (!metadata || metadata.proven !== true || !PARALLEL_KINDS.has(metadata.kind)) return null;
  const operands = metadata.operands || [metadata.left, metadata.right];
  return Array.isArray(operands) && operands.length >= 2 && metadata.equivalent !== undefined ? operands : null;
}

/**
 * `options.equivalence`/`options.parallel` proves parallel notation for one
 * specific value (checked at every recursive `render` call, so it can match
 * a nested sub-expression, not just the top-level one). `options.equivalences`
 * additionally carries a whole table of such proofs — e.g. from a network's
 * general series/parallel pre-reduction (`reduce.js`), which can prove many
 * unrelated sub-networks at once — keyed by `structuralKey` of the value each
 * one proves, for the same reason `equivalent()` below reduces to that key.
 */
function explicitParallel(value, options) {
  const direct = options.equivalence || options.parallel;
  const directOperands = operandsOf(direct);
  if (directOperands && equivalent(value, direct.equivalent)) return directOperands;
  const table = options.equivalences;
  if (!table) return null;
  const key = structuralKey(value);
  const entry = table instanceof Map ? table.get(key) : table[key];
  return operandsOf(entry);
}

function renderParallel(value, context, options) {
  const operands = explicitParallel(value, options);
  if (!operands) return null;
  const body = operands.map((operand) => render(operand, PRECEDENCE.product, context, options)).join(' \\parallel ');
  return body;
}

function precedence(value) {
  if (value?.kind === 'add') return PRECEDENCE.sum;
  if (value?.kind === 'multiply') return PRECEDENCE.product;
  if (value?.kind === 'power') return PRECEDENCE.power;
  return PRECEDENCE.atom;
}

function render(value, parentPrecedence, context, options = {}) {
  let text;
  if (value?.kind === 'infinity') return value.sign < 0 ? '-\\infty' : '\\infty';
  if (value?.kind === 'number') return renderNumber(value);
  if (value?.kind === 'symbol') return symbolText(value.name);
  if (value?.kind === 'rational') {
    const parallel = renderParallel(value, context, options);
    text = parallel || renderRational(value, context, options);
  } else if (value?.kind === 'power') {
    text = renderPower(value, context, options);
  } else if (value?.kind === 'multiply') {
    const parallel = renderParallel(value, context, options);
    text = parallel || renderProduct(value, context, options);
  } else if (value?.kind === 'add') {
    text = renderSum(value, context, options);
  } else {
    throw new TypeError(`unknown expression kind ${value?.kind}`);
  }
  return precedence(value) < parentPrecedence ? parenthesize(text) : text;
}

/** Render an immutable rational AST as deterministic textbook TeX. */
export function renderExpression(value, options = {}) {
  return render(value, 0, { variable: options.variable || 's' }, options);
}

/** Render an equation with an already formatted left-hand label. */
export function renderEquation(label, value, options = {}) {
  return `${label} = ${renderExpression(value, options)}`;
}

const QUANTITY_LABELS = Object.freeze({
  zin: 'Z_{in}',
  zout: 'Z_{out}',
  av: 'A_v',
  gain: 'A_v',
});

/** Return the standard analysis label for AC or DC quantities. */
export function quantityLabel(quantity, argument = undefined) {
  const key = String(quantity).replace(/[^A-Za-z]/g, '').toLowerCase();
  const base = QUANTITY_LABELS[key] || String(quantity);
  return argument === undefined || argument === null ? base : `${base}(${argument})`;
}

/** Render `Z_in(s)`, `Z_out(0)`, or `A_v(s)` with its expression. */
export function renderQuantityEquation(quantity, argument, value, options = {}) {
  return renderEquation(quantityLabel(quantity, argument), value, options);
}

/** Render a zero-based pole or zero equation. */
export function renderRootEquation(kind, index, value, options = {}) {
  const prefix = String(kind).toLowerCase().startsWith('z') ? 'z' : 'p';
  return renderEquation(`${prefix}_{${index}}`, value, options);
}

/**
 * Build the `options.equivalences` table `render` checks at every recursive
 * call (see `explicitParallel`) from a list of `provenParallel(...)` results
 * (or equivalent `{ equivalent, operands }` records) — e.g. one per parallel
 * merge a network's series/parallel pre-reduction (`reduce.js`) performed.
 */
export function equivalenceTable(proofs) {
  const table = new Map();
  for (const proof of proofs) table.set(structuralKey(proof.equivalent), proof);
  return table;
}

/** Build explicit metadata for a caller-proven parallel-resistance display. */
export function provenParallel(equivalent, ...operands) {
  return Object.freeze({
    kind: 'parallel-resistance',
    proven: true,
    equivalent,
    operands: Object.freeze(operands),
  });
}

/** Render the exact infinity sentinel used by presentation-only callers. */
export function infinity(sign = 1) {
  return Object.freeze({ kind: 'infinity', sign: sign < 0 ? -1 : 1 });
}

export const tex = renderExpression;
export const equation = renderEquation;
export const rootEquation = renderRootEquation;
