/**
 * Cancel a common polynomial factor from a rational function's numerator and
 * denominator. `rationalFunction` removes only common monomial content, so a
 * factor such as `s (C_L + C_M) r_o5 r_o10 + r_o5 + r_o10` left behind by a
 * block-wise solve inflates the apparent order (and the reported poles).
 *
 * Both sides are expanded into sparse integer polynomials. A cheap modular
 * check (random values for every symbol except the frequency variable, then a
 * univariate GCD over GF(p)) screens out the common case of no shared
 * frequency-dependent factor. Only then does an exact multivariate GCD
 * (recursive primitive PRS) run, and the result is verified by exact
 * division. Every stage is bounded; on any limit the value is returned
 * unchanged, so this is purely an exact simplification.
 */
import { add, integer, multiply, power, rationalFunction, symbol } from './rational.js';

const MAX_TERMS = 3000;
const MAX_WORK = 3_000_000;
const PRIME = 2147483647n;

class WorkLimit extends Error {}

function bigGcd(a, b) {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function modInverse(value, prime) {
  let [a, m, x0, x1] = [((value % prime) + prime) % prime, prime, 0n, 1n];
  if (a === 0n) throw new RangeError('no inverse');
  let b = m;
  while (a > 1n) {
    const q = a / b;
    [a, b] = [b, a % b];
    [x0, x1] = [x1 - q * x0, x0];
  }
  return ((x1 % prime) + prime) % prime;
}

/* Sparse polynomial: Map<exponentKey, bigint>, exponents over `vars`. */

function makeContext(vars, work) {
  const n = vars.length;
  const zeroKey = new Array(n).fill(0).join(',');
  const parse = (key) => key.split(',').map(Number);
  const tick = (amount = 1) => {
    work.used += amount;
    if (work.used > MAX_WORK) throw new WorkLimit();
  };
  const addTerm = (map, key, coefficient) => {
    const next = (map.get(key) || 0n) + coefficient;
    if (next === 0n) map.delete(key);
    else map.set(key, next);
  };
  const mul = (a, b) => {
    tick(a.size * b.size);
    const out = new Map();
    for (const [ka, ca] of a) {
      const ea = parse(ka);
      for (const [kb, cb] of b) {
        const eb = parse(kb);
        addTerm(out, ea.map((e, i) => e + eb[i]).join(','), ca * cb);
      }
    }
    if (out.size > MAX_TERMS * 4) throw new WorkLimit();
    return out;
  };
  const sum = (a, b, scale = 1n) => {
    tick(a.size + b.size);
    const out = new Map(a);
    for (const [k, c] of b) addTerm(out, k, c * scale);
    return out;
  };
  const constant = (c) => (c === 0n ? new Map() : new Map([[zeroKey, c]]));
  const shiftVar = (a, index, amount) => {
    const out = new Map();
    for (const [k, c] of a) {
      const e = parse(k);
      e[index] += amount;
      out.set(e.join(','), c);
    }
    return out;
  };
  // Lexicographic comparison of exponent vectors.
  const compare = (x, y) => {
    for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };
  const leading = (a) => {
    let best = null;
    for (const [k, c] of a) {
      const e = parse(k);
      if (!best || compare(e, best.e) > 0) best = { e, c };
    }
    return best;
  };
  /** Exact multivariate division, or null when `b` does not divide `a`. */
  const divide = (a, b) => {
    if (!b.size) throw new RangeError('division by zero polynomial');
    const lb = leading(b);
    let rest = new Map(a);
    const quotient = new Map();
    while (rest.size) {
      tick(b.size);
      const la = leading(rest);
      if (la.e.some((e, i) => e < lb.e[i]) || la.c % lb.c !== 0n) return null;
      const term = new Map([[la.e.map((e, i) => e - lb.e[i]).join(','), la.c / lb.c]]);
      addTerm(quotient, [...term.keys()][0], [...term.values()][0]);
      rest = sum(rest, mul(term, b), -1n);
    }
    return quotient;
  };
  const degreeIn = (a, index) => {
    let degree = -1;
    for (const k of a.keys()) degree = Math.max(degree, parse(k)[index]);
    return degree;
  };
  /** Coefficients of `a` as a univariate polynomial in variable `index`. */
  const coefficientsIn = (a, index) => {
    const out = new Map();
    for (const [k, c] of a) {
      const e = parse(k);
      const d = e[index];
      e[index] = 0;
      if (!out.has(d)) out.set(d, new Map());
      out.get(d).set(e.join(','), c);
    }
    return out;
  };
  const integerContent = (a) => {
    let g = 0n;
    for (const c of a.values()) g = bigGcd(g, c);
    return g;
  };
  const normalizeSign = (a) => {
    const lead = leading(a);
    if (lead && lead.c < 0n) {
      const out = new Map();
      for (const [k, c] of a) out.set(k, -c);
      return out;
    }
    return a;
  };

  /** GCD of polynomials involving only variables index..n-1. */
  function gcd(a, b, index) {
    tick();
    if (!a.size) return normalizeSign(b);
    if (!b.size) return normalizeSign(a);
    if (index >= n) return constant(bigGcd(integerContent(a), integerContent(b)));
    const da = degreeIn(a, index);
    const db = degreeIn(b, index);
    if (da <= 0 && db <= 0) return gcd(a, b, index + 1);
    const contentA = contentIn(a, index);
    const contentB = contentIn(b, index);
    const content = gcd(contentA, contentB, index + 1);
    let p = divide(a, contentA);
    let q = divide(b, contentB);
    if (!p || !q) throw new WorkLimit();
    if (degreeIn(p, index) < degreeIn(q, index)) [p, q] = [q, p];
    while (q.size && degreeIn(q, index) > 0) {
      const r = pseudoRemainder(p, q, index);
      p = q;
      q = r.size ? primitivePart(r, index) : r;
    }
    // A nonzero constant (in this variable) remainder means coprime here.
    const g = q.size ? constant(1n) : primitivePart(p, index);
    const result = mul(content, g);
    return normalizeSign(result);
  }
  function contentIn(a, index) {
    let g = new Map();
    for (const coefficient of coefficientsIn(a, index).values()) {
      g = gcd(g, coefficient, index + 1);
      if (g.size === 1 && g.has(zeroKey) && (g.get(zeroKey) === 1n || g.get(zeroKey) === -1n)) break;
    }
    return g;
  }
  function primitivePart(a, index) {
    const content = contentIn(a, index);
    const out = divide(a, content);
    if (!out) throw new WorkLimit();
    return normalizeSign(out);
  }
  function pseudoRemainder(a, b, index) {
    const db = degreeIn(b, index);
    const lcB = coefficientsIn(b, index).get(db);
    let rest = a;
    let da = degreeIn(rest, index);
    while (rest.size && da >= db) {
      const lcA = coefficientsIn(rest, index).get(da);
      rest = sum(mul(lcB, rest), mul(shiftVar(lcA, index, da - db), b), -1n);
      da = degreeIn(rest, index);
    }
    return rest;
  }

  return { gcd, divide, degreeIn, parse, coefficientsIn, zeroKey };
}

/** Expand an expression into sparse rational terms: Map<symbolPowers, [num, den]>. */
function expand(value, work) {
  const tick = () => {
    work.used += 1;
    if (work.used > MAX_WORK) throw new WorkLimit();
  };
  const monomialKey = (powers) => [...powers.entries()].filter(([, e]) => e).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([s, e]) => `${s}^${e}`).join('*');
  const one = () => new Map([['', { powers: new Map(), num: 1n, den: 1n }]]);
  const addInto = (out, term) => {
    const key = monomialKey(term.powers);
    const existing = out.get(key);
    if (!existing) { out.set(key, term); return; }
    const num = existing.num * term.den + term.num * existing.den;
    const den = existing.den * term.den;
    if (num === 0n) out.delete(key);
    else { const g = bigGcd(num, den); out.set(key, { powers: existing.powers, num: num / g, den: den / g }); }
  };
  const product = (a, b) => {
    const out = new Map();
    for (const ta of a.values()) for (const tb of b.values()) {
      tick();
      const powers = new Map(ta.powers);
      for (const [s, e] of tb.powers) powers.set(s, (powers.get(s) || 0) + e);
      const num = ta.num * tb.num;
      const den = ta.den * tb.den;
      const g = bigGcd(num, den) || 1n;
      addInto(out, { powers, num: num / g, den: den / g });
    }
    if (out.size > MAX_TERMS) throw new WorkLimit();
    return out;
  };
  function walk(node) {
    tick();
    if (node.kind === 'number') {
      return node.numerator === 0n ? new Map() : new Map([['', { powers: new Map(), num: node.numerator, den: node.denominator }]]);
    }
    if (node.kind === 'symbol') {
      return new Map([[`${node.name}^1`, { powers: new Map([[node.name, 1]]), num: 1n, den: 1n }]]);
    }
    if (node.kind === 'power') {
      if (!Number.isInteger(node.exponent) || node.exponent < 0 || node.exponent > 12) throw new WorkLimit();
      let result = one();
      const base = walk(node.base);
      for (let i = 0; i < node.exponent; i++) result = product(result, base);
      return result;
    }
    if (node.kind === 'multiply') return node.factors.reduce((result, factor) => product(result, walk(factor)), one());
    if (node.kind === 'add') {
      const out = new Map();
      for (const term of node.terms) for (const t of walk(term).values()) addInto(out, t);
      if (out.size > MAX_TERMS) throw new WorkLimit();
      return out;
    }
    throw new WorkLimit();
  }
  return walk(value);
}

