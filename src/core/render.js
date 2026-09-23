import { applyTransform, fmt, transformRect, transformToSvg } from './geometry.js';
import { ceilGrid, floorGrid, GRID } from './grid.js';
import { autoRoute, steinerBranches } from './router.js';
import { escapeSvg, fontAttrs, resolveColor, strokeAttrs, strokeWidth, styleAttrs, themeInkSvg } from './style.js';
import { INTERFACE_PIN_TYPES, LABEL_ALIGN_INSET, LABEL_FONT_SIZE, LabelInstance, isReferenceMarker, referenceMarkerInfo, stripMathDelimiters } from './model.js';
import { defaultArrowhead, polylineArrowheads } from './line-style.js';
import { hiddenSupplyBarLabels, supplyBars } from './supply-bars.js';

function pt(x, y) {
  return `${fmt(x)} ${fmt(y)}`;
}

/**
 * Map an absolute M/L/C path's coordinates through a component transform.
 * `trim` pulls a straight first/last segment's ends in by that distance, so a
 * butt-ended lead keeps its exact look inside a square-capped ink path.
 */
function transformPathD(d, t, trim = 0) {
  const tokens = String(d).match(/[MLC]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  const commands = [];
  for (const token of tokens) {
    if (/^[MLC]$/.test(token)) commands.push({ command: token, values: [] });
    else commands.at(-1)?.values.push(Number(token));
  }
  const pull = (point, toward) => {
    const dx = toward[0] - point[0];
    const dy = toward[1] - point[1];
    const length = Math.hypot(dx, dy);
    if (!length || length <= 2 * trim) return point;
    return [point[0] + dx / length * trim, point[1] + dy / length * trim];
  };
  if (trim > 0 && commands.length >= 2 && commands[0].command === 'M' && commands[1].command === 'L') {
    const [x, y] = pull(commands[0].values.slice(0, 2), commands[1].values.slice(0, 2));
    commands[0].values.splice(0, 2, x, y);
  }
  const last = commands.at(-1);
  if (trim > 0 && commands.length >= 2 && last.command === 'L' && last.values.length === 2) {
    const prev = commands.at(-2).values.slice(-2);
    const [x, y] = pull(last.values, prev);
    last.values.splice(0, 2, x, y);
  }
  const format = (n) => Number(n.toFixed(3));
  return commands.map(({ command, values }) => {
    const points = [];
    for (let i = 0; i + 1 < values.length; i += 2) {
      const p = applyTransform(t, values[i], values[i + 1]);
      points.push(`${format(p.x)} ${format(p.y)}`);
    }
    return `${command} ${points.join(' ')}`;
  }).join(' ');
}

/** Solid strokes merged into one path render without doubled anti-aliased edges. */
function solidStyle(style) {
  return !style?.lineStyle || style.lineStyle === 'solid';
}

function strokeWidthOf(style, base = 'symbol') {
  return strokeWidth(style, base);
}

/** These terminals land on the centerline of a stroked body outline. Pull a
 * filled arrowhead out by half that outline so its tip meets the visible edge
 * rather than disappearing into the body. */
function terminalBodyInset(circuit, point) {
  for (const component of circuit.components.values()) {
    if (!['block', 'signal_sum', 'signal_multiply'].includes(component.type)) continue;
    if (component.terminalDefs.some((terminal) => {
      const world = component.terminalWorld(terminal.name);
      return world.x === point.x && world.y === point.y;
    })) return strokeWidthOf(component.style, 'emph') / 2;
  }
  return 0;
}

function wireArrowheadOptions(circuit, points) {
  return {
    startInset: terminalBodyInset(circuit, points[0]),
    endInset: terminalBodyInset(circuit, points.at(-1)),
  };
}

// One shared miter limit keeps merged wires and sharp resistor leads in one
// group, and every ink subpath uses the wires' projecting square cap.
const INK_MITER_LIMIT = 5;
function inkAttrs(style) {
  return styleAttrs(style, 'wire', INK_MITER_LIMIT);
}

function polygonPoints(g) {
  if (typeof g.points === 'string') return g.points;
  return (g.points || []).map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(' ');
}

function graphicsToSvg(g, textTransform = '', objectStyle = null) {
  const stroke = objectStyle ? styleAttrs(objectStyle, g.style, g.miterLimit) : strokeAttrs(g.style, g.miterLimit);
  switch (g.kind) {
    case 'path':
      return `<path d="${g.d}" fill="none" ${stroke}/>`;
    case 'circle':
      return `<circle cx="${fmt(g.cx)}" cy="${fmt(g.cy)}" r="${fmt(g.r)}" fill="#fff" ${stroke}/>`;
    case 'rect':
      return `<rect x="${fmt(g.x)}" y="${fmt(g.y)}" width="${fmt(g.w)}" height="${fmt(g.h)}" fill="#fff" ${stroke}/>`;
    case 'polygon':
      if (g.fill === 'foreground') {
        return `<polygon points="${polygonPoints(g)}" fill="${escapeSvg(resolveColor(objectStyle?.color || '#111'))}" stroke="none"/>`;
      }
      return `<polygon points="${polygonPoints(g)}" fill="${escapeSvg(resolveColor(g.fill || 'none'))}" ${stroke}/>`;
    case 'text':
      return `<text x="${fmt(g.x)}" y="${fmt(g.y)}" text-anchor="${g.anchor || 'middle'}" font-family="sans-serif" ${fontAttrs(g.font || 'label')} stroke="none"${g.keepUpright ? ` transform="${textTransform}"` : ''}>${escapeSvg(g.text)}</text>`;
    case 'dot':
      return `<circle cx="${fmt(g.cx)}" cy="${fmt(g.cy)}" r="${fmt(g.r)}" fill="${escapeSvg(resolveColor(objectStyle?.color || g.fill || '#111'))}" stroke="none"/>`;
    default:
      return '';
  }
}

function symbolTextSvg(g, t, color = '#111') {
  const p = applyTransform(t, g.x, g.y);
  const font = fontAttrs(g.font || 'label').replace(/fill="[^"]+"/, `fill="${escapeSvg(resolveColor(color))}"`);
  const attrs = `x="${fmt(p.x)}" y="${fmt(p.y)}" dominant-baseline="middle" text-anchor="${g.anchor || 'middle'}" font-family="sans-serif" ${font} stroke="none"`;
  const lines = String(g.text ?? '').split('\n');
  if (lines.length === 1) return `<text ${attrs}>${escapeSvg(lines[0])}</text>`;
  const lineHeight = g.font === 'label' ? LABEL_FONT_SIZE : 16;
  const firstDy = -((lines.length - 1) * lineHeight) / 2;
  const tspans = lines.map((line, index) => `<tspan x="${fmt(p.x)}" dy="${fmt(index ? lineHeight : firstDy)}">${escapeSvg(line)}</tspan>`).join('');
  return `<text ${attrs}>${tspans}</text>`;
}

function textEl(x, y, text, anchor, size, fill) {
  return `<text x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor || 'middle'}" font-family="sans-serif" font-size="${size || 12}" fill="${escapeSvg(resolveColor(fill || '#111'))}" stroke="none">${escapeSvg(text)}</text>`;
}

// Label-object text with one of the style.js font kinds ("instance" | "label").
// Runs with `sub`/`super` render as tspans (baseline-shift + smaller size) so
// instance labels like M1 render as M with a subscript 1, keeping the text's
// alignment/anchor untouched (alignment is handled by the parent <text>).
function labelTextEl(x, y, runs, anchor, kind, color = '#111', width = 'normal', textStyle = {}) {
  let font = fontAttrs(kind)
    .replace(/fill="[^"]+"/, `fill="${escapeSvg(resolveColor(color))}"`)
    .replace(/font-size="[^"]+"/, `font-size="${width === 'thin' ? 32 : width === 'thick' ? 44 : 38}"`)
    .replace(/font-weight="[^"]+"/, `font-weight="${textStyle.bold === false ? 'normal' : 'bold'}"`);
  if (textStyle.italic === false) font = font.replace(/ font-style="italic"/, '');
  const attrs = `x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor}" font-family="sans-serif" ${font} stroke="none"`;
  if (runs.length === 1 && !runs[0].sub && !runs[0].super && !runs[0].text.includes('\n')) {
    return `<text ${attrs}>${escapeSvg(runs[0].text)}</text>`;
  }
  const lineRuns = [[]];
  for (const run of runs) {
    const parts = String(run.text).split('\n');
    parts.forEach((part, index) => {
      if (part) lineRuns.at(-1).push({ ...run, text: part });
      if (index < parts.length - 1) lineRuns.push([]);
    });
  }
  const renderRuns = (line) => line.map((r) => {
      if (!r.sub && !r.super) return escapeSvg(r.text);
      const shift = r.sub ? 'baseline-shift="-6px"' : 'baseline-shift="6px"';
      const size = r.sub || r.super ? ' font-size="0.62em"' : '';
      return `<tspan ${shift}${size}>${escapeSvg(r.text)}</tspan>`;
    }).join('');
  const body = lineRuns.length === 1
    ? renderRuns(lineRuns[0])
    : lineRuns.map((line, lineIndex) => `<tspan x="${fmt(x)}" dy="${lineIndex ? LABEL_FONT_SIZE : 0}">${renderRuns(line)}</tspan>`).join('');
  return `<text ${attrs}>${body}</text>`;
}

const MATH_FONT_FAMILY = "'Latin Modern Math','Computer Modern','CMU Serif','STIX Two Math','Cambria Math','DejaVu Serif',serif";

function mathMlAtom(value, kind = 'mi', attrs = '') {
  return `<${kind}${attrs ? ` ${attrs}` : ''}>${escapeSvg(value)}</${kind}>`;
}

function mathMlDelimiter(value, stretchy = true) {
  // Fences stretch to their own <mrow> (see parseFenced), so no minimum size
  // is imposed: a short group keeps LaTeX's text-size parenthesis. TeX sets
  // no space between a fence and its content, so neither do we.
  return mathMlAtom(value, 'mo', `fence="true" stretchy="${stretchy}" lspace="0em" rspace="0em"`);
}

// TeX typesets a leading sign as a prefix: `-g_m` is tight, while the `-` of
// `a - b` keeps binary spacing. It also draws U+2212, which is wider and sits
// higher than the ASCII hyphen.
const MATH_SIGNS = { '-': '\u2212', '+': '+' };

// TeX sets lowercase Greek in math italic (an <mi> default) and uppercase
// Greek upright, which needs the explicit variant.
const GREEK_LOWER = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
};
const GREEK_UPPER = {
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

// TeX Appendix G rule 18a: when the nucleus is a single character, the script
// shift ignores that character's own height and depth, so `g_m` and `r_o` set
// their subscripts on one line. MathML instead drops a subscript clear of a
// descender (the MATH table's SubscriptBaselineDropMin) and lifts a
// superscript clear of a tall base, which parts those subscripts by 0.17 em.
// Zeroing the metric each shift is measured from restores TeX's rule; mpadded
// changes only the reported box, so the glyph itself is untouched.
const SINGLE_CHARACTER = /^<m[in](?: [^>]*)?>(?:[^<&]|&[a-z]+;|&#\d+;)<\/m[in]>$/;

// A provenance wrapper (see the `\pv` branch below) must not hide the nucleus
// it groups: the padding belongs on the character, the `data-node` attribute
// outside it, so a provenance render lays out exactly like an ordinary one.
const PROVENANCE_ROW = /^(<mrow data-node="\d+">)([\s\S]*)(<\/mrow>)$/;

function mathMlNucleus(base, metric) {
  const wrapped = PROVENANCE_ROW.exec(base);
  if (wrapped) return `${wrapped[1]}${mathMlNucleus(wrapped[2], metric)}${wrapped[3]}`;
  return SINGLE_CHARACTER.test(base) ? `<mpadded ${metric}="0">${base}</mpadded>` : base;
}

function mathMlSign(value, prefix) {
  const glyph = MATH_SIGNS[value];
  return prefix
    ? mathMlAtom(glyph, 'mo', 'form="prefix" lspace="0em" rspace="0em"')
    : mathMlAtom(glyph, 'mo', 'form="infix"');
}

/** Size table shared by the parallel operator and the evaluation bar. */
function fenceSize(tall, requestedSize) {
  if (requestedSize === 'Bigg') return 'minsize="2.8em" maxsize="3.4em"';
  if (requestedSize === 'bigg') return 'minsize="2.4em" maxsize="3.0em"';
  if (requestedSize === 'Big') return 'minsize="2.0em" maxsize="2.5em"';
  if (requestedSize === 'big') return 'minsize="1.6em" maxsize="2.0em"';
  return tall ? 'minsize="2.2em" maxsize="2.8em"' : 'minsize="1.2em"';
}

/**
 * A single tall bar, as in `Z_{out} = v/i \Big\vert_{v_{in}=0}`: the
 * condition a quantity was evaluated under. It takes the same sizing as the
 * parallel operator, and hugs its own subscript on the right.
 */
function mathMlEvaluationBar(tall = false, requestedSize = null) {
  const attrs = `fence="true" stretchy="true" ${fenceSize(tall, requestedSize)} lspace="0.15em" rspace="0em"`;
  return mathMlAtom('|', 'mo', attrs);
}

function mathMlParallel(tall = false, requestedSize = null) {
  // Use the same single double-bar operator as LaTeX `\Vert`, rather than
  // two independent bars whose MathML operator spacing creates a large gap.
  // Explicit Big/Bigg commands win; a fraction on the line gets the compact
  // `\Big\Vert` treatment automatically.
  const attrs = `fence="false" stretchy="true" ${fenceSize(tall, requestedSize)} lspace="0.15em" rspace="0.15em"`;
  return mathMlAtom('∥', 'mo', attrs);
}

/** Pixel size declared on an SVG root, with a sensible fallback. Shared by the
 *  editor's PNG rasterization and the server's PDF page sizing. */
export function svgPixelSize(svg) {
  const root = String(svg).match(/<svg\b[^>]*>/i)?.[0] || '';
  const width = Number(root.match(/\bwidth="([\d.]+)"/i)?.[1]);
  const height = Number(root.match(/\bheight="([\d.]+)"/i)?.[1]);
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1000,
    height: Number.isFinite(height) && height > 0 ? height : 800,
  };
}

/** Convert the small TeX subset emitted by symbolic analysis into MathML.
 * MathML is rendered by the browser inside the live SVG through a
 * foreignObject; keeping this parser local avoids a runtime CDN dependency. */
export function texToMathML(source) {
  const text = stripMathDelimiters(source).replace(/\s+/g, ' ').trim();
  const hasFraction = /\\frac\b/.test(text);
  let index = 0;
  const commandSymbols = {
    parallel: '∥', cdot: '·', times: '×', pm: '±', mp: '∓',
    infty: '∞', approx: '≈', le: '≤', ge: '≥', neq: '≠', to: '→', gg: '≫',
    ll: '≪', equiv: '≡', propto: '∝', partial: '∂',
  };
  let requestedParallelSize = null;
  const skipSpaces = () => { while (text[index] === ' ') index += 1; };
  const parseSequence = (stop = null) => {
    const atoms = [];
    while (index < text.length) {
      if (stop && text[index] === stop) { index += 1; break; }
      const token = text[index];
      if (token === '_' || token === '^') {
        index += 1;
        const script = parseArgument();
        const base = atoms.pop() || mathMlAtom('', 'mi');
        atoms.push(token === '_'
          ? `<msub>${mathMlNucleus(base, 'depth')}${script}</msub>`
          : `<msup>${mathMlNucleus(base, 'height')}${script}</msup>`);
        continue;
      }
      atoms.push(parseAtom(atoms[atoms.length - 1]));
    }
    return atoms.join('');
  };
  // A fenced group is its own <mrow>, so its delimiters stretch to that group
  // and nothing else — what LaTeX's \left…\right does. Without the wrapper
  // every parenthesis stretches to the tallest thing on the line, so `A_v(s)`
  // next to a fraction grows parentheses several lines tall.
  const parseFenced = (open, close) => {
    const body = parseSequence(close);
    const closed = text[index - 1] === close;
    // Only a group that is genuinely taller than one line gets stretched
    // fences, the way a TeX author reaches for \left…\right there and plain
    // parentheses everywhere else: a stretched glyph is also padded away from
    // its content, which reads as a gap around short groups like `(s)`.
    const tall = /<mfrac|<msqrt/.test(body);
    return `<mrow>${mathMlDelimiter(open, tall)}${body}${closed ? mathMlDelimiter(close, tall) : ''}</mrow>`;
  };
  const parseArgument = () => {
    skipSpaces();
    if (text[index] === '{') {
      index += 1;
      return `<mrow>${parseSequence('}')}</mrow>`;
    }
    return parseAtom();
  };
  // A marker argument is read literally: `present.js` writes only digits here
  // and its contents are an AST node id, not math to typeset.
  const parseRawArgument = () => {
    skipSpaces();
    if (text[index] !== '{') return '';
    index += 1;
    let raw = '';
    while (index < text.length && text[index] !== '}') raw += text[index++];
    if (text[index] === '}') index += 1;
    return raw;
  };
  const parseTextArgument = () => {
    skipSpaces();
    if (text[index] !== '{') return parseArgument();
    index += 1;
    let depth = 1;
    let raw = '';
    while (index < text.length && depth > 0) {
      const ch = text[index++];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      if (depth > 0) raw += ch;
    }
    // TeX/editor spacing commands have no literal glyph to emit. Preserve
    // them as visible word spaces in <mtext> so prose such as "Miller
    // approximation used for" does not collapse together.
    const prose = raw
      // Accept the editor's escaped colon while converting other spacing
      // commands to ordinary word spaces.
      .replace(/\\:/g, ':')
      .replace(/\\qquad/g, '  ')
      .replace(/\\quad/g, ' ')
      .replace(/\\[;,!]/g, ' ')
      .replace(/\\ /g, ' ')
      .replace(/\s+/g, ' ');
    return `<mtext>${escapeSvg(prose).replace(/ /g, '&#160;')}</mtext>`;
  };
  const parseCommand = () => {
    index += 1; // backslash
    const match = text.slice(index).match(/^[A-Za-z]+|^./);
    if (!match) return mathMlAtom('\\', 'mo');
    const name = match[0];
    index += name.length;
    if (name === 'frac') {
      const numerator = parseArgument();
      const denominator = parseArgument();
      return `<mfrac>${numerator}${denominator}</mfrac>`;
    }
    if (name === 'sqrt') return `<msqrt>${parseArgument()}</msqrt>`;
    if (name === 'pv') {
      // Provenance marker from `present.js`: the first group is the AST node
      // id, the second is the sub-expression rendered from it. The wrapper is
      // an <mrow>, MathML's own grouping element, so it carries the attribute
      // without changing layout. Ordinary renders emit no markers, so nothing
      // persisted, exported, or edited as a label ever reaches this branch.
      const id = parseRawArgument().replace(/[^0-9]/g, '');
      skipSpaces();
      if (text[index] !== '{') return `<mrow data-node="${id}">${parseAtom()}</mrow>`;
      index += 1;
      return `<mrow data-node="${id}">${parseSequence('}')}</mrow>`;
    }
    // \left is transparent: the delimiter after it starts a fenced group like
    // any other. \right and \middle are dropped without consuming their
    // delimiter, so the enclosing group closes on it exactly once.
    if (name === 'left') return parseAtom();
    if (name === 'right' || name === 'middle') return '';
    if (name === '|') {
      // The analysis engine emits the TeX-safe parallel spelling `\|\|`.
      // Consume both escaped bars as one compact operator so the second bar
      // is not parsed as an independent stretchy delimiter.
      if (text[index] === '\\' && text[index + 1] === '|') index += 2;
      const parallel = mathMlParallel(hasFraction, requestedParallelSize);
      requestedParallelSize = null;
      return parallel;
    }
    if (name === 'vert') {
      const bar = mathMlEvaluationBar(hasFraction, requestedParallelSize);
      requestedParallelSize = null;
      return bar;
    }
    if (name === 'Vert') {
      const parallel = mathMlParallel(hasFraction, requestedParallelSize);
      requestedParallelSize = null;
      return parallel;
    }
    if (name === 'mathrm' || name === 'text' || name === 'operatorname') return parseTextArgument();
    if (name === 'parallel') {
      const parallel = mathMlParallel(hasFraction, requestedParallelSize);
      requestedParallelSize = null;
      return parallel;
    }
    if (['big', 'Big', 'bigg', 'Bigg'].includes(name)) {
      requestedParallelSize = name;
      return '';
    }
    if (name === 'quad') return '<mspace width="1em"/>';
    if (name === 'qquad') return '<mspace width="2em"/>';
    if (name === '>') return mathMlAtom('>', 'mo');
    if (GREEK_LOWER[name]) return mathMlAtom(GREEK_LOWER[name], 'mi');
    if (GREEK_UPPER[name]) return mathMlAtom(GREEK_UPPER[name], 'mi', 'mathvariant="normal"');
    if (commandSymbols[name]) return mathMlAtom(commandSymbols[name], 'mo');
    if (name === ',' || name === ';' || name === '!') return '';
    return mathMlAtom(name, 'mi');
  };
  // An atom that follows nothing, or follows an operator, starts an
  // expression: a sign there is TeX's prefix form.
  const parseAtom = (previous = null) => {
    skipSpaces();
    if (index >= text.length) return '';
    // Be forgiving for hand-authored labels that use plain `||` rather than
    // the TeX-safe `\|\|` spelling.  Both forms render identically, while
    // the stored label source remains untouched for editing.
    if (text[index] === '|' && text[index + 1] === '|') {
      index += 2;
      const parallel = mathMlParallel(hasFraction, requestedParallelSize);
      requestedParallelSize = null;
      return parallel;
    }
    if (text[index] === '\\') return parseCommand();
    if (text[index] === '{') {
      index += 1;
      return `<mrow>${parseSequence('}')}</mrow>`;
    }
    const char = text[index++];
    if (/[A-Za-z]/.test(char)) return mathMlAtom(char, 'mi');
    if (/[0-9]/.test(char)) return mathMlAtom(char, 'mn');
    if (char === '(' || char === '[') return parseFenced(char, char === '(' ? ')' : ']');
    if ('()[]|'.includes(char)) return mathMlDelimiter(char);
    if (MATH_SIGNS[char]) return mathMlSign(char, !previous || /^<mo\b/.test(previous));
    if (char === ' ' && text[index] === ' ') return '<mspace width="0.25em"/>';
    return mathMlAtom(char, 'mo');
  };
  return `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" style="font-family:${MATH_FONT_FAMILY};color:inherit"><mrow>${parseSequence()}</mrow></math>`;
}

function mathLabelSvg(label, opacity = '') {
  const box = label.bbox();
  const color = resolveColor(label.style?.color || '#111');
  // Keep the default ink theme-aware.  Math labels live in an XHTML
  // foreignObject, so the SVG attribute recoloring rules used by ordinary
  // <text> labels do not reach their inline `color` declaration.  Explicit
  // user colors remain literal and therefore are not changed by dark mode.
  const colorCss = color.toLowerCase() === '#111' ? 'var(--svg-ink, #111)' : color;
  const fontSize = label.style?.width === 'thin' ? 32 : label.style?.width === 'thick' ? 44 : 38;
  const justify = label.align === 'left' ? 'flex-start' : label.align === 'right' ? 'flex-end' : 'center';
  const aria = escapeSvg(`Math label ${label.text}`);
  const sidePadding = Math.max(6, Math.min(LABEL_ALIGN_INSET, box.w - label.textWidth() - 6));
  const padding = `6px ${label.align === 'right' ? sidePadding : 6}px 6px ${label.align === 'left' ? sidePadding : 6}px`;
  const style = `width:100%;height:100%;display:flex;flex-direction:column;align-items:stretch;justify-content:center;box-sizing:border-box;padding:${padding};overflow:visible;white-space:nowrap;color:${escapeSvg(colorCss)};font-family:${MATH_FONT_FAMILY};font-size:${fontSize}px;line-height:1.2;font-weight:normal;pointer-events:none;`;
  const lineStyle = `display:flex;flex-shrink:0;align-items:center;justify-content:${justify};width:100%;min-height:1.2em;`;
  const lines = stripMathDelimiters(label.text).split(/\r?\n/)
    .map((line) => `<div class="schematic-math-line" style="${lineStyle}">${texToMathML(line)}</div>`)
    .join('');
  return `<foreignObject x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(box.w)}" height="${fmt(box.h)}" pointer-events="none"${opacity}><div xmlns="http://www.w3.org/1999/xhtml" class="schematic-math-label" style="${style}" aria-label="${aria}">${lines}</div></foreignObject>`;
}

function polylineD(points) {
  return points.map((point, i) => `${i ? 'L' : 'M'} ${pt(point.x, point.y)}`).join(' ');
}

function arrowheadsSvg(heads, color, opacity = '') {
  return heads.map((head) => `<polygon points="${pt(head.tip.x, head.tip.y)} ${pt(head.left.x, head.left.y)} ${pt(head.right.x, head.right.y)}" fill="${escapeSvg(resolveColor(color || '#111'))}" stroke="none"${opacity}/>`).join('');
}

function styledPolylineSvg(points, style, base, fallback = 'none', opacity = '') {
  const geometry = polylineArrowheads(points, style?.arrowhead, { fallback });
  if (geometry.shaftPoints.length < 2) return '';
  const attrs = styleAttrs(style, base);
  return `<path d="${polylineD(geometry.shaftPoints)}" fill="none"${opacity} ${attrs}/>${arrowheadsSvg(geometry.heads, style?.color, opacity)}`;
}

function shapeAnnotationSvg(label, opacity = '') {
  const a = label.anchor; const b = label.end;
  if (label.kind === 'line' || label.kind === 'arrow') {
    const points = label.points?.length ? label.points : [a, b];
    return styledPolylineSvg(points, label.style, 'annotation', defaultArrowhead(label.kind), opacity);
  }
  const attrs = styleAttrs(label.style);
  if (label.kind === 'box') {
    const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y);
    return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(Math.abs(b.x - a.x))}" height="${fmt(Math.abs(b.y - a.y))}" fill="none"${opacity} ${attrs}/>`;
  }
}
/**
 * Bare drawable geometry of one component (body graphics plus symbol text),
 * without ids, labels, or accessibility wrappers. Editor effects restyle it
 * with CSS, e.g. the commit-feedback glow that traces the symbol itself.
 */
