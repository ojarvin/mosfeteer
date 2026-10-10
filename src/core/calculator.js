/**
 * The calculator's arithmetic: one line typed the way a search bar takes it
 * (`20*log(123)`, `123e-12`, `2pi*1k`, `sqrt(2)/2`), evaluated to a number.
 *
 * - Numbers: `12`, `1.5`, `.5`, `123e-12`, with an SI suffix straight after
 *   (`4.7k`, `10u` or `10µ`, `1.5meg`, `2p`): f p n u m k meg M G T.
 * - Operators: `+ - * /`, `^` (or `**`, right-associative, above unary
 *   minus: `-2^2` is -4), `!` factorial, `%` percent after a number
 *   (`5%` is 0.05) and modulo between two (`10 % 3`), and implicit
 *   multiplication (`2pi`, `3(4+5)`, `(1+2)(3+4)`). `×`, `÷`, `−` work too.
 * - Functions: `log` is base 10 (`ln` is natural, `log2`, `log10`), `exp`,
 *   `sqrt`, `cbrt`, `abs`, the trigonometric functions in radians and their
 *   inverses and hyperbolics, `floor`, `ceil`, `round`, `sign`, `min`,
 *   `max`, `hypot`, `atan2`; `db(x)` is 20 log10|x| and `undb(x)` back.
 * - Names: `pi` (`π`), `e`, `ans` (the last result), and any name given a
 *   value with `name = expression`.
 */

const SI = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, K: 1e3, meg: 1e6, Meg: 1e6, MEG: 1e6, M: 1e6, G: 1e9, T: 1e12 };

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('! takes a whole number from 0 up');
  if (n > 170) return Infinity;
  let value = 1;
  for (let k = 2; k <= n; k++) value *= k;
  return value;
}

const FUNCTIONS = {
  log: Math.log10, log10: Math.log10, lg: Math.log10, ln: Math.log, log2: Math.log2, exp: Math.exp,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
  min: Math.min, max: Math.max, hypot: Math.hypot, atan2: Math.atan2,
  db: (x) => 20 * Math.log10(Math.abs(x)), undb: (x) => 10 ** (x / 20),
  fact: factorial,
};

const CONSTANTS = { pi: Math.PI, 'π': Math.PI, e: Math.E, tau: 2 * Math.PI };

const NAME = /^[A-Za-z_π][\w]*/;

function tokenize(text) {
  const source = String(text).replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/\*\*/g, '^');
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    const number = source.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if (number) {
      let value = Number(number[0]);
      i += number[0].length;
      // An SI suffix straight after the number, unless the letters spell a
      // name of their own (2pi, 2e, 3ans: implicit multiplication).
      const letters = source.slice(i).match(/^[A-Za-zµμ]+/)?.[0];
      if (letters && !(letters in CONSTANTS) && !(letters in FUNCTIONS) && letters !== 'ans') {
        const suffix = ['meg', 'Meg', 'MEG'].find((s) => letters === s) || (letters.length === 1 && letters in SI ? letters : null);
        if (suffix) {
          value *= SI[suffix];
          i += suffix.length;
        }
      }
      tokens.push({ type: 'number', value });
      continue;
    }
    const name = source.slice(i).match(NAME);
    if (name) {
      tokens.push({ type: 'name', value: name[0] });
      i += name[0].length;
      continue;
    }
    if ('+-*/^()!%,='.includes(ch)) {
      tokens.push({ type: ch });
      i++;
      continue;
    }
    throw new Error(`"${ch}" is not something the calculator reads`);
  }
  return tokens;
}

