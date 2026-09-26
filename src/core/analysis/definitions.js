/**
 * Named sub-expressions for the displayed equations: the textbook's
 * "where Z_1 = ...". A large parameter-only sum that recurs, or that sits in
 * an equation too long to read at once, is shown as one symbol, and its
 * definition is shown once below.
 *
 * This is presentation only. The renderer (`present.js`) swaps a named node
 * for its symbol wherever the node occurs; nothing here changes a value.
 * Sums that carry the frequency variable stay inline, so a denominator's
 * structure in `s` is never hidden behind a name, although its coefficients
 * may be named.
 */
import { structuralKey, symbolText } from './present.js';

const MIN_LEAVES = 5;
const LONG_ROW_LEAVES = 16;
const MAX_DEFINITIONS = 8;

function children(node) {
  switch (node?.kind) {
    case 'rational': return [node.numerator, node.denominator];
    case 'multiply': return node.factors;
    case 'add': return node.terms;
    case 'power': return [node.base];
    case 'quadratic-formula': return [node.numerator?.linear, node.discriminant, node.denominator].filter(Boolean);
    default: return [];
  }
}

function leaves(node) {
  if (node?.kind === 'symbol') return 1;
  return children(node).reduce((sum, child) => sum + leaves(child), 0);
}

function carriesVariable(node, variable) {
  if (node?.kind === 'symbol') return node.name === variable;
  return children(node).some((child) => carriesVariable(child, variable));
}

/**
 * Physical dimension of a parameter name as exponents of ohms and seconds,
 * or null when the name says nothing certain (a flicker coefficient, a
 * channel length, a controlled-source gain).
 */
function symbolDimension(name, variable) {
  if (name === variable) return [0, -1];
  if (name === '\\gamma') return [0, 0];
  if (name.includes('_{')) return null;
  if (/^gmb?[A-Za-z0-9_]*$/.test(name)) return [-1, 0];
  if (/^r(?:o|ds)[A-Za-z0-9_]*$/.test(name) || /^R[A-Za-z0-9_]*$/.test(name)) return [1, 0];
  if (/^C[A-Za-z0-9_]*$/.test(name)) return [-1, 1];
  if (/^L[A-Za-z0-9_]*$/.test(name)) return [1, 1];
  return null;
}

export function dimensionOf(node, variable = 's') {
  switch (node?.kind) {
    case 'number': return [0, 0];
    case 'symbol': return symbolDimension(node.name, variable);
    case 'power': {
      const base = dimensionOf(node.base, variable);
      return base && base.map((exponent) => exponent * node.exponent);
    }
    case 'multiply':
    case 'rational': {
      const parts = children(node).map((child) => dimensionOf(child, variable));
      if (parts.some((part) => !part)) return null;
      const sign = (index) => (node.kind === 'rational' && index === 1 ? -1 : 1);
      return parts.reduce((total, part, index) => total.map((exponent, axis) => exponent + sign(index) * part[axis]), [0, 0]);
    }
    case 'add': {
      const parts = node.terms.map((term) => dimensionOf(term, variable));
      if (parts.some((part) => !part)) return null;
      return parts.every((part) => part[0] === parts[0][0] && part[1] === parts[0][1]) ? parts[0] : null;
    }
    default: return null;
  }
}

/** Z for an impedance, Y an admittance, τ a time constant, X anything else. */
function letterFor(dimension) {
  const [ohms, seconds] = dimension || [];
  if (ohms === 1 && seconds === 0) return 'Z';
  if (ohms === -1 && seconds === 0) return 'Y';
  if (ohms === 0 && seconds === 1) return '\\tau';
  return 'X';
}

/** The display root: a rational over one is shown as its numerator. */
function displayRoot(node) {
  if (node?.kind === 'rational' && node.denominator?.kind === 'number'
    && node.denominator.numerator === node.denominator.denominator) return node.numerator;
  return node;
}

const EXPANSION_LIMIT = 256;

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function addCoefficient(map, key, [numerator, denominator]) {
  const [n, d] = map.get(key) || [0n, 1n];
  const sumNumerator = n * denominator + numerator * d;
  const sumDenominator = d * denominator;
  if (sumNumerator === 0n) { map.delete(key); return; }
  const divisor = gcd(sumNumerator, sumDenominator);
  map.set(key, [sumNumerator / divisor, sumDenominator / divisor]);
}

function monomialKey(exponents) {
  return [...exponents].filter(([, exponent]) => exponent).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, exponent]) => `${name}^${exponent}`).join('*');
}

/**
 * Expand a polynomial into monomial -> rational coefficient, or null for a
 * node that is not one (a fraction) or grows past the limit. Two sums with
 * equal expansions are one quantity however they were factored.
 */