export function componentShapeSvg(c) {
  const t = c.transform;
  const body = c.type === 'block'
    ? `<rect x="${fmt(-c.blockSize.w / 2)}" y="${fmt(-c.blockSize.h / 2)}" width="${fmt(c.blockSize.w)}" height="${fmt(c.blockSize.h)}" fill="#fff" ${styleAttrs(c.style, 'emph')}/>`
    : c.def.graphics.filter((g) => g.kind !== 'text').map((g) => graphicsToSvg(g, '', c.style)).join('');
  const text = c.def.graphics.filter((g) => g.kind === 'text').map((g) => symbolTextSvg(g, t, c.style?.color || '#111')).join('');
  return `<g transform="${transformToSvg(t)}">${body}</g>${text}`;
}

/**
 * Bare drawable geometry of one label: its text, or the line/arrow/box of a
 * visual annotation. Math labels are HTML (foreignObject) and return null.
 */
export function labelShapeSvg(label) {
  if (['box', 'arrow', 'line'].includes(label.kind)) return shapeAnnotationSvg(label);
  if (label.math) return null;
  const t = label.textPos();
  return labelTextEl(t.x, t.y, label.runs(), t.anchor, label.owner ? 'instance' : 'label', resolveColor(label.style?.color || '#111'), label.style?.width, label.style);
}