/** Parse and evaluate `tokens` with `names` ({ name: number }). */
function evaluateTokens(tokens, names) {
  let at = 0;
  const peek = () => tokens[at];
  const next = () => tokens[at++];
  const expect = (type) => {
    const token = next();
    if (token?.type !== type) throw new Error(token ? `expected "${type}" before "${token.value ?? token.type}"` : `expected "${type}" at the end`);
  };
  // A factor may follow with no operator: a number, a name, or "(".
  const startsFactor = (token) => token && (token.type === 'number' || token.type === 'name' || token.type === '(');

  function sum() {
    let value = product();
    while (peek()?.type === '+' || peek()?.type === '-') {
      const op = next().type;
      const right = product();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  function product() {
    let value = unary();
    for (;;) {
      const token = peek();
      if (token?.type === '*' || token?.type === '/') {
        next();
        const right = unary();
        value = token.type === '*' ? value * right : value / right;
      } else if (token?.type === '%' && startsFactor(tokens[at + 1])) {
        next();
        value %= unary();
      } else if (startsFactor(token)) {
        value *= unary();
      } else return value;
    }
  }
  function unary() {
    if (peek()?.type === '-') { next(); return -unary(); }
    if (peek()?.type === '+') { next(); return unary(); }
    return power();
  }
  function power() {
    const base = postfix();
    if (peek()?.type === '^') {
      next();
      return base ** unary();
    }
    return base;
  }
  function postfix() {
    let value = primary();
    for (;;) {
      if (peek()?.type === '!') { next(); value = factorial(value); } else if (peek()?.type === '%' && !startsFactor(tokens[at + 1])) { next(); value /= 100; } else return value;
    }
  }
  function primary() {
    const token = next();
    if (!token) throw new Error('the expression ends too soon');
    if (token.type === 'number') return token.value;
    if (token.type === '(') {
      const value = sum();
      expect(')');
      return value;
    }
    if (token.type === 'name') {
      const name = token.value;
      if (peek()?.type === '(' && FUNCTIONS[name]) {
        next();
        const args = [];
        if (peek()?.type !== ')') {
          args.push(sum());
          while (peek()?.type === ',') { next(); args.push(sum()); }
        }
        expect(')');
        return FUNCTIONS[name](...args);
      }
      if (peek()?.type === '(' && !(name in CONSTANTS) && !Object.prototype.hasOwnProperty.call(names, name)) throw new Error(`"${name}" is not a function the calculator knows`);
      if (Object.prototype.hasOwnProperty.call(names, name)) return names[name];
      if (name in CONSTANTS) return CONSTANTS[name];
      if (FUNCTIONS[name]) {
        // A function with its argument written without parentheses: ln 2.
        return FUNCTIONS[name](power());
      }
      throw new Error(name === 'ans' ? 'there is no earlier result for ans' : `"${name}" has no value (give it one: ${name} = 1.5)`);
    }
    throw new Error(`"${token.type}" cannot start a value`);
  }

  const value = sum();
  if (at < tokens.length) {
    const token = tokens[at];
    throw new Error(`unexpected "${token.value ?? token.type}"`);
  }
  return value;
}

/**
 * Evaluate one line. `names` holds the values of `ans` and of names given
 * earlier; an assignment (`x = 2k`) returns its name with the value.
 * Returns `{ value, name? }`; throws an Error that says what is wrong.
 */
export function calculate(line, names = {}) {
  const text = String(line ?? '').trim();
  if (!text) throw new Error('nothing to calculate');
  const assignment = text.match(/^([A-Za-z_][\w]*)\s*=(?!=)\s*(.+)$/);
  if (assignment) {
    const [, name] = assignment;
    if (name in FUNCTIONS || name in CONSTANTS || name === 'ans') throw new Error(`"${name}" is a built-in name`);
    return { name, value: evaluateTokens(tokenize(assignment[2]), names) };
  }
  return { value: evaluateTokens(tokenize(text), names) };
}

/** A result as the calculator shows it: up to 12 significant digits,
 *  powers of ten for the very small and the very large. */
export function formatResult(value) {
  if (Number.isNaN(value)) return 'not a number';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '-∞';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e-4 && magnitude < 1e15) {
    return String(Number(value.toPrecision(12)));
  }
  const [mantissa, exponent] = value.toExponential(11).split('e');
  return `${String(Number(mantissa))}e${Number(exponent)}`;
}

const PREFIXES = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];

/** The value with an SI prefix (`4.7k`, `1.5p`), when one says it more
 *  plainly than the number; null otherwise. */
export function siResult(value) {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(value) || value === 0 || magnitude < 1e-15 || magnitude >= 1e15) return null;
  const [scale, prefix] = PREFIXES.find(([s]) => magnitude >= s * (1 - 1e-12)) || PREFIXES.at(-1);
  if (!prefix) return null;
  return `${Number((value / scale).toPrecision(6))}${prefix}`;
}

/**
 * The names a history of lines leaves set: each line run in order, `ans`
 * following the last good result. Lines that fail are skipped.
 */
export function replayNames(lines) {
  const names = {};
  for (const line of lines) {
    try {
      const { name, value } = calculate(line, names);
      if (name) names[name] = value;
      names.ans = value;
    } catch { /* a line that failed then fails now */ }
  }
  return names;
}
