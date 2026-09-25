import { INFINITY_NAMES, ONE, isNumber, isZero, keyOf } from './rational.js';

const PRECEDENCE = Object.freeze({ sum: 10, product: 20, power: 30, atom: 40 });
const PARALLEL_KINDS = new Set(['parallel', 'parallel-resistance']);

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
  if (value?.kind === 'multiply') return `m:${value.factors.map(structuralKey).join(',')}`;
  if (value?.kind === 'add') return `a:${value.terms.map(structuralKey).join(',')}`;
  if (value?.kind === 'power') return `p:${structuralKey(value.base)}^${value.exponent}`;
  return keyOf(value);
}

function displayProduct(factors) {
  let coefficient = 1n;
  const visible = factors.filter((factor) => {
    if (isNumber(factor) && factor.denominator === 1n) {
      coefficient *= factor.numerator;
      return false;
    }
    return true;
  });
  if (coefficient !== 1n || !visible.length) visible.unshift({ ...ONE, numerator: coefficient });
  return visible.length === 1 ? visible[0] : { kind: 'multiply', factors: visible };
}

/** Display-only fraction composition. Parallel identities remain indivisible
 * factors; no circuit polynomial is expanded or approximated here. */
function composedFraction(value, context, options) {
  const usedProofs = new Set();
  let visited = 0;
  function parts(node, path = new Set()) {
    if (++visited > 256) throw new RangeError('fraction presentation limit');
    if (explicitParallel(node, options)) return { n: [node], d: [] };
    const key = structuralKey(node);
    const proof = !path.has(key) && options.equivalences?.get?.(key);
    const nestedPath = new Set([...path, key]);
    let kind = node.kind;
    let operands;
    if (proof?.proven && ['product', 'quotient', 'sum'].includes(proof.kind)) {
      kind = proof.kind;
      operands = proof.operands;
      usedProofs.add(key);
    }
    if (kind === 'rational' || kind === 'quotient') {
      const a = parts(operands?.[0] || node.numerator, nestedPath);
      const b = parts(operands?.[1] || node.denominator, nestedPath);
      return { n: [...a.n, ...b.d], d: [...a.d, ...b.n] };
    }
    if (kind === 'number') {
      return { n: [{ ...ONE, numerator: node.numerator }], d: node.denominator === 1n ? [] : [{ ...ONE, numerator: node.denominator }] };
    }
    if (kind === 'multiply' || kind === 'product') {
      const factors = (operands || node.factors).map((factor) => parts(factor, nestedPath));
      return { n: factors.flatMap((factor) => factor.n), d: factors.flatMap((factor) => factor.d) };
    }
    if (kind === 'power') {
      const base = parts(node.base, nestedPath);
      const exponent = Math.abs(node.exponent);
      const powered = (factors) => !factors.length ? [] : exponent === 1 ? factors : [{ kind: 'power', base: displayProduct(factors), exponent }];
      if (node.exponent === 0) return { n: [ONE], d: [] };
      return node.exponent < 0 ? { n: powered(base.d), d: powered(base.n) } : { n: powered(base.n), d: powered(base.d) };
    }
    if (kind === 'add' || kind === 'sum') {
      const terms = (operands || node.terms).map((term) => parts(term, nestedPath));
      if (!terms.some((term) => term.d.some((factor) => !isNumber(factor) || factor.numerator !== factor.denominator))) {
        return { n: [operands ? { kind: 'add', terms: terms.map((term) => displayProduct(term.n)), ordered: true } : node], d: [] };
      }
      // Common denominator uses the largest multiplicity of each factor,
      // avoiding repeated denominators in 1/a + 1/a without distributing sums.
      const common = new Map();
      const denominators = terms.map((term) => {
        const counts = new Map();
        for (const factor of term.d) {
          if (isNumber(factor) && factor.numerator === 1n) continue;
          const key = structuralKey(factor);
          const entry = counts.get(key) || { factor, count: 0 };
          entry.count++;
          counts.set(key, entry);
        }
        for (const [key, entry] of counts) if ((common.get(key)?.count || 0) < entry.count) common.set(key, entry);
        return counts;
      });
      const numerator = { kind: 'add', terms: terms.map((term, index) => displayProduct([
        ...term.n,
        ...[...common].flatMap(([key, entry]) => Array(entry.count - (denominators[index].get(key)?.count || 0)).fill(entry.factor)),
      ])) };
      return { n: [numerator], d: [...common.values()].flatMap((entry) => Array(entry.count).fill(entry.factor)) };
    }
    return { n: [node], d: [] };
  }
  try {
    const { n, d } = parts(value);
    const denominator = displayProduct(d);
    if (isNumber(denominator) && denominator.numerator === 1n) return null;
    const numerator = displayProduct(n);
    const negative = isNegative(numerator) !== isNegative(denominator);
    const equivalences = new Map(options.equivalences instanceof Map
      ? options.equivalences : Object.entries(options.equivalences || {}));
    usedProofs.forEach((key) => equivalences.delete(key));
    const nested = { ...options, equivalences };
    return `${negative ? '-' : ''}\\frac{${render(unsigned(numerator), 0, context, nested)}}{${render(unsigned(denominator), 0, context, nested)}}`;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
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
  const sorted = [...factors].sort((left, right) => factorRank(left, context) - factorRank(right, context)
    || structuralKey(left).localeCompare(structuralKey(right)));
  // Put each transistor's gm*ro together before other resistance factors.
  for (let i = 0; i < sorted.length; i++) {
    const match = sorted[i]?.kind === 'symbol' && /^gm(.+)$/.exec(sorted[i].name);
    if (!match) continue;
    const j = sorted.findIndex((factor, index) => index > i && factor.kind === 'symbol' && factor.name === `ro${match[1]}`);
    if (j > i + 1) sorted.splice(i + 1, 0, sorted.splice(j, 1)[0]);
  }
  return sorted;
}

// Algebra may factor ro*(gm*ro + 1) for cancellation. For presentation,
// flatten small resistive sums without expanding frequency polynomials or
// topology-proven gain/load products. This never changes the solver's AST.
function flatResistiveSum(value) {
  if (value?.kind !== 'multiply' || !value.factors.some((factor) => factor.kind === 'symbol' && /^ro.+$/.test(factor.name))) return null;
  let terms = [[]];
  for (const factor of value.factors) {
    const choices = factor.kind === 'add' ? factor.terms : [factor];
    if (terms.length * choices.length > 4) return null;
    if (choices.some((choice) => choice.kind === 'rational' || choice.kind === 'add'
      || (choice.kind === 'multiply' && choice.factors.some((part) => !['number', 'symbol', 'power'].includes(part.kind))))) return null;
    terms = terms.flatMap((term) => choices.map((choice) => [...term, ...(choice.kind === 'multiply' ? choice.factors : [choice])]));
  }
  if (terms.length < 2 || terms.some((term) => term.some((factor) => factor.kind === 'symbol' && factor.name === 's'))) return null;
  return { kind: 'add', terms: terms.map((factors) => {
    factors = factors.filter((factor) => !isNumber(factor) || factor.numerator !== factor.denominator);
    return factors.length === 1 ? factors[0] : { kind: 'multiply', factors };
  }) };
}

function parenthesize(text) {
  return `\\left(${text}\\right)`;
}

/**
 * Provenance markers. `\pv{n}{…}` wraps one rendered sub-expression so the
 * MathML it becomes can carry a `data-node` attribute back to the AST node it
 * was rendered from. TeX stays the single source of truth for the displayed
 * equation: markers appear only when a caller asks for provenance, and nothing
 * persisted, exported, or edited as a label ever sees one.
 *
 * A few renderers post-process a child's rendered text (stripping a leading
 * minus, comparing against `1`). They reach through the wrapper with the two
 * helpers below, so a provenance render differs from an ordinary one by
 * exactly the markers — which `analysis-present-v2.test.js` asserts directly.
 */
function unmark(text) {
  if (!text.startsWith('\\pv{')) return null;
  const idEnd = text.indexOf('}', 4);
  if (idEnd < 0 || text[idEnd + 1] !== '{') return null;
  let depth = 1;
  for (let i = idEnd + 2; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      // Only a marker spanning the whole string is this text's own wrapper;
      // `\pv{1}{A} + \pv{2}{B}` is a sequence and must not be unwrapped.
      if (depth === 0) return i === text.length - 1 ? { id: text.slice(4, idEnd), body: text.slice(idEnd + 2, i) } : null;
    }
  }
  return null;
}

