/**
 * Short TeX as plot and label markup (`_{}`, `^{}`, letters and symbols as
 * characters), for the texts drawn without a math typesetter: a plot's axis
 * titles and marker labels, menus, messages. Imports nothing, so the model
 * and the plot modules can use it alike.
 */

/** Strip the common inline/display math delimiters from an equation label.
 * The delimiters are retained in the editable source so users can see and
 * continue editing ordinary TeX, but never become visible glyphs. */
export function stripMathDelimiters(value) {
  const source = String(value ?? '').trim();
  if (source.length >= 4 && source.startsWith('$$') && source.endsWith('$$')) return source.slice(2, -2).trim();
  if (source.length >= 2 && source.startsWith('$') && source.endsWith('$')) return source.slice(1, -1).trim();
  return source;
}

// TeX sets lowercase Greek in math italic (an <mi> default) and uppercase
// Greek upright, which needs the explicit variant.
export const GREEK_LOWER = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
};
export const GREEK_UPPER = {
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

/** TeX's symbol commands that read as one character. */
export const TEX_SYMBOLS = {
  parallel: '∥', cdot: '·', times: '×', pm: '±', mp: '∓', div: '÷',
  infty: '∞', approx: '≈', le: '≤', ge: '≥', leq: '≤', geq: '≥', neq: '≠', ne: '≠', to: '→', gg: '≫',
  ll: '≪', equiv: '≡', propto: '∝', partial: '∂', sim: '∼', lesssim: '≲', gtrsim: '≳',
  degree: '°', circ: '∘', ldots: '…', cdots: '⋯', prime: '′', sqrt: '√', angle: '∠', nabla: '∇',
  rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', uparrow: '↑', downarrow: '↓',
};

const symbol = (name) => GREEK_LOWER[name] || GREEK_UPPER[name] || TEX_SYMBOLS[name] || name;

/**
 * The TeX the math labels take beyond letters, Greek, and TEX_SYMBOLS:
 * each `{ tex, note }`, `tex` an example as typed between `$...$`. Learn's
 * Math tab lists them with the Greek and the symbols, each drawn.
 */
export const TEX_STRUCTURES = Object.freeze([
  { tex: 'V_{out}', note: 'subscript' },
  { tex: 'x^{2}', note: 'superscript' },
  { tex: '\\frac{g_m}{C_L}', note: 'fraction' },
  { tex: '\\sqrt{4kT\\gamma}', note: 'square root' },
  { tex: '\\text{dB}', note: 'upright words' },
  { tex: '\\mathrm{d}t', note: 'upright letters' },
  { tex: '\\operatorname{sinc}', note: 'upright name' },
  { tex: '\\overline{Q}', note: 'overbar (also \\bar)' },
  { tex: '\\left(1 + \\frac{1}{s}\\right)', note: 'brackets that fit' },
  { tex: 'R_1 \\| R_2', note: 'in parallel (also ||)' },
  { tex: 'a\\,b\\;c\\ d\\quad e', note: 'spaces: thin, medium, word, quad' },
]);

/** A short TeX phrase as label markup, for places that draw labels but not
 * math: $\phi_1$ becomes ϕ_{1}, $2\cdot f_s$ 2·f_{s}. Anything else is
 * returned as it is. */
export function texToLabelMarkup(source) {
  const text = String(source ?? '').trim();
  if (!(text.length >= 2 && text.startsWith('$') && text.endsWith('$'))) return text;
  return stripMathDelimiters(text)
    // An overbar (a complementary phase) as a combining overline on each
    // character under it, markup left as it is.
    .replace(/\\(?:overline|bar)\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_, inner) => inner.replace(/\\([A-Za-z]+)/g, (__, name) => symbol(name))
      .replace(/([_^])([^{])/g, '$1{$2}').replace(/[^_^{}]/g, (ch) => `${ch}\u0305`))
    .replace(/\\(?:mathrm|text|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\[,;: ]/g, ' ').replace(/\\!/g, '')
    .replace(/\\([A-Za-z]+) ?/g, (_, name) => symbol(name))
    .replace(/\\([{}$%&#_])/g, '$1')
    .replace(/([_^])([^{])/g, '$1{$2}');
}

/** Short TeX or label markup as readable plain text, for menus and
 * messages: $\phi_{1}$ reads ϕ1, V_{BN} reads VBN. */
export function plainTexText(source) {
  return stripMathDelimiters(source)
    // An overbar (a complementary phase, $\overline{\phi_1}$) as a combining
    // overline over each character it covers: ϕ̅1̅.
    .replace(/\\(?:overline|bar)\{((?:[^{}]|\{[^{}]*\})*)\}/g, (_, inner) => [...plainTexText(inner)].map((ch) => `${ch}\u0305`).join(''))
    .replace(/\\(?:mathrm|text|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\[,;: ]/g, ' ').replace(/\\!/g, '')
    .replace(/\\([A-Za-z]+) ?/g, (_, name) => symbol(name))
    .replace(/[_^]\{([^}]*)\}/g, '$1')
    .replace(/[_^{}]/g, '');
}

/** A plot text with each `$...$` in it as label markup (texToLabelMarkup):
 *  `Gain $A_v$ (dB)` reads Gain A_{v} (dB); `\$` is a dollar sign. */
export function plotTextMarkup(text) {
  const source = String(text ?? '');
  if (!source.includes('$')) return source;
  return source.replace(/(?<!\\)\$\$?((?:[^$\\]|\\.)+?)\$\$?/g, (_, tex) => texToLabelMarkup(`$${tex}$`)).replace(/\\\$/g, '$');
}