/**
 * The view-dependent parts of a viewport render: the root sizing attributes,
 * the background rectangle, and the grid lines. Everything else in the drawing
 * is in world coordinates, so the editor re-applies only this frame on pan and
 * zoom instead of re-rendering the whole schematic.
 */
export function viewportFrame(vp) {
  const x1 = vp.x + vp.w;
  const y1 = vp.y + vp.h;
  const W = x1 - vp.x;
  const H = y1 - vp.y;
  return {
    width: `${W}`,
    height: `${H}`,
    viewBox: `${fmt(vp.x)} ${fmt(vp.y)} ${fmt(W)} ${fmt(H)}`,
    background: { x: fmt(vp.x), y: fmt(vp.y), width: fmt(W), height: fmt(H) },
  };
}

/** Grid lines covering a viewport, as one path: panning then rewrites a
 * single attribute instead of replacing hundreds of elements. */
export function viewportGridPath(vp) {
  const x1 = vp.x + vp.w;
  const y1 = vp.y + vp.h;
  const d = [];
  for (let x = ceilGrid(vp.x); x <= ceilGrid(x1); x += GRID) d.push(`M ${fmt(x)} ${fmt(vp.y)} V ${fmt(y1)}`);
  for (let y = ceilGrid(vp.y); y <= ceilGrid(y1); y += GRID) d.push(`M ${fmt(vp.x)} ${fmt(y)} H ${fmt(x1)}`);
  return d.join(' ');
}

export function viewportGridSvg(vp) {
  return `<path class="grid-line" d="${viewportGridPath(vp)}" fill="none" stroke="#e9e9e9" stroke-width="1"/>`;
}

/**
 * Render a Circuit to an SVG string.
 * opts.grid: draw the coarse 40-unit grid. opts.terminals / opts.junctions:
 * draw terminal dots / net junction dots. opts.background: white rect.
 * opts.netNames: label nets by name. opts.includeBBox: draw component bboxes.
 * opts.emptyHint: draw the 'empty schematic' placeholder (default true).
 * opts.themeInk: emit default ink as currentColor for theme-aware editor views.
 * opts.underlay: emit an empty editor-underlay group above the grid for effects.
 * opts.viewport {x,y,w,h}: fixed world window to render (infinite canvas). When
 * absent, the view auto-fits the circuit contents (used for exports / PNG).
 */