/** A child's rendered text with its own provenance wrapper removed. */
function markedBody(text) {
  return unmark(text)?.body ?? text;
}

/** Rewrite a child's rendered text while preserving its provenance wrapper. */
function mapMarked(text, fn) {
  const marked = unmark(text);
  return marked ? `\\pv{${marked.id}}{${fn(marked.body)}}` : fn(text);
}

/**
 * The symbol names in one subtree. The AST is immutable and shared, so
 * identity memoization keeps a whole provenance pass linear in the tree
 * instead of quadratic in its depth.
 */
const SYMBOL_NAMES = new WeakMap();
function symbolNames(value) {
  if (!value || typeof value !== 'object') return [];
  const cached = SYMBOL_NAMES.get(value);
  if (cached) return cached;
  let names;
  if (value.kind === 'symbol') names = [value.name];
  else if (value.kind === 'rational') names = [...symbolNames(value.numerator), ...symbolNames(value.denominator)];
  else if (value.kind === 'multiply') names = value.factors.flatMap(symbolNames);
  else if (value.kind === 'add') names = value.terms.flatMap(symbolNames);
  else if (value.kind === 'power') names = symbolNames(value.base);
  else if (value.kind === 'quadratic-formula') {
    names = [
      ...symbolNames(value.numerator?.linear),
      ...symbolNames(value.discriminant),
      ...symbolNames(value.denominator),
    ];
  } else names = [];
  const unique = Object.freeze([...new Set(names)]);
  SYMBOL_NAMES.set(value, unique);
  return unique;
}

