/**
 * Transfer-function blocks (`tf_s`, `tf_z`): a signal-flow box holding its
 * transfer function as math. The function is written the MATLAB way, as a
 * part's value:
 *
 *   tf([1], [1 2 1])          numerator and denominator coefficients: in s,
 *                             highest power first; in z, ascending powers
 *                             of z^-1 (the DSP way, MATLAB's filt), so
 *                             tf([1 -1], [1]) is 1 - z^-1;
 *   [1], [1 2 1]              the same without tf();
 *   tf([1], [1 -1], 'Variable', 'z')   descending powers of z (MATLAB's tf);
 *   tf([k], [1 p], 'InputDelay', T)    times a delay, e^{-sT} (s only);
 *   k                         a plain gain: one coefficient, no lists;
 *   (1 - exp(-s*T))/s         in s, any expression in s with delays
 *                             exp(-s*T) -- a DAC's pulse, excess loop delay.
 *
 * A coefficient is a number or a symbol (`k`, `a_1`, `2*g_m`, `-p`), so a
 * block can carry a symbolic gain or pole. This module only reads and draws
 * the definition; it imports nothing, so the model can size the box from it.
 */

// Every transfer-function block and its variable: the general H(s) and H(z)
// blocks, and presets of them -- a DAC's NRZ and RZ pulses, a delay in s,
// a delay in z -- whose definitions are as editable as any block's.
export const TRANSFER_FUNCTION_TYPES = Object.freeze({ tf_s: 's', tf_z: 'z', tf_dac: 's', tf_dac_rz: 's', tf_delay: 's', tf_zdelay: 'z' });
const PRESETS = Object.freeze({
  tf_z: 'tf([1], [1 -1])', // an accumulator: 1 / (1 - z^-1)
  tf_s: 'tf([1], [1 1])',
  tf_dac: '(1 - exp(-s*T))/s', // a sample held for a period (NRZ)
  tf_dac_rz: '(1 - exp(-s*T/2))/s', // held for half a period, then zero (RZ)
  tf_delay: 'exp(-s*T_d)',
  tf_zdelay: 'tf([0 1], [1])', // z^-1
});

/** Whether a part is a transfer-function block in `variable` ('s' or 'z'). */
export const isBlockIn = (component, variable) => TRANSFER_FUNCTION_TYPES[component?.type] === variable;
export const TRANSFER_FUNCTION_ROLE = 'transfer-function';

export function isTransferFunction(component) {
  return !!component && Object.hasOwn(TRANSFER_FUNCTION_TYPES, component.type);
}

/** A part whose value is one coefficient, drawn as math: a gain's k, a
 *  sampler's period T. */
export function isCoefficientBlock(component) {
  return component?.type === 'gain' || component?.type === 'sampler' || component?.type === 'quantizer' || component?.type === 'dither';
}

/**
 * A dither source's value: its shape and amplitude A, `rect 1` (uniform
 * over +-A; `uniform`, `rectangular`) or `tri 0.5` (triangular over +-A),
 * A a positive number in full scale (1 is +-FS, N - 1 of the largest
 * quantizer; `1/2` too; a `±` and a trailing `FS` are read past). Returns
 * `{ shape: 'rect' | 'tri', amplitude }`.
 */
export function parseDither(text) {
  const words = String(text ?? '').toLowerCase().replace(/±|\+\/-|\+-/g, ' ').replace(/[,()=]/g, ' ').split(/\s+/).filter(Boolean);
  let shape = 'rect';
  let amplitude = null;
  for (const word of words) {
    if (/^(rect|rectangular|uniform|rnd)$/.test(word)) shape = 'rect';
    else if (/^(tri|triangular|tpdf)$/.test(word)) shape = 'tri';
    else if (/^(a|amplitude|fs)$/.test(word)) continue;
    else {
      const match = word.match(/^(\d*\.?\d+(?:e[-+]?\d+)?)(?:\/(\d*\.?\d+))?$/);
      if (!match || amplitude !== null) throw new Error('a dither source is a shape and an amplitude: rect 1, tri 0.5');
      amplitude = Number(match[1]) / (match[2] ? Number(match[2]) : 1);
    }
  }
  if (!(amplitude > 0) || !Number.isFinite(amplitude)) throw new Error('a dither source needs an amplitude above 0: rect 1, tri 0.5');
  return { shape, amplitude };
}

/** A dither source's value as stored: `rect 1`. */
export const ditherValueText = ({ shape, amplitude }) => `${shape} ${Number(amplitude.toPrecision(12))}`;

