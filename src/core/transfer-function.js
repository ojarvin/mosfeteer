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
 *   k                         a plain gain: one coefficient, no lists.
 *
 * A coefficient is a number or a symbol (`k`, `a_1`, `2*g_m`, `-p`), so a
 * block can carry a symbolic gain or pole. This module only reads and draws
 * the definition; it imports nothing, so the model can size the box from it.
 */

export const TRANSFER_FUNCTION_TYPES = Object.freeze({ tf_s: 's', tf_z: 'z' });
export const TRANSFER_FUNCTION_ROLE = 'transfer-function';

export function isTransferFunction(component) {
  return !!component && Object.hasOwn(TRANSFER_FUNCTION_TYPES, component.type);
}

/** A gain block or a transfer-function block: a value drawn as math. */
export function isSignalBlock(component) {
  return isTransferFunction(component) || component?.type === 'gain';
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
  const option = source.match(/,\s*'variable'\s*,\s*'([^']*)'\s*$/i);
  if (option) {
    const name = option[1].replace(/\s/g, '');
    const powers = /^z\^?-1$|^z\^\{-1\}$/i.test(name) ? 'z^-1' : /^[sz]$/i.test(name) ? name.toLowerCase() : null;
    if (!powers) throw new Error(`unknown variable "${option[1]}" ('z' or 'z^-1' in a z block)`);
    if (powers !== variable && !(variable === 'z' && powers === 'z^-1')) throw new Error(`'Variable', '${option[1]}' does not fit an H(${variable}) block`);
    inverse = powers === 'z^-1';
    source = source.slice(0, option.index).trim();
  }
  const lists = source.match(/^([[{][^\]}]*[\]}])\s*,?\s*([[{][^\]}]*[\]}])$/);
  if (lists) return { num: coefficients(lists[1], 'numerator'), den: coefficients(lists[2], 'denominator'), inverse };
  if (/[[\]{}]/.test(source)) throw new Error('a transfer function is tf([num], [den]): two lists of coefficients');
  // A gain: one coefficient over 1.
  return { num: coefficients(`[${source}]`, 'gain'), den: ['1'], inverse };
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
  const { num, den, inverse } = parseTransferFunction(text, variable);
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
  const fraction = tex.match(/^\\frac\{(.*)\}\{(.*)\}$/);
  return fraction ? [fraction[1], fraction[2]] : [tex];
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
  // An accumulator in z: 1 / (1 - z^-1).
  return type === 'tf_z' ? 'tf([1], [1 -1])' : 'tf([1], [1 1])';
}