function createProvenanceCollector() {
  const symbols = new Map();
  let next = 0;
  return {
    wrap(value, text) {
      const id = (next += 1);
      symbols.set(id, symbolNames(value));
      return `\\pv{${id}}{${text}}`;
    },
    /**
     * Only ids that survived into the rendered string are real: a speculative
     * render the presenter then discards (`composedFraction` probing a shape
     * it rejects) allocates an id that never appears in the output.
     */
    resolve(tex) {
      const used = new Set();
      for (const match of String(tex).matchAll(/\\pv\{(\d+)\}/g)) used.add(Number(match[1]));
      return [...used].sort((a, b) => a - b)
        .map((id) => ({ id, symbols: [...(symbols.get(id) || [])] }));
    },
  };
}

/**
 * Strip every provenance marker, leaving exactly the TeX an ordinary render
 * would have produced. A balanced scan, because a marker's body contains
 * arbitrary nested braces.
 */
export function stripProvenanceMarkers(tex) {
  const text = String(tex);
  let out = '';
  const markers = [];
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') {
      const marker = /^\\pv\{\d+\}\{/.exec(text.slice(i));
      if (marker) {
        markers.push(depth);
        depth += 1;
        i += marker[0].length - 1;
        continue;
      }
    }
    const char = text[i];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      // This closes the innermost open marker rather than a TeX group.
      if (markers.length && markers[markers.length - 1] === depth) { markers.pop(); continue; }
    }
    out += char;
  }
  return out;
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
  const fraction = composedFraction(value, context, options);
  if (fraction) return fraction;
  const negative = isNegative(value);
  const positive = unsigned(value);
  const visible = sortProductFactors(positive.kind === 'multiply' ? positive.factors : [positive], context);
  const body = visible.length
    ? visible.map((factor) => render(factor, PRECEDENCE.product, context, options)).join(' \\, ')
    : '1';
  if (!negative) return body;
  if (visible.length === 1 && visible[0]?.kind === 'add') return `-${parenthesize(render(visible[0], 0, context, options))}`;
  return `-${body}`;
}