/** A quantizer's level count: a whole number of at least 2. */
export function parseLevels(text) {
  const source = String(text ?? '').trim().replace(/^N\s*=\s*/i, '');
  if (!/^\d+$/.test(source) || Number(source) < 2) throw new Error('a quantizer has a whole number of levels, at least 2 (N = 2 is single-bit)');
  return Number(source);
}

/** A gain, a sampler, or a transfer-function block: a value drawn as math. */
export function isSignalBlock(component) {
  return isTransferFunction(component) || isCoefficientBlock(component);
}

/** A gain's value: one coefficient (`k`, `0.5`, `2*g_m`, `-a_1`). */
export function parseGain(text) {
  const tokens = coefficients(`[${String(text ?? '').trim()}]`, 'gain');
  if (tokens.length !== 1) throw new Error('a gain is one coefficient: a number or a symbol (k, 0.5, a_1, 2*g_m)');
  return tokens[0];
}

/**
 * Whether a gain's coefficient is short enough to sit inside its triangle:
 * a plain name of up to two letters with a short subscript, signed or not
 * (`k`, `b_1`, `-g_1`, `K_p`, `a_12`), a positive number of up to three
 * characters (`2`, `10`, `0.5`), or a negative digit (`-2`). Anything else
 * -- a product, a quotient, a longer number -- goes beside the triangle, so
 * every gain in a diagram follows one rule.
 */
export function gainFitsInside(text) {
  let token;
  try { token = parseGain(text); } catch { return false; }
  return /^-?[A-Za-z]{1,2}(?:_\{?[A-Za-z0-9]{1,2}\}?)?$/.test(token) || /^(?:\d{1,2}|\d\.\d|-\d)$/.test(token);
}

/** A gain's value as TeX, or a plain mark when it does not read. */
export function gainDisplay(text) {
  try {
    const token = parseGain(text);
    return `${token.startsWith('-') ? '-' : ''}${coefficientTex(token.replace(/^[-+]/, ''))}`;
  } catch {
    return '\\text{?}';
  }
}

/** The coefficient tokens of one list: `[1 -2, a_1]` -> ['1', '-2', 'a_1']. */
function coefficients(list, what) {
  const body = list.trim().replace(/^[[{]|[\]}]$/g, '').trim();
  if (!body) throw new Error(`the ${what} has no coefficients`);
  // Spaces separate coefficients unless they sit beside an operator, so
  // `[1 2*a]` and `[1, 2 * a]` both read as two.
  const tokens = body.replace(/\s*([*/^])\s*/g, '$1').split(/[\s,;]+/).filter(Boolean);
  for (const token of tokens) {
    if (!/^[-+]?(?:\d+(?:\.\d*)?(?:e[-+]?\d+)?|\.\d+|[A-Za-z\\][\w\\{}^.]*)(?:[*/](?:\d+(?:\.\d*)?|[A-Za-z\\][\w\\{}^.]*))*$/i.test(token)) {
      throw new Error(`bad coefficient "${token}" in the ${what}`);
    }
  }
  return tokens;
}

/**
 * Read a definition for a block in `variable` ('s' or 'z'). Returns
 * `{ num, den, inverse }`: coefficient tokens, highest power first -- or,
 * with `inverse` (z^-1, the default in z), lowest power of z^-1 first.
 * Throws on anything else.
 */
export function parseTransferFunction(text, variable = 's') {
  let source = String(text ?? '').trim();
  if (!source) throw new Error('a transfer function is tf([num], [den]), or a gain');
  const call = source.match(/^tf\s*\(([\s\S]*)\)$/i);
  if (call) source = call[1].trim();
  let inverse = variable === 'z';
  let delay = null;
  // Trailing name-value options: 'Variable', 'z' and 'InputDelay', T.
  for (let option = source.match(/,\s*'(\w+)'\s*,\s*('[^']*'|[^,']+)\s*$/); option; option = source.match(/,\s*'(\w+)'\s*,\s*('[^']*'|[^,']+)\s*$/)) {
    const key = option[1].toLowerCase();
    const value = option[2].trim().replace(/^'|'$/g, '');
    if (key === 'variable') {
      const name = value.replace(/\s/g, '');
      const powers = /^z\^?-1$|^z\^\{-1\}$/i.test(name) ? 'z^-1' : /^[sz]$/i.test(name) ? name.toLowerCase() : null;
      if (!powers) throw new Error(`unknown variable "${value}" ('z' or 'z^-1' in a z block)`);
      if (powers !== variable && !(variable === 'z' && powers === 'z^-1')) throw new Error(`'Variable', '${value}' does not fit an H(${variable}) block`);
      inverse = powers === 'z^-1';
    } else if (key === 'inputdelay' || key === 'iodelay') {
      if (variable !== 's') throw new Error(`'InputDelay' is for H(s) blocks; in z a delay is z^-1`);
      delay = delayValue(parseExpression(value), value);
    } else {
      throw new Error(`unknown option '${option[1]}' ('Variable', or 'InputDelay' in s)`);
    }
    source = source.slice(0, option.index).trim();
  }
  const lists = source.match(/^([[{][^\]}]*[\]}])\s*,?\s*([[{][^\]}]*[\]}])$/);
  if (lists) return { num: coefficients(lists[1], 'numerator'), den: coefficients(lists[2], 'denominator'), inverse, ...(delay ? { delay } : {}) };
  if (/[[\]{}]/.test(source)) throw new Error('a transfer function is tf([num], [den]): two lists of coefficients');
  // A gain: one coefficient over 1.
  return { num: coefficients(`[${source}]`, 'gain'), den: ['1'], inverse, ...(delay ? { delay } : {}) };
}