export function svgString(circuit, opts = {}) {
  const o = { grid: false, terminals: true, junctions: true, background: true, netNames: false, includeBBox: false, emptyHint: true, ...opts };
  const ghostRefs = o.ghostRefs instanceof Set ? o.ghostRefs : new Set(o.ghostRefs || []);
  const ghostLabels = o.ghostLabels instanceof Set ? o.ghostLabels : new Set(o.ghostLabels || []);
  const ghostNets = o.ghostNets instanceof Set ? o.ghostNets : new Set(o.ghostNets || []);
  const b = circuit.bounds(o.grid || o.background ? 0 : 20);
  const vp = o.viewport;
  const empty = b.w <= 0 && b.h <= 0;
  if (empty && !vp) {
    const w = 400;
    const h = 200;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`];
    parts.push(`<rect width="${w}" height="${h}" fill="#fff"/>`);
    if (o.grid) {
      for (let x = 0; x <= w; x += GRID) parts.push(`<line class="grid-line" x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#eee" stroke-width="1"/>`);
      for (let y = 0; y <= h; y += GRID) parts.push(`<line class="grid-line" x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#eee" stroke-width="1"/>`);
    }
    parts.push(textEl(w / 2, h / 2, 'empty schematic', 'middle', 16, '#999'));
    parts.push('</svg>');
    return parts.join('\n');
  }

  // Extents to draw (in world units). With a viewport the window is the exact
  // view (so free panning never rescales the drawing); without one, the view
  // auto-fits the circuit contents (exports / PNG).
  const pad = o.padding ?? (o.grid && !vp ? 0 : 40);
  const x0 = vp ? vp.x : floorGrid(b.x) - pad;
  const y0 = vp ? vp.y : floorGrid(b.y) - pad;
  const x1 = vp ? vp.x + vp.w : ceilGrid(b.x + b.w) + pad;
  const y1 = vp ? vp.y + vp.h : ceilGrid(b.y + b.h) + pad;
  const W = x1 - x0;
  const H = y1 - y0;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${fmt(x0)} ${fmt(y0)} ${fmt(W)} ${fmt(H)}">`,
  ];

  if (o.background) parts.push(`<rect x="${fmt(x0)}" y="${fmt(y0)}" width="${fmt(W)}" height="${fmt(H)}" fill="#fff"/>`);

  if (empty && o.emptyHint) parts.push(textEl(x0 + W / 2, y0 + H / 2, 'empty schematic', 'middle', 16, '#999'));

  if (o.grid) {
    if (vp) {
      parts.push(viewportGridSvg(vp));
    } else {
      for (let x = x0; x <= x1; x += GRID) {
        parts.push(`<line class="grid-line" x1="${fmt(x)}" y1="${fmt(y0)}" x2="${fmt(x)}" y2="${fmt(y1)}" stroke="#e9e9e9" stroke-width="1"/>`);
      }
      for (let y = y0; y <= y1; y += GRID) {
        parts.push(`<line class="grid-line" x1="${fmt(x0)}" y1="${fmt(y)}" x2="${fmt(x1)}" y2="${fmt(y)}" stroke="#e9e9e9" stroke-width="1"/>`);
      }
    }
  }
  // Editor-only slot for transient effects that should glow behind the drawing.
  if (o.underlay) parts.push('<g class="editor-underlay"></g>');
  // The crosshair is a navigation aid, not an object highlight. Render it
  // before components, wires, and labels so those objects remain readable.
  if (o.cursor && o.cursorCrosshair) {
    const { x, y } = o.cursor;
    const { x: vx, y: vy, w: vw, h: vh } = o.cursorCrosshair;
    parts.push(`<path class="editor-cursor-crosshair" d="M ${fmt(vx)} ${fmt(y)} L ${fmt(vx + vw)} ${fmt(y)} M ${fmt(x)} ${fmt(vy)} L ${fmt(x)} ${fmt(vy + vh)}" fill="none"/>`);
  }
  const drawOrder = (item) => Number.isFinite(item?.drawOrder) ? item.drawOrder : 0;
  const byDrawOrder = (a, b, tie) => drawOrder(a) - drawOrder(b) || tie(a, b);
  const labels = [...circuit.labels.values()];
  const comps = [...circuit.components.values()].sort((a, b) => byDrawOrder(a, b, (x, y) => x.refdes.localeCompare(y.refdes)));

  // Persistent net highlights recolor a highlighted group's wires, its net
  // labels, its junction dots, and the parts that stand for the net itself --
  // ground/supply/VCM markers and interface ports, with their labels -- over
  // their own styles. The same parts glow with a hovered net in the editor.
  const withHighlight = (style, color) => (color ? { ...(style || {}), color } : style);
  const markerHighlights = new Map();
  const solderAt = new Map([...circuit.components.values()]
    .filter((c) => c.type === 'solder')
    .map((c) => [`${c.transform.x},${c.transform.y}`, c.refdes]));
  for (const net of circuit.nets.values()) {
    const color = circuit.netHighlight?.(net);
    if (!color) continue;
    for (const { comp } of net.terminals) {
      const component = circuit.components.get(comp);
      if (isReferenceMarker(component) || INTERFACE_PIN_TYPES.has(component?.type)) markerHighlights.set(comp, color);
    }
    // Solder dots on the net's wires belong to it too: every dot sits on a
    // junction or a branch vertex of the net it joins.
    for (const point of [...(net.junctions || []), ...net.paths().flat()]) {
      const solder = solderAt.get(`${point.x},${point.y}`);
      if (solder) markerHighlights.set(solder, color);
    }
  }
  const compStyle = (c) => withHighlight(c.style, markerHighlights.get(c.refdes));
  const labelHighlight = (label) => (label.netId ? circuit.netHighlight?.(circuit.nets.get(label.netId)) : null)
    || (label.owner ? markerHighlights.get(label.owner) : null) || null;

  // Bottom layer: visual shape annotations and their child labels. Keeping
  // these together prevents annotation text from floating above the other
  // default layers when a box or arrow has a caption.
  const annotationShapes = labels
    .filter((label) => ['arrow', 'box', 'line'].includes(label.kind))
    .sort((a, b) => byDrawOrder(a, b, (x, y) => x.id.localeCompare(y.id)));
  for (const label of annotationShapes) {
    if (label.id === o.editingLabel) continue;
    const opacity = ghostLabels.has(label.id) ? ' opacity="0.34"' : '';
    parts.push(`<g${opacity} data-label-id="${escapeSvg(label.id)}" role="button" tabindex="0" aria-label="${escapeSvg(`${label.kind} annotation ${label.text || label.id}`)}">${shapeAnnotationSvg(label, '')}</g>`);
    if (label.kind !== 'line') {
      const mid = label.textAnchor || { x: (label.anchor.x + label.end.x) / 2, y: (label.anchor.y + label.end.y) / 2 };
      parts.push(`<g${opacity}>${labelTextEl(mid.x, mid.y, label.runs(), 'middle', 'label', resolveColor(label.style?.color || '#111'), label.style?.width)}</g>`);
    }
    for (const child of labels.filter((candidate) => candidate.parent === label.id)) {
      if (child.id === o.editingLabel) continue;
      const childOpacity = ghostLabels.has(child.id) || ghostLabels.has(label.id) ? ' opacity="0.34"' : '';
      const t = child.textPos();
      const childVisual = child.math
        ? mathLabelSvg(child)
        : labelTextEl(t.x, t.y, child.runs(), t.anchor, 'label', resolveColor(child.style?.color || '#111'), child.style?.width, child.style);
      parts.push(`<g${childOpacity} data-label-id="${escapeSvg(child.id)}" role="button" tabindex="0" aria-label="${escapeSvg(`Annotation label ${child.text}`)}">${childVisual}</g>`);
    }
  }

  // Middle layer: wires deliberately sit behind components and labels. Their
  // rounded caps still overlap terminal leads at the exact electrical point.
  const nets = [...circuit.nets.values()].sort((a, b) => byDrawOrder(a, b, (x, y) => x.id.localeCompare(y.id)));
  // Where a wire meets a pin lead (or another wire), two separately drawn
  // strokes overlap and their anti-aliased edges add up into a visibly
  // thicker joint. Solid wires and terminal leads of one stroke style are
  // therefore drawn together as a single path ("ink"), rasterized once.
  // Per-segment wire elements stay in place, unpainted, for hit targets and
  // keyboard access; ghosts and dashed strokes keep their own elements.
  const ink = new Map();
  const addInk = (attrs, d) => {
    if (!ink.has(attrs)) ink.set(attrs, []);
    ink.get(attrs).push(d);
  };
  const inkLeads = (c) => c.type !== 'block' && !ghostRefs.has(c.refdes) && solidStyle(compStyle(c));
  for (const c of comps) {
    if (!inkLeads(c)) continue;
    for (const g of c.def.graphics) {
      if (g.terminalLead) addInk(inkAttrs(compStyle(c)), transformPathD(g.d, c.transform, strokeWidthOf(c.style) / 2));
    }
  }
  const UNPAINTED = ' stroke-opacity="0"';
  for (const net of nets) {
    // Fixed paths are already the complete authored geometry. Keep the legacy
    // managed fallback below so multi-terminal managed nets retain their old
    // rendering behavior.
    const paths = net.routingMode === 'fixed'
      ? net.paths()
      : net.branches
        ? net.branches
        : !net.route && net.terminals.length >= 3
          ? steinerBranches(net.terminalWorlds(), { rects: [], pins: new Map(), wires: [] })
          : [net.points()];
    const opacity = ghostNets.has(net.id) ? ' opacity="0.34"' : '';
    const highlight = circuit.netHighlight?.(net) || null;
    const netStyle = withHighlight(net.style, highlight);
    for (const [branch, pts] of paths.entries()) {
      if (!pts || pts.length < 2) continue;
      const wireKind = net.routingMode === 'fixed' ? 'fixed' : 'managed';
      const wireHelp = net.routingMode === 'fixed'
        ? 'Fixed/direct wire — drag vertices, segments, or junctions'
        : 'Managed wire — drag orthogonal segments';
      const segmentStyles = net.wireStyles && Object.keys(net.wireStyles).some((key) => key.startsWith(`${branch}:`));
      if (!segmentStyles) {
        const d = pts.map((p, i) => (i === 0 ? `M ${pt(p.x, p.y)}` : `L ${pt(p.x, p.y)}`)).join(' ');
        const inked = !opacity && solidStyle(netStyle);
        const geometry = polylineArrowheads(pts, netStyle?.arrowhead, wireArrowheadOptions(circuit, pts));
        if (inked) addInk(inkAttrs(netStyle), polylineD(geometry.shaftPoints));
        parts.push(`<path class="wire-${wireKind}" d="${d}" fill="none"${opacity} data-net-id="${escapeSvg(net.id)}" data-wire-branch="${branch}" data-wire-segment="1" role="button" tabindex="0" aria-label="${escapeSvg(`${wireHelp} on ${net.name || net.id}`)}" ${styleAttrs(netStyle, 'wire')}${inked ? UNPAINTED : ''}><title>${escapeSvg(wireHelp)}</title></path>`);
        parts.push(arrowheadsSvg(geometry.heads, netStyle?.color, opacity));
        continue;
      }
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]; const b = pts[i];
        const d = `M ${pt(a.x, a.y)} L ${pt(b.x, b.y)}`;
        const segmentStyle = withHighlight({ ...(net.style || {}), ...(net.wireStyles[`${branch}:${i}`] || {}) }, highlight);
        const inked = !opacity && solidStyle(segmentStyle);
        const geometry = polylineArrowheads([a, b], segmentStyle.arrowhead, wireArrowheadOptions(circuit, [a, b]));
        // Solid wires are painted by the shared ink path below, but dashed
        // and ghosted wires paint their own element. Use the same shortened
        // shaft for those visible strokes so a dash cannot run underneath an
        // endpoint arrowhead.
        const paintedD = inked ? d : polylineD(geometry.shaftPoints);
        if (inked) addInk(inkAttrs(segmentStyle), polylineD(geometry.shaftPoints));
        parts.push(`<path class="wire-${wireKind}" d="${paintedD}" fill="none"${opacity} data-net-id="${escapeSvg(net.id)}" data-wire-branch="${branch}" data-wire-segment="${i}" role="button" tabindex="0" aria-label="${escapeSvg(`${wireHelp} on ${net.name || net.id}, segment ${i}`)}" ${styleAttrs(segmentStyle, 'wire')}${inked ? UNPAINTED : ''}><title>${escapeSvg(wireHelp)}</title></path>`);
        parts.push(arrowheadsSvg(geometry.heads, segmentStyle.color, opacity));
      }
    }
  }
  for (const [attrs, ds] of ink) {
    parts.push(`<path class="wire-ink" d="${ds.join(' ')}" fill="none" ${attrs} pointer-events="none"/>`);
  }

  // A joined supply bar is drawn as one shape (below), so the slabs it covers
  // are left out: two coincident fills would double their anti-aliased edges.
  const bars = supplyBars(circuit);
  const barred = new Set(bars.flatMap((bar) => bar.refs));
  // Top layer: components and their body/value graphics sit above wires.
  for (const c of comps) {
    const t = c.transform;
    const opacity = ghostRefs.has(c.refdes) ? ' opacity="0.34"' : '';
    const textGraphics = c.def.graphics.filter((g) => g.kind === 'text');
    const bodyGraphics = c.def.graphics.filter((g) => g.kind !== 'text');
    parts.push(`<g transform="${transformToSvg(t)}"${opacity} data-ref="${escapeSvg(c.refdes)}" role="button" tabindex="0" aria-label="${escapeSvg(`Component ${c.refdes}, ${c.type}`)}"><g class="sym" data-ref="${escapeSvg(c.refdes)}">`);
    if (c.type === 'block') {
      const r = c.blockSize;
      parts.push(`<rect x="${fmt(-r.w / 2)}" y="${fmt(-r.h / 2)}" width="${fmt(r.w)}" height="${fmt(r.h)}" fill="#fff" ${styleAttrs(compStyle(c), 'emph')}/>`);
    } else {
      const leadsInked = inkLeads(c);
      for (const g of bodyGraphics) {
        if (leadsInked && g.terminalLead) continue;
        if (barred.has(c.refdes) && g.fill === 'foreground') continue;
        parts.push(graphicsToSvg(g, '', compStyle(c)));
      }
    }
    parts.push('</g></g>');
    for (const g of textGraphics) parts.push(symbolTextSvg(g, t, compStyle(c)?.color || '#111'));
    if (o.includeBBox) {
      const r = c.bboxWorld();
      parts.push(`<rect x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}" fill="none" stroke="#0a8" stroke-dasharray="4 4" stroke-width="1"/>`);
    }
  }

  // Joined supply bars: one continuous bar over each run of aligned same-rail
  // supplies, in the slab's own ink, so the row reads as one bar. It covers
  // the slabs themselves too, so no seam shows where they meet. Visual only.
  for (const bar of bars) {
    const from = circuit.components.get(bar.refs[0]);
    const ghost = bar.refs.some((ref) => ghostRefs.has(ref)) ? ' opacity="0.34"' : '';
    const r = bar.rect;
    parts.push(`<rect class="supply-bar-join" x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}" fill="${escapeSvg(resolveColor(compStyle(from)?.color || '#111'))}" stroke="none" pointer-events="none"${ghost}/>`);
  }

  // Junction dots are placed by the routing algorithm as actual `solder`
  // components (Circuit#syncJunctionSolders); the renderer draws no lookalike
  // circle at net junctions.

  // Junction dots at multi-terminal net connection points (above the wires).
  if (o.junctions) {
    for (const net of circuit.nets.values()) {
      if (net.terminals.length < 3) continue;
      for (const { comp, term } of net.terminals) {
        const c = circuit.components.get(comp);
        if (!c) continue;
        const p = c.terminalWorld(term);
        parts.push(`<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="3.5" fill="#292929"/>`);
      }
    }
  }

  // Terminal dots.
  if (o.terminals) {
    for (const c of comps) {
      for (const { x, y } of c.worldTerminals()) {
        parts.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="3" fill="#111"/>`);
      }
    }
  }

  // Top layer: components, instance labels, free labels, and net labels draw
  // above the middle wires. Component drawOrder only changes stacking within
  // this layer, so a pushed-back component remains above every wire.
  // Labels (drawn upright, never mirrored). Symbols with a dedicated instance
  for (const c of comps) {
    const def = c.def;
    const opacity = ghostRefs.has(c.refdes) ? ' opacity="0.34"' : '';
    if (def.refPrefix && def.refPos && !def.labelOffset) {
      const p = applyTransform(c.transform, def.refPos.x, def.refPos.y);
      // Uniform component-id font (bold+italic, INSTANCE_FONT) across all symbols,
      // matching the dedicated instance labels used by transistors (e.g. nmos).
      parts.push(
        `<text x="${fmt(p.x)}" y="${fmt(p.y)}" text-anchor="${def.refPos.anchor || 'middle'}" font-family="sans-serif" ${fontAttrs('instance')} stroke="none"${opacity}>${escapeSvg(c.refdes)}</text>`,
      );
    }
    const hasOwnedMarkerLabel = isReferenceMarker(c) && labels.some((label) => label.owner === c.refdes);
    if (def.textPos && c.value !== undefined && c.value !== '' && !hasOwnedMarkerLabel) {
      const p = applyTransform(c.transform, def.textPos.x, def.textPos.y);
      const valueText = def.textPos.font
        ? symbolTextSvg({ ...def.textPos, text: c.value }, c.transform, c.style?.color || '#333')
        : textEl(p.x, p.y, c.value, def.textPos.anchor, 12, '#333');
      parts.push(`<g${opacity}>${valueText}</g>`);
    }
    if (isReferenceMarker(c) && !def.textPos && c.value !== undefined && c.value !== '' && !hasOwnedMarkerLabel) {
      const marker = referenceMarkerInfo(c.type);
      const p = applyTransform(c.transform, marker.labelOffset.x, marker.labelOffset.y);
      parts.push(`<g${opacity}>${textEl(p.x, p.y, c.value, 'middle', 12, '#333')}</g>`);
    }
  }

  // Dedicated / instance label objects (instance identifiers are bold+italic and
  // larger than free-standing annotation labels). Text is aligned inside the
  // label's rendered box (left/center/right) and vertically centered.
  const barHidden = hiddenSupplyBarLabels(circuit);
  for (const label of labels
    .filter((candidate) => !['box', 'arrow', 'line'].includes(candidate.kind) && !candidate.parent && !barHidden.has(candidate.id))
    .sort((a, b) => byDrawOrder(a, b, (x, y) => x.id.localeCompare(y.id)))) {
    if (label.id === o.editingLabel) continue;
    const opacity = ghostLabels.has(label.id) || (label.owner && ghostRefs.has(label.owner)) ? ' opacity="0.34"' : '';
    const t = label.textPos();
    const roleName = label.owner ? `Instance label ${label.text}` : label.netId ? `Net label ${label.text}` : `Annotation ${label.text}`;
    const labelVisual = label.math
      ? mathLabelSvg(label)
      : labelTextEl(t.x, t.y, label.runs(), t.anchor, label.owner ? 'instance' : 'label', resolveColor(labelHighlight(label) || label.style?.color || '#111'), label.style?.width, label.style);
    if (label.selectable === false) {
      parts.push(`<g${opacity} pointer-events="none">${labelVisual}</g>`);
    } else {
      parts.push(`<g${opacity} data-label-id="${escapeSvg(label.id)}" role="button" tabindex="0" aria-label="${escapeSvg(roleName)}">${labelVisual}</g>`);
    }
  }

  parts.push('</svg>');
  return o.themeInk ? themeInkSvg(parts.join('\n')) : parts.join('\n');
}

/**
 * Editor-only overlays rendered on top of svgString output.
 * opts.cursor {x,y}: grid cursor (small gray circle). opts.selection [refdes]:
 * halos around each selected component's bbox. opts.nets [net]: highlight
 * (select) net routes. opts.netMarkers [refdes]: reference markers and ports on
 * those nets, glowing like their wires. opts.netSolder [{x,y}]: solder halos
 * on those nets. opts.rubber {x0,y0,x1,y1,color}: marquee/zoom box.
 * opts.centerGuides {x,y,w,h}: sky-blue dashed centerlines for the combined
 * selection bounds, with small edge ticks and a center marker.
 * opts.wireMode: show all component terminals, colored by net membership.
 * opts.terminalSnapTarget {x,y}: Alt-held terminal snap target, emphasized
 * with an accent halo and ring.
 * opts.wirePreview {from:{x,y},to:{x,y}}: dashed routed preview line.
 */
// Editor overlay colors are semantic and theme-aware (style.css tokens):
// SELECT (accent blue) = selection, focus, and previews of pending edits;
// WARN (amber) = needs attention, e.g. an unconnected pin while wiring;
// DANGER (red) = errors such as cross-net overlaps and focused check issues.
// Sky-blue center guides are measurement aids and deliberately separate from
// the accent blue used for selection and pending edits.
const SELECT = 'var(--accent, #2563eb)';
const WARN = 'var(--warn, #b45309)';
const DANGER = 'var(--danger, #c53030)';
const NEUTRAL = 'var(--svg-faint, #7a7d85)';

export function editorOverlay(circuit, opts = {}) {
  const parts = [];
  if (opts.cursor && opts.cursorCrosshair) {
    const { x, y } = opts.cursor;
    const { x: vx, y: vy, w, h } = opts.cursorCrosshair;
    parts.push(`<path class="editor-cursor-crosshair" d="M ${fmt(vx)} ${fmt(y)} L ${fmt(vx + w)} ${fmt(y)} M ${fmt(x)} ${fmt(vy)} L ${fmt(x)} ${fmt(vy + h)}" fill="none"/>`);
  }
  const dangerHalo = (r) =>
    `<rect x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}" fill="${DANGER}" fill-opacity="0.1" stroke="${DANGER}" stroke-width="2" vector-effect="non-scaling-stroke" rx="3"/>`;

  // A selected part glows along its own linework (styled by the editor as a
  // wide translucent accent stroke) inside a light, unfilled outline, so the
  // symbol itself stays legible instead of sitting under a tinted box.
  for (const ref of opts.selection || []) {
    const c = circuit.components.get(ref);
    if (!c) continue;
    const r = c.bboxWorld();
    const pad = 6;
    parts.push(`<g class="selection-glow" pointer-events="none">${componentShapeSvg(c)}</g>`);
    parts.push(`<rect class="selection-outline" x="${fmt(r.x - pad)}" y="${fmt(r.y - pad)}" width="${fmt(r.w + pad * 2)}" height="${fmt(r.h + pad * 2)}" fill="none" stroke="${SELECT}" stroke-width="1.5" stroke-opacity="0.6" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" rx="6" pointer-events="none"/>`);
  }

  for (const r of opts.layoutPreviewRects || []) {
    parts.push(`<rect class="layout-preview" x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}" fill="var(--accent)" fill-opacity="0.06" stroke="var(--accent)" stroke-width="2" stroke-dasharray="7 5" vector-effect="non-scaling-stroke" pointer-events="none"/>`);
  }

  // Equation to schematic highlight: the devices one hovered or locked
  // sub-expression of a derived equation was built from. Their own geometry is
  // retraced and restyled by CSS, the way commit feedback traces a committed
  // shape. Interaction only — the overlay never reaches an export.
  for (const ref of opts.emphasis || []) {
    const c = circuit.components.get(ref);
    if (c) parts.push(`<g class="equation-emphasis">${componentShapeSvg(c)}</g>`);
  }

  // Resizable schematic blocks and box annotations share one eight-handle
  // affordance: the handles resize, the rest of the outline moves. Handles
  // live in the interaction overlay, so they never become selectable circuit
  // geometry or affect bounds/routing. They are appended last so no later
  // overlay (a selection outline, a net glow) can cover and steal a press.
  const handleParts = [];
  // Handles keep a constant on-screen size (`handleScale` is world units per
  // screen pixel): a 14 px mark inside a 28 px grab area.
  const unit = Number.isFinite(opts.handleScale) && opts.handleScale > 0 ? opts.handleScale : 1;
  const resizeHandles = (kind, id, name, r) => {
    const handles = [
      ['nw', r.x, r.y], ['n', r.x + r.w / 2, r.y], ['ne', r.x + r.w, r.y],
      ['e', r.x + r.w, r.y + r.h / 2], ['se', r.x + r.w, r.y + r.h],
      ['s', r.x + r.w / 2, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, r.y + r.h / 2],
    ];
    const square = (x, y, px) => `x="${fmt(x - px * unit / 2)}" y="${fmt(y - px * unit / 2)}" width="${fmt(px * unit)}" height="${fmt(px * unit)}"`;
    return `<g class="resize-handles" data-resize-kind="${kind}" data-resize-id="${escapeSvg(id)}">${handles.map(([handle, x, y]) => `<g data-resize-handle="${handle}" role="button" tabindex="0" aria-label="Resize ${escapeSvg(name)} ${handle}"><rect ${square(x, y, 28)} fill="transparent"/><rect ${square(x, y, 14)} rx="${fmt(2 * unit)}" fill="var(--accent, #4f9cf9)" stroke="var(--paper, #fff)" stroke-width="2" vector-effect="non-scaling-stroke"/></g>`).join('')}</g>`;
  };
  for (const ref of opts.resizeBlocks || []) {
    const c = circuit.components.get(ref);
    if (c?.type === 'block') handleParts.push(resizeHandles('component', c.refdes, c.refdes, c.bboxWorld()));
  }
  for (const id of opts.resizeBoxes || []) {
    const label = circuit.labels.get(id);
    if (label?.kind === 'box') handleParts.push(resizeHandles('annotation', label.id, 'box', label.bbox()));
  }

  // Selection centerlines are deliberately sky blue and dashed so they read
  // as measurement guides rather than cursor crosshairs or circuit geometry.
  // Keep each guide outside the selected bounds: one grid cell of guide at
  // each edge is enough to expose the center without crossing the artwork.
  if (opts.centerGuides) {
    const r = opts.centerGuides;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const pad = GRID;
    const tick = 10;
    const color = '#0ea5e9';
    parts.push(`<g class="selection-center-guides" pointer-events="none" opacity="0.9">` +
      `<path d="M ${fmt(cx)} ${fmt(r.y - pad)} L ${fmt(cx)} ${fmt(r.y)} M ${fmt(cx)} ${fmt(r.y + r.h)} L ${fmt(cx)} ${fmt(r.y + r.h + pad)} M ${fmt(r.x - pad)} ${fmt(cy)} L ${fmt(r.x)} ${fmt(cy)} M ${fmt(r.x + r.w)} ${fmt(cy)} L ${fmt(r.x + r.w + pad)} ${fmt(cy)}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="9 6"/>` +
      `<path d="M ${fmt(r.x)} ${fmt(cy - tick)} L ${fmt(r.x)} ${fmt(cy + tick)} M ${fmt(r.x + r.w)} ${fmt(cy - tick)} L ${fmt(r.x + r.w)} ${fmt(cy + tick)} M ${fmt(cx - tick)} ${fmt(r.y)} L ${fmt(cx + tick)} ${fmt(r.y)} M ${fmt(cx - tick)} ${fmt(r.y + r.h)} L ${fmt(cx + tick)} ${fmt(r.y + r.h)}" fill="none" stroke="${color}" stroke-width="3"/>` +
      `<rect x="${fmt(cx - 4)}" y="${fmt(cy - 4)}" width="8" height="8" fill="#fff" stroke="${color}" stroke-width="2" transform="rotate(45 ${fmt(cx)} ${fmt(cy)})"/>` +
      `</g>`);
  }

  // Placement guides: the spacing and alignment relationships the object being
  // placed or moved already stands in. Sky blue, like the selection
  // centerlines, because both are measurement aids rather than circuit or
  // selection state. Every measurement is drawn between the two anchors it
  // measures, with a leader from each anchor to the dimension line, so what
  // is being compared is never in doubt; two equal intervals carry the same
  // number side by side. Only the blue anchor/alignment family is rendered.
  // A guide's `weight` fades a suggestion that is still far from its target,
  // so the relationship about to be reached is the one that reads.
  if (opts.placementGuide?.guides?.length) {
    const { moving, guides } = opts.placementGuide;
    const ANCHOR_INK = '#0ea5e9';
    const FAR_ALIGN = 16 * GRID;
    const tick = 9;
    const dot = (p, solid, ink) => `<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="4.5" fill="${p.moving && !p.synthetic && solid ? ink : 'var(--paper, #fff)'}" stroke="${ink}" stroke-width="2"/>`;
    parts.push(`<g class="placement-guides" pointer-events="none" fill="none" stroke-width="2" vector-effect="non-scaling-stroke">`);
    for (const guide of guides) {
      const weight = guide.weight ?? 1;
      if (weight < 1) parts.push(`<g class="placement-guide-faded" opacity="${weight}">`);
      const close = () => { if (weight < 1) parts.push('</g>'); };
      const color = ANCHOR_INK;
      const axis = guide.axis;
      const along = axis === 'x' ? 'y' : 'x';
      const pt = (p, a) => (a === 'x' ? p.x : p.y);
      // One shared dash rhythm for every "not yet real" stroke (a suggestion,
      // an alignment reference, a target crossing) keeps the state signal to a
      // single visual cue instead of several competing rhythms.
      const SUGGESTION_DASH = '7 5';
      if (guide.kind === 'align') {
        const stops = guide.points.map((p) => pt(p, along)).sort((a, b) => a - b);
        const line = (a, b) => axis === 'y'
          ? `M ${fmt(a)} ${fmt(guide.value)} H ${fmt(b)}`
          : `M ${fmt(guide.value)} ${fmt(a)} V ${fmt(b)}`;
        // A far alignment keeps its full line, but only the stretch beside each
        // anchor is at strength; the long middle crosses unrelated parts and
        // stays a hairline.
        const near = [];
        const far = [];
        for (let i = 0; i + 1 < stops.length; i += 1) {
          const [a, b] = [stops[i], stops[i + 1]];
          if (b - a > FAR_ALIGN) {
            near.push(line(a, a + 2 * GRID), line(b - 2 * GRID, b));
            far.push(line(a + 2 * GRID, b - 2 * GRID));
          } else near.push(line(a, b));
        }
        near.push(line(stops[0] - GRID / 2, stops[0]), line(stops.at(-1), stops.at(-1) + GRID / 2));
        parts.push(`<path d="${near.join(' ')}" stroke="${color}" stroke-dasharray="${SUGGESTION_DASH}" stroke-opacity="0.85"/>`);
        if (far.length) parts.push(`<path class="placement-align-far" d="${far.join(' ')}" stroke="${color}" stroke-dasharray="${SUGGESTION_DASH}" stroke-opacity="0.3" stroke-width="1.25"/>`);
        parts.push(guide.points.map((p) => dot(p, true, color)).join(''));
        close();
        continue;
      }
      // One dimension line clear of every anchor and of the moving symbol. A
      // guide still being offered is drawn dashed, and its own point stands on
      // the target rather than on the object, so the two intervals stay the
      // ones being labelled. Direct one-peer distances use the opposite lane
      // from target/even-spacing rulers, keeping both useful readings legible.
      // Everything that only connects an anchor back to that line (leaders,
      // the halfway reference) stays a quiet solid hairline, so dashing reads
      // as one thing: not landed yet.
      const pending = !guide.exact;
      const dash = pending ? ` stroke-dasharray="${SUGGESTION_DASH}"` : '';
      const bboxEdge = axis === 'x' ? moving.bbox.y : moving.bbox.x;
      const bboxFarEdge = axis === 'x' ? moving.bbox.y + moving.bbox.h : moving.bbox.x + moving.bbox.w;
      const pointEdges = guide.points.map((p) => pt(p, along));
      const base = guide.direct
        ? Math.max(bboxFarEdge, ...pointEdges) + GRID
        : Math.min(bboxEdge, ...pointEdges) - GRID;
      if (pending) {
        // Where to land: the target column or row, across the moving symbol.
        const lo = Math.min(bboxEdge, ...guide.points.map((p) => pt(p, along)));
        const hi = Math.max(axis === 'x' ? moving.bbox.y + moving.bbox.h : moving.bbox.x + moving.bbox.w,
          ...guide.points.map((p) => pt(p, along)));
        parts.push(`<path d="${axis === 'x'
          ? `M ${fmt(guide.target)} ${fmt(lo - GRID / 2)} V ${fmt(hi + GRID / 2)}`
          : `M ${fmt(lo - GRID / 2)} ${fmt(guide.target)} H ${fmt(hi + GRID / 2)}`}" stroke="${color}" stroke-dasharray="${SUGGESTION_DASH}" stroke-opacity="0.55"/>`);
      }
      const leader = (p) => (axis === 'x'
        ? `M ${fmt(p.x)} ${fmt(p.y)} V ${fmt(base)}`
        : `M ${fmt(p.x)} ${fmt(p.y)} H ${fmt(base)}`);
      parts.push(`<path d="${guide.points.map(leader).join(' ')}" stroke="${color}" stroke-opacity="0.3" stroke-width="1.25"/>`);
      const span = (a, b) => (axis === 'x'
        ? `M ${fmt(a.x)} ${fmt(base)} H ${fmt(b.x)} M ${fmt(a.x)} ${fmt(base - tick)} V ${fmt(base + tick)} M ${fmt(b.x)} ${fmt(base - tick)} V ${fmt(base + tick)}`
        : `M ${fmt(base)} ${fmt(a.y)} V ${fmt(b.y)} M ${fmt(base - tick)} ${fmt(a.y)} H ${fmt(base + tick)} M ${fmt(base - tick)} ${fmt(b.y)} H ${fmt(base + tick)}`);
      const label = (a, b) => (axis === 'x'
        ? `<text x="${fmt((a.x + b.x) / 2)}" y="${fmt(base - GRID / 3)}" fill="${color}" stroke="none" text-anchor="middle" font-size="24" font-family="system-ui, sans-serif">${guide.cells} cells</text>`
        : `<text x="${fmt(base - GRID / 3)}" y="${fmt((a.y + b.y) / 2 + 8)}" fill="${color}" stroke="none" text-anchor="end" font-size="24" font-family="system-ui, sans-serif">${guide.cells} cells</text>`);
      for (let i = 0; i + 1 < guide.points.length; i += 1) {
        const a = guide.points[i];
        const b = guide.points[i + 1];
        parts.push(`<path d="${span(a, b)}" stroke="${color}"${dash}/>`);
        parts.push(label(a, b));
      }
      if (guide.halfway) {
        const { from, at, cells } = guide.halfway;
        const halfBase = base + tick + 8;
        const reference = axis === 'x'
          ? `M ${fmt(at.x)} ${fmt(at.y)} V ${fmt(base)} M ${fmt(from.x)} ${fmt(halfBase)} H ${fmt(at.x)}`
          : `M ${fmt(at.x)} ${fmt(at.y)} H ${fmt(base)} M ${fmt(halfBase)} ${fmt(from.y)} V ${fmt(at.y)}`;
        const text = axis === 'x'
          ? `<text x="${fmt((from.x + at.x) / 2)}" y="${fmt(halfBase + 20)}" fill="${color}" stroke="none" text-anchor="middle" font-size="20" font-family="system-ui, sans-serif">${cells} cells</text>`
          : `<text x="${fmt(halfBase + 20)}" y="${fmt((from.y + at.y) / 2 + 7)}" fill="${color}" stroke="none" text-anchor="start" font-size="20" font-family="system-ui, sans-serif">${cells} cells</text>`;
        parts.push(`<g class="placement-halfway-reference" stroke="${color}" stroke-opacity="0.4" stroke-width="1.25"><path d="${reference}"/></g>${text}`);
      }
      parts.push(guide.points.map((p) => dot(p, guide.exact, color)).join(''));
      close();
    }
    parts.push('</g>');
  }

  // A marquee/visual selection is only a preview until its gesture commits.
  // Keep it visually distinct and never touch the editor's real selection.
  if (opts.previewSelection) {
    for (const ref of opts.previewSelection.refs || []) {
      const c = circuit.components.get(ref);
      if (c) {
        const r = c.bboxWorld();
        parts.push(`<rect x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}" fill="none" stroke="${SELECT}" stroke-width="2" stroke-dasharray="5 3" rx="3" opacity="0.9"/>`);
      }
    }
    for (const id of opts.previewSelection.labels || []) {
      const label = circuit.labels.get(id);
      if (!label) continue;
      const r = label.bbox();
      parts.push(`<rect x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}" fill="none" stroke="${SELECT}" stroke-width="2" stroke-dasharray="5 3" rx="2" opacity="0.9"/>`);
    }
    for (const id of opts.previewSelection.nets || []) {
      const net = circuit.nets.get(id);
      if (!net) continue;
      for (const pts of net.paths()) {
        if (!pts || pts.length < 2) continue;
        const d = pts.map((p, i) => (i === 0 ? `M ${pt(p.x, p.y)}` : `L ${pt(p.x, p.y)}`)).join(' ');
        parts.push(`<path d="${d}" fill="none" stroke="${SELECT}" stroke-width="7" opacity="0.32" stroke-dasharray="8 5" stroke-linecap="round"/>`);
      }
    }
    for (const { a, b } of opts.previewWireSegments || []) {
      parts.push(`<path d="M ${pt(a.x, a.y)} L ${pt(b.x, b.y)}" fill="none" stroke="${SELECT}" stroke-width="8" opacity="0.55" stroke-dasharray="8 5" stroke-linecap="round"/>`);
    }
  }

  // Solder dots on a highlighted net get a halo so wire junctions stand out.
  if (opts.netSolder && opts.netSolder.length) {
    for (const p of opts.netSolder) {
      parts.push(`<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="13" fill="none" stroke="${SELECT}" stroke-width="2" opacity="0.7"/>`);
      parts.push(`<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="3.5" fill="${SELECT}"/>`);
    }
  }

  // Arrow and line vertices are drag points: solid when the annotation is
  // selected, hollow while the pointer rests on an unselected one.
  const vertexHandles = (label, solid) => label.points.map((p) => `<circle class="annotation-vertex-handle" cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="${fmt(5 * unit)}" fill="${solid ? SELECT : 'var(--paper, #fff)'}" stroke="${solid ? 'var(--paper, #fff)' : SELECT}" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`).join('');
  const hoverAnnotation = opts.hoverAnnotation && !(opts.selLabels || []).includes(opts.hoverAnnotation)
    ? circuit.labels.get(opts.hoverAnnotation) : null;
  if (hoverAnnotation?.points) parts.push(vertexHandles(hoverAnnotation, false));

  if (opts.selLabels && opts.selLabels.length) {
    for (const id of opts.selLabels) {
      const label = circuit.labels.get(id);
      if (!label) continue;
      const b = label.bbox();
      const a = label.anchorWorld();
      parts.push(`<rect x="${fmt(b.x)}" y="${fmt(b.y)}" width="${fmt(b.w)}" height="${fmt(b.h)}" fill="none" stroke="${SELECT}" stroke-width="2" rx="2"/>`);
      if (label.points) parts.push(vertexHandles(label, true));
      else if (label.kind !== 'box') parts.push(`<circle cx="${fmt(a.x)}" cy="${fmt(a.y)}" r="3.5" fill="${SELECT}"/>`);
    }
  } else if (opts.selLabel) {
    const label = circuit.labels.get(opts.selLabel);
    if (label) {
      const b = label.bbox();
      const a = label.anchorWorld();
      parts.push(`<rect x="${fmt(b.x)}" y="${fmt(b.y)}" width="${fmt(b.w)}" height="${fmt(b.h)}" fill="none" stroke="${SELECT}" stroke-width="2" rx="2"/>`);
      parts.push(`<circle cx="${fmt(a.x)}" cy="${fmt(a.y)}" r="3.5" fill="${SELECT}"/>`);
    }
  }

  // Reference markers and ports on a highlighted net glow along their own
  // linework, in the net highlight's color.
  for (const ref of new Set(opts.netMarkers || [])) {
    const c = circuit.components.get(ref);
    if (c) parts.push(`<g class="selection-glow net-marker-glow" pointer-events="none">${componentShapeSvg(c)}</g>`);
  }

  for (const net of opts.nets || []) {
    const paths = net && typeof net.paths === 'function' ? net.paths() : [net];
    for (const pts of paths) {
      if (!pts || pts.length < 2) continue;
      const d = pts.map((p, i) => (i === 0 ? `M ${pt(p.x, p.y)}` : `L ${pt(p.x, p.y)}`)).join(' ');
      parts.push(`<path d="${d}" fill="none" stroke="${SELECT}" stroke-width="12" opacity="0.35" stroke-linecap="round" stroke-linejoin="round"/>`);
      parts.push(`<path d="${d}" fill="none" stroke="${SELECT}" stroke-width="2.4"/>`);
    }
  }

  // Design-check focus: the objects behind the selected issue, in the error color.
  if (opts.diagnostic) {
    for (const ref of opts.diagnostic.components || []) {
      const c = circuit.components.get(ref);
      if (c) parts.push(dangerHalo(c.bboxWorld()));
    }
    for (const id of opts.diagnostic.labels || []) {
      const label = circuit.labels.get(id);
      if (label) parts.push(dangerHalo(label.bbox()));
    }
    for (const id of opts.diagnostic.nets || []) {
      const net = circuit.nets.get(id);
      for (const pts of net?.paths?.() || []) {
        if (!pts || pts.length < 2) continue;
        const d = pts.map((p, i) => (i === 0 ? `M ${pt(p.x, p.y)}` : `L ${pt(p.x, p.y)}`)).join(' ');
        parts.push(`<path d="${d}" fill="none" stroke="${DANGER}" stroke-width="12" opacity="0.3" stroke-linecap="round" stroke-linejoin="round"/>`);
        parts.push(`<path d="${d}" fill="none" stroke="${DANGER}" stroke-width="2.4"/>`);
      }
    }
  }

  // Cross-net collinear overlaps (a wire dragged on top of another net's wire).
  if (opts.warnOverlaps && opts.warnOverlaps.length) {
    for (const o of opts.warnOverlaps) {
      parts.push(`<line x1="${fmt(o.x0)}" y1="${fmt(o.y0)}" x2="${fmt(o.x1)}" y2="${fmt(o.y1)}" stroke="${DANGER}" stroke-width="9" opacity="0.55" stroke-linecap="round"/>`);
    }
  }

  if (opts.wireSegments && opts.wireSegments.length) {
    for (const { a, b } of opts.wireSegments) {
      parts.push(`<path d="M ${pt(a.x, a.y)} L ${pt(b.x, b.y)}" fill="none" stroke="${SELECT}" stroke-width="9" opacity="0.6" stroke-linecap="round"/>`);
    }
  }

  if (opts.fixedDrag) {
    const { x, y, junction } = opts.fixedDrag;
    parts.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${junction ? 14 : 10}" fill="none" stroke="${SELECT}" stroke-width="2.5" stroke-dasharray="4 3"/>`);
  }

  if (opts.wireMode) {
    const src = opts.wireSource;
    const snapTarget = opts.terminalSnapTarget;
    const terminalRadius = 8;
    const sourceRadius = 8.5;
    if (snapTarget && Number.isFinite(snapTarget.x) && Number.isFinite(snapTarget.y)) {
      parts.push(`<circle class="wire-snap-target" cx="${fmt(snapTarget.x)}" cy="${fmt(snapTarget.y)}" r="15" fill="${SELECT}" fill-opacity="0.16"/>`);
      parts.push(`<circle class="wire-snap-target" cx="${fmt(snapTarget.x)}" cy="${fmt(snapTarget.y)}" r="12" fill="none" stroke="${SELECT}" stroke-width="3" stroke-dasharray="5 3"/>`);
    }
    for (const comp of circuit.components.values()) {
      for (const terminal of comp.worldTerminals()) {
        const connected = circuit.netOfTerminal({ comp: comp.refdes, term: terminal.name });
        const isSource = src && src.refdes === comp.refdes && src.term === terminal.name;
        // Connected pins are quiet; open pins still need a wire (attention).
        const color = connected ? NEUTRAL : WARN;
        if (isSource) {
          parts.push(`<circle cx="${fmt(terminal.x)}" cy="${fmt(terminal.y)}" r="12.5" fill="${SELECT}" opacity="0.18"/>`);
          parts.push(`<circle cx="${fmt(terminal.x)}" cy="${fmt(terminal.y)}" r="${sourceRadius}" fill="${SELECT}" stroke="var(--paper, #fff)" stroke-width="2"/>`);
        } else {
          parts.push(`<circle cx="${fmt(terminal.x)}" cy="${fmt(terminal.y)}" r="${terminalRadius}" fill="var(--paper, #fff)" stroke="${color}" stroke-width="2.5"/>`);
        }
      }
    }
  }

  if (opts.rubber) {
    const r = opts.rubber;
    const x = Math.min(r.x0, r.x1);
    const y = Math.min(r.y0, r.y1);
    const w = Math.abs(r.x1 - r.x0);
    const h = Math.abs(r.y1 - r.y0);
    const color = r.color === 'neutral' ? NEUTRAL : SELECT;
    parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${color}" opacity="0.12" stroke="${color}" stroke-width="1.4" stroke-dasharray="5 4"/>`);
  }

  // The draft wire follows the cursor until it is committed.
  for (const preview of [opts.wirePreview].filter(Boolean)) {
    const from = preview.from;
    const pts = preview.pts || autoRoute([{ x: from.x, y: from.y }, { x: preview.to.x, y: preview.to.y }]);
    if (pts && pts.length >= 2) {
      const d = pts.map((p, i) => (i === 0 ? `M ${pt(p.x, p.y)}` : `L ${pt(p.x, p.y)}`)).join(' ');
      // Drawn as the wire it will become: full wire weight in the accent,
      // translucent until the commit flash settles it into ink.
      parts.push(`<path class="wire-draft" d="${d}" fill="none" stroke="${SELECT}" stroke-width="6" stroke-opacity="0.55" stroke-linecap="square" stroke-linejoin="miter"/>`);
    }
    parts.push(`<circle cx="${fmt(from.x)}" cy="${fmt(from.y)}" r="5.5" fill="${SELECT}"/>`);
  }
  if (opts.annotationPreview) {
    const { kind, a, b, points } = opts.annotationPreview;
    const attrs = `stroke="${SELECT}" stroke-width="6" stroke-dasharray="10 7" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
    if (kind === 'line') {
      const d = points.map((point, i) => `${i ? 'L' : 'M'} ${pt(point.x, point.y)}`).join(' ');
      parts.push(`<path d="${d}" ${attrs}/>`);
    } else if (kind === 'box') {
      const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y);
      parts.push(`<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(Math.abs(b.x - a.x))}" height="${fmt(Math.abs(b.y - a.y))}" ${attrs}/>`);
    } else {
      const route = points?.length ? points : [a, b];
      const geometry = polylineArrowheads(route, 'end');
      parts.push(`<path d="${polylineD(geometry.shaftPoints)}" ${attrs}/>${arrowheadsSvg(geometry.heads, SELECT, ' opacity=".8"')}`);
    }
  }

  if (opts.directWirePreview) {
    const { from, pts } = opts.directWirePreview;
    if (from && pts && pts.length >= 2) {
      const d = pts.map((p, i) => (i === 0 ? `M ${pt(p.x, p.y)}` : `L ${pt(p.x, p.y)}`)).join(' ');
      parts.push(`<path class="direct-wire-preview" d="${d}" fill="none" stroke="${SELECT}" stroke-width="4" stroke-dasharray="10 6" stroke-linecap="round"/>`);
      for (const p of pts.slice(1, -1)) parts.push(`<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="5" fill="var(--paper, #fff)" stroke="${SELECT}" stroke-width="2"/>`);
    }
  }

  if (opts.cursor) {
    const { x, y } = opts.cursor;
    const color = opts.directWirePreview || opts.wireMode ? SELECT : '#7a7d85';
    const radius = opts.wireMode ? 8 : 4;
    parts.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${radius}" fill="none" stroke="${color}" stroke-width="${opts.wireMode ? 2 : 1.5}"/>`);
    if (opts.wireMode && !opts.wirePreview && !opts.directWirePreview) {
      parts.push(`<path d="M ${fmt(x - 14)} ${fmt(y)} L ${fmt(x + 14)} ${fmt(y)} M ${fmt(x)} ${fmt(y - 14)} L ${fmt(x)} ${fmt(y + 14)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 2"/>`);
    }
  }

  // Symmetric placement: the axis a mirrored pair is being placed about. A
  // construction line, drawn in the measurement sky blue and never geometry.
  if (opts.symmetryAxis?.operation && opts.ghost?.def) {
    const { operation, pin } = opts.symmetryAxis;
    const g = opts.ghost;
    // Long enough to read as an axis through whatever is being mirrored.
    const b = transformRect({ x: g.x, y: g.y, rotation: g.rotation, mirrorX: g.mirrorX, mirrorY: g.mirrorY }, g.def.bbox);
    const reach = operation === 'mirrorX'
      ? Math.max(Math.abs(b.y - pin.y), Math.abs(b.y + b.h - pin.y)) + GRID
      : Math.max(Math.abs(b.x - pin.x), Math.abs(b.x + b.w - pin.x)) + GRID;
    const d = operation === 'mirrorX'
      ? `M ${fmt(pin.x)} ${fmt(pin.y - reach)} V ${fmt(pin.y + reach)}`
      : `M ${fmt(pin.x - reach)} ${fmt(pin.y)} H ${fmt(pin.x + reach)}`;
    parts.push(`<g class="symmetry-axis" pointer-events="none" fill="none" stroke="#0ea5e9" stroke-width="2" vector-effect="non-scaling-stroke">` +
      `<path d="${d}" stroke-dasharray="14 5 3 5"/>` +
      `<circle cx="${fmt(pin.x)}" cy="${fmt(pin.y)}" r="4.5" fill="var(--paper, #fff)" stroke="#0ea5e9" stroke-width="2"/>` +
      `</g>`);
    // How far apart the pair is being pulled. Two equal intervals either side
    // of the axis, dimensioned like a spacing guide, because the number that
    // decides a differential pair's pitch is the one the gesture is setting.
    // It sits on the far side of the symbol from the placement guides, which
    // measure off the top/left edge, so the two readouts never collide.
    const from = opts.symmetryAxis.from;
    const axis = operation === 'mirrorX' ? 'x' : 'y';
    const offset = from ? Math.abs(from[axis] - pin[axis]) : 0;
    if (offset > 1e-6) {
      const twin = { x: from.x, y: from.y, [axis]: 2 * pin[axis] - from[axis] };
      const cells = Math.round((offset / GRID) * 100) / 100;
      const text = `${cells} ${cells === 1 ? 'cell' : 'cells'}`;
      const tick = 9;
      const base = axis === 'x'
        ? Math.max(b.y + b.h, pin.y, from.y) + GRID
        : Math.max(b.x + b.w, pin.x, from.x) + GRID;
      const leader = (p) => (axis === 'x'
        ? `M ${fmt(p.x)} ${fmt(p.y)} V ${fmt(base)}`
        : `M ${fmt(p.x)} ${fmt(p.y)} H ${fmt(base)}`);
      const span = (a, c) => (axis === 'x'
        ? `M ${fmt(a.x)} ${fmt(base)} H ${fmt(c.x)} M ${fmt(a.x)} ${fmt(base - tick)} V ${fmt(base + tick)} M ${fmt(c.x)} ${fmt(base - tick)} V ${fmt(base + tick)}`
        : `M ${fmt(base)} ${fmt(a.y)} V ${fmt(c.y)} M ${fmt(base - tick)} ${fmt(a.y)} H ${fmt(base + tick)} M ${fmt(base - tick)} ${fmt(c.y)} H ${fmt(base + tick)}`);
      const label = (a, c) => (axis === 'x'
        ? `<text x="${fmt((a.x + c.x) / 2)}" y="${fmt(base + GRID * 0.8)}" fill="#0ea5e9" stroke="none" text-anchor="middle" font-size="24" font-family="system-ui, sans-serif">${text}</text>`
        : `<text x="${fmt(base + GRID / 3)}" y="${fmt((a.y + c.y) / 2 + 8)}" fill="#0ea5e9" stroke="none" text-anchor="start" font-size="24" font-family="system-ui, sans-serif">${text}</text>`);
      const at = (p) => ({ x: axis === 'x' ? p.x : base, y: axis === 'x' ? base : p.y });
      parts.push(`<g class="symmetry-offset" pointer-events="none" fill="none" stroke="#0ea5e9" stroke-width="2" vector-effect="non-scaling-stroke">` +
        `<path d="${[twin, pin, from].map(leader).join(' ')}" stroke-opacity="0.4" stroke-dasharray="4 4"/>` +
        `<path d="${span(twin, pin)}"/><path d="${span(pin, from)}"/>` +
        label(twin, pin) + label(pin, from) +
        [twin, from].map((p) => `<circle cx="${fmt(at(p).x)}" cy="${fmt(at(p).y)}" r="4.5" fill="#0ea5e9" stroke="#0ea5e9" stroke-width="2"/>`).join('') +
        `</g>`);
    }
  }

  // Placement ghost: a faded preview of the component (or label) that will be
  // placed at the snapped cursor once the user clicks or presses Enter. A
  // symmetric placement previews its mirrored twin the same way.
  for (const g of [opts.ghost, opts.ghostTwin].filter(Boolean)) {
    if (g.label) {
      // Use the same label model and renderer as the committed annotation so
      // markup, alignment, and the grid-sized footprint are previewed honestly.
      const preview = new LabelInstance(circuit, {
        text: g.text || 'label', x: g.x, y: g.y, align: g.align || 'center',
      });
      const b = preview.bbox();
      const t = preview.textPos();
      parts.push(`<g class="label-placement-ghost" opacity="0.58">`);
      parts.push(`<rect x="${fmt(b.x)}" y="${fmt(b.y)}" width="${fmt(b.w)}" height="${fmt(b.h)}" fill="none" stroke="#9aa0ab" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      parts.push(labelTextEl(t.x, t.y, preview.runs(), t.anchor, 'label'));
      parts.push('</g>');
    } else if (g.def) {
      const t = transformToSvg({ x: g.x, y: g.y, rotation: g.rotation, mirrorX: g.mirrorX, mirrorY: g.mirrorY });
      const body = g.def.graphics.filter((gg) => gg.kind !== 'text').map((gg) => graphicsToSvg(gg)).join('');
      const text = g.def.graphics.filter((gg) => gg.kind === 'text').map((gg) => symbolTextSvg(gg, { x: g.x, y: g.y, rotation: g.rotation, mirrorX: g.mirrorX, mirrorY: g.mirrorY })).join('');
      parts.push(`<g transform="${t}" opacity="0.45">${body}</g>${text}`);
    }
  }

  parts.push(...handleParts);
  return parts.join('\n');
}