function renderSum(value, context, options) {
  const flat = value.terms.flatMap((term) => flatResistiveSum(term)?.terms || [term]);
  const terms = options.orderedSum || value.ordered ? flat : sortSumTerms(flat, context);
  return terms.map((term, index) => {
    const negative = isNegative(term);
    const body = render(unsigned(term), negative || explicitParallel(term, options) ? PRECEDENCE.product : PRECEDENCE.sum, context, options);
    if (index === 0) return negative ? `-${body}` : body;
    return negative ? ` - ${body}` : ` + ${body}`;
  }).join('');
}

function renderRational(value, context, options) {
  if (isZero(value.numerator)) return '0';
  const composed = composedFraction(value, context, options);
  if (composed) return composed;
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
  return negative ? `-${markedBody(denominatorText) === '1' && numerator.kind === 'add' ? parenthesize(fraction) : fraction}` : fraction;
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
  function flatten(operand, seen) {
    const key = structuralKey(operand);
    const nested = !seen.has(key) && explicitParallel(operand, options);
    if (!nested) return [operand];
    return nested.flatMap((branch) => flatten(branch, new Set([...seen, key])));
  }
  const flat = operands.flatMap((operand) => flatten(operand, new Set([structuralKey(value)])));
  const body = flat.map((operand) => render(operand, PRECEDENCE.product, context, options)).join(' \\parallel ');
  return body;
}

function precedence(value) {
  if (value?.kind === 'add') return PRECEDENCE.sum;
  if (value?.kind === 'multiply') return PRECEDENCE.product;
  if (value?.kind === 'power') return PRECEDENCE.power;
  return PRECEDENCE.atom;
}

function renderQuadraticFormula(value, context, options) {
  const linear = value.numerator?.linear;
  const root = `\\sqrt{${render(value.discriminant, 0, context, options)}}`;
  const sign = value.sign < 0 ? '-' : '+';
  const numerator = isZero(linear)
    ? `${sign === '-' ? '-' : ''}${root}`
    : `${render(linear, PRECEDENCE.sum, context, options)} ${sign} ${root}`;
  return `\\frac{${numerator}}{${render(value.denominator, 0, context, options)}}`;
}

function renderNode(value, parentPrecedence, context, options = {}) {
  if (value?.kind === 'quadratic-formula') return renderQuadraticFormula(value, context, options);
  let text;
  const proof = options.equivalences?.get?.(structuralKey(value));
  if (proof?.proven === true && ['quotient', 'sum'].includes(proof.kind)) {
    const equivalences = new Map(options.equivalences);
    equivalences.delete(structuralKey(value));
    const nested = { ...options, equivalences };
    if (proof.kind === 'quotient') return composedFraction(value, context, options)
      || renderRational({ kind: 'rational', numerator: proof.operands[0], denominator: proof.operands[1] }, context, nested);
    const body = renderSum({ kind: 'add', terms: proof.operands }, context, { ...nested, orderedSum: true });
    return parentPrecedence > PRECEDENCE.sum ? parenthesize(body) : body;
  }
  if (proof?.proven === true && proof.kind === 'product') {
    // Remove this identity while visiting its factors: a unit factor must
    // never make a display proof recurse back into itself.
    const equivalences = new Map(options.equivalences);
    equivalences.delete(structuralKey(value));
    const negative = proof.operands.filter(isNegative).length % 2 === 1;
    const factors = proof.operands.map((factor) => {
      const text = render(factor, PRECEDENCE.product, context, { ...options, equivalences });
      return isNegative(factor)
        ? mapMarked(text, (body) => (body.startsWith('-') ? body.slice(1) : body))
        : text;
    });
    const body = `${negative ? '-' : ''}${factors.join(' \\, ')}`;
    return parentPrecedence > PRECEDENCE.product ? parenthesize(body) : body;
  }
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
    const flat = !parallel && flatResistiveSum(value);
    if (flat) return render(flat, parentPrecedence, context, options);
    text = parallel || renderProduct(value, context, options);
  } else if (value?.kind === 'add') {
    text = renderSum(value, context, options);
  } else {
    throw new TypeError(`unknown expression kind ${value?.kind}`);
  }
  const parallel = explicitParallel(value, options);
  const rank = parallel ? PRECEDENCE.sum
    : value?.kind === 'rational' && isNumber(value.denominator) && value.denominator.numerator === value.denominator.denominator
      ? precedence(value.numerator) : precedence(value);
  return rank < parentPrecedence ? parenthesize(text) : text;
}