function symbolsOf(...expansions) {
  const names = new Set();
  for (const expansion of expansions) for (const term of expansion.values()) for (const name of term.powers.keys()) names.add(name);
  return [...names].sort();
}

/** Clear denominators: integer sparse polynomial over `vars` and its scale. */
function toInteger(expansion, vars) {
  let lcm = 1n;
  for (const term of expansion.values()) lcm = lcm / bigGcd(lcm, term.den) * term.den;
  const map = new Map();
  for (const term of expansion.values()) {
    map.set(vars.map((name) => term.powers.get(name) || 0).join(','), term.num * (lcm / term.den));
  }
  return { map, scale: lcm };
}

function modularGcdDegree(a, b, vars, variableIndex) {
  // Deterministic pseudo-random evaluation points for reproducible results.
  let seed = 0x2545f491n;
  const next = () => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return (seed >> 17n) % (PRIME - 2n) + 2n;
  };
  const values = vars.map((_, i) => (i === variableIndex ? 0n : next()));
  const reduce = (map) => {
    const coefficients = [];
    for (const [key, c] of map) {
      const e = key.split(',').map(Number);
      let term = ((c % PRIME) + PRIME) % PRIME;
      e.forEach((exponent, i) => {
        if (i !== variableIndex) for (let k = 0; k < exponent; k++) term = term * values[i] % PRIME;
      });
      const d = e[variableIndex];
      coefficients[d] = ((coefficients[d] || 0n) + term) % PRIME;
    }
    const out = Array.from({ length: coefficients.length }, (_, i) => coefficients[i] || 0n);
    while (out.length && out[out.length - 1] === 0n) out.pop();
    return out;
  };
  let p = reduce(a);
  let q = reduce(b);
  const rem = (x, y) => {
    x = x.slice();
    const inv = modInverse(y[y.length - 1], PRIME);
    while (x.length >= y.length) {
      const f = x[x.length - 1] * inv % PRIME;
      const shift = x.length - y.length;
      for (let i = 0; i < y.length; i++) x[i + shift] = ((x[i + shift] - f * y[i]) % PRIME + PRIME) % PRIME;
      while (x.length && x[x.length - 1] === 0n) x.pop();
    }
    return x;
  };
  if (!p.length || !q.length) return 0;
  while (q.length) [p, q] = [q, rem(p, q)];
  return p.length - 1;
}