function expand(node) {
  switch (node?.kind) {
    case 'number': return new Map([['', [node.numerator, node.denominator]]]);
    case 'symbol': return new Map([[`${node.name}^1`, [1n, 1n]]]);
    case 'add': {
      const total = new Map();
      for (const term of node.terms) {
        const part = expand(term);
        if (!part) return null;
        for (const [key, coefficient] of part) addCoefficient(total, key, coefficient);
        if (total.size > EXPANSION_LIMIT) return null;
      }
      return total;
    }
    case 'multiply':
    case 'power': {
      const factors = node.kind === 'multiply' ? node.factors
        : node.exponent > 0 && node.exponent <= 8 ? Array(node.exponent).fill(node.base) : null;
      if (!factors) return null;
      let product = new Map([['', [1n, 1n]]]);
      for (const factor of factors) {
        const part = expand(factor);
        if (!part) return null;
        const next = new Map();
        for (const [leftKey, [ln, ld]] of product) {
          for (const [rightKey, [rn, rd]] of part) {
            const exponents = new Map();
            for (const key of [leftKey, rightKey]) {
              for (const piece of key ? key.split('*') : []) {
                const at = piece.lastIndexOf('^');
                const name = piece.slice(0, at);
                exponents.set(name, (exponents.get(name) || 0) + Number(piece.slice(at + 1)));
              }
            }
            addCoefficient(next, monomialKey(exponents), [ln * rn, ld * rd]);
            if (next.size > EXPANSION_LIMIT) return null;
          }
        }
        product = next;
      }
      return product;
    }
    default: return null;
  }
}

/** A key equal for every spelling of one polynomial, else the structural key. */
function valueKey(node) {
  const expanded = expand(node);
  if (!expanded) return `s:${structuralKey(node)}`;
  return `e:${[...expanded].map(([key, [n, d]]) => `${key}:${n}/${d}`).sort().join('+')}`;
}

/**
 * Choose sub-expressions to name from the rows about to be displayed. Each
 * row is a list of expressions (a noise row has one per generator). Returns
 * `[{ value, keys }]`: the shortest spelling of each chosen quantity and the
 * structural keys of every spelling that occurs, those shared by the most
 * rows first. A sum inside a chosen one counts only where it also occurs on
 * its own.
 */
export function chooseDefinitions(rows, options = {}) {
  const variable = options.variable || 's';
  const limit = options.maxDefinitions ?? MAX_DEFINITIONS;
  const values = new Map();
  const valueKeyOf = (node) => {
    const key = structuralKey(node);
    if (!values.has(key)) values.set(key, valueKey(node));
    return values.get(key);
  };
  const chosen = new Map();
  while (chosen.size < limit) {
    const candidates = new Map();
    rows.forEach((expressions, row) => {
      const long = expressions.reduce((sum, value) => sum + leaves(value), 0) >= LONG_ROW_LEAVES;
      for (const expression of expressions) {
        const roots = new Set([expression, displayRoot(expression)]
          .filter((node) => node?.kind === 'add').map(valueKeyOf));
        const visit = (node) => {
          if (!node || typeof node !== 'object') return;
          const eligible = node.kind === 'add' && leaves(node) >= MIN_LEAVES && !carriesVariable(node, variable);
          const key = eligible ? valueKeyOf(node) : null;
          if (key && chosen.has(key)) {
            chosen.get(key).forms.set(structuralKey(node), node);
            return;
          }
          if (key && !roots.has(key)) {
            const entry = candidates.get(key) || { forms: new Map(), count: 0, rows: new Set(), long: false };
            entry.forms.set(structuralKey(node), node);
            entry.count += 1;
            entry.rows.add(row);
            entry.long ||= long;
            candidates.set(key, entry);
          }
          children(node).forEach(visit);
        };
        visit(expression);
      }
    });
    // A sum shared by several rows says the most once named; then size.
    let best = null;
    for (const [key, entry] of candidates) {
      if (entry.count < 2 && !entry.long) continue;
      const size = Math.min(...[...entry.forms.values()].map(leaves));
      const score = [entry.rows.size, size * entry.count];
      if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) {
        best = { key, entry, score };
      }
    }
    if (!best) break;
    chosen.set(best.key, { forms: best.entry.forms });
  }
  return [...chosen.values()].map(({ forms }) => ({
    value: [...forms.values()].reduce((short, form) => (leaves(form) < leaves(short) ? form : short)),
    keys: [...forms.keys()],
  }));
}

/**
 * Give each chosen quantity a symbol by its dimension, numbered in order and
 * skipping any spelling already displayed (an impedance component `Z1`
 * renders as `Z_{1}` too). Returns `[{ keys, value, name }]`.
 */
export function nameDefinitions(chosen, options = {}) {
  const variable = options.variable || 's';
  const taken = new Set([...(options.takenSymbols || [])].map(symbolText));
  const counters = new Map();
  return chosen.map(({ value, keys }) => {
    const letter = letterFor(dimensionOf(value, variable));
    let index = counters.get(letter) || 0;
    let name;
    do {
      index += 1;
      name = `${letter}_{${index}}`;
    } while (taken.has(name));
    counters.set(letter, index);
    taken.add(name);
    return { keys, value, name };
  });
}

/** Every symbol name in a set of expressions, for `takenSymbols`. */
export function symbolsIn(values) {
  const names = new Set();
  const visit = (node) => {
    if (node?.kind === 'symbol') names.add(node.name);
    children(node).forEach(visit);
  };
  values.forEach(visit);
  return names;
}