/**
 * Render one node. With `options.provenance` set, the result is wrapped in a
 * `\pv{…}` marker naming the AST node it came from; without it this is a
 * direct call through to `renderNode` and costs nothing.
 */
function render(value, parentPrecedence, context, options = {}) {
  const text = renderNode(value, parentPrecedence, context, options);
  return options.provenance ? options.provenance.wrap(value, text) : text;
}

/** Render an immutable rational AST as deterministic textbook TeX. */
export function renderExpression(value, options = {}) {
  return render(value, 0, { variable: options.variable || 's' }, options);
}

/**
 * Render as `renderExpression` does, but with every sub-expression wrapped in a
 * provenance marker, and return the node table alongside the TeX. Each entry is
 * `{id, symbols}`; resolving those symbol names to circuit objects is
 * `provenance.js`'s job, and turning the markers into `data-node` attributes is
 * `texToMathML`'s.
 */
export function renderExpressionWithProvenance(value, options = {}) {
  const provenance = createProvenanceCollector();
  const tex = render(value, 0, { variable: options.variable || 's' }, { ...options, provenance });
  return { tex, nodes: provenance.resolve(tex) };
}

/** `renderEquation` with provenance markers, for the same reason. */
export function renderEquationWithProvenance(label, value, options = {}) {
  const { tex, nodes } = renderExpressionWithProvenance(value, options);
  return { tex: `${label} = ${tex}`, nodes };
}

/** `renderRootEquation` with provenance markers, for the same reason. */
export function renderRootEquationWithProvenance(kind, index, value, options = {}) {
  const prefix = String(kind).toLowerCase().startsWith('z') ? 'z' : 'p';
  return renderEquationWithProvenance(`${prefix}_{${index}}`, value, options);
}

/**
 * Join several provenance renders into one, renumbering so node ids stay
 * unique across the result. A pole or zero row is several root equations shown
 * together, each rendered on its own; without renumbering the second root's
 * nodes would collide with the first's and highlight the wrong devices.
 */
export function joinProvenanceRenders(parts, separator = '') {
  const pieces = [];
  const nodes = [];
  let offset = 0;
  for (const part of parts) {
    if (!part) continue;
    const shift = offset;
    pieces.push(String(part.tex).replace(/\\pv\{(\d+)\}/g, (match, id) => `\\pv{${Number(id) + shift}}`));
    for (const node of part.nodes) nodes.push({ id: node.id + shift, symbols: [...node.symbols] });
    offset += part.nodes.reduce((highest, node) => Math.max(highest, node.id), 0);
  }
  return { tex: pieces.join(separator), nodes };
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
  zm: 'Z_m',
  gm: 'G_m',
  ai: 'A_i',
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

/** A factored identity established by the circuit's linear port model. */
export function provenProduct(equivalent, ...operands) {
  return Object.freeze({ kind: 'product', proven: true, equivalent, operands: Object.freeze(operands) });
}

/** Ratios and sums whose recombination the caller has checked exactly. */
export function provenQuotient(equivalent, numerator, denominator) {
  return Object.freeze({ kind: 'quotient', proven: true, equivalent, operands: Object.freeze([numerator, denominator]) });
}

export function provenSum(equivalent, ...operands) {
  return Object.freeze({ kind: 'sum', proven: true, equivalent, operands: Object.freeze(operands) });
}