function fromInteger(map, vars, scale) {
  const terms = [];
  for (const [key, c] of map) {
    const exponents = key.split(',').map(Number);
    const factors = [integer(c)];
    exponents.forEach((exponent, i) => {
      if (exponent) factors.push(exponent === 1 ? symbol(vars[i]) : power(symbol(vars[i]), exponent));
    });
    terms.push(multiply(factors));
  }
  const polynomial = terms.length ? add(terms) : integer(0);
  return scale === 1n ? polynomial : multiply(polynomial, { kind: 'number', numerator: 1n, denominator: scale });
}

/**
 * Return `value` with any common factor that depends on `variable` cancelled,
 * or `value` itself when there is none or a work limit is reached.
 */
export function cancelCommonPolynomialFactor(value, options = {}) {
  if (value?.kind !== 'rational' || value.budgetExceeded || value.infinite) return value;
  const variable = options.variable || value.variable || 's';
  const work = { used: 0 };
  try {
    const numerator = expand(value.numerator, work);
    const denominator = expand(value.denominator, work);
    const vars = symbolsOf(numerator, denominator);
    const variableIndex = vars.indexOf(variable);
    if (variableIndex < 0 || !numerator.size || !denominator.size) return value;
    // Put the frequency variable first so content is taken in it last.
    const ordered = [variable, ...vars.filter((name) => name !== variable)];
    const n = toInteger(numerator, ordered);
    const d = toInteger(denominator, ordered);
    if (modularGcdDegree(n.map, d.map, ordered, 0) === 0) return value;
    const context = makeContext(ordered, work);
    const common = context.gcd(n.map, d.map, 0);
    if (context.degreeIn(common, 0) <= 0) return value;
    const reducedNumerator = context.divide(n.map, common);
    const reducedDenominator = context.divide(d.map, common);
    if (!reducedNumerator || !reducedDenominator) return value;
    // N/D = (N'/n.scale)/(D'/d.scale) = N' d.scale / (D' n.scale).
    return rationalFunction(
      fromInteger(reducedNumerator, ordered, 1n),
      multiply(fromInteger(reducedDenominator, ordered, 1n), { kind: 'number', numerator: n.scale, denominator: d.scale }),
      { variable: value.variable },
    );
  } catch (error) {
    if (error instanceof WorkLimit) return value;
    throw error;
  }
}