// ----- expressions in s --------------------------------------------------------------

/**
 * An expression in s, as an AST: `{ t: 'num', v }`, `{ t: 'sym', name }`,
 * `{ t: 'var' }` (s), `{ t: 'exp', delay }` (e^{-s delay}, `delay` an AST
 * free of s), `{ t: 'add', terms: [{ sign, node }] }`, `{ t: 'mul', factors }`,
 * `{ t: 'div', num, den }`, `{ t: 'pow', base, n }`. Multiplication may be
 * implicit (`2s`, `k(s + 1)`). `exp()` takes only a delay, `-s*T` (T a
 * number, a symbol, or a product or quotient of them), so the expression
 * stays a ratio of polynomials in s and its delays.
 */
export function parseExpression(text) {
  const source = String(text ?? '');
  let i = 0;
  const skip = () => { while (/\s/.test(source[i] || '')) i += 1; };
  const peek = () => { skip(); return source[i]; };
  const fail = (what) => { throw new Error(`${what} at "${source.slice(i, i + 12) || 'the end'}"`); };
  const expression = () => {
    const terms = [];
    let sign = 1;
    if (peek() === '-' || peek() === '+') { sign = source[i] === '-' ? -1 : 1; i += 1; }
    terms.push({ sign, node: product() });
    while (peek() === '+' || peek() === '-') {
      sign = source[i] === '-' ? -1 : 1;
      i += 1;
      terms.push({ sign, node: product() });
    }
    return terms.length === 1 && terms[0].sign === 1 ? terms[0].node : { t: 'add', terms };
  };
  const product = () => {
    let node = power();
    for (;;) {
      const c = peek();
      if (c === '*') { i += 1; node = mul(node, power()); }
      else if (c === '/') { i += 1; node = { t: 'div', num: node, den: power() }; }
      else if (c && /[A-Za-z0-9.(\\]/.test(c)) node = mul(node, power());
      else return node;
    }
  };
  const mul = (a, b) => ({ t: 'mul', factors: [...(a.t === 'mul' ? a.factors : [a]), ...(b.t === 'mul' ? b.factors : [b])] });
  const power = () => {
    const base = atom();
    if (peek() !== '^') return base;
    i += 1;
    skip();
    const braced = source[i] === '{' || source[i] === '(';
    if (braced) i += 1;
    const match = source.slice(i).match(/^\s*(-?\d+)(?![.\d])\s*/);
    if (!match) fail('a power must be a whole number');
    i += match[0].length;
    if (braced) { if (peek() !== '}' && peek() !== ')') fail('unclosed power'); i += 1; }
    return { t: 'pow', base, n: Number(match[1]) };
  };
  const atom = () => {
    const c = peek();
    if (c === '(') {
      i += 1;
      const inner = expression();
      if (peek() !== ')') fail('a missing )');
      i += 1;
      return inner;
    }
    const number = source.slice(i).match(/^(\d+(?:\.\d*)?(?:e[-+]?\d+)?|\.\d+)/i);
    if (number) { i += number[0].length; return { t: 'num', v: number[0] }; }
    const name = source.slice(i).match(/^\\?[A-Za-z]+(?:_\{?[A-Za-z0-9]+\}?)?/);
    if (!name) fail('expected a number, a name, or (');
    i += name[0].length;
    const word = name[0].replace(/^\\/, '');
    if (word === 'exp') {
      if (peek() !== '(') fail('exp needs (');
      i += 1;
      const inner = expression();
      if (peek() !== ')') fail('a missing )');
      i += 1;
      return { t: 'exp', delay: delayOf(inner) };
    }
    if (word === 's') return { t: 'var' };
    return { t: 'sym', name: word.replace(/[{}]/g, '') };
  };
  const node = expression();
  if (peek() !== undefined) fail('unexpected text');
  return node;
}

/** Whether an AST has s in it (delays aside). */
function hasVariable(node) {
  switch (node.t) {
    case 'var': return true;
    case 'add': return node.terms.some((term) => hasVariable(term.node));
    case 'mul': return node.factors.some(hasVariable);
    case 'div': return hasVariable(node.num) || hasVariable(node.den);
    case 'pow': return hasVariable(node.base);
    default: return false;
  }
}

/** The delay of `exp(arg)`: arg must be -s times something free of s. */
function delayOf(arg) {
  let sign = 1;
  let node = arg;
  if (node.t === 'add' && node.terms.length === 1) { sign = node.terms[0].sign; node = node.terms[0].node; }
  // -s*T, -T*s, -s*T/2: exactly one s, as a plain factor.
  const flat = [];
  const collect = (n) => { if (n.t === 'mul') n.factors.forEach(collect); else flat.push(n); };
  let quotient = null;
  if (node.t === 'div') { collect(node.num); quotient = node.den; } else collect(node);
  const vars = flat.filter((f) => f.t === 'var');
  const rest = flat.filter((f) => f.t !== 'var');
  if (sign !== -1 || vars.length !== 1 || rest.some(hasVariable) || (quotient && hasVariable(quotient))) {
    throw new Error('exp() takes a delay: exp(-s*T), T a number or a symbol');
  }
  let delay = rest.length === 0 ? { t: 'num', v: '1' } : rest.length === 1 ? rest[0] : { t: 'mul', factors: rest };
  if (quotient) delay = { t: 'div', num: delay, den: quotient };
  return delay;
}

/** A delay given on its own ('InputDelay', T): free of s. */
function delayValue(node, text) {
  if (hasVariable(node)) throw new Error(`a delay is a number or a symbol, not "${text}"`);
  return node;
}

const symbolTex = (name) => name.replace(/^([A-Za-z]+)_(\w+)$/, (m, base, sub) => `${base}_{${sub}}`);

/** An AST as TeX: a quotient as a fraction, delays as e^{-sT}. */
export function expressionTex(node, parent = 0) {
  const wrap = (tex, needed) => (needed ? `\\left(${tex}\\right)` : tex);
  switch (node.t) {
    case 'num': return node.v.replace(/(\d)e([-+]?\d+)/i, (m, d, e) => `${d}\\cdot 10^{${Number(e)}}`);
    case 'sym': return symbolTex(node.name);
    case 'var': return 's';
    case 'exp': {
      const d = node.delay;
      return d.t === 'num' && d.v === '1' ? 'e^{-s}' : `e^{-s\\,${expressionTex(d, 2)}}`;
    }
    case 'add': {
      const tex = node.terms.map((term, index) => `${index === 0 ? (term.sign < 0 ? '-' : '') : (term.sign < 0 ? ' - ' : ' + ')}${expressionTex(term.node, 1)}`).join('');
      return wrap(tex, parent >= 1);
    }
    case 'mul': return wrap(node.factors.map((f) => expressionTex(f, 2)).join('\\,'), parent >= 3);
    case 'div': return `\\frac{${expressionTex(node.num)}}{${expressionTex(node.den)}}`;
    case 'pow': return `${expressionTex(node.base, 3)}^{${node.n}}`;
    default: return '?';
  }
}

/**
 * Read a block's definition: `{ kind: 'lists', num, den, inverse, delay }`
 * (tf() or its lists, or a gain), or in s `{ kind: 'expression', ast }`
 * for an expression with delays. Throws when neither reads.
 */
export function readTransferFunction(text, variable = 's') {
  const source = String(text ?? '');
  // In s, anything that names s or a delay is an expression; the rest -- a
  // gain such as g_m/C -- reads as before.
  if (variable === 's' && !/^\s*(tf\s*\(|[[{])/i.test(source) && /(^|[^A-Za-z\\_{])s(?![A-Za-z_])|exp\s*\(/.test(source)) {
    try {
      return { kind: 'expression', ast: parseExpression(source) };
    } catch (error) {
      throw new Error(`${error.message} (an H(s) block is tf([num], [den]), or an expression in s such as (1 - exp(-s*T))/s)`);
    }
  }
  return { kind: 'lists', ...parseTransferFunction(source, variable) };
}

const isZero = (token) => /^[-+]?0*(\.0*)?$/.test(token);
const isOne = (token) => /^\+?0*1(\.0*)?$/.test(token);
const isMinusOne = (token) => /^-0*1(\.0*)?$/.test(token);

/** A coefficient as TeX: `2*g_m` -> `2 g_{m}`, `a/b` -> `\frac{a}{b}`. */
function coefficientTex(token) {
  const body = token.replace(/^\+/, '');
  const tex = body
    .replace(/([A-Za-z])_([A-Za-z0-9]+)/g, (match, base, sub) => `${base}_{${sub}}`)
    .replace(/(\d)e([-+]?\d+)/gi, (match, digit, exponent) => `${digit}\\cdot 10^{${Number(exponent)}}`);
  const parts = tex.split('/');
  return parts.length === 2 ? `\\frac{${parts[0].replace(/\*/g, '\\,')}}{${parts[1].replace(/\*/g, '\\,')}}` : tex.replace(/\*/g, '\\,');
}

/** One term: a coefficient times the variable to a power. */
function term(token, power, variable, inverse) {
  const v = power === 0 ? '' : inverse ? `${variable}^{-${power}}` : power === 1 ? variable : `${variable}^{${power}}`;
  const negative = token.startsWith('-');
  const magnitude = negative ? token.slice(1) : token.replace(/^\+/, '');
  let body;
  if (v && isOne(magnitude)) body = v;
  else body = `${coefficientTex(magnitude)}${v ? ` ${v}` : ''}`;
  return { negative, body };
}

/** A polynomial as TeX, its terms in the order written. */
export function polynomialTex(tokens, variable, inverse = false) {
  const last = tokens.length - 1;
  const terms = tokens
    .map((token, index) => (isZero(token) ? null : term(token, inverse ? index : last - index, variable, inverse)))
    .filter(Boolean);
  if (!terms.length) return '0';
  return terms.map((t, index) => (index === 0 ? `${t.negative ? '-' : ''}${t.body}` : ` ${t.negative ? '-' : '+'} ${t.body}`)).join('');
}

/** The definition as display math: a fraction, or the numerator alone over 1. */
export function transferFunctionTex(text, variable) {
  const read = readTransferFunction(text, variable);
  if (read.kind === 'expression') return expressionTex(read.ast);
  const tex = listsTex(read, variable);
  if (!read.delay) return tex;
  const delay = expressionTex({ t: 'exp', delay: read.delay });
  return /^\\frac/.test(tex) ? `${tex}\\,${delay}` : tex === '1' ? delay : `\\left(${tex}\\right) ${delay}`;
}

function listsTex({ num, den, inverse }, variable) {
  if (den.length === 1 && isOne(den[0])) return polynomialTex(num, variable, inverse);
  // Over -1: the numerator with its signs flipped.
  if (den.length === 1 && isMinusOne(den[0])) {
    return polynomialTex(num.map((token) => (token.startsWith('-') ? token.slice(1) : `-${token.replace(/^\+/, '')}`)), variable, inverse);
  }
  const top = polynomialTex(num, variable, inverse);
  return `\\frac{${top}}{${polynomialTex(den, variable, inverse)}}`;
}

/** The lines the block's math stacks, as TeX: the numerator and, for a
 *  fraction, the denominator -- what its box is sized around. */
export function transferFunctionLines(text, variable) {
  const tex = transferFunctionDisplay(text, variable);
  const fraction = wholeFraction(tex);
  return fraction || [tex];
}

/** `\frac{a}{b}` as [a, b] when the fraction is the whole of `tex`. */
function wholeFraction(tex) {
  if (!tex.startsWith('\\frac{')) return null;
  const group = (start) => {
    let depth = 0;
    for (let i = start; i < tex.length; i++) {
      if (tex[i] === '{') depth += 1;
      else if (tex[i] === '}' && --depth === 0) return i;
    }
    return -1;
  };
  const end = group(5);
  if (end < 0 || tex[end + 1] !== '{') return null;
  const close = group(end + 1);
  return close === tex.length - 1 ? [tex.slice(6, end), tex.slice(end + 2, close)] : null;
}

/** The block's math: the transfer function, or a plain mark when the
 *  definition does not read (the value keeps what was typed). */
export function transferFunctionDisplay(text, variable) {
  try {
    return transferFunctionTex(text, variable);
  } catch {
    return `H(${variable}) = \\text{?}`;
  }
}

/** The default definition a new block starts with. */
export function defaultTransferFunction(type) {
  return PRESETS[type] || PRESETS.tf_s;
}
