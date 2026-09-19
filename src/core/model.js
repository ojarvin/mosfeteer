import { applyTransform, applyDir, inverseTransform, rectFromPoints, rectUnion, transformRect } from './geometry.js';
import { snap, snapPoint, GRID } from './grid.js';
import { getSymbol } from './components/index.js';
import { balancedCrossCoupling, steinerBranches, bodyClearanceSafe, gateBodyCrossingAllowed, segThroughInterior, smartRoute } from './router.js';
import { collapseCollinear } from './wireedit.js';
import { cloneFixedPath, clonePath, hasPositiveBranchOverlap, joinBranchEnds, junctionPoints, normalizePath, pathLength, pathSegments, pointOnPath, reduceBranches, samePolylineSet, splitBranchAt, splitByComponent, validateWiring, wireSegments } from './wiring.js';

/** Canonical physical net-name form. Names are case-sensitive; only outer
 * whitespace is non-semantic. Empty names mean that a net is unnamed. */
export function canonicalNetName(name) {
  return String(name ?? '').trim();
}

/** Shared reference markers.  Unnamed markers are global AC references;
 * entering a marker value (or child label) makes that instance local. */
export const REFERENCE_MARKER_TYPES = Object.freeze(['ground', 'supply', 'vcm']);
const REFERENCE_MARKER_INFO = Object.freeze({
  ground: Object.freeze({ terminal: 'gnd', globalName: 'VSS', labelOffset: { x: 0, y: 120 } }),
  supply: Object.freeze({ terminal: 'p', globalName: 'VDD', labelOffset: { x: 0, y: -120 } }),
  vcm: Object.freeze({ terminal: 'vcm', globalName: 'VCM', labelOffset: { x: 0, y: 120 } }),
});

// Keep `GND` as a compatibility alias; new unnamed ground markers use `VSS`.
const REFERENCE_MARKER_LEGACY_GLOBAL_NAMES = Object.freeze({ ground: Object.freeze(['GND']) });

// Active-low sequential symbols used the `n` suffix before the terminal names
// were standardized on `B`. Keep old documents loadable while the registered
// component types and their new instances use the consistent spelling.
const LEGACY_COMPONENT_TYPE_RENAMES = Object.freeze({
  and_gate: 'and2_gate',
  nand_gate: 'nand2_gate',
  or_gate: 'or2_gate',
  nor_gate: 'nor2_gate',
  xor_gate: 'xor2_gate',
  xnor_gate: 'xnor2_gate',
  dff_clkn: 'dff_clkb',
  dff_clkn_qb: 'dff_clkb_qb',
  dff_rstn: 'dff_rstb',
  dff_rstn_qb: 'dff_rstb_qb',
  dff_clkn_rstn: 'dff_clkb_rstb',
  dff_clkn_rstn_qb: 'dff_clkb_rstb_qb',
});

function serializedComponentType(type) {
  return LEGACY_COMPONENT_TYPE_RENAMES[type] || type;
}

function serializedTerminalName(type, term) {
  if (!['dff_clkb', 'dff_clkb_qb', 'dff_clkb_rstb', 'dff_clkb_rstb_qb'].includes(type)
      && !['dff_rstb', 'dff_rstb_qb'].includes(type)) return term;
  if (term === 'CLKN') return 'CLKB';
  if (term === 'RSTN') return 'RSTB';
  return term;
}

export function referenceMarkerInfo(type) {
  return REFERENCE_MARKER_INFO[type] || null;
}

export function referenceMarkerGlobalNames(typeOrInfo) {
  const info = typeof typeOrInfo === 'string' ? referenceMarkerInfo(typeOrInfo) : typeOrInfo;
  if (!info) return [];
  const type = Object.entries(REFERENCE_MARKER_INFO).find(([, value]) => value === info)?.[0];
  return [info.globalName, ...(REFERENCE_MARKER_LEGACY_GLOBAL_NAMES[type] || [])];
}

export function isReferenceMarkerGlobalName(typeOrInfo, name) {
  return referenceMarkerGlobalNames(typeOrInfo).includes(canonicalNetName(name));
}

export function isReferenceMarker(component) {
  return !!component && REFERENCE_MARKER_TYPES.includes(component.type);
}

export function referenceMarkerName(component) {
  if (!isReferenceMarker(component)) return '';
  const label = component.circuit?.labelOf?.(component.refdes);
  return canonicalNetName(label?._text || '');
}

/** Whether a marker's owned label is an intentional local-rail label. Labels
 * synthesized only to preserve legacy net renames opt out of this flag until
 * the user edits/commits the marker label explicitly. */
export function referenceMarkerIsLocal(component) {
  if (!isReferenceMarker(component)) return false;
  const label = component.circuit?.labelOf?.(component.refdes);
  return !!label && label.referenceLocal !== false;
}

// Component moves are automatic edits: unlike an explicit authored waypoint
// path, every candidate produced while re-anchoring or translating a moved net
// must satisfy the router's one-cell body-clearance policy. Endpoint re-anchors
// intentionally use the move-specific pin-rectangle exception.
function automaticMovePathSafe(path, env) {
  if (!path || path.length < 2) return true;
  const moveOptions = { pinRects: env.pinRects || new Map() };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    for (const rect of env.rects || []) {
      if (gateBodyCrossingAllowed(a, b, rect, env)) continue;
      if (segThroughInterior(a, b, rect) ||
          !bodyClearanceSafe(a, b, i, path, rect, env, moveOptions)) return false;
    }
  }
  return true;
}


/** Nominal world units of text width per character (font-size 12 sans-serif).
 *  Raised for the bold+italic label font (INSTANCE_FONT / LABEL_FONT are both
 *  bold italic) — bold/italic glyphs are measurably wider than the regular
 *  face. */
export const LABEL_CHAR_W = 8;

/** Font-size (world units) used for every label; both label kinds render at this
 *  (style.js INSTANCE_FONT / LABEL_FONT size). */
export const LABEL_FONT_SIZE = 38;

// Per-glyph width model for a label line (no DOM in the core model, so we use
// narrow / default / wide buckets scaled to the label font size) to give a
// "tight" text bounding box.
const _UNIT = LABEL_FONT_SIZE * (LABEL_CHAR_W / 12); // ~23.33 per default char
const _NARROW = new Set(`i l I t f r j 1 2 3 . , : ; ' " ! | ( ) [ ] - / * ~ ^ \` _ space-empty`);
const _WIDE = new Set(`m w M W @ # $ % & 0 6 8 9`);

const _NARROW_SET = new Set(_NARROW);
const _WIDE_SET = new Set(_WIDE);
function charWidth(c) {
  if (c === ' ') return _UNIT * 0.5;
  if (_NARROW_SET.has(c)) return _UNIT * 0.5;
  if (_WIDE_SET.has(c) || (c >= 'A' && c <= 'Z')) return _UNIT * 1.1;
  return _UNIT;
}

/**
 * Parse label text into rich-text runs. `_{...}` and `^{...}` mark subscript /
 * superscript runs (e.g. "C_{GS}", "V^{DD}"). The optional
 * `autoSubscript` option is retained for compatibility with old callers, but
 * is intentionally ignored: component labels now persist explicit `_{...}`
 * markup, so plain `M1` stays plain text and only `M_{1}` renders with a
 * subscript. Returns [{text, sub, super}].
 */
export function parseLabelRuns(text, opts = {}) {
  const str = String(text);
  const runs = [];
  let normal = '';
  let i = 0;
  const flush = () => {
    if (!normal) return;
    runs.push({ text: normal });
    normal = '';
  };
  while (i < str.length) {
    const c = str[i];
    if ((c === '_' || c === '^') && str[i + 1] === '{') {
      const end = str.indexOf('}', i + 2);
      if (end !== -1) {
        flush();
        const run = { text: str.slice(i + 2, end) };
        if (c === '_') run.sub = true;
        else run.super = true;
        runs.push(run);
        i = end + 1;
        continue;
      }
    }
    normal += c;
    i++;
  }
  flush();
  if (runs.length === 0) runs.push({ text: str });
  return runs;
}

/** Split rich-text runs into visual lines without losing sub/superscript
 * metadata. Newlines remain part of the persisted label text. */
export function labelRunLines(text, opts = {}) {
  const lines = [[]];
  for (const run of parseLabelRuns(text, opts)) {
    const parts = String(run.text).split('\n');
    parts.forEach((part, index) => {
      if (part) lines.at(-1).push({ ...run, text: part });
      if (index < parts.length - 1) lines.push([]);
    });
  }
  return lines;
}

/** Tight height (world units) of a rendered label line (cap height). */
export const LABEL_CAP_H = Math.round(LABEL_FONT_SIZE * 0.7);

/** Gap between left/right aligned text and its box edge: a quarter grid cell. */
export const LABEL_ALIGN_INSET = GRID / 4;

/**
 * Toggle subscript ('_') or superscript ('^') markup on the selected range of a
 * raw label string (used by the inline label editor's Ctrl+, / Ctrl+. ).
 * Returns {text, selStart, selEnd} or null when there is no selection.
 *  - A selection fully inside one `_{...}`/`^{...}` group unwraps that group
 *    (pressing the hotkey again reverts the subscript).
 *  - A selection that overlaps any markup unwraps every group it touches
 *    (mixed sub/super + plain text reverts to plain).
 *  - Otherwise (plain text) the selection is wrapped in the markup.
 */
export function applyMarkup(text, s, e, mark) {
  if (s === e || s > e) return null;
  const groups = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === mark && text[i + 1] === '{') {
      const j = text.indexOf('}', i + 2);
      if (j !== -1 && j > i + 2) {
        groups.push({ open: i, contentStart: i + 2, contentEnd: j, close: j });
        i = j;
      }
    }
  }
  const inside = groups.find((g) => g.contentStart <= s && e <= g.contentEnd);
  if (inside) {
    // Selecting the subscripted text: undo the markup (remove that group's braces).
    const len = inside.contentEnd - inside.contentStart;
    return {
      text: text.slice(0, inside.open) + text.slice(inside.contentStart, inside.contentEnd) + text.slice(inside.close + 1),
      selStart: inside.open,
      selEnd: inside.open + len,
    };
  }
  const overlapping = groups.filter((g) => g.open < e && g.close >= s);
  if (overlapping.length) {
    // Mixed selection: revert every touched group to plain text.
    let t = text;
    for (const g of [...overlapping].sort((a, b) => b.open - a.open)) {
      t = t.slice(0, g.open) + t.slice(g.contentStart, g.contentEnd) + t.slice(g.close + 1);
    }
    return { text: t, selStart: Math.min(s, t.length), selEnd: Math.min(e, t.length) };
  }
  // Plain text: wrap the selection.
  const open = mark + '{';
  return {
    text: text.slice(0, s) + open + text.slice(s, e) + '}' + text.slice(e),
    selStart: s + open.length,
    selEnd: e + open.length,
  };
}

/** Return the independently selectable segments whose two endpoints are in a
 * contained box.  Segment indices use the same convention as Net.wireSegments
 * (segment 1 joins points 0 and 1).  Kept in the model so marquee and clipboard
 * code cannot accidentally disagree about containment. */
export function containedWireSegments(paths = [], box) {
  if (!box) return [];
  const inside = (p) => p && p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
  const out = [];
  for (let branch = 0; branch < paths.length; branch++) {
    const path = paths[branch] || [];
    for (let segment = 1; segment < path.length; segment++) {
      if ((path[segment - 1].x === path[segment].x && path[segment - 1].y === path[segment].y)) continue;
      if (inside(path[segment - 1]) && inside(path[segment])) out.push({ branch, segment });
    }
  }
  return out;
}

/** Extract contiguous selected runs as standalone polylines.  Endpoints are
 * deliberately unanchored: callers may paste these as floating wire islands.
 * `selected` accepts {branch,segment} records or `branch:segment` strings. */
export function extractWireIslands(paths = [], selected = []) {
  const wanted = new Set(selected.map((s) => typeof s === 'string' ? s : `${s.branch}:${s.segment}`));
  const out = [];
  for (let branch = 0; branch < paths.length; branch++) {
    const path = paths[branch] || [];
    let start = null;
    for (let segment = 1; segment <= path.length; segment++) {
      const hit = segment < path.length && wanted.has(`${branch}:${segment}`);
      if (hit && start === null) start = segment;
      if ((!hit || segment === path.length) && start !== null) {
        const end = hit && segment === path.length ? segment : segment - 1;
        if (end >= start) out.push(path.slice(start - 1, end + 1).map((p) => ({ x: p.x, y: p.y })));
        start = null;
      }
    }
  }
  return out;
}

/** Extract selected runs while retaining explicitly declared common junctions.
 * Each returned island is suitable for one terminal-less net.  Runs only join
 * when they meet at a supplied junction; ordinary disconnected runs remain
 * independent islands even if their bboxes happen to touch. */
export function extractWireFragments(paths = [], selected = [], junctions = []) {
  const wanted = new Set(selected.map((s) => typeof s === 'string' ? s : `${s.branch}:${s.segment}`));
  const junctionKeys = new Set((junctions || []).map((p) => `${p.x},${p.y}`));
  const runs = [];
  for (let branch = 0; branch < paths.length; branch++) {
    const path = paths[branch] || [];
    let start = null;
    for (let segment = 1; segment <= path.length; segment++) {
      const hit = segment < path.length && wanted.has(`${branch}:${segment}`) &&
        (path[segment - 1].x !== path[segment].x || path[segment - 1].y !== path[segment].y);
      if (hit && start === null) start = segment;
      if ((!hit || segment === path.length) && start !== null) {
        const end = hit && segment === path.length ? segment : segment - 1;
        const raw = path.slice(start - 1, end + 1).map((p) => ({ x: p.x, y: p.y }));
        const cuts = (junctions || []).filter((j) => pointOnPath(j, raw) &&
          !(j.x === raw[0].x && j.y === raw[0].y) && !(j.x === raw.at(-1).x && j.y === raw.at(-1).y));
        const ordered = [];
        for (let i = 0; i < raw.length - 1; i++) {
          const a = raw[i]; const b = raw[i + 1];
          ordered.push(a);
          const middle = cuts.filter((j) => pointOnPath(j, [a, b]) &&
            !(j.x === a.x && j.y === a.y) && !(j.x === b.x && j.y === b.y));
          middle.sort((u, v) => Math.abs(u.x - a.x) + Math.abs(u.y - a.y) - Math.abs(v.x - a.x) - Math.abs(v.y - a.y));
          for (const cut of middle) if (!ordered.some((p) => p.x === cut.x && p.y === cut.y)) ordered.push({ x: cut.x, y: cut.y });
        }
        ordered.push(raw.at(-1));
        const pieces = [];
        let piece = [ordered[0]];
        for (let i = 1; i < ordered.length; i++) {
          piece.push(ordered[i]);
          if (junctionKeys.has(`${ordered[i].x},${ordered[i].y}`) && i < ordered.length - 1) {
            if (piece.length > 1) pieces.push(piece); piece = [ordered[i]];
          }
        }
        if (piece.length > 1) pieces.push(piece);
        for (const run of pieces) runs.push({ path: run, junctions: run.filter((p) => junctionKeys.has(`${p.x},${p.y}`)) });
        start = null;
      }
    }
  }
  const groups = runs.map((run) => [run]);
  const joins = (a, b) => a.path.some((p) => junctionKeys.has(`${p.x},${p.y}`) &&
    b.path.some((q) => q.x === p.x && q.y === p.y));
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (!groups[i] || !groups[j] || !groups[i].some((a) => groups[j].some((b) => joins(a, b)))) continue;
      groups[i].push(...groups[j]); groups[j] = null;
    }
  }
  return groups.filter(Boolean).map((group) => ({
    paths: group.map((run) => run.path),
    junctions: [...new Map(group.flatMap((run) => run.junctions).map((p) => [`${p.x},${p.y}`, p])).values()],
  }));
}

/** Apply a world-space quarter-turn or axis reflection to points. */
export function transformWorldPoints(points = [], center, operation = 'rotate') {
  const c = center || { x: 0, y: 0 };
  const map = (p) => {
    let x = p.x - c.x;
    let y = p.y - c.y;
    if (operation === 'rotate' || operation === 'rotateCCW' || operation === 'rotate180' || operation === 'rotate270') {
      const turns = operation === 'rotateCCW' || operation === 'rotate270' ? 3 : operation === 'rotate180' ? 2 : 1;
      for (let i = 0; i < turns; i++) [x, y] = [-y, x];
    } else if (operation === 'mirrorX') x = -x;
    else if (operation === 'mirrorY') y = -y;
    return { x: snap(x + c.x), y: snap(y + c.y) };
  };
  return points.map(map);
}

/** Compose a component's local transform with a world-space D4 operation.
 * Brute-force matching keeps mirror ordering identical to geometry.js and is
 * easier to audit than a collection of reflection parity cases. */
export function transformComponentWorld(transform, center, operation = 'rotate') {
  const origin = transformWorldPoints([{ x: transform.x, y: transform.y }], center, operation)[0];
  const basis = (x, y) => applyTransform(transform, x, y);
  // Do not use transformWorldPoints for the unit basis: its grid snap is
  // correct for wire points but would collapse a one-unit orientation probe.
  const worldOp = (p) => {
    let x = p.x - center.x; let y = p.y - center.y;
    if (operation === 'rotate' || operation === 'rotateCCW' || operation === 'rotate180' || operation === 'rotate270') {
      const turns = operation === 'rotateCCW' || operation === 'rotate270' ? 3 : operation === 'rotate180' ? 2 : 1;
      for (let i = 0; i < turns; i++) [x, y] = [-y, x];
    }
    else if (operation === 'mirrorX') x = -x;
    else if (operation === 'mirrorY') y = -y;
    return { x: x + center.x, y: y + center.y };
  };
  const p0 = worldOp({ x: transform.x, y: transform.y });
  const p1 = worldOp(basis(1, 0));
  const p2 = worldOp(basis(0, 1));
  let best = null;
  let bestScore = Infinity;
  for (const rotation of [0, 90, 180, 270]) for (const mirrorX of [false, true]) for (const mirrorY of [false, true]) {
    const t = { x: origin.x, y: origin.y, rotation, mirrorX, mirrorY };
    const q0 = applyTransform(t, 0, 0);
    const q1 = applyTransform(t, 1, 0);
    const q2 = applyTransform(t, 0, 1);
    const score = (q1.x - q0.x - (p1.x - p0.x)) ** 2 + (q1.y - q0.y - (p1.y - p0.y)) ** 2 +
      (q2.x - q0.x - (p2.x - p0.x)) ** 2 + (q2.y - q0.y - (p2.y - p0.y)) ** 2;
    if (score < bestScore) {
      best = t;
      bestScore = score;
      if (score === 0) break;
    }
  }
  return best || { ...transform, x: origin.x, y: origin.y };
}

let _uid = 0;
function uid() {
  return `x${(_uid++).toString(36)}${Date.now().toString(36).slice(-4)}`;
}

/** Parse a terminal reference string like "R1.a" -> {comp, term}. */
export function parseTermRef(s) {
  const idx = s.lastIndexOf('.');
  if (idx <= 0 || idx === s.length - 1) throw new Error(`invalid terminal ref "${s}" (expected "REFDES.TERM")`);
  return { comp: s.slice(0, idx), term: s.slice(idx + 1) };
}

/** Strip the common inline/display math delimiters from an equation label.
 * The delimiters are retained in the editable source so users can see and
 * continue editing ordinary TeX, but never become visible glyphs. */
export function stripMathDelimiters(value) {
  let source = String(value ?? '').trim();
  if (source.length >= 4 && source.startsWith('$$') && source.endsWith('$$')) return source.slice(2, -2).trim();
  if (source.length >= 2 && source.startsWith('$') && source.endsWith('$')) return source.slice(1, -1).trim();
  return source;
}

/** A compact source approximation used for grid-snapped math label bounds.
 * TeX command names should not make an equation's box wider than the glyphs
 * they produce in MathML. This is deliberately a metric helper, not a TeX
 * evaluator; rendering remains the authoritative MathML representation. */
export function mathTextForMetrics(value) {
  let source = stripMathDelimiters(value);
  const symbols = {
    parallel: '||', vert: '|', Vert: '||', cdot: '·', times: '×', pm: '±', mp: '∓',
    infty: '∞', approx: '≈', le: '≤', ge: '≥', neq: '≠', to: '→', gg: '≫',
    // A LaTeX quad is approximately one em. The metric uses half-width
    // spaces, so two spaces reserve the right amount of label width.
    quad: '  ', qquad: '    ',
  };
  let previous;
  do {
    previous = source;
    source = source
      .replace(/\\frac\{((?:[^{}]|\{[^{}]*\})*)\}\{((?:[^{}]|\{[^{}]*\})*)\}/g, '($1/$2)')
      .replace(/\\sqrt\{((?:[^{}]|\{[^{}]*\})*)\}/g, '√($1)')
      .replace(/\\(?:mathrm|text|operatorname)\{([^{}]*)\}/g, '$1');
  } while (source !== previous);
  source = source
    .replace(/\\(?:left|right|middle)\s*/g, '')
    .replace(/\\[,;!]\s*/g, '')
    .replace(/\\([|])/g, '$1')
    .replace(/\\([A-Za-z]+)/g, (_, name) => symbols[name] || name);
  return source;
}

/** Keep parallel-resistance bars unambiguous in persisted math-label source.
 * A bare `||` is convenient to type, but TeX parses it as two independent
 * delimiters (and browsers may add operator spacing).  Store the escaped
 * spelling so editing, JSON, and SVG export all agree on `\|\|`. */
export function normalizeMathSource(value) {
  return String(value ?? '')
    .replace(/\\parallel/g, '\\|\\|')
    .replace(/(^|[^\\])\|\|/g, '$1\\|\\|');
}

/**
 * Component identifiers remain compact and unambiguous in connectivity refs
 * (`M1.g`), but the editor also accepts textbook-style numeric subscripts in
 * rename fields (`M_{1}`). Keep the identifier canonical while letting the
 * label renderer provide the subscript typography.
 */
/** Interface pins: an owned name label that also names the pin's net. */
export const INTERFACE_PIN_TYPES = new Set(['input', 'output', 'inputoutput', 'port']);

/** Symbols that carry a MOS small-signal model, and so device capacitances. */
export const MOS_ANALYSIS_TYPES = new Set(['nmos', 'pmos', 'nmosb', 'pmosb']);

export function normalizeComponentRefdes(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  // Component identity is stored without TeX punctuation. Flattening the
  // explicit script runs means `M_{2}` and `M2` address the same connectivity
  // id, while still allowing a label such as `R_{D}` to be used as the
  // presentation source for the canonical id `RD`.
  const runs = parseLabelRuns(raw);
  // Superscript is presentation-only and must not silently become part of a
  // component identity. Explicit subscript markup is the supported textbook
  // spelling for names.
  if (runs.some((run) => run.super)) return raw;
  return runs.map((run) => run.text).join('');
}

/** Return the persisted display source for a component name. Numeric default
 * names use textbook subscript notation (`M_{1}`), while an explicitly
 * formatted source such as `R_{D}` is preserved when it denotes the same
 * canonical component id. */
export function componentLabelText(refdes, source = null) {
  const canonical = normalizeComponentRefdes(refdes);
  const supplied = source === null || source === undefined ? '' : String(source).trim();
  if (supplied && normalizeComponentRefdes(supplied) === canonical && /[_^]\{/.test(supplied)) return supplied;
  // Interface voltage ports use a two-part textbook name: the voltage
  // marker stays on the baseline while the direction/index is subscripted
  // (VI1 -> V_{I1}, VO2 -> V_{O2}, VIO3 -> V_{IO3}).
  const voltagePort = canonical.match(/^V(IO|I|O)(\d+)$/);
  if (voltagePort) return `V_{${voltagePort[1]}${voltagePort[2]}}`;
  const numeric = canonical.match(/^([A-Za-z]+)(\d+)$/);
  return numeric ? `${numeric[1]}_{${numeric[2]}}` : canonical;
}

/** Compare a label's source text with a raw component refdes.  This treats
 * `M1` and `M_{1}` as the same instance label, but does not mistake a
 * superscript or a custom marker label for the refdes. */
function labelMatchesRefdes(text, refdes) {
  return normalizeComponentRefdes(text) === normalizeComponentRefdes(refdes);
}

/**
 * A free-floating or component-owned text label. The label's ANCHOR is always
 * a grid point. The rendered box is derived from the tight text bounds, then
 * expanded so BOTH dimensions are even multiples of a grid square (2, 4, 6
 * ... cells). Free and owned labels are centered on the anchor; net labels use
 * the anchor as their electrical attachment point and place one box edge on it.
 * Changing text resizes the box while retaining that attachment relationship.
 * Owned labels ("instance labels", e.g. M1 on a transistor) live in local
 * component space via `offset` and follow the owner's transform.
 */
export class LabelInstance {
  constructor(circuit, opts = {}) {
    this.circuit = circuit;
    this.id = opts.id || uid();
    this.kind = ['label', 'arrow', 'box', 'line'].includes(opts.kind) ? opts.kind : 'label';
    this.netId = opts.netId !== undefined && opts.netId !== null && opts.netId !== '' ? String(opts.netId) : null;
    this.connectorId = opts.connectorId !== undefined && opts.connectorId !== null && opts.connectorId !== '' ? String(opts.connectorId) : null;
    this.connectorT = Number.isFinite(opts.connectorT) ? opts.connectorT : null;
    this.parent = opts.parent || null;
    this.roleError = null;
    if (this.netId && opts.owner) this.roleError = 'label cannot have both netId and owner';
    if (this.kind !== 'label' && (this.netId || opts.owner || this.parent || this.connectorId)) throw new Error('annotations cannot have owners, nets, or connectors');
    if (this.parent && (this.netId || opts.owner || this.connectorId)) throw new Error('child labels cannot have owners, nets, or connectors');
    if (this.connectorId && this.netId) throw new Error('label cannot have both connectorId and netId');
    this.math = !!opts.math;
    // Browser-rendered text metrics are runtime-only. The deterministic
    // character-width estimate remains the fallback for headless/CLI use,
    // while the web renderer can replace it with actual SVG/MathML bounds.
    this._renderedTextBounds = null;
    // Persist the grid-sized math footprint, rather than browser glyph
    // metrics, so loading does not temporarily move aligned text while the
    // live renderer prepares its fresh measurement.
    const mathBox = opts.mathBox;
    this._mathBox = this.math && mathBox
      && [mathBox.w, mathBox.h].every((size) => Number.isFinite(size) && size >= 2 * GRID && size % (2 * GRID) === 0)
      ? { w: mathBox.w, h: mathBox.h } : null;
    this._text = opts.text !== undefined
      ? (this.math ? normalizeMathSource(opts.text) : String(opts.text))
      : 'label';
    this.align = ['center', 'left', 'right'].includes(opts.align) ? opts.align : 'center';
    this.style = {
      color: opts.style?.color || '#111',
      lineStyle: opts.style?.lineStyle || 'solid',
      width: opts.style?.width || 'normal',
      bold: opts.style?.bold !== false,
      italic: opts.style?.italic !== false,
    };
    this.drawOrder = Number.isFinite(opts.drawOrder) ? opts.drawOrder : 0;
    this.owner = this.netId ? null : (opts.owner || null);
    const ownerComponent = this.owner ? circuit.components.get(this.owner) : null;
    this.referenceLocal = isReferenceMarker(ownerComponent)
      ? opts.referenceLocal !== false
      : null;
    this.offset = this.owner && opts.offset ? { x: snap(opts.offset.x), y: snap(opts.offset.y) } : null;
    const rawPoints = ['arrow', 'line'].includes(this.kind) && Array.isArray(opts.points) ? opts.points : null;
    const points = rawPoints?.map((point) => snapPoint(point?.x || 0, point?.y || 0)) || [];
    const p = points[0] || snapPoint(opts.x || 0, opts.y || 0);
    this.anchor = { x: p.x, y: p.y };
    const e = points.at(-1) || (opts.end ? snapPoint(opts.end.x, opts.end.y) : p);
    this.end = { x: e.x, y: e.y };
    this.points = ['arrow', 'line'].includes(this.kind) ? (points.length ? points : [{ ...p }, { ...e }]) : null;
    const textPoint = opts.textAnchor ? snapPoint(opts.textAnchor.x, opts.textAnchor.y) : { x: snap((p.x + e.x) / 2), y: snap((p.y + e.y) / 2) };
    this.textAnchor = { x: textPoint.x, y: textPoint.y };
    const net = this.netId ? circuit.nets.get(this.netId) : null;
    this.netSide = this.netId && ['above', 'below', 'left', 'right'].includes(opts.netSide)
      ? opts.netSide
      : net ? circuit._defaultNetLabelSide(net, this.anchor) : this.netId ? 'above' : null;
  }

  get text() {
    if (this.netId) return this.circuit.nets.get(this.netId)?.name || '';
    return this._text;
  }

  set text(value) {
    if (this.netId && this.circuit?.nets.has(this.netId)) {
      const net = this.circuit.renameNet(this.netId, value);
      this.circuit._markReferenceLabelsLocal?.(net);
    }
    else {
      const next = this.math ? normalizeMathSource(value) : String(value);
      if (this.owner && !this.math && this.circuit._syncComponentLabel(this.owner, next)) return;
      if (this.owner && this.circuit._syncReferenceMarkerLabel(this.owner, next)) return;
      this._text = next;
      this.circuit.invalidateRoutingCache();
    }
  }

  isOwned() {
    return !!this.owner;
  }

  isNetLabel() {
    return !!this.netId;
  }

  displayText() {
    return this.text;
  }

  setNetId(netId) {
    this.circuit.invalidateRoutingCache();
    this.netId = netId === null || netId === undefined || netId === '' ? null : String(netId);
    if (this.netId) {
      this.owner = null;
      this.offset = null;
      const net = this.circuit.nets.get(this.netId);
      if (!this.netSide && net) this.netSide = this.circuit._defaultNetLabelSide(net, this.anchor);
    } else {
      this.netSide = null;
    }
    return this;
  }
  anchorWorld() {
    if (this.parent && this.circuit.labels.has(this.parent)) {
      return { x: this.anchor.x, y: this.anchor.y };
    }
    if (this.owner) {
      const c = this.circuit.components.get(this.owner);
      if (c) return applyTransform(c.transform, this.offset?.x || 0, this.offset?.y || 0);
    }
    return { x: this.anchor.x, y: this.anchor.y };
  }

  /** Tight width (world units) of the rendered text line. Sub/superscript runs
   *  render smaller (0.62 em) so they contribute less width to the box. */
  textWidth() {
    if (this._renderedTextBounds?.w > 0) return this._renderedTextBounds.w;
    const source = this.math ? mathTextForMetrics(this.text) : this.text;
    return Math.max(...labelRunLines(source).map((line) => line.reduce((width, r) => {
      const scale = r.sub || r.super ? 0.62 : 1;
      return width + [...r.text].reduce((sum, ch) => sum + charWidth(ch) * scale, 0);
    }, 0)), 0);
  }

  /** Rich-text runs of this label's explicit source text. */
  runs() {
    return parseLabelRuns(this.text);
  }

  /** Tight height (world units) of the rendered text line. */
  textHeight() {
    if (this._renderedTextBounds?.h > 0) return this._renderedTextBounds.h;
    if (this.math) {
      const source = stripMathDelimiters(this.text);
      // MathML scripts and fractions need more ascent/descent than ordinary
      // label tspans. The renderer adds a small internal inset as well.
      // A simple fraction needs a four-cell content box before the outer
      // two-cell math margin. Nodal-analysis equations can contain several
      // nested fractions; reserve additional rows based on the fraction count
      // so the foreignObject never clips a denominator. Math labels may also
      // contain explicit newlines (used by the compact assumptions annotation).
      const lineHeight = (line) => {
        const fractions = (line.match(/\\frac/g) || []).length;
        if (fractions >= 9) return LABEL_CAP_H * 9.2;
        if (fractions >= 4) return LABEL_CAP_H * 6.2;
        if (fractions > 0) return LABEL_CAP_H * 3.2;
        if (/\\(?:sqrt|sum|int)|[_^]/.test(line)) return LABEL_CAP_H * 2.2;
        return LABEL_CAP_H * 1.7;
      };
      return source.split(/\r?\n/).reduce((height, line) => height + lineHeight(line), 0);
    }
    return Math.max(1, this.text.split('\n').length) * LABEL_CAP_H;
  }

  /** Even number of grid cells >= 2 needed to hold the text horizontally. */
  colWidth() {
    if (this.math && !this._renderedTextBounds && this._mathBox) return this._mathBox.w / GRID;
    // Screen-to-world transforms may return 320.00001 for a 320-unit box.
    // Avoid adding two whole cells for sub-pixel measurement noise.
    const tolerance = this._renderedTextBounds ? 0.001 : 0;
    let n = Math.ceil((this.textWidth() - tolerance) / GRID);
    // MathML font metrics are not available in the model layer.  Reserve one
    // grid cell on each side of math labels so wide glyphs, stretchy
    // delimiters, and browser-specific font shaping do not hit the box edge.
    if (this.math && !this._renderedTextBounds) n += 2;
    // Round outward to the nearest even number of grid cells. This keeps the
    // anchor centered while allowing measured browser glyphs to define the
    // tight content size instead of relying on a font heuristic.
    return Math.max(2, Math.ceil(n / 2) * 2);
  }

  /** Even number of grid cells >= 2 needed to hold the text vertically. */
  rowHeight() {
    if (this.math && !this._renderedTextBounds && this._mathBox) return this._mathBox.h / GRID;
    const tolerance = this._renderedTextBounds ? 0.001 : 0;
    let n = Math.ceil((this.textHeight() - tolerance) / GRID);
    if (this.math && !this._renderedTextBounds) n += 2;
    return Math.max(2, Math.ceil(n / 2) * 2);
  }

  /** Install a tight browser-measured text rectangle in world units. */
  setRenderedTextBounds(width, height) {
    const w = Number(width);
    const h = Number(height);
    if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return false;
    const previous = this._renderedTextBounds;
    if (previous && Math.abs(previous.w - w) < 0.01 && Math.abs(previous.h - h) < 0.01) return false;
    this._renderedTextBounds = { w, h };
    this.circuit.invalidateRoutingCache();
    return true;
  }

  /** Drop only the runtime browser measurement and keep the persisted math
   * footprint. A label that must measure again (the math font has just
   * arrived, say) still reports the saved box until it does, so the position
   * it was aligned to stays the reference. */
  clearMeasuredTextBounds() {
    if (!this._renderedTextBounds) return false;
    this._renderedTextBounds = null;
    this.circuit.invalidateRoutingCache();
    return true;
  }

  clearRenderedTextBounds() {
    if (!this._renderedTextBounds && !this._mathBox) return false;
    this._renderedTextBounds = null;
    this._mathBox = null;
    this.circuit.invalidateRoutingCache();
    return true;
  }

  bbox() {
    if (this.kind === 'arrow') {
      const points = this.points?.length ? this.points : [this.anchor, this.end];
      const x = Math.min(...points.map((point) => point.x));
      const y = Math.min(...points.map((point) => point.y));
      const x1 = Math.max(...points.map((point) => point.x));
      const y1 = Math.max(...points.map((point) => point.y));
      return { x, y, w: Math.max(GRID, x1 - x), h: Math.max(GRID, y1 - y) };
    }
    if (this.kind === 'box') {
      const x = Math.min(this.anchor.x, this.end.x);
      const y = Math.min(this.anchor.y, this.end.y);
      return { x, y, w: Math.max(GRID, Math.abs(this.end.x - this.anchor.x)), h: Math.max(GRID, Math.abs(this.end.y - this.anchor.y)) };
    }
    if (this.kind === 'line') {
      const x0 = Math.min(...this.points.map((point) => point.x));
      const y0 = Math.min(...this.points.map((point) => point.y));
      const x1 = Math.max(...this.points.map((point) => point.x));
      const y1 = Math.max(...this.points.map((point) => point.y));
      return { x: x0, y: y0, w: Math.max(GRID, x1 - x0), h: Math.max(GRID, y1 - y0) };
    }
    const a = this.anchorWorld();
    const w = this.colWidth() * GRID;
    const h = this.rowHeight() * GRID;
    if (this.netId) {
      if (this.netSide === 'below') return { x: a.x - w / 2, y: a.y, w, h };
      if (this.netSide === 'left') return { x: a.x - w, y: a.y - h / 2, w, h };
      if (this.netSide === 'right') return { x: a.x, y: a.y - h / 2, w, h };
      return { x: a.x - w / 2, y: a.y - h, w, h };
    }
    return { x: a.x - w / 2, y: a.y - h / 2, w, h };
  }

  /**
   * Where to draw the text and its text-anchor so the text is horizontally
   * aligned within the box (left/center/right) and vertically centered in it.
   * Returns {x, y, anchor} for an SVG <text> element.
   */
  textPos() {
    const b = this.bbox();
    const centerX = b.x + b.w / 2;
    const centerY = b.y + b.h / 2;
    const inset = this.alignInset();
    let x, anchor;
    if (this.align === 'left') {
      x = b.x + inset;
      anchor = 'start';
    } else if (this.align === 'right') {
      x = b.x + b.w - inset;
      anchor = 'end';
    } else {
      x = centerX;
      anchor = 'middle';
    }
    // Baseline sits below the box center so the cap height is vertically
    // centered on the label box, including side-attached net labels.
    const lineCount = Math.max(1, this.text.split('\n').length);
    const y = centerY - ((lineCount - 1) * LABEL_FONT_SIZE) / 2 + LABEL_CAP_H / 2;
    return { x, y, anchor };
  }

  setText(text) {
    if (this.netId) {
      const net = this.circuit.renameNet(this.netId, text);
      this.circuit._markReferenceLabelsLocal?.(net);
    } else {
      const next = this.math ? normalizeMathSource(text) : String(text);
      if (this.owner && !this.math && this.circuit._syncComponentLabel(this.owner, next)) return;
      if (this.owner && this.circuit._syncReferenceMarkerLabel(this.owner, next)) return;
      this._text = next;
      this.clearRenderedTextBounds();
      this.circuit.invalidateRoutingCache();
    }
  }
  setColor(color) {
    const previous = this.style.color;
    this.style.color = color;
    for (const child of this.circuit.labels.values()) {
      if (child.parent === this.id && child.style.color === previous) child.style.color = color;
    }
    return this;
  }


  /** Side gap for left/right text: a quarter cell, never pushing text past the far box edge. */
  alignInset() {
    if (this.align === 'center') return 0;
    return Math.max(0, Math.min(LABEL_ALIGN_INSET, this.bbox().w - this.textWidth()));
  }

  setAlign(a) {
    if (['center', 'left', 'right'].includes(a)) this.align = a;
  }

  moveTo(wx, wy) {
    wx = snap(wx);
    wy = snap(wy);
    if (this.kind === 'arrow' || this.kind === 'box' || this.kind === 'line') {
      const dx = wx - this.anchor.x;
      const dy = wy - this.anchor.y;
      this.anchor = { x: wx, y: wy };
      this.end = { x: this.end.x + dx, y: this.end.y + dy };
      if (this.points) this.points = this.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
      this.textAnchor = { x: this.textAnchor.x + dx, y: this.textAnchor.y + dy };
      for (const label of this.circuit.labels.values()) {
        if (label.parent === this.id) label.anchor = { x: label.anchor.x + dx, y: label.anchor.y + dy };
      }
      this.circuit.invalidateRoutingCache();
      return;
    }
    if (this.netId && !this.circuit._netLabelAnchorOnPath(this.netId, { x: wx, y: wy })) {
      throw new Error('net label anchor must lie on a drawable net path');
    }
    if (this.connectorId && typeof this.circuit.moveConnectorLabel === 'function') {
      this.circuit.moveConnectorLabel(this, wx, wy);
      return;
    }
    if (this.owner) {
      const c = this.circuit.components.get(this.owner);
      if (c) {
        const lo = inverseTransform(c.transform, wx, wy);
        this.offset = { x: snap(lo.x), y: snap(lo.y) };
        this.circuit.invalidateRoutingCache();
        return;
      }
    }
    this.anchor = { x: wx, y: wy };
    this.circuit.invalidateRoutingCache();
  }

  moveSegment(index, dx, dy) {
    if (!['arrow', 'line'].includes(this.kind) || !Number.isInteger(index) || index < 1 || index >= this.points.length) return false;
    for (const point of [this.points[index - 1], this.points[index]]) {
      point.x += dx;
      point.y += dy;
    }
    this.anchor = { ...this.points[0] };
    this.end = { ...this.points.at(-1) };
    return true;
  }

  moveVertex(index, wx, wy) {
    if (!['arrow', 'line'].includes(this.kind) || !Number.isInteger(index) || index < 0 || index >= this.points.length) return false;
    this.points[index] = snapPoint(wx, wy);
    this.anchor = { ...this.points[0] };
    this.end = { ...this.points.at(-1) };
    return true;
  }

  toJSON() {
    return {
      id: this.id,
      kind: this.kind,
      text: this.netId ? this.text : this._text,
      ...(this.math ? { math: true } : {}),
      ...(this.math && (this._renderedTextBounds || this._mathBox)
        ? { mathBox: { w: this.colWidth() * GRID, h: this.rowHeight() * GRID } } : {}),
      align: this.align,
      owner: this.owner,
      ...(this.referenceLocal === false ? { referenceLocal: false } : {}),
      parent: this.parent,
      netId: this.netId,
      netSide: this.netSide,
      ...(this.connectorId ? { connectorId: this.connectorId, connectorT: this.connectorT } : {}),
      offset: this.offset ? { ...this.offset } : null,
      anchor: this.owner ? null : { ...this.anchor },
      end: this.kind === 'label' ? null : { ...this.end },
      points: ['arrow', 'line'].includes(this.kind) ? this.points.map((point) => ({ ...point })) : null,
      textAnchor: this.kind === 'label' ? null : { ...this.textAnchor },
      style: { ...this.style },
      drawOrder: this.drawOrder,
    };
  }
}

const SMALL_SIGNAL_DEVICE_MODELS = new Set(['triode', 'ro']);

function normalizeSmallSignalDeviceModel(value) {
  if (value === undefined || value === null || value === '') return null;
  const model = String(value);
  if (model.trim().toLowerCase() === 'current-source') {
    throw new Error('small-signal current-source model override is no longer supported');
  }
  if (!SMALL_SIGNAL_DEVICE_MODELS.has(model)) {
    throw new Error(`unknown small-signal device model "${model}"`);
  }
  return model;
}

function migrateSerializedComponentAnalysis(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  const migrated = { ...analysis };
  const obsoleteModel = String(migrated.model ?? '').trim().toLowerCase() === 'current-source';
  const obsoleteAlias = String(migrated.smallSignalModel ?? '').trim().toLowerCase() === 'current-source';
  if (obsoleteModel) {
    delete migrated.model;
    delete migrated.smallSignalModel;
  } else if (obsoleteAlias) {
    delete migrated.smallSignalModel;
  }
  return migrated;
}

export class ComponentInstance {
  constructor(circuit, type, opts = {}) {
    this.circuit = circuit;
    this.type = type;
    this.def = getSymbol(type);
    const suppliedRefdes = opts.refdes !== undefined && opts.refdes !== null
      ? normalizeComponentRefdes(opts.refdes)
      : '';
    this.refdes = suppliedRefdes || circuit.nextRefdes(this.def.refPrefix || type.toUpperCase(), {
      reserveLabels: !!this.def.labelOffset,
    });
    this.value = opts.value !== undefined ? String(opts.value) : this.def.defaultValue;
    // Schematic blocks are the one resizable symbol. Keep their geometry and
    // perimeter terminal slots on the instance rather than mutating the shared
    // symbol definition (which would resize every block in the document).
    this.blockSize = this.type === 'block'
      ? {
          w: Math.max(2 * GRID, snap(opts.blockSize?.w ?? opts.width ?? 160)),
          h: Math.max(2 * GRID, snap(opts.blockSize?.h ?? opts.height ?? 160)),
        }
      : null;
    this.blockTerminals = this.type === 'block'
      ? (opts.blockTerminals || this.def.terminals.map((t) => {
          const side = Math.abs(t.x) >= 80 ? (t.x > 0 ? 'right' : 'left') : (t.y < 0 ? 'top' : 'bottom');
          return { name: t.name, side, offset: side === 'top' || side === 'bottom' ? t.x + 80 : t.y + 80 };
        })).map((t) => ({ name: String(t.name), side: String(t.side), offset: snap(Number(t.offset)) }))
      : null;
    this.analysis = {
      model: normalizeSmallSignalDeviceModel(opts.analysis?.model ?? opts.analysis?.smallSignalModel),
      role: opts.analysis?.role || null,
      channelLengthModulation: opts.analysis?.channelLengthModulation
        || opts.analysis?.clm
        || null,
      resistance: opts.analysis?.resistance
        || opts.analysis?.resistancePolicy
        || null,
      gmroLarge: opts.analysis?.gmroLarge ?? opts.analysis?.gmro ?? null,
      ignoreBodyEffect: opts.analysis?.ignoreBodyEffect
        ?? (String(opts.analysis?.bodyEffect || '').toLowerCase() === 'ignore' ? true : null),
      parasitics: opts.analysis?.parasitics || null,
    };
    this.transform = {
      x: snapPoint(opts.x || 0, opts.y || 0).x,
      y: snapPoint(opts.x || 0, opts.y || 0).y,
      rotation: opts.rotation || 0,
      mirrorX: opts.mirrorX !== undefined ? !!opts.mirrorX : !!(this.def && this.def.defaultMirrorX),
      mirrorY: opts.mirrorY !== undefined ? !!opts.mirrorY : !!(this.def && this.def.defaultMirrorY),
    };
    this.style = { color: opts.style?.color || '#111', lineStyle: opts.style?.lineStyle || 'solid', width: opts.style?.width || 'normal' };
    this.drawOrder = Number.isFinite(opts.drawOrder) ? opts.drawOrder : 0;
  }

  /** Dynamic terminal definitions for a resizable schematic block. */
  get terminalDefs() {
    if (this.type !== 'block') return this.def.terminals;
    const { w, h } = this.blockSize;
    return this.blockTerminals.map((item) => {
      const x = item.side === 'left' ? -w / 2 : item.side === 'right' ? w / 2 : -w / 2 + item.offset;
      const y = item.side === 'top' ? -h / 2 : item.side === 'bottom' ? h / 2 : -h / 2 + item.offset;
      const dir = item.side === 'top' ? { x: 0, y: -1 } : item.side === 'right' ? { x: 1, y: 0 } : item.side === 'bottom' ? { x: 0, y: 1 } : { x: -1, y: 0 };
      return { name: item.name, x, y, direction: 'passive', dir };
    });
  }

  setBlockSize(size = {}) {
    if (this.type !== 'block') throw new Error(`component ${this.refdes} is not a schematic block`);
    const next = {
      w: Math.max(2 * GRID, snap(Number(size.w ?? old.w))),
      h: Math.max(2 * GRID, snap(Number(size.h ?? old.h))),
    };
    if (![next.w, next.h].every(Number.isFinite)) throw new Error('block size must be finite');
    const connected = new Set();
    for (const net of this.circuit.nets.values()) {
      for (const terminal of net.terminals || []) if (terminal.comp === this.refdes) connected.add(terminal.term);
    }
    const sideMax = (side) => side === 'top' || side === 'bottom' ? next.w : next.h;
    const slots = [];
    // Match block-diagram perimeter behavior: every grid slot one cell away
    // from a corner is a valid attachment, including the exact edge midpoint.
    for (let offset = GRID; offset <= next.w - GRID; offset += GRID) slots.push({ side: 'top', offset });
    for (let offset = GRID; offset <= next.h - GRID; offset += GRID) slots.push({ side: 'right', offset });
    for (let offset = next.w - GRID; offset >= GRID; offset -= GRID) slots.push({ side: 'bottom', offset });
    for (let offset = next.h - GRID; offset >= GRID; offset -= GRID) slots.push({ side: 'left', offset });
    const used = new Set();
    const valid = new Set(slots.map((slot) => `${slot.side}:${slot.offset}`));
    const keep = [];
    const addExplicit = (item) => {
      const nextLength = sideMax(item.side);
      const offset = Math.max(0, Math.min(nextLength, snap(item.offset)));
      const saved = { ...item, offset };
      keep.push(saved);
      const key = `${saved.side}:${saved.offset}`;
      if (valid.has(key)) used.add(key);
    };
    // Explicit terminals and connected generated terminals are persistent.
    // Unconnected generated terminals are disposable perimeter affordances,
    // exactly like block-diagram terminals during a resize.
    for (const item of this.blockTerminals.filter((candidate) => !/^T\d+$/.test(candidate.name))) addExplicit(item);
    for (const item of this.blockTerminals.filter((candidate) => /^T\d+$/.test(candidate.name) && connected.has(candidate.name))) {
      const nextLength = sideMax(item.side);
      const offset = Math.max(0, Math.min(nextLength, snap(item.offset)));
      const key = `${item.side}:${offset}`;
      if (!valid.has(key) || used.has(key)) {
        const replacement = slots.find((candidate) => !used.has(`${candidate.side}:${candidate.offset}`));
        if (!replacement) throw new Error(`block ${this.refdes} resize creates coincident connected terminals`);
        used.add(`${replacement.side}:${replacement.offset}`);
        keep.push({ ...item, side: replacement.side, offset: replacement.offset });
      } else {
        used.add(key);
        keep.push({ ...item, offset });
      }
    }
    let nextGenerated = 1;
    // Every remaining non-corner grid slot receives a generated terminal.
    // Growing a block therefore creates new wireable T<n> terminals, while
    // shrinking removes only the unconnected generated affordances.
    for (const slot of slots) {
      const key = `${slot.side}:${slot.offset}`;
      if (used.has(key)) continue;
      while (keep.some((item) => item.name === `T${nextGenerated}`)) nextGenerated++;
      used.add(key);
      keep.push({ name: `T${nextGenerated++}`, side: slot.side, offset: slot.offset });
    }
    this.blockSize = next;
    this.blockTerminals = keep;
    return this;
  }

  localTerminal(name) {
    const t = this.terminalDefs.find((t) => t.name === name);
    if (!t) throw new Error(`component ${this.refdes} has no terminal "${name}"`);
    return t;
  }

  /** World (absolute, grid-snapped) position of a terminal. */
  terminalWorld(name) {
    const t = this.localTerminal(name);
    return applyTransform(this.transform, t.x, t.y);
  }

  worldTerminals() {
    return this.terminalDefs.map((t) => ({ name: t.name, ...this.terminalWorld(t.name) }));
  }

  bboxWorld() {
    const bbox = this.type === 'block'
      ? { x: -this.blockSize.w / 2, y: -this.blockSize.h / 2, w: this.blockSize.w, h: this.blockSize.h }
      : this.def.bbox;
    return transformRect(this.transform, bbox);
  }
  setColor(color) {
    const previous = this.style.color;
    this.style.color = color;
    for (const label of this.circuit.labels.values()) {
      if (label.owner === this.refdes && label.style.color === previous) label.style.color = color;
    }
    return this;
  }

  toJSON() {
    return {
      refdes: this.refdes,
      type: this.type,
      value: this.value,
      ...(this.analysis.model || this.analysis.role || this.analysis.channelLengthModulation
        || this.analysis.resistance || this.analysis.parasitics
        || this.analysis.gmroLarge !== null || this.analysis.ignoreBodyEffect !== null
        ? { analysis: { ...this.analysis } }
        : {}),
      transform: { ...this.transform },
      ...(this.type === 'block' ? { blockSize: { ...this.blockSize }, blockTerminals: this.blockTerminals.map((t) => ({ ...t })) } : {}),
      style: { ...this.style },
      drawOrder: this.drawOrder,
    };
  }
}

export class Net {
  constructor(circuit, opts = {}) {
    this.circuit = circuit;
    this.id = opts.id || uid();
    this.name = canonicalNetName(opts.name);
    // Preserve public wire islands; ordinary connect() nets may be pruned when
    // they no longer have an electrical anchor.
    this.style = { color: opts.style?.color || '#111', lineStyle: opts.style?.lineStyle || 'solid', width: opts.style?.width || 'normal' };
    this.drawOrder = Number.isFinite(opts.drawOrder) ? opts.drawOrder : 0;
    this.wireStyles = { ...(opts.wireStyles || {}) };
    this.preserveEmpty = !!opts.preserveEmpty;
    this.analysis = {
      role: opts.analysis?.role || null,
      acGround: !!opts.analysis?.acGround,
    };
    /** Ordered list of {comp, term} terminal references. */
    this.terminals = [];
    /** Managed nets autoroute; fixed nets preserve fixedPaths. */
    this.routingMode = opts.routingMode === 'fixed' ? 'fixed' : 'managed';
    /** Explicit authorization for authored managed diagonal segments. */
    this.allowDiagonal = this.routingMode === 'managed' && opts.allowDiagonal === true;
    /** Optional explicit grid-snapped wire path points. null => auto-route. */
    this.route = this.routingMode === 'fixed' ? null : (opts.route ? clonePath(opts.route, this.allowDiagonal) : null);
    /** Grid points where other wires join this net (mid-wire junctions). */
    this.junctions = opts.junctions ? opts.junctions.map((p) => ({ x: snap(p.x), y: snap(p.y) })) : [];
    /** Optional list of wire branches (each a polyline) for multi-way joined
     *  nets; when present the renderer draws every branch. */
    this.branches = this.routingMode === 'fixed' ? null : (opts.branches ? opts.branches.map((p) => clonePath(p, this.allowDiagonal)) : null);
    /** Protected direct paths. Each entry is {points, start, end}; anchors are
     * terminal refs ({comp, term}) or null when an endpoint is free. */
    this.fixedPaths = this.routingMode === 'fixed'
      ? (opts.fixedPaths || []).map((entry) => Net.fixedPathEntry(entry))
      : [];
  }

  static fixedPathEntry(entry, dedupe = false) {
    // Accept the array form as a small migration convenience, while v2 writes
    // the explicit object form so phase 2 can retain terminal anchors.
    const points = Array.isArray(entry) ? entry : entry?.points;
    const start = Array.isArray(entry) ? null : Net.terminalAnchor(entry?.start);
    const end = Array.isArray(entry) ? null : Net.terminalAnchor(entry?.end);
    const normalized = dedupe
      ? cloneFixedPath(points || [])
      : (points || []).map((p) => ({ x: snap(p.x), y: snap(p.y) }));
    // Distinct terminals can intentionally share a location. Keep both
    // endpoint anchors as a degenerate path so separating either component
    // later creates a real wire instead of a phantom terminal connection.
    if (normalized.length === 1 && (points || []).length >= 2 && start && end &&
        (start.comp !== end.comp || start.term !== end.term)) {
      normalized.push({ ...normalized[0] });
    }
    return { points: normalized, start, end };
  }

  static terminalAnchor(anchor) {
    if (!anchor) return null;
    if (typeof anchor === 'string') {
      const idx = anchor.lastIndexOf('.');
      if (idx <= 0 || idx === anchor.length - 1) return null;
      return { comp: anchor.slice(0, idx), term: anchor.slice(idx + 1) };
    }
    if (anchor.comp && anchor.term) return { comp: anchor.comp, term: anchor.term };
    return null;
  }

  terminalCount() {
    return this.terminals.length;
  }

  /** World points of the terminals in connection order. */
  terminalWorlds() {
    return this.terminals.map(({ comp, term }) => this.circuit.components.get(comp)?.terminalWorld(term));
  }

  /** All connection anchors: component terminals plus wire junctions. */
  anchorWorlds() {
    return [...this.terminalWorlds().filter(Boolean), ...this.junctions];
  }

  /** Resulting wire polyline (grid points). Auto-laid-out unless a route was set.
 *  For multi-branch joined nets the primary (first) branch is returned. */
  points() {
    if (this.routingMode === 'fixed') return this.fixedPaths[0]?.points.map((p) => ({ ...p })) || [];
    // Floating pasted/drawn islands have no electrical anchors, but their
    // explicit geometry remains a real drawable net.
    if (this.route && this.route.length >= 2) return this.route.slice();
    if (this.branches && this.branches.length) return this.branches[0].slice();
    const anchors = this.anchorWorlds();
    if (anchors.length === 0) return [];
    const env = this.circuit._netEnv(this.id);
    if (anchors.length === 2) {
      // Match the editor preview: two-terminal nets escape each pin one cell
      // outward before bending, so a committed wire never drills a body.
      return smartRoute(anchors[0], anchors[1], env) || [];
    }
    // Multi-terminal managed geometry must be materialized by a successful
    // balanced layout.  Do not silently synthesize an obstacle-free fallback
    // here: that would make an unrouted net appear connected through bodies.
    return [];
  }

  /** Canonical editable paths. Automatic nets are deliberately not materialized. */
  paths() {
    if (this.routingMode === 'fixed') return this.fixedPaths.map((entry) => entry.points.map((p) => ({ ...p })));
    if (this.branches && this.branches.length) return this.branches.map((p) => clonePath(p, this.allowDiagonal));
    if (this.route && this.route.length >= 2) return [clonePath(this.route, this.allowDiagonal)];
    const pts = this.points();
    return pts.length >= 2 ? [pts] : [];
  }

  wireSegments() {
    return this.paths().flatMap((path, branch) => {
      const segments = this.routingMode === 'fixed' ? pathSegments(path) : wireSegments(path, this.allowDiagonal);
      return segments.map((s) => ({ branch, ...s }));
    });
  }

  /** Every drawn polyline of the net (all branches), for bounds and evaluation. */
  pathPoints() {
    return this.paths().flatMap((b) => b);
  }

  /** Total drawn length; fixed diagonal segments use their Euclidean length. */
  length() {
    return this.paths().reduce((sum, pts) => sum + pathLength(pts), 0);
  }

  wiringErrors() { return validateWiring(this); }
  setColor(color) {
    const previous = this.style.color;
    this.style.color = color;
    for (const style of Object.values(this.wireStyles)) {
      if (style.color === previous) style.color = color;
    }
    for (const label of this.circuit.labels.values()) {
      if (label.netId === this.id && label.style.color === previous) label.style.color = color;
    }
    return this;
  }
  toJSON() {
    return {
      id: this.id,

      name: this.name,
      style: { ...this.style },
      drawOrder: this.drawOrder,
      wireStyles: Object.fromEntries(Object.entries(this.wireStyles).map(([key, style]) => [key, { ...style }])),
      preserveEmpty: this.preserveEmpty,
      ...(this.analysis.role || this.analysis.acGround ? { analysis: { ...this.analysis } } : {}),
      terminals: this.terminals.map((t) => ({ ...t })),
      routingMode: this.routingMode,
      allowDiagonal: this.allowDiagonal,
      route: this.routingMode === 'managed' && this.route ? this.route.map((p) => ({ ...p })) : null,
      junctions: this.junctions.map((p) => ({ ...p })),
      branches: this.routingMode === 'managed' && this.branches ? this.branches.map((b) => b.map((p) => ({ ...p }))) : null,
      fixedPaths: this.routingMode === 'fixed' ? this.fixedPaths.map((entry) => ({
        points: entry.points.map((p) => ({ ...p })),
        start: entry.start ? { ...entry.start } : null,
        end: entry.end ? { ...entry.end } : null,
      })) : null,
    };
  }
}

const isDiagonalSegment = (a, b) => a.x !== b.x && a.y !== b.y;

/** True when a polyline contains an authored diagonal segment. */
export function pathHasDiagonal(path = []) {
  for (let i = 1; i < path.length; i++) if (isDiagonalSegment(path[i - 1], path[i])) return true;
  return false;
}

/**
 * The geometry of a diagonal-mode wire draft through `endpoints` (source,
 * clicked points, target). Legs between clicked points are literal and may be
 * diagonal; a leg that starts or ends on a component pin is auto-routed so it
 * leaves and enters the pin like any managed wire. Returns null when a pin leg
 * cannot be routed safely.
 */
export function diagonalDraftPath(circuit, endpoints, env) {
  const points = endpoints.map((p) => snapPoint(p.x, p.y));
  const pinAt = (p) => [...circuit.components.values()].some((c) => c.type !== 'solder' &&
    c.terminalDefs.some((t) => {
      const q = c.terminalWorld(t.name);
      return q.x === p.x && q.y === p.y;
    }));
  const path = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.x === b.x && a.y === b.y) continue;
    const pinLeg = (i === 1 && pinAt(a)) || (i === points.length - 1 && pinAt(b));
    const leg = pinLeg ? smartRoute(a, b, { ...env, allowDiagonal: false }) : [a, b];
    if (!leg) return null;
    for (const point of leg.slice(1)) path.push({ x: point.x, y: point.y });
  }
  return clonePath(path, true);
}

function diagonalRouteRequested(options) {
  if (options === 'diagonal') return true;
  if (!options || typeof options !== 'object') return false;
  return options.allowDiagonal === true || options.routeStyle === 'diagonal' ||
    options.route === 'diagonal' || options.style === 'diagonal';
}

function wireTargetIdentity(options) {
  const target = options?.targetIdentity || options?.target;
  if (target && typeof target === 'object') return target;
  if (options && typeof options === 'object' && options.netId !== undefined &&
      options.pathIndex !== undefined && options.segmentIndex !== undefined && options.point) return options;
  return null;
}

function validateWireTarget(circuit, P, identity) {
  if (!identity || typeof identity.netId !== 'string' || !Number.isInteger(identity.pathIndex) ||
      !Number.isInteger(identity.segmentIndex) || !identity.point ||
      !Number.isFinite(identity.point.x) || !Number.isFinite(identity.point.y) ||
      identity.point.x !== snap(identity.point.x) || identity.point.y !== snap(identity.point.y)) {
    throw new Error('wire target identity is invalid');
  }
  const targetNet = circuit.nets.get(identity.netId);
  const paths = targetNet?.paths() || [];
  const path = paths[identity.pathIndex];
  if (!path || identity.segmentIndex <= 0 || identity.segmentIndex >= path.length) {
    throw new Error('wire target identity is invalid');
  }
  const targetPoint = { x: identity.point.x, y: identity.point.y };
  if (targetPoint.x !== P.x || targetPoint.y !== P.y ||
      !pointOnPath(targetPoint, [path[identity.segmentIndex - 1], path[identity.segmentIndex]])) {
    throw new Error('wire target identity does not match the selected point');
  }
  const first = path[0];
  const last = path[path.length - 1];
  return {
    targetNet,
    targetPoint,
    targetIsInterior: targetPoint.x !== first.x || targetPoint.y !== first.y ?
      (targetPoint.x !== last.x || targetPoint.y !== last.y) : false,
  };
}

function inferWireTarget(circuit, P) {
  const hits = new Map();
  for (const net of circuit.nets.values()) {
    const paths = circuit._explicitBranches(net);
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const path = paths[pathIndex];
      for (let segmentIndex = 1; segmentIndex < path.length; segmentIndex++) {
        if (pointOnPath(P, [path[segmentIndex - 1], path[segmentIndex]])) {
          hits.set(net.id, { targetNet: net, targetPoint: P, targetIsInterior: true });
          break;
        }
      }
    }
  }
  if (hits.size > 1) throw new Error('ambiguous wire target; provide target identity');
  return hits.values().next().value || null;
}

function resolveWireTarget(circuit, point, identity = null) {
  if (identity) return validateWireTarget(circuit, point, identity).targetNet;
  for (const net of circuit.nets.values()) {
    for (const terminal of net.terminals) {
      const position = circuit.getComponent(terminal.comp).terminalWorld(terminal.term);
      if (position.x === point.x && position.y === point.y) return net;
    }
  }
  return inferWireTarget(circuit, point)?.targetNet || null;
}

/** Return whether two points are already connected by explicit net topology.
 * Geometric crossings between branches do not count unless the net records a
 * junction there; otherwise a same-net wirePointTo can accidentally add a
 * redundant branch or turn a crossing into an implicit join. */
function wirePointsConnected(net, from, to, circuit, targetPathIndex = null) {
  const paths = circuit._explicitBranches(net);
  const fromPaths = [];
  const toPaths = [];
  for (let i = 0; i < paths.length; i++) {
    if (pointOnPath(from, paths[i])) fromPaths.push(i);
    if (pointOnPath(to, paths[i]) && (targetPathIndex == null || i === targetPathIndex)) toPaths.push(i);
  }
  if (!fromPaths.length || !toPaths.length) return false;

  const links = paths.map(() => new Set());
  const samePoint = (a, b) => a.x === b.x && a.y === b.y;
  const explicitJunctions = net.junctions || [];
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const sharedEndpoint = [paths[i][0], paths[i].at(-1)].some((a) =>
        [paths[j][0], paths[j].at(-1)].some((b) => samePoint(a, b)));
      const sharedJunction = explicitJunctions.some((p) => pointOnPath(p, paths[i]) && pointOnPath(p, paths[j]));
      if (sharedEndpoint || sharedJunction) {
        links[i].add(j);
        links[j].add(i);
      }
    }
  }

  const seen = new Set(fromPaths);
  const queue = [...fromPaths];
  while (queue.length) {
    const pathIndex = queue.shift();
    if (toPaths.includes(pathIndex)) return true;
    for (const next of links[pathIndex]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

export class Circuit {
  constructor() {
    this.components = new Map();
    this.nets = new Map();
    this.labels = new Map();
    this._netId = 0;
    /** Junction annotations explicitly removed by the user stay removed. */
    this.suppressedJunctions = new Set();
    /** Pending warnings from merging separately named physical nets. */
    this.netNameWarnings = [];
    this._routingEnvCache = new Map();
  }

  invalidateRoutingCache() {
    this._routingEnvCache.clear();
  }

  // ----- components -------------------------------------------------

  /** Smallest unused refdes index for a prefix ("R" -> R1, R2, R4 if R3
   * exists...).  Owned instance labels use the refdes as their id, so label
   * ids reserve the same namespace when choosing an automatic name. */
  nextRefdes(prefix, { reserveLabels = true } = {}) {
    const used = new Set();
    for (const c of this.components.values()) {
      if (c.refdes.startsWith(prefix)) {
        const n = Number(c.refdes.slice(prefix.length));
        if (Number.isInteger(n) && n > 0) used.add(n);
      }
    }
    if (reserveLabels) {
      for (const id of this.labels.keys()) {
        if (!String(id).startsWith(prefix)) continue;
        const n = Number(String(id).slice(prefix.length));
        if (Number.isInteger(n) && n > 0) used.add(n);
      }
    }
    let n = 1;
    while (used.has(n)) n++;
    return `${prefix}${n}`;
  }

  addComponent(type, opts = {}) {
    this.invalidateRoutingCache();
    const inst = new ComponentInstance(this, type, opts);
    if (this.components.has(inst.refdes)) throw new Error(`reference designator ${inst.refdes} already in use`);
    // Do this before inserting the component.  Otherwise an explicit
    // refdes can leave a half-added component behind when its owned label id
    // collides with an existing free/annotation label.  Automatically chosen
    // refdes values already avoid this through nextRefdes().
    if (!opts.noLabel && inst.def?.labelOffset && this.labels.has(inst.refdes)) {
      throw new Error(`label id "${inst.refdes}" already in use`);
    }
    this.components.set(inst.refdes, inst);
    // Every symbol with a label offset carries its instance label from the
    // start. Default numeric names persist explicit textbook markup (M_{1}),
    // while the connectivity id remains compact (M1).
    if (!opts.noLabel) this._ensureComponentInstanceLabel(inst);
    // Touching pins connect: a newly placed component whose terminal lands on
    // another component's terminal joins that net immediately. Skipped while a
    // state is being loaded (fromJSON) so explicit nets are not pre-empted.
    if (!this._loading) this.connectCoincident(inst.refdes);
    return inst;
  }

  getComponent(refdes) {
    const c = this.components.get(refdes);
    if (!c) throw new Error(`unknown component "${refdes}"`);
    return c;
  }
  /**
   * Rename a component while preserving its identity throughout the circuit.
   * Refdes values are intentionally conservative: they must begin with a
   * letter and contain only letters, digits, or underscores so terminal refs
   * (`REFDES.TERM`) remain unambiguous.
   */
  renameComponent(refdes, newRefdes, { displayLabel = null } = {}) {
    this.invalidateRoutingCache();
    const current = normalizeComponentRefdes(refdes);
    const component = this.getComponent(current);
    const next = normalizeComponentRefdes(newRefdes);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(next)) {
      throw new Error(`invalid refdes "${next}"`);
    }
    const interfacePin = INTERFACE_PIN_TYPES.has(component.type);
    const interfaceNet = interfacePin ? this.netOfTerminal({ comp: current, term: 'p' }) : null;
    const interfacePinCount = interfaceNet
      ? interfaceNet.terminals.filter(({ comp }) => INTERFACE_PIN_TYPES.has(this.components.get(comp)?.type)).length
      : 0;
    const referenceMarker = isReferenceMarker(component);
    if (next === current) {
      if (interfaceNet && interfacePinCount <= 1) {
        const interfaceLabel = this.labelOf(current);
        const interfaceName = canonicalNetName(displayLabel ?? interfaceLabel?._text ?? next);
        if (interfaceName && interfaceNet.name !== interfaceName) this.renameNet(interfaceNet, interfaceName);
      }
      if (!isReferenceMarker(component)) {
        const label = this.labelOf(current);
        if (label && (displayLabel !== null || labelMatchesRefdes(label._text, current))) {
          label._text = componentLabelText(next, displayLabel ?? label._text);
          label.clearRenderedTextBounds();
        }
      }
      return component;
    }
    if (this.components.has(next)) throw new Error(`component name "${next}" is already in use`);

    const ownedLabels = [...this.labels.values()].filter((label) => label.owner === current);
    this.components.delete(current);
    component.refdes = next;
    this.components.set(next, component);
    for (const net of this.nets.values()) {
      for (const terminal of net.terminals) {
        if (terminal.comp === current) terminal.comp = next;
      }
      if (net.routingMode === 'fixed') {
        for (const path of net.fixedPaths) {
          if (path.start?.comp === current) path.start.comp = next;
          if (path.end?.comp === current) path.end.comp = next;
        }
      }
    }
    for (const label of ownedLabels) {
      label.owner = next;
      // Reference-marker labels can be local rail names, so preserve those
      // custom values. Interface pins participate in the same component
      // name/label contract as every other symbol; their connected net is
      // renamed below when it has a single interface owner.
      const isRefdesLabel = labelMatchesRefdes(label._text, current);
      if (referenceMarker) {
        if (isRefdesLabel) {
          label._text = next;
          label.clearRenderedTextBounds();
        }
      } else {
        // Normal component-owned labels are instance labels by default. Keep
        // the refdes-derived occurrences synchronized, including explicit
        // `_{...}` source text, while preserving a deliberately customized
        // child label (owned-label edits are otherwise independent).
        if (isRefdesLabel || interfacePin) {
          label._text = componentLabelText(next, displayLabel ?? label._text);
          label.clearRenderedTextBounds();
        }
      }
    }
    if (interfacePin && interfaceNet && interfacePinCount <= 1) {
      const renamedNet = this.netOfTerminal({ comp: next, term: 'p' });
      const label = this.labelOf(next);
      if (label) {
        label._text = componentLabelText(next, displayLabel ?? label._text);
        label.clearRenderedTextBounds();
      }
      const interfaceName = canonicalNetName(label?._text || next);
      if (renamedNet && interfaceName && renamedNet.name !== interfaceName) this.renameNet(renamedNet, interfaceName);
    }
    this._ensureComponentInstanceLabel(component);
    return component;
  }

  /** Ensure a component that supports instance labels has one.  This also
   * repairs legacy documents whose labels predate the owned-label model. */
  _ensureComponentInstanceLabel(component) {
    if (!component?.def?.labelOffset) return null;
    const existing = this.labelOf(component.refdes);
    if (existing) {
      const isSpecial = isReferenceMarker(component);
      if (!isSpecial && labelMatchesRefdes(existing._text, component.refdes)) {
        existing._text = componentLabelText(component.refdes, existing._text);
        existing.clearRenderedTextBounds();
      }
      return existing;
    }
    return this.addLabel({
      text: componentLabelText(component.refdes),
      owner: component.refdes,
      offset: component.def.labelOffset,
      align: 'center',
      style: { color: component.style.color },
    });
  }


  _beginComponentEdit(refdes, previous) {
    const current = this._componentEdit;
    if (!current) {
      const topology = this._snapshotNetTopology();
      const pending = new Set();
      for (const saved of topology.nets) {
        if (saved.terminals.some((t) => t.comp === refdes)) pending.add(saved.id);
      }
      this._componentEdit = { topology, previous: new Map([[refdes, previous]]), pending };
      return;
    }
    if (!current.previous.has(refdes)) current.previous.set(refdes, previous);
    for (const saved of current.topology.nets) {
      if (saved.terminals.some((t) => t.comp === refdes)) current.pending.add(saved.id);
    }
  }

  _completeComponentEdit(netId) {
    const edit = this._componentEdit;
    if (!edit) return;
    edit.pending.delete(netId);
    if (edit.pending.size === 0 && !this._componentEditApplying) this._componentEdit = null;
  }

  _rollbackComponentEdit() {
    const edit = this._componentEdit;
    if (!edit) return false;
    for (const [refdes, transform] of edit.previous) {
      const c = this.components.get(refdes);
      if (c) c.transform = { ...transform };
    }
    this._restoreNetTopology(edit.topology);
    this.invalidateRoutingCache();
    this._componentEdit = null;
    return true;
  }

  moveComponent(refdes, x, y) {
    this.invalidateRoutingCache();
    const c = this.getComponent(refdes);
    const p = snapPoint(x, y);
    this._beginComponentEdit(refdes, { ...c.transform });
    c.transform.x = p.x;
    c.transform.y = p.y;
    if (this._componentEdit?.pending.size === 0) this._componentEdit = null;
    return c;
  }

  /** Resize a schematic block from a world-space rectangle.  The block's
   * origin follows the rectangle center, so the same corner-drag semantics as
   * the block-diagram editor can be used without changing ordinary component
   * transform rules. */
  resizeBlock(refdes, rect = {}) {
    const component = this.getComponent(refdes);
    if (component.type !== 'block') throw new Error(`component ${refdes} is not a schematic block`);
    if (component.transform.rotation % 360 !== 0 || component.transform.mirrorX || component.transform.mirrorY) {
      throw new Error('resizing a rotated or mirrored schematic block is not supported');
    }
    const beforeTransform = { ...component.transform };
    const beforeSize = { ...component.blockSize };
    const beforeTerminals = component.blockTerminals.map((terminal) => ({ ...terminal }));
    const topology = this._snapshotNetTopology();
    const x = snap(Number(rect.x)); const y = snap(Number(rect.y));
    const w = Math.max(2 * GRID, snap(Number(rect.w)));
    const h = Math.max(2 * GRID, snap(Number(rect.h)));
    if (![x, y, w, h].every(Number.isFinite)) throw new Error('block rectangle must contain finite coordinates');
    const touched = new Set([...this.nets.values()].filter((net) => net.terminals.some((t) => t.comp === refdes)).map((net) => net.id));
    try {
      component.setBlockSize({ w, h });
      component.transform.x = x + w / 2;
      component.transform.y = y + h / 2;
      this.invalidateRoutingCache();
      for (const id of touched) {
        const net = this.nets.get(id);
        if (net && !this.rerouteNet(net, 'refresh')) throw new Error(`unable to route net ${id} after block resize`);
      }
      this.connectCoincident(refdes);
      return component;
    } catch (error) {
      component.transform = beforeTransform;
      component.blockSize = beforeSize;
      component.blockTerminals = beforeTerminals;
      this._restoreNetTopology(topology);
      throw error;
    }
  }

  setTransform(refdes, { rotation, mirrorX, mirrorY } = {}) {
    this.invalidateRoutingCache();
    const c = this.getComponent(refdes);
    this._beginComponentEdit(refdes, { ...c.transform });
    this._componentEditApplying = true;
    try {
      if (rotation !== undefined) c.transform.rotation = ((Math.round(rotation / 90) % 4) + 4) % 4 * 90;
      if (mirrorX !== undefined) c.transform.mirrorX = !!mirrorX;
      if (mirrorY !== undefined) c.transform.mirrorY = !!mirrorY;
      this.connectCoincident(refdes);
    } catch (err) {
      this._rollbackComponentEdit();
      throw err;
    } finally {
      this._componentEditApplying = false;
    }
    if (this._componentEdit?.pending.size === 0) this._componentEdit = null;
    return c;
  }

  /**
   * Connect any terminal of `refdes` (or of every component when omitted) that
   * sits EXACTLY on another component's terminal — touching pins connect, like
   * dropping a ground symbol onto a transistor source. Once connected the two
   * terminals share a net, so dragging either component apart simply routes a
   * wire that keeps them joined. Returns the number of connections made.
   */
  connectCoincident(refdes) {
    let comps;
    if (Array.isArray(refdes)) {
      comps = refdes.map((r) => this.components.get(r)).filter(Boolean);
    } else {
      comps = refdes ? [this.components.get(refdes)].filter(Boolean) : [...this.components.values()];
    }
    if (comps.length === 0) return 0;
    // Position -> every component terminal sitting there (a point may be shared
    // by more than two pins).
    const at = new Map();
    for (const other of this.components.values()) {
      for (const t of other.worldTerminals()) {
        const key = `${t.x},${t.y}`;
        if (!at.has(key)) at.set(key, []);
        at.get(key).push({ comp: other.refdes, term: t.name });
      }
    }
    let made = 0;
    for (const c of comps) {
      for (const t of c.worldTerminals()) {
        for (const hit of at.get(`${t.x},${t.y}`) || []) {
          if (hit.comp === c.refdes) continue;
          const mine = this.netOfTerminal({ comp: c.refdes, term: t.name });
          const theirs = this.netOfTerminal(hit);
          if (mine && theirs && mine.id === theirs.id) continue;
          // A coincident pin is not enough to grow a protected net: direct mode
          // must supply the explicit anchored path (including a zero-length
          // path when two distinct terminals intentionally start together).
          if (mine?.routingMode === 'fixed' || theirs?.routingMode === 'fixed') continue;
          this.connect(`${c.refdes}.${t.name}`, `${hit.comp}.${hit.term}`);
          made++;
        }
      }
    }
    return made;
  }

  setValue(refdes, value) {
    const c = this.getComponent(refdes);
    c.value = String(value);
    if (isReferenceMarker(c) && this.labelOf(refdes)) this._syncReferenceMarkerLabel(refdes, c.value);
    return c;
  }

  /** Persist optional textbook small-signal metadata on a device.  These
   * attributes are descriptive model hints, not electrical connectivity. */
  setComponentAnalysis(refdes, attrs = {}) {
    const component = this.getComponent(refdes);
    const hasOwn = (key) => Object.prototype.hasOwnProperty.call(attrs, key);
    const model = hasOwn('model') ? attrs.model : attrs.smallSignalModel;
    const role = attrs.role;
    const clmValue = hasOwn('channelLengthModulation')
      ? attrs.channelLengthModulation
      : hasOwn('clm')
        ? attrs.clm
        : (attrs.ignoreChannelLengthModulation === undefined
          ? undefined
          : (attrs.ignoreChannelLengthModulation ? 'ignore' : 'finite'));
    const gmroValue = hasOwn('gmroLarge')
      ? attrs.gmroLarge
      : hasOwn('gmro')
        ? attrs.gmro
        : undefined;
    const bodyEffectValue = hasOwn('ignoreBodyEffect')
      ? attrs.ignoreBodyEffect
      : hasOwn('bodyEffect')
        ? (attrs.bodyEffect === null || attrs.bodyEffect === undefined || attrs.bodyEffect === ''
          ? attrs.bodyEffect
          : String(attrs.bodyEffect).toLowerCase() === 'ignore')
        : undefined;
    const resistanceValue = hasOwn('resistance')
      ? attrs.resistance
      : hasOwn('resistancePolicy')
        ? attrs.resistancePolicy
        : hasOwn('infiniteResistance')
          ? (attrs.infiniteResistance ? 'infinite' : 'finite')
          : undefined;
    const normalizeOptionalBoolean = (value, label) => {
      if (value === undefined || value === null || value === '') return value;
      if (value === true || value === false) return value;
      const normalized = String(value).trim().toLowerCase();
      if (['true', 'yes', 'large', 'ignore', 'ignored'].includes(normalized)) return true;
      if (['false', 'no', 'exact', 'finite', 'include', 'included', 'retain'].includes(normalized)) return false;
      throw new Error(`unknown ${label} override "${value}"`);
    };
    const normalizedGmro = normalizeOptionalBoolean(gmroValue, 'g_m r_o');
    const normalizedBodyEffect = normalizeOptionalBoolean(bodyEffectValue, 'body-effect');
    const normalizeResistance = (value) => {
      if (value === undefined || value === null || value === '') return value;
      if (value === true) return 'infinite';
      if (value === false) return 'finite';
      const normalized = String(value).trim().toLowerCase().replace(/_/g, '-');
      if (['infinite', 'inf', 'ignore', 'open', 'large'].includes(normalized)) return 'infinite';
      if (['finite', 'exact', 'retain', 'include'].includes(normalized)) return 'finite';
      throw new Error(`unknown resistance override "${value}"`);
    };
    const normalizedResistance = normalizeResistance(resistanceValue);
    // A device's own capacitances: 'include' or 'omit' override the request's
    // global choice, null follows it.
    const parasiticsValue = hasOwn('parasitics')
      ? attrs.parasitics
      : hasOwn('deviceCapacitances') ? attrs.deviceCapacitances : undefined;
    const normalizeParasitics = (value) => {
      if (value === undefined || value === null || value === '') return value;
      if (value === true) return 'include';
      if (value === false) return 'omit';
      const normalized = String(value).trim().toLowerCase();
      if (['include', 'included', 'on', 'yes'].includes(normalized)) return 'include';
      if (['omit', 'omitted', 'off', 'no', 'ignore'].includes(normalized)) return 'omit';
      throw new Error(`unknown parasitics override "${value}"`);
    };
    const normalizedParasitics = normalizeParasitics(parasiticsValue);
    if (normalizedParasitics !== undefined && normalizedParasitics !== null
      && !MOS_ANALYSIS_TYPES.has(component.type)) {
      throw new Error(`parasitics overrides apply only to MOS components, not ${component.type}`);
    }
    const normalizedModel = model === undefined ? undefined : normalizeSmallSignalDeviceModel(model);
    if (role !== undefined && role !== null && role !== '' && !['dc-bias', 'input', 'output'].includes(String(role))) {
      throw new Error(`unknown small-signal device role "${role}"`);
    }
    if (normalizedResistance !== undefined && normalizedResistance !== null
      && !['resistor', 'variable_resistor'].includes(component.type)) {
      throw new Error(`resistance overrides apply only to resistor components, not ${component.type}`);
    }
    if (clmValue !== undefined && clmValue !== null && clmValue !== ''
      && !['ignore', 'finite'].includes(String(clmValue).toLowerCase())) {
      throw new Error(`unknown channel-length modulation policy "${clmValue}"`);
    }
    component.analysis = {
      model: normalizedModel === undefined ? component.analysis?.model || null : normalizedModel,
      role: role === undefined ? component.analysis?.role || null : (role ? String(role) : null),
      channelLengthModulation: clmValue === undefined
        ? component.analysis?.channelLengthModulation || null
        : (clmValue ? String(clmValue).toLowerCase() : null),
      resistance: normalizedResistance === undefined
        ? component.analysis?.resistance || null
        : (normalizedResistance ? String(normalizedResistance).toLowerCase() : null),
      gmroLarge: normalizedGmro === undefined
        ? component.analysis?.gmroLarge ?? null
        : normalizedGmro,
      ignoreBodyEffect: normalizedBodyEffect === undefined
        ? component.analysis?.ignoreBodyEffect ?? null
        : normalizedBodyEffect,
      parasitics: normalizedParasitics === undefined
        ? component.analysis?.parasitics ?? null
        : (normalizedParasitics || null),
    };
    // Interface-port roles describe the electrical net, so keep the two
    // representations synchronized regardless of which context menu changed
    // them. Clearing a port role also clears the role on its attached net;
    // `setNetAnalysis` below propagates that clear to any sibling ports.
    if (hasOwn('role') && INTERFACE_PIN_TYPES.has(component.type)) {
      for (const terminal of component.terminalDefs) {
        const net = this.netOfTerminal({ comp: component.refdes, term: terminal.name });
        if (net) this.setNetAnalysis(net, {
          role: component.analysis.role,
          acGround: component.analysis.role === 'dc-bias',
        });
      }
    }
    return component;
  }

  /** Persist optional analysis metadata on a physical net. */
  setNetAnalysis(netOrId, attrs = {}) {
    const net = this._resolveNet(netOrId);
    const role = attrs.role;
    if (role !== undefined && role !== null && role !== '' && !['dc-bias', 'input', 'output'].includes(String(role))) {
      throw new Error(`unknown small-signal net role "${role}"`);
    }
    const nextRole = role === undefined ? net.analysis?.role || null : (role ? String(role) : null);
    const nextAcGround = attrs.acGround === undefined
      ? role === undefined ? !!net.analysis?.acGround : nextRole === 'dc-bias'
      : !!attrs.acGround;
    net.analysis = { role: nextRole, acGround: nextAcGround };
    if (net.analysis.role === 'dc-bias') net.analysis.acGround = true;
    if (role !== undefined || attrs.acGround !== undefined) {
      const syncedRole = net.analysis.role || (net.analysis.acGround ? 'dc-bias' : null);
      for (const terminal of net.terminals) {
        const component = this.components.get(terminal.comp);
        if (!component || !INTERFACE_PIN_TYPES.has(component.type)) continue;
        component.analysis = { ...component.analysis, role: syncedRole };
      }
    }
    return net;
  }

  removeComponent(refdes) {
    this.invalidateRoutingCache();
    const c = this.getComponent(refdes);
    if (c.type === 'solder') this.suppressedJunctions.add(`${c.transform.x},${c.transform.y}`);
    const touched = [];
    for (const net of this.nets.values()) {
      this._dropFixedAnchor(net, { comp: refdes });
      const wasMember = net.terminals.some((t) => t.comp === refdes);
      net.terminals = net.terminals.filter((t) => t.comp !== refdes);
      if (net.terminals.length === 0 && (!net.preserveEmpty || !this._netHasGeometry(net))) {
        this.removeNet(net);
      } else if (wasMember) touched.push(net);
    }
    for (const [id, l] of [...this.labels]) if (l.owner === refdes) this.labels.delete(id);
    this.components.delete(refdes);
    // Removing one of several ports can leave a sole port behind, and a sole
    // port names its net. Settle that here so the identity is never stale.
    if (INTERFACE_PIN_TYPES.has(c.type)) {
      for (const net of touched) this._syncInterfacePinLabels(net, { enforceName: true });
    }
    this.syncJunctionSolders();
    return true;
  }
  addAnnotation(kind, opts = {}) {
    if (!['arrow', 'box', 'line'].includes(kind)) throw new Error(`unknown annotation kind "${kind}"`);
    const points = ['arrow', 'line'].includes(kind) && Array.isArray(opts.points)
      ? opts.points.map((point) => ({ x: snap(point.x), y: snap(point.y) }))
      : null;
    const a = points?.[0] || { x: snap(opts.x || 0), y: snap(opts.y || 0) };
    const b = points?.at(-1) || (opts.end ? { x: snap(opts.end.x), y: snap(opts.end.y) } : a);
    const pathLength = points?.reduce((sum, point, index) => index ? sum + Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) : 0, 0)
      ?? Math.hypot(a.x - b.x, a.y - b.y);
    if (kind === 'arrow' && ((points && points.length < 2) || pathLength < GRID * 2)) throw new Error('arrow must have non-zero length and minimum length of two grid cells');
    if (kind === 'box' && (a.x === b.x || a.y === b.y)) throw new Error('box must have non-zero width and height');
    if (kind === 'line' && (!points || points.length < 2 || points.every((point) => point.x === a.x && point.y === a.y))) throw new Error('line must have at least two distinct points');
    const shape = this.addLabel({
      ...opts,
      kind,
      text: '',
      style: { ...(opts.style || {}), lineStyle: opts.style?.lineStyle || (kind === 'box' ? 'dashed' : 'solid') },
      x: a.x,
      y: a.y,
      end: b,
      ...(points ? { points } : {}),
    });
    if (opts.text) {
      const child = this.addLabel({
        text: opts.text,
        align: opts.align,
        parent: shape.id,
        x: opts.textAnchor?.x ?? a.x,
        y: opts.textAnchor?.y ?? a.y,
        style: { color: shape.style.color },
      });
      if (!opts.textAnchor) {
        const w = child.colWidth() * GRID;
        const h = child.rowHeight() * GRID;
        if (kind === 'box') {
          const top = Math.min(a.y, b.y);
          child.anchor = { x: snap((a.x + b.x) / 2), y: snap(top - h / 2) };
        } else {
          // Place an arrow caption against the first authored segment. For an
          // orthogonal route this keeps the caption aligned with the shaft,
          // instead of hanging diagonally from the first corner. Preserve the
          // Preserve quadrant placement for diagonal arrows.
          const first = points?.[1] || b;
          const dx = Math.sign(first.x - a.x);
          const dy = Math.sign(first.y - a.y);
          const orthogonal = (dx === 0) !== (dy === 0);
          child.anchor = {
            x: snap(orthogonal && dx !== 0 ? (dx > 0 ? a.x - w / 2 : a.x + w / 2) : (dx > 0 ? a.x - w / 2 : dx < 0 ? a.x + w / 2 : a.x)),
            y: snap(orthogonal && dy !== 0 ? (dy > 0 ? a.y - h / 2 : a.y + h / 2) : (dy > 0 ? a.y - h / 2 : dy < 0 ? a.y + h / 2 : a.y)),
          };
        }
      }
    }
    return shape;
  }

  // ----- labels -------------------------------------------------

  addLabel(opts = {}) {
    this.invalidateRoutingCache();
    if (opts.owner && opts.netId) throw new Error('label cannot have both owner and netId');
    const inst = new LabelInstance(this, opts);
    if (this.labels.has(inst.id)) throw new Error(`label id "${inst.id}" already in use`);
    this.labels.set(inst.id, inst);
    return inst;
  }

  _resolveNet(netOrId) {
    const net = typeof netOrId === 'string' ? this.nets.get(netOrId) : netOrId;
    if (!net || !this.nets.has(net.id)) throw new Error(`unknown net "${netOrId?.id || netOrId}"`);
    return net;
  }

  renameNet(netOrId, name) {
    this.invalidateRoutingCache();
    const net = this._resolveNet(netOrId);
    const canonical = canonicalNetName(name);
    if (!canonical && this.netLabels(net).length > 0) throw new Error(`cannot clear name of net ${net.id} while net labels are attached`);
    net.name = canonical;
    // Renaming an unnamed reference-attached net away from its global rail
    // name makes that marker local.  Persist the same child label used by the
    // inline reference editor so analysis and the net list agree about the
    // new rail scope.
    if (canonical) {
      for (const terminal of net.terminals) {
        const component = this.components.get(terminal.comp);
        if (!isReferenceMarker(component)) continue;
        const info = referenceMarkerInfo(component.type);
        if (terminal.term !== info?.terminal || referenceMarkerName(component) || isReferenceMarkerGlobalName(info, canonical)) continue;
        this.addLabel({
          text: canonical,
          owner: component.refdes,
          referenceLocal: false,
          offset: info.labelOffset,
          align: 'center',
          style: { color: component.style.color },
        });
      }
    }
    for (const label of this.labels.values()) {
      if (label.netId === net.id) label.clearRenderedTextBounds();
    }
    this._syncInterfacePinLabels(net);
    this._syncReferenceMarkerLabels(net);
    this.netNameWarnings = this.netNameWarnings.filter((warning) => warning.netId !== net.id);
    return net;
  }

  /** A port's owned label is its identity, exactly like every other
   * component's, so two ports can never carry one name.  A port additionally
   * NAMES its physical net: while it is the only interface pin on that net,
   * the net name and the port identity are one thing and renaming either
   * renames both.  Several ports on one net keep their own identities and the
   * net keeps a single name, and a net name that cannot be a component
   * identity (not a valid refdes, or already taken) likewise leaves the port
   * alone -- that port simply does not name this net.  Authored textbook
   * markup (`V_{IN}`) remains the display source of both. */
  _syncInterfacePinLabels(netOrId, { enforceName = false, preserveSource = false } = {}) {
    const net = this._resolveNet(netOrId);
    const pins = net.terminals
      .map(({ comp }) => this.components.get(comp))
      .filter((component) => component && INTERFACE_PIN_TYPES.has(component.type));
    if (!pins.length) return net;
    if (pins.length > 1) {
      // Several ports share one physical net.  Each keeps its own identity;
      // the net keeps one name and takes the first port's only when it has
      // none of its own, the same first-wins rule net merges use.
      if (!net.name) {
        const firstLabel = this.labelOf(pins[0].refdes);
        net.name = canonicalNetName(firstLabel?._text || pins[0].refdes);
      }
      return net;
    }
    const pin = pins[0];
    const label = this.labelOf(pin.refdes);
    if (preserveSource && !enforceName && net.name) {
      const raw = label?._text || '';
      // Older documents stored a compact net name alongside a formatted
      // interface label. Promote that authored source during load so the
      // label does not lose its subscript on the next synchronization.
      if (raw && /[_^]\{/.test(raw)
          && normalizeComponentRefdes(raw) === normalizeComponentRefdes(pin.refdes)
          && normalizeComponentRefdes(net.name) === normalizeComponentRefdes(pin.refdes)) {
        net.name = canonicalNetName(raw);
      }
    }
    if (enforceName || !net.name) {
      // Keep authored subscript markup on the physical name. Connectivity
      // still uses the component's compact refdes; net names are display
      // sources and may carry the same textbook markup as their pin label.
      const preferred = canonicalNetName(label?._text || pin.refdes);
      if (preferred && net.name !== preferred) net.name = preferred;
    } else if (normalizeComponentRefdes(net.name) !== pin.refdes
        && this._adoptNetNameAsPortIdentity(net, pin)) {
      // The net was renamed from the net side; that renames its sole port so
      // one identity remains.  When the name cannot be an identity the label
      // below falls back to the port's own, so it never shows another
      // component's name.
      return net;
    }
    const source = normalizeComponentRefdes(net.name) === normalizeComponentRefdes(pin.refdes)
      ? net.name
      : label?._text;
    const display = componentLabelText(pin.refdes, source);
    if (label && label._text !== display) {
      label._text = display;
      label.clearRenderedTextBounds();
    }
    return net;
  }

  /** Renaming a net renames the port that names it.  A name that cannot be a
   * component identity is kept by the net alone: the rename is never lost and
   * never silently duplicates another component's name. */
  _adoptNetNameAsPortIdentity(net, pin) {
    const source = canonicalNetName(net.name);
    const next = normalizeComponentRefdes(source);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(next) || this.components.has(next)) return false;
    this.renameComponent(pin.refdes, next, { displayLabel: source });
    return true;
  }

  /** Ordinary component instance labels are the presentation of the
 * component's canonical name, not independent child annotations. Editing
 * one therefore validates and renames the component atomically. Interface
 * pins take the same path: their label is their identity, and renaming the
 * component renames the net it names. */
  _syncComponentLabel(refdes, text) {
    const component = this.components.get(refdes);
    if (!component || isReferenceMarker(component)) return false;
    const next = normalizeComponentRefdes(text);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(next)) throw new Error(`invalid component name "${String(text).trim()}"`);
    this.renameComponent(refdes, next, { displayLabel: text });
    return true;
  }

  _syncReferenceMarkerLabel(refdes, text) {
    const component = this.components.get(refdes);
    if (!isReferenceMarker(component)) return false;
    const previous = referenceMarkerName(component);
    const next = canonicalNetName(text);
    const owned = this.labelOf(refdes);
    if (owned) owned.referenceLocal = true;
    component.value = next;
    for (const label of this.labels.values()) {
      if (label.owner === refdes && label._text !== next) {
        label._text = next;
        label.clearRenderedTextBounds();
      }
    }
    const info = referenceMarkerInfo(component.type);
    const net = this.netOfTerminal({ comp: refdes, term: info.terminal });
    if (net && next && net.name !== next) this.renameNet(net, next);
    else if (net && !next && previous && net.name === previous) this.renameNet(net, info.globalName);
    this.invalidateRoutingCache();
    return true;
  }

  _markReferenceLabelsLocal(netOrId) {
    const net = this._resolveNet(netOrId);
    for (const terminal of net.terminals) {
      const component = this.components.get(terminal.comp);
      if (!isReferenceMarker(component)) continue;
      const label = this.labelOf(component.refdes);
      if (label) label.referenceLocal = true;
    }
    return net;
  }

  _syncReferenceMarkerLabels(netOrId) {
    const net = this._resolveNet(netOrId);
    for (const terminal of net.terminals) {
      const component = this.components.get(terminal.comp);
      if (!isReferenceMarker(component) || !referenceMarkerName(component)) continue;
      const info = referenceMarkerInfo(component.type);
      if (terminal.term !== info.terminal) continue;
      component.value = net.name;
      for (const label of this.labels.values()) {
        if (label.owner === component.refdes) label._text = net.name;
      }
    }
    return net;
  }

  /** Name a marker-attached net only when it is currently unnamed.  The
   * marker's value is intentionally not used as a global reference when it is
   * non-empty: that is the explicit local-label escape hatch. */
  _syncReferenceMarkerNetName(netOrId) {
    const net = this._resolveNet(netOrId);
    if (net.name) return net;
    for (const terminal of net.terminals) {
      const component = this.components.get(terminal.comp);
      if (!isReferenceMarker(component)) continue;
      const info = referenceMarkerInfo(component.type);
      if (terminal.term !== info.terminal) continue;
      const name = referenceMarkerName(component) || info.globalName;
      if (name) {
        net.name = name;
        break;
      }
    }
    return net;
  }

  _isAutoReferenceName(net, name) {
    if (!net || !name) return false;
    return net.terminals.some((terminal) => {
      const component = this.components.get(terminal.comp);
      if (!isReferenceMarker(component) || referenceMarkerName(component)) return false;
      const info = referenceMarkerInfo(component.type);
      return terminal.term === info.terminal && isReferenceMarkerGlobalName(info, name);
    });
  }

  _defaultNetLabelSide(net, anchor) {
    const p = snapPoint(anchor?.x, anchor?.y);
    for (const path of net.paths()) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        if (!pointOnPath(p, [a, b])) continue;
        if (a.y === b.y) return 'above';
        if (a.x === b.x) return 'left';
      }
    }
    return 'above';
  }

  addNetLabel(netOrId, nameOrOpts = {}, maybeOpts = {}) {
    const net = this._resolveNet(netOrId);
    const opts = typeof nameOrOpts === 'string'
      ? { ...maybeOpts, text: nameOrOpts }
      : { ...(nameOrOpts || {}) };
    if (opts.id && this.labels.has(String(opts.id))) throw new Error(`label id "${opts.id}" already in use`);
    const requestedName = opts.name !== undefined ? opts.name : opts.text;
    const anchor = opts.anchor || { x: opts.x || 0, y: opts.y || 0 };
    const targetName = canonicalNetName(requestedName !== undefined ? requestedName : net.name);
    if (!targetName) throw new Error('net label requires a non-empty net name');
    if (!this._netLabelAnchorOnPath(net, anchor)) throw new Error('net label anchor must lie on a drawable net path');
    if (opts.text !== undefined || opts.name !== undefined) {
      this.renameNet(net, targetName);
    }
    const netSide = ['above', 'below', 'left', 'right'].includes(opts.netSide)
      ? opts.netSide
      : this._defaultNetLabelSide(net, anchor);
    return this.addLabel({ ...opts, text: net.name, name: undefined, owner: null, netId: net.id, netSide, offset: null, x: anchor.x, y: anchor.y, style: opts.style || { color: net.style.color } });
  }

  _netLabelAnchorOnPath(netOrId, point) {
    const net = this._resolveNet(netOrId);
    const p = snapPoint(point?.x, point?.y);
    return net.paths().some((path) => path.length >= 2 && pointOnPath(p, path));
  }

  _resolveNetLabel(labelOrId) {
    const label = typeof labelOrId === 'string' ? this.labels.get(labelOrId) : labelOrId;
    if (!label || !this.labels.has(label.id) || !label.netId) throw new Error(`unknown net label "${labelOrId?.id || labelOrId}"`);
    this._resolveNet(label.netId);
    return label;
  }

  renameNetLabel(labelOrId, name) {
    const label = this._resolveNetLabel(labelOrId);
    return this.renameNet(label.netId, name);
  }

  convertLabelToNet(labelOrId, netOrId) {
    this.invalidateRoutingCache();
    const label = typeof labelOrId === 'string' ? this.labels.get(labelOrId) : labelOrId;
    if (!label || !this.labels.has(label.id)) throw new Error(`unknown label "${labelOrId?.id || labelOrId}"`);
    const net = this._resolveNet(netOrId);
    if (!net.name) throw new Error('net label requires a non-empty net name');
    const world = label.anchorWorld();
    if (!this._netLabelAnchorOnPath(net, world)) throw new Error('net label anchor must lie on a drawable net path');
    label.owner = null;
    label.offset = null;
    label.anchor = snapPoint(world.x, world.y);
    label.setNetId(net.id);
    label._text = net.name;
    return label;
  }

  convertNetLabelToAnnotation(labelOrId, text = null) {
    this.invalidateRoutingCache();
    const label = this._resolveNetLabel(labelOrId);
    const value = text === null || text === undefined ? label.text : String(text);
    label.setNetId(null);
    label.owner = null;
    label.offset = null;
    label._text = value;
    return label;
  }

  retargetNetLabel(labelOrId, netOrId) {
    return this.convertLabelToNet(labelOrId, netOrId);
  }

  netLabels(netOrId) {
    const net = this._resolveNet(netOrId);
    return [...this.labels.values()].filter((label) => label.netId === net.id);
  }

  _retargetNetLabels(fromNetId, toNetId) {
    for (const label of this.labels.values()) if (label.netId === fromNetId) label.setNetId(toNetId);
  }

  logicalNetGroup(name) {
    const wanted = canonicalNetName(name);
    if (!wanted) return { name: '', netIds: [], nets: [], terminals: [], labels: [] };
    const nets = [...this.nets.values()].filter((net) => canonicalNetName(net.name) === wanted);
    return {
      name: wanted,
      netIds: nets.map((net) => net.id),
      nets,
      terminals: nets.flatMap((net) => net.terminals.map((t) => ({ ...t, netId: net.id }))),
      labels: [...this.labels.values()].filter((label) => label.netId && nets.some((net) => net.id === label.netId)),
    };
  }

  logicalNetGroups() {
    const names = [...new Set([...this.nets.values()].map((net) => canonicalNetName(net.name)).filter(Boolean))];
    return names.map((name) => this.logicalNetGroup(name));
  }

  namedNetGroups() {
    return this.logicalNetGroups();
  }

  logicalNetOf(ref) {
    const net = typeof ref === 'string' && this.nets.has(ref)
      ? this.nets.get(ref)
      : typeof ref === 'object' && ref?.id && this.nets.has(ref.id)
        ? this.nets.get(ref.id)
        : typeof ref === 'string' && ref.includes('.')
          ? this.netOfTerminal(ref)
          : null;
    return net?.name ? this.logicalNetGroup(net.name) : null;
  }

  logicallyConnected(a, b) {
    const resolve = (value) => {
      if (typeof value === 'string' && this.nets.has(value)) return this.nets.get(value);
      if (value?.id && this.nets.has(value.id)) return this.nets.get(value.id);
      if (typeof value === 'string' && value.includes('.')) return this.netOfTerminal(value);
      return null;
    };
    const left = resolve(a);
    const right = resolve(b);
    if (!left || !right) return false;
    return left === right || (!!left.name && canonicalNetName(left.name) === canonicalNetName(right.name));
  }

  areLogicallyConnected(a, b) {
    return this.logicallyConnected(a, b);
  }

  removeLabel(id) {
    this.invalidateRoutingCache();
    const key = typeof id === 'string' ? id : id?.id;
    const owner = this.labels.get(key)?.owner;
    const removed = this.labels.delete(key);
    if (removed) {
      for (const [childId, label] of this.labels) if (label.parent === key) this.labels.delete(childId);
      const marker = owner ? this.components.get(owner) : null;
      if (isReferenceMarker(marker) && !this.labelOf(marker.refdes)) this._clearReferenceMarkerName(marker);
    }
    return removed;
  }

  /** Deleting a marker's owned label drops its local-rail identity: the value
   * must go with it (an orphaned value renders as legacy marker text), and the
   * net returns to the global rail name the label had taken it away from. */
  _clearReferenceMarkerName(component) {
    const previous = canonicalNetName(component.value);
    component.value = '';
    if (!previous) return;
    const info = referenceMarkerInfo(component.type);
    const net = this.netOfTerminal({ comp: component.refdes, term: info.terminal });
    if (!net || net.name !== previous) return;
    // Another local marker or an explicit net label still owns this name.
    if (this.netLabels(net).length) return;
    if (net.terminals.some(({ comp, term }) => {
      const other = this.components.get(comp);
      return other !== component && isReferenceMarker(other) &&
        term === referenceMarkerInfo(other.type).terminal && referenceMarkerName(other);
    })) return;
    this.renameNet(net, info.globalName);
  }

  /** The instance label owned by a component, if any. */
  labelOf(refdes) {
    for (const l of this.labels.values()) if (l.owner === refdes) return l;
    return null;
  }

  // ----- connectivity -------------------------------------------------

  /** Outward pin direction honoring the terminal's explicit `dir` (via the
   *  transform), falling back to the bbox-centre heuristic — matches the editor. */
  _pinDir(c, t, wx, wy) {
    if (t.dir) {
      const d = applyDir(c.transform, t.dir.x, t.dir.y);
      if (d.x !== 0 || d.y !== 0) return d;
    }
    const r = c.bboxWorld();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const ndx = r.w === 0 ? 0 : (wx - cx) / (r.w / 2);
    const ndy = r.h === 0 ? 0 : (wy - cy) / (r.h / 2);
    if (Math.abs(ndx) >= Math.abs(ndy)) return { x: Math.sign(ndx), y: 0 };
    return { x: 0, y: Math.sign(ndy) };
  }

  /** Routing environment for a net's default route: component bboxes + pins
   *  (labels are soft obstacles: they steer the route but never block it).
   *  `gatePassages` contains only same-net MOS gate axes when at least two
   *  gates participate, allowing the intentional shared-gate body crossing.
   *  `excludeNetId` (or a Set of ids being re-laid-out) is NOT included in
   *  `wires` — its old branches are about to be replaced and must not act as
   *  obstacles — but every OTHER net's explicit wire geometry is, so a fresh
   *  layout never lies collinearly on top of another net's wire (crossing
   *  stays legal). */
  _netEnv(excludeNetId = null) {
    const key = excludeNetId instanceof Set ? [...excludeNetId].sort().join(',') : excludeNetId || '';
    const cached = this._routingEnvCache.get(key);
    if (cached) return cached;
    const excluded = excludeNetId instanceof Set
      ? excludeNetId
      : excludeNetId == null ? new Set() : new Set([excludeNetId]);
    const rects = [];
    const pins = new Map();
    const pinRects = new Map();
    const gateCandidates = [];
    const gateCounts = new Map();
    for (const c of this.components.values()) {
      if (c.type === 'solder') continue;
      const body = c.bboxWorld();
      rects.push(body);
      for (const t of c.terminalDefs) {
        const w = c.terminalWorld(t.name);
        pins.set(`${w.x},${w.y}`, this._pinDir(c, t, w.x, w.y));
        const key = `${w.x},${w.y}`;
        if (!pinRects.has(key)) pinRects.set(key, []);
        pinRects.get(key).push(body);
      }
      const gate = c.terminalDefs.find((t) => t.direction === 'gate');
      if (gate) {
        const point = c.terminalWorld(gate.name);
        const gateNet = this.netOfTerminal({ comp: c.refdes, term: gate.name });
        const netId = gateNet?.id || null;
        if (netId) gateCounts.set(netId, (gateCounts.get(netId) || 0) + 1);
        gateCandidates.push({ netId, rect: body, point, dir: this._pinDir(c, gate, point.x, point.y) });
      }
    }
    const gatePassages = gateCandidates.filter((candidate) =>
      candidate.netId && excluded.has(candidate.netId) && gateCounts.get(candidate.netId) >= 2
    );
    const wires = [];
    for (const n of this.nets.values()) {
      if (excluded.has(n.id)) continue;
      wires.push(...this._explicitBranches(n));
    }
    const labelRects = [];
    for (const l of this.labels.values()) {
      // Shape annotations are visual-only and must not influence routing.
      if (['arrow', 'box', 'line'].includes(l.kind)) continue;
      // The net being re-laid-out may pass through its own label. Other net
      // labels remain soft obstacles just like free annotations.
      if (l.isNetLabel() && excluded.has(l.netId)) continue;
      labelRects.push(l.bbox());
    }
    const env = { rects, pins, pinRects, gatePassages, wires, labelRects };
    this._routingEnvCache.set(key, env);
    return env;
  }

  /** Routing environment that also treats every existing wire as an obstacle
   *  (collinear overlap is forbidden, crossing is allowed). Used when routing a
   *  new branch so it never runs along an existing wire. */
  _routingEnv(excludeNetId = null) {
    const env = this._netEnv(excludeNetId);
    const excluded = excludeNetId instanceof Set
      ? excludeNetId
      : excludeNetId == null ? new Set() : new Set([excludeNetId]);
    const wires = [];
    for (const n of this.nets.values()) {
      if (excluded.has(n.id)) continue;
      wires.push(...this._explicitBranches(n));
    }
    return { ...env, wires };
  }

  /** Re-route a net, preserving hand-drawn wire shapes. `moved` (optional) is a
   *  Map of refdes -> {dx,dy} for components that just moved: polylines whose
   *  endpoint terminals share one move delta slide with it (manual loops are
   *  kept), one-end-moved legs get re-anchored at the new pin with their drawn
   *  body intact, and untouched polylines stay byte-identical. Routes that were
   *  never hand-drawn are laid out fresh. This is the general-purpose router —
   *  no symbol- or net-type special cases. Returns false when no safe route can
   *  be installed; failed component edits are rolled back by the model. */
  rerouteNet(net, moved = null) {
    this.invalidateRoutingCache();
    if (net.routingMode === 'fixed') {
      this._rerouteFixedNet(net, moved);
      this._repairNetLabels(net);
      this._completeComponentEdit(net.id);
      return true;
    }
    const env = this._netEnv(net.id);
    const anchors = net.anchorWorlds();
    // A non-translation transform (rotate/mirror) relocates terminals in a way
    // the drawn body cannot follow; lay the net out fresh from its terminals.
    if (moved === 'refresh') {
      const previous = {
        branches: net.branches?.map((p) => clonePath(p, net.allowDiagonal)) || null,
        route: net.route?.length >= 2 ? clonePath(net.route, net.allowDiagonal) : null,
        junctions: net.junctions.map((p) => ({ ...p })),
      };
      net.branches = null;
      net.route = null;
      net.junctions = []; // Fresh layout starts from terminal anchors only.
      if (!this._layoutFresh(net, anchors, env)) {
        // A refresh is allowed to fail, but it must never erase a route that
        // was already valid merely because the new layout is unroutable.
        net.branches = previous.branches;
        net.route = previous.route;
        net.junctions = previous.junctions;
        return this._rerouteFailure(net, moved);
      }
      this._repairNetLabels(net);
      this._completeComponentEdit(net.id);
      return true;
    }
    // A complete same-delta set move is a rigid translation, including
    // junction-ending branches whose second endpoint cannot be classified as
    // a component terminal. Its clearance from every moved component is
    // invariant, so validate only against stationary component bodies before
    // installing; failures retain the existing component-edit rollback.
    if (moved instanceof Map && moved.size > 0 && net.terminals.length > 0) {
      let delta = null;
      let rigid = true;
      for (const terminal of net.terminals) {
        const terminalDelta = moved.get(terminal.comp);
        if (!terminalDelta) {
          rigid = false;
          break;
        }
        if (!delta) delta = terminalDelta;
        else if (delta.dx !== terminalDelta.dx || delta.dy !== terminalDelta.dy) {
          rigid = false;
          break;
        }
      }
      const hasGeometry = !!(net.branches?.length || net.route?.length || net.junctions.length);
      if (rigid && delta && hasGeometry) {
        const translatePath = (path) => path?.map((p) => ({
          x: p.x + delta.dx,
          y: p.y + delta.dy,
        })) || null;
        const branches = net.branches?.map(translatePath) || null;
        const route = translatePath(net.route);
        const translatedPaths = [...(branches || []), ...(route ? [route] : [])];
        const rigidEnv = {
          ...env,
          rects: [...this.components.values()]
            .filter((component) => component.type !== 'solder' && !moved.has(component.refdes))
            .map((component) => component.bboxWorld()),
        };
        if (translatedPaths.some((path) => !automaticMovePathSafe(path, rigidEnv))) {
          return this._rerouteFailure(net, moved);
        }
        net.branches = branches;
        net.route = route;
        net.junctions = net.junctions.map((p) => ({
          x: p.x + delta.dx,
          y: p.y + delta.dy,
        }));
        this._repairNetLabels(net);
        this._completeComponentEdit(net.id);
        return true;
      }
    }
    // Partial set moves preserve unselected-side wire bodies and re-anchor
    // only their boundary legs. Branches wholly inside the moved set translate
    // in _reroutePolyline when both endpoint terminals share one delta.
    if (net.branches && net.branches.length) {
      const rerouted = net.branches.map((b) => this._reroutePolyline(net, b, moved, env));
      if (rerouted.some((b) => !b)) {
        return this._rerouteFailure(net, moved);
      }
      net.branches = rerouted.map((p) => clonePath(p, net.allowDiagonal));
      net.route = net.branches[0] ? clonePath(net.branches[0], net.allowDiagonal) : null;
      if (moved && moved.size > 0) this._pruneDanglingBranches(net);
      this._repairNetLabels(net);
      this._completeComponentEdit(net.id);
      return true;
    }
    if (net.route && net.route.length >= 2) {
      const rerouted = this._reroutePolyline(net, net.route, moved, env);
      if (!rerouted) {
        return this._rerouteFailure(net, moved);
      }
      net.route = clonePath(rerouted, net.allowDiagonal);
      if (moved && moved.size > 0) this._pruneDanglingBranches(net);
      this._repairNetLabels(net);
      this._completeComponentEdit(net.id);
      return true;
    }
    // A one-terminal net may own a deliberate wire stub. Never erase that
    // geometry merely because it has no second electrical endpoint yet.
    if (anchors.length < 2) {
      this._repairNetLabels(net);
      this._completeComponentEdit(net.id);
      return true;
    }
    // No drawn shape to preserve: lay out fresh from the anchors.
    const laidOut = this._layoutFresh(net, anchors, env);
    if (!laidOut) return this._rerouteFailure(net, moved);
    this._repairNetLabels(net);
    this._completeComponentEdit(net.id);
    return true;
  }

  /** Lay a net out from its terminals without consulting any existing route. */
  _layoutFresh(net, anchors, env) {
    // Coincident terminals are electrically connected at the shared point;
    // they need no drawn branch (and cannot be routed through overlapping
    // bodies). Keep the membership while recording the degenerate anchor.
    if (anchors.length > 1 && anchors.every((p) => p.x === anchors[0].x && p.y === anchors[0].y)) {
      net.route = [{ ...anchors[0] }];
      net.branches = null;
      return true;
    }
    if (net.junctions.length) {
      const path = [{ ...anchors[0] }];
      for (let i = 1; i < anchors.length; i++) {
        const seg = smartRoute(path[path.length - 1], anchors[i], env);
        if (!seg || seg.length < 2) return false;
        for (let k = 1; k < seg.length; k++) path.push({ ...seg[k] });
      }
      collapseCollinear(path);
      net.route = path.slice();
      net.branches = [net.route.slice()];
      return true;
    } else if (anchors.length === 2) {
      const route = smartRoute(anchors[0], anchors[1], env);
      if (!route || (route.length < 2 &&
          (anchors[0].x !== anchors[1].x || anchors[0].y !== anchors[1].y))) return false;
      net.route = route;
      net.branches = null;
      return true;
    } else {
      // 3+ terminal net with no explicit junction: store the balanced T-junction
      // as multiple branches (external → junction → each pair terminal) so the
      // renderer draws a clean centered T and the junction solder lands at the
      // shared point. One polyline instead would wind through all three arms.
      const paths = steinerBranches(anchors, env);
      if (!paths || paths.length === 0) return false;
      net.branches = paths.map((p) => clonePath(p, net.allowDiagonal));
      net.route = paths[0] ? clonePath(paths[0], net.allowDiagonal) : null;
      net.junctions = this._netJunctions(net, paths);
      return true;
    }
  }

  /** Repair only anchored endpoints of a protected path. A rigid set move is
   * special: all fixed geometry translates with the moved terminals, including
   * unanchored interior points and any manually retained free paths. */
  _rerouteFixedNet(net, moved = null) {
    if (!net.fixedPaths.length) return;
    if (moved && moved !== 'refresh' && moved.size > 0 && net.terminals.length > 0) {
      let delta = null;
      let rigid = true;
      for (const t of net.terminals) {
        const d = moved.get(t.comp);
        if (!d) { rigid = false; break; }
        if (!delta) delta = d;
        else if (delta.dx !== d.dx || delta.dy !== d.dy) { rigid = false; break; }
      }
      if (rigid && delta) {
        net.fixedPaths = net.fixedPaths.map((entry) => ({
          points: Net.fixedPathEntry({
            points: entry.points.map((p) => ({ x: p.x + delta.dx, y: p.y + delta.dy })),
            start: entry.start,
            end: entry.end,
          }, false).points,
          start: entry.start ? { ...entry.start } : null,
          end: entry.end ? { ...entry.end } : null,
        }));
        net.junctions = net.junctions.map((p) => ({ x: p.x + delta.dx, y: p.y + delta.dy }));
        return;
      }
    }
    net.fixedPaths = net.fixedPaths.map((entry) => {
      const points = entry.points.map((p) => ({ ...p }));
      if (entry.start && points.length) {
        const c = this.components.get(entry.start.comp);
        if (c) points[0] = c.terminalWorld(entry.start.term);
      }
      if (entry.end && points.length) {
        const c = this.components.get(entry.end.comp);
        if (c) points[points.length - 1] = c.terminalWorld(entry.end.term);
      }
      return { ...entry, points: Net.fixedPathEntry({ points, start: entry.start, end: entry.end }, false).points };
    });
  }

  /** Undo a committed translation when rerouting its attached wire fails. */
  _rollbackMovedComponents(moved) {
    if (!(moved instanceof Map)) return;
    for (const [refdes, delta] of moved) {
      const c = this.components.get(refdes);
      if (!c || !delta) continue;
      c.transform.x -= delta.dx;
      c.transform.y -= delta.dy;
    }
    this.invalidateRoutingCache();
  }

  _rerouteFailure(net, moved) {
    if (this._componentEdit?.pending.has(net.id)) this._rollbackComponentEdit();
    else this._rollbackMovedComponents(moved);
    return false;
  }

  /** Re-anchor one drawn polyline after a component move (see rerouteNet). */
  _reroutePolyline(net, poly, moved, env) {
    if (!poly || poly.length < 2) return poly;
    const n = poly.length;
    const classify = (p) => {
      if (!moved) return null;
      for (const [refdes, delta] of moved) {
        const c = this.components.get(refdes);
        if (!c) continue;
        for (const t of c.terminalDefs) {
          const cur = c.terminalWorld(t.name);
          const old = { x: cur.x - delta.dx, y: cur.y - delta.dy };
          if (Math.abs(p.x - old.x) <= 1 && Math.abs(p.y - old.y) <= 1) return { refdes, cur, delta };
        }
      }
      return null;
    };
    const a0 = classify(poly[0]);
    const a1 = classify(poly[n - 1]);
    // Re-anchoring one end of an explicitly authored path may retain its
    // pre-existing clearance choices.  Keep the long-standing body-drill
    // guard for that case; complete one-cell validation is reserved for paths
    // translated as an automatic set-move candidate below.
    const safeCandidate = (candidate) => candidate && candidate.every((p, i) => i === 0 ||
      !env.rects.some((rect) =>
        segThroughInterior(candidate[i - 1], p, rect) &&
        !gateBodyCrossingAllowed(candidate[i - 1], p, rect, env))) ? candidate : null;
    if (a0 && a1 && a0.delta.dx === a1.delta.dx && a0.delta.dy === a1.delta.dy) {
      // Both endpoint terminals share one move delta: slide the whole drawn
      // body even when the terminals belong to different components.
      const translated = poly.map((p) => ({ x: p.x + a0.delta.dx, y: p.y + a0.delta.dy }));
      return automaticMovePathSafe(translated, env) ? translated : null;
    }
    // Diagonal segments are authored geometry and protected one by one: the
    // autorouter never replaces them. When a moved pin's own leg is diagonal,
    // its end follows the pin (stretching the segment) if that stays clear of
    // component bodies; otherwise the segment stays put and an orthogonal
    // connector joins the pin to its old end. Orthogonal legs below are
    // re-anchored like any managed wire.
    const endpointLeg = (oldEnd, bodyEnd, currentEnd, atStart) => {
      if (isDiagonalSegment(oldEnd, bodyEnd)) {
        const stretched = atStart ? [{ ...currentEnd }, { ...bodyEnd }] : [{ ...bodyEnd }, { ...currentEnd }];
        if (safeCandidate(stretched)) return stretched;
        const connector = atStart ? smartRoute(currentEnd, oldEnd, env) : smartRoute(oldEnd, currentEnd, env);
        if (!connector) return null;
        return atStart ? [...connector, { ...bodyEnd }] : [{ ...bodyEnd }, ...connector];
      }
      const staysVertical = oldEnd.x === bodyEnd.x && currentEnd.x === bodyEnd.x;
      const staysHorizontal = oldEnd.y === bodyEnd.y && currentEnd.y === bodyEnd.y;
      if (staysVertical || staysHorizontal) {
        const direct = atStart
          ? [{ ...currentEnd }, { ...bodyEnd }]
          : [{ ...bodyEnd }, { ...currentEnd }];
        return automaticMovePathSafe(direct, env) ? direct : null;
      }
      return atStart
        ? smartRoute(currentEnd, bodyEnd, env)
        : smartRoute(bodyEnd, currentEnd, env);
    };
    if (a0 && a1) {
      // The endpoint terminals moved by different deltas. Re-anchor only the
      // two terminal legs, retaining the authored body between them.
      if (poly.length > 2) {
        const start = endpointLeg(poly[0], poly[1], a0.cur, true);
        const end = endpointLeg(poly[n - 1], poly[n - 2], a1.cur, false);
        if (!start || !end) return null;
        return [...start.slice(0, -1), ...poly.slice(1, -1), ...end];
      }
      if (isDiagonalSegment(poly[0], poly[1])) {
        const stretched = safeCandidate([{ ...a0.cur }, { ...a1.cur }]);
        if (stretched) return stretched;
        const start = smartRoute(a0.cur, poly[0], env);
        const end = smartRoute(poly[1], a1.cur, env);
        return start && end ? [...start, ...end] : null;
      }
      const leg = smartRoute({ x: a0.cur.x, y: a0.cur.y }, { x: a1.cur.x, y: a1.cur.y }, env);
      // A failed route must not be replaced with a straight segment: that
      // segment may pass through a component body. Signal failure without
      // changing the caller's copy of the last valid wire shape.
      return leg && leg.length >= 1 ? leg : null;
    }
    if (a0) {
      // If the moved pin remains on the old leg's axis, stretch or shrink that
      // leg directly. Otherwise route a minimum safe connector to the body.
      const leg = endpointLeg(poly[0], poly[1], a0.cur, true);
      if (!leg || leg.length < 1) return null;
      const out = [...leg, ...poly.slice(1)];
      collapseCollinear(out);
      return safeCandidate(out);
    }
    if (a1) {
      // The path is stored in start-to-end order. Keep a collinear boundary
      // leg straight; otherwise route forward from its old body endpoint.
      const leg = endpointLeg(poly[n - 1], poly[n - 2], a1.cur, false);
      if (!leg || leg.length < 1) return null;
      const out = [...poly.slice(0, n - 2), ...leg];
      collapseCollinear(out);
      return safeCandidate(out);
    }
    return poly.map((p) => ({ ...p }));
  }

  /** Defensive prune of wire geometry that floats free at one end. After a set
   *  drag / partial re-anchor a branch may end at a stale grid point that is
   *  neither a terminal, a mid-wire junction anchor, nor a shared vertex; such
   *  a stub leads nowhere and must be dropped. A branch endpoint is "attached"
   *  when it is a terminal world point, a net junction anchor, or a point
   *  shared by >= 2 branches. Only called after an actual component move (a
   *  non-empty `moved` map); wire-run drags never invoke it. Nets with fewer
   *  than 2 terminals are left alone (the deliberate one-terminal wire stub
   *  keeps its geometry), and for valid nets this is a no-op. */
  _pruneDanglingBranches(net) {
    if (net.terminals.length < 2) return;
    const paths = net.branches && net.branches.length
      ? net.branches
      : net.route && net.route.length >= 2 ? [net.route] : [];
    if (paths.length === 0) return;
    const terminalKeys = new Set(
      net.terminals
        .map((t) => this.components.get(t.comp)?.terminalWorld(t.term))
        .filter(Boolean)
        .map((p) => `${p.x},${p.y}`)
    );
    const junctionKeys = new Set(net.junctions.map((p) => `${p.x},${p.y}`));
    // Occurrences of a point across branches: an endpoint shared by >= 2
    // branches is a junction vertex even when it is not a terminal.
    const countAt = (p) => {
      let n = 0;
      for (const b of paths) if (b.some((q) => q.x === p.x && q.y === p.y)) n++;
      return n;
    };
    const attached = (p) => terminalKeys.has(`${p.x},${p.y}`) || junctionKeys.has(`${p.x},${p.y}`) || countAt(p) >= 2;
    const kept = paths.filter((b) => attached(b[0]) && attached(b[b.length - 1]));
    if (kept.length === paths.length) return;
    if (kept.length === 0) {
      net.branches = null;
      net.route = null;
      net.junctions = [];
      return;
    }
    net.branches = kept.map((p) => clonePath(p, net.allowDiagonal));
    net.route = clonePath(kept[0], net.allowDiagonal);
    net.junctions = this._netJunctions(net, kept);
  }

  resolveTerm(ref) {
    const { comp, term } = typeof ref === 'string' ? parseTermRef(ref) : ref;
    const c = this.getComponent(comp);
    c.localTerminal(term);
    return { comp, term };
  }

  /** Net whose terminal list contains the given terminal, if any. */
  netOfTerminal(ref) {
    const { comp, term } = typeof ref === 'string' ? parseTermRef(ref) : ref;
    for (const net of this.nets.values()) {
      if (net.terminals.some((t) => t.comp === comp && t.term === term)) return net;
    }
    return null;
  }

  _createNet(name) {
    this.invalidateRoutingCache();
    const net = new Net(this, { name });
    this._netId += 1;
    net.id = `N${this._netId}`;
    this.nets.set(net.id, net);
    return net;
  }

  /** Public factory for editor-created geometric wire islands.  In particular,
   * this is the supported way for the UI to create a zero-terminal net; callers
   * must not assign Net internals and thereby bypass serialization invariants. */
  createWireNet(opts = {}) {
    this.invalidateRoutingCache();
    const net = new Net(this, {
      id: opts.id,
      name: opts.name,
      style: opts.style,
      drawOrder: opts.drawOrder,
      wireStyles: opts.wireStyles,
      routingMode: opts.routingMode,
      allowDiagonal: opts.allowDiagonal,
      route: opts.route,
      branches: opts.branches,
      junctions: opts.junctions,
      fixedPaths: opts.fixedPaths,
      preserveEmpty: opts.preserveEmpty !== false,
    });
    this._netId += 1;
    if (!opts.id) net.id = `N${this._netId}`;
    else {
      const num = parseInt(String(net.id).replace(/\D/g, ''), 10) || 0;
      if (num > this._netId) this._netId = num;
    }
    if (this.nets.has(net.id)) throw new Error(`net id "${net.id}" already in use`);
    this.nets.set(net.id, net);
    return net;
  }

  createNet(opts = {}) { return this.createWireNet(opts); }

  /** Collapse accidental duplicate terminal memberships without routing any
   * geometry. Used after batched imports where coincidence must be resolved
   * only after all copied nets have been installed. */
  ensureUniqueTerminals(refs = null) {
    const wanted = refs ? new Set(refs) : null;
    const owners = new Map();
    const memberships = new Map();
    for (const net of this.nets.values()) for (const t of net.terminals) {
      if (wanted && !wanted.has(t.comp)) continue;
      const key = `${t.comp}.${t.term}`;
      if (!memberships.has(key)) memberships.set(key, []);
      if (!memberships.get(key).includes(net)) memberships.get(key).push(net);
    }
    for (const nets of memberships.values()) if (nets.length > 1) this._mergeNameConflict(nets);
    for (const net of [...this.nets.values()]) {
      for (const t of [...net.terminals]) {
        if (wanted && !wanted.has(t.comp)) continue;
        const key = `${t.comp}.${t.term}`;
        const prior = owners.get(key);
        if (!prior || prior === net) { owners.set(key, net); continue; }
        const fixed = prior.routingMode === 'fixed' || net.routingMode === 'fixed';
        if (!fixed) prior.allowDiagonal = prior.allowDiagonal || net.allowDiagonal;
        const entries = [...this._fixedPathEntries(prior), ...this._fixedPathEntries(net)];
        const members = [...prior.terminals, ...net.terminals];
        this._mergeNets(prior, [net], members);
        if (fixed) this._setFixedPaths(prior, entries, [...prior.junctions, ...net.junctions]);
        else {
          const paths = [...prior.paths(), ...net.paths()];
          prior.branches = paths.length ? paths.map((p) => clonePath(p, prior.allowDiagonal)) : null;
          prior.route = prior.branches?.[0] ? clonePath(prior.branches[0], prior.allowDiagonal) : null;
          prior.junctions = this._netJunctions(prior, paths);
        }
        owners.set(key, prior);
      }
    }
    this.syncJunctionSolders();
    return this;
  }

  /** Attach exactly one endpoint of a geometric net.  A wire target must carry
   * its net/path/segment identity and an exact point on that segment; a crossing
   * elsewhere is not an attachment.  Fixed geometry is promoted/merged as fixed
   * geometry so no autorouter or reducer can rewrite a deliberately authored path. */
  attachWireEndpoint(netOrId, pathIndex, endpointIndex, target) {
    const net = typeof netOrId === 'string' ? this.nets.get(netOrId) : netOrId;
    if (!net) throw new Error('unknown wire net');
    net.preserveEmpty = true;
    const paths = net.paths();
    const path = paths[pathIndex];
    if (!path || ![0, path.length - 1].includes(endpointIndex)) throw new Error('wire endpoint must be a path endpoint');
    let targetNet = null;
    let targetPoint = null;
    let terminal = null;
    let targetIsInterior = false;
    if (typeof target === 'string' || (target && target.comp && target.term)) {
      terminal = this.resolveTerm(target);
      targetPoint = this.getComponent(terminal.comp).terminalWorld(terminal.term);
      targetNet = this.netOfTerminal(terminal);
    } else if (target && target.netId !== undefined && target.pathIndex !== undefined && target.segmentIndex !== undefined && target.point) {
      targetNet = this.nets.get(target.netId);
      if (!targetNet) throw new Error(`unknown wire target net "${target.netId}"`);
      const targetPaths = targetNet.paths();
      const targetPath = targetPaths[target.pathIndex];
      const targetPointRaw = target.point;
      if (!targetPath || !Number.isInteger(target.segmentIndex) || target.segmentIndex <= 0 || target.segmentIndex >= targetPath.length ||
          !Number.isFinite(targetPointRaw.x) || !Number.isFinite(targetPointRaw.y) ||
          targetPointRaw.x !== snap(targetPointRaw.x) || targetPointRaw.y !== snap(targetPointRaw.y)) {
        throw new Error('wire attachment target identity is invalid');
      }
      targetPoint = { x: targetPointRaw.x, y: targetPointRaw.y };
      const a = targetPath[target.segmentIndex - 1];
      const b = targetPath[target.segmentIndex];
      if (!pointOnPath(targetPoint, [a, b])) throw new Error('wire attachment target is not on the selected segment');
      // Extending this same path can make a preselected interior target its
      // new endpoint before attachment. Preserve that pre-mutation intent.
      targetIsInterior = target.interior === true || !((targetPoint.x === targetPath[0].x && targetPoint.y === targetPath[0].y) ||
        (targetPoint.x === targetPath.at(-1).x && targetPoint.y === targetPath.at(-1).y));
    } else throw new Error('wire attachment must target an existing wire with explicit identity or a terminal');

    const landed = path[endpointIndex];
    if (!landed || landed.x !== targetPoint.x || landed.y !== targetPoint.y) {
      throw new Error('wire endpoint is not exactly landed on the attachment target');
    }

    if (targetNet === net) {
      if (terminal && !net.terminals.some((t) => t.comp === terminal.comp && t.term === terminal.term)) net.terminals.push(terminal);
      targetPoint = targetPoint || path[endpointIndex];
      this._replaceWireEndpoint(net, pathIndex, endpointIndex, targetPoint, terminal);
      if (!terminal && targetIsInterior && !net.junctions.some((p) => p.x === targetPoint.x && p.y === targetPoint.y)) {
        net.junctions.push({ ...targetPoint });
      }
      this._syncInterfacePinLabels(net, { enforceName: true });
      this.syncJunctionSolders();
      return net;
    }
    // Attaching a floating managed island to an otherwise unconnected terminal
    // does not require promotion; retain its explicit orthogonal geometry.
    if (!targetNet && terminal) {
      if (!net.terminals.some((t) => t.comp === terminal.comp && t.term === terminal.term)) net.terminals.push({ ...terminal });
      this._replaceWireEndpoint(net, pathIndex, endpointIndex, targetPoint, terminal);
      this._syncInterfacePinLabels(net, { enforceName: true });
      return net;
    }
    const sourceEntries = this._fixedPathEntries(net);
    const targetEntries = targetNet ? this._fixedPathEntries(targetNet) : [];
    if (targetNet && targetNet !== net) this._mergeNameConflict([net, targetNet], { allowConflict: true });
    const allEntries = [...targetEntries, ...sourceEntries];
    const members = [...(targetNet?.terminals || []), ...(net.terminals || [])];
    if (terminal) members.push(terminal);
    const unique = [];
    for (const t of members) if (!unique.some((q) => q.comp === t.comp && q.term === t.term)) unique.push({ ...t });
    const sourceEntry = allEntries[targetEntries.length + pathIndex];
    if (sourceEntry) {
      sourceEntry.points[endpointIndex === 0 ? 0 : sourceEntry.points.length - 1] = { ...targetPoint };
      if (endpointIndex === 0) sourceEntry.start = terminal || null;
      else sourceEntry.end = terminal || null;
    }
    const keep = targetNet || net;
    keep.allowDiagonal = keep.allowDiagonal || net.allowDiagonal || !!targetNet?.allowDiagonal;
    if (targetNet && targetNet !== net) this._mergeNets(keep, [net], unique, { allowNameConflict: true });
    else keep.terminals = unique;
    const fixedMerge = net.routingMode === 'fixed' || targetNet?.routingMode === 'fixed';
    const mergedJunctions = [...(targetNet?.junctions || []), ...(net.junctions || []), ...(terminal || !targetIsInterior ? [] : [targetPoint])];
    if (fixedMerge) this._setFixedPaths(keep, allEntries, mergedJunctions);
    else {
      const paths = allEntries.flatMap((entry, index) => {
        if (!terminal && index < targetEntries.length) {
          const split = splitBranchAt(entry.points, targetPoint, keep.allowDiagonal);
          if (split) return split;
        }
        return [clonePath(entry.points, keep.allowDiagonal)];
      });
      keep.branches = paths;
      keep.route = paths[0] ? clonePath(paths[0], keep.allowDiagonal) : null;
      keep.junctions = this._netJunctions(keep, paths);
      if (!terminal && !keep.junctions.some((p) => p.x === targetPoint.x && p.y === targetPoint.y)) {
        keep.junctions.push({ ...targetPoint });
      }
    }
    this._syncInterfacePinLabels(keep, { enforceName: true });
    this.syncJunctionSolders();
    return keep;
  }

  attachFragmentEndpoint(...args) { return this.attachWireEndpoint(...args); }
  attachNetEndpoint(...args) { return this.attachWireEndpoint(...args); }

  _replaceWireEndpoint(net, pathIndex, endpointIndex, point, terminal = null) {
    this.invalidateRoutingCache();
    if (net.routingMode === 'fixed') {
      const entry = net.fixedPaths[pathIndex];
      if (!entry) return;
      entry.points[endpointIndex === 0 ? 0 : entry.points.length - 1] = { ...point };
      if (endpointIndex === 0) entry.start = terminal ? { ...terminal } : entry.start;
      else entry.end = terminal ? { ...terminal } : entry.end;
      this._sanitizeFixedAnchors(net);
      return;
    }
    const source = net.branches && net.branches.length ? net.branches : net.route ? [net.route] : [];
    if (!source[pathIndex]) return;
    source[pathIndex][endpointIndex === 0 ? 0 : source[pathIndex].length - 1] = { ...point };
    net.branches = source.map((p) => clonePath(p, net.allowDiagonal));
    net.route = clonePath(net.branches[0], net.allowDiagonal);
    if (terminal && !net.terminals.some((t) => t.comp === terminal.comp && t.term === terminal.term)) net.terminals.push({ ...terminal });
    net.junctions = this._netJunctions(net, net.branches);
    this._reduceNet(net);
    this.syncJunctionSolders();
  }

  /** Snapshot managed/fixed net topology before a compound operation.  Net
   * objects are retained so callers holding a net reference see the rollback,
   * while the map snapshot also restores deleted/created nets. */
  _snapshotNetTopology() {
    return {
      netId: this._netId,
      nets: [...this.nets].map(([id, net]) => ({
        id,
        net,
        name: net.name,
        analysis: { ...(net.analysis || {}) },
        preserveEmpty: net.preserveEmpty,
        allowDiagonal: net.allowDiagonal,
        terminals: net.terminals.map((t) => ({ ...t })),
        routingMode: net.routingMode,
        route: net.route ? clonePath(net.route, net.allowDiagonal) : null,
        branches: net.branches ? net.branches.map((p) => clonePath(p, net.allowDiagonal)) : null,
        junctions: net.junctions.map((p) => ({ ...p })),
        fixedPaths: net.fixedPaths.map((entry) => Net.fixedPathEntry(entry)),
      })),
      labels: [...this.labels].map(([id, label]) => ({
        id,
        label,
        netId: label.netId,
        owner: label.owner,
        offset: label.offset ? { ...label.offset } : null,
        anchor: label.anchor ? { ...label.anchor } : null,
        text: label._text,
      })),
    };
  }

  _restoreNetTopology(snapshot) {
    this._netId = snapshot.netId;
    this.nets.clear();
    for (const saved of snapshot.nets) {
      const net = saved.net;
      net.name = saved.name;
      net.analysis = { ...(saved.analysis || {}) };
      net.preserveEmpty = saved.preserveEmpty;
      net.allowDiagonal = saved.routingMode === 'managed' && saved.allowDiagonal === true;
      net.terminals = saved.terminals.map((t) => ({ ...t }));
      net.routingMode = saved.routingMode;
      net.route = saved.route ? clonePath(saved.route, net.allowDiagonal) : null;
      net.branches = saved.branches ? saved.branches.map((p) => clonePath(p, net.allowDiagonal)) : null;
      net.junctions = saved.junctions.map((p) => ({ ...p }));
      net.fixedPaths = saved.fixedPaths.map((entry) => Net.fixedPathEntry(entry));
      this.nets.set(saved.id, net);
    }
    this.labels.clear();
    for (const saved of snapshot.labels || []) {
      const label = saved.label;
      label.netId = saved.netId;
      label.owner = saved.owner;
      label.offset = saved.offset ? { ...saved.offset } : null;
      label.anchor = saved.anchor ? { ...saved.anchor } : label.anchor;
      label._text = saved.text;
      this.labels.set(saved.id, label);
    }
  }


  _pathsConnectedToTerminals(net) {
    const paths = this._explicitBranches(net);
    const terminals = net.terminals
      .map((t) => this.components.get(t.comp)?.terminalWorld(t.term))
      .filter(Boolean);
    if (terminals.length > 1 && terminals.every((p) => p.x === terminals[0].x && p.y === terminals[0].y)) return true;
    const onPath = (p, path) => path.some((q) => q.x === p.x && q.y === p.y) || pointOnPath(p, path);
    if (!paths.length || terminals.some((p) => !paths.some((path) => onPath(p, path)))) return false;
    const parent = paths.map((_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const join = (a, b) => {
      a = find(a); b = find(b);
      if (a !== b) parent[b] = a;
    };
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        if (paths[i].some((p) => onPath(p, paths[j])) || paths[j].some((p) => onPath(p, paths[i]))) join(i, j);
      }
    }
    const root = find(0);
    return paths.every((_, i) => find(i) === root);
  }
  _namedNetNames(nets) {
    return [...new Set(nets.map((net) => canonicalNetName(net.name)).filter(Boolean))];
  }

  _syncAnalysisAttributes(net) {
    if (!net) return net;
    const portTypes = INTERFACE_PIN_TYPES;
    const ports = net.terminals
      .map((terminal) => this.components.get(terminal.comp))
      .filter((component) => component && portTypes.has(component.type));
    const portRole = ports.map((component) => component.analysis?.role).find(Boolean) || null;
    const netRole = net.analysis?.role || (net.analysis?.acGround ? 'dc-bias' : null);
    const role = netRole || portRole;
    if (role) {
      net.analysis = { ...(net.analysis || {}), role, acGround: role === 'dc-bias' || !!net.analysis?.acGround };
      for (const component of ports) component.analysis = { ...component.analysis, role };
    }
    return net;
  }

  _recordNetNameWarning(primary, sources) {
    const sourceIds = new Set(sources.map((net) => net.id));
    const names = new Set(this._namedNetNames(sources));
    for (const warning of this.netNameWarnings) {
      if (sourceIds.has(warning.netId)) for (const name of warning.names) names.add(name);
    }
    const ordered = [...names];
    if (ordered.length < 2) return;
    const warning = {
      netId: primary.id,
      names: ordered,
      message: `merged nets retain "${primary.name}" but also contained ${ordered.filter((name) => name !== primary.name).join(', ')}`,
    };
    const key = `${warning.netId}:${warning.names.join('|')}`;
    this.netNameWarnings = this.netNameWarnings.filter((entry) => entry.netId !== primary.id);
    if (!this.netNameWarnings.some((entry) => `${entry.netId}:${entry.names.join('|')}` === key)) {
      this.netNameWarnings.push(warning);
    }
  }

  _mergeNameConflict(nets, { allowConflict = false } = {}) {
    const names = this._namedNetNames(nets);
    if (names.length > 1 && !allowConflict) throw new Error(`conflicting net names: ${names.join(', ')}`);
    return names[0] || '';
  }

  /** Merge physical net identity and metadata without touching geometry. All
   * topology editors call this before deleting a source net so names and labels
   * cannot silently diverge from the surviving physical net. */
  _mergeNets(primary, others = [], terminals = null, options = {}) {
    const sources = [primary, ...others].filter(Boolean).filter((net, i, all) => all.indexOf(net) === i);
    if (!sources.length) throw new Error('cannot merge empty net set');
    let name = this._mergeNameConflict(sources, { allowConflict: options.allowNameConflict });
    if (options.allowNameConflict) {
      const explicit = sources
        .map((source) => source.name)
        .filter((candidate) => candidate && !sources.some((source) => this._isAutoReferenceName(source, candidate)));
      if (explicit.length) name = explicit[0];
    }
    if (options.allowNameConflict) this._recordNetNameWarning(primary, sources);
    primary.name = name;
    if (sources.some((source) => source.analysis?.acGround || source.analysis?.role === 'dc-bias')) {
      primary.analysis = { ...(primary.analysis || {}), role: 'dc-bias', acGround: true };
    }
    const members = terminals || sources.flatMap((net) => net.terminals);
    primary.terminals = [];
    for (const t of members) {
      if (!primary.terminals.some((q) => q.comp === t.comp && q.term === t.term)) primary.terminals.push({ ...t });
    }
    for (const other of sources.slice(1)) {
      this._retargetNetLabels(other.id, primary.id);
      this.nets.delete(other.id);
      this.netNameWarnings = this.netNameWarnings.filter((warning) => warning.netId !== other.id);
    }
    return primary;
  }

  /**
   * Connect terminals. Accepts many refs ("R1.a", "C2.b", ...) as the same
   * net; nets are created/merged as needed. Returns the resulting net.
   */
  connect(...refs) {
    this.invalidateRoutingCache();
    const okRefs = refs.map((r) => this.resolveTerm(r));
    for (let i = 0; i < okRefs.length; i++) {
      for (let j = i + 1; j < okRefs.length; j++) {
        if (okRefs[i].comp === okRefs[j].comp && okRefs[i].term === okRefs[j].term) {
          throw new Error(`cannot connect a terminal to itself: ${refs[i]}`);
        }
      }
    }
    const involved = new Map(); // terminal -> existing net
    for (const r of okRefs) {
      const net = this.netOfTerminal(r);
      if (net) involved.set(`${r.comp}.${r.term}`, net);
    }
    const involvedNets = [...new Set(involved.values())];
    this._mergeNameConflict(involvedNets, { allowConflict: true });
    if (involvedNets.length === 1 &&
        okRefs.every((r) => involved.has(`${r.comp}.${r.term}`))) {
      this._syncReferenceMarkerNetName(involvedNets[0]);
      this._syncAnalysisAttributes(involvedNets[0]);
      this._syncInterfacePinLabels(involvedNets[0], { enforceName: true });
      return involvedNets[0];
    }
    const growsFixed = involvedNets.some((n) => n.routingMode === 'fixed') &&
      (involvedNets.length > 1 || okRefs.some((r) => !involved.has(`${r.comp}.${r.term}`)));
    if (growsFixed) throw new Error('cannot grow a fixed net with managed connect; use wireDirectTo');
    const topology = this._snapshotNetTopology();
    // Copying a complete set onto its source can make many pins coincide.
    // Merge those physical nets directly; routing a zero-length bridge for
    // every pin is both redundant and needlessly expensive.
    const coincident = involvedNets.length > 1 && okRefs.length >= 2 && (() => {
      const points = okRefs.map((r) => this.getComponent(r.comp).terminalWorld(r.term));
      return points.every((p) => p.x === points[0].x && p.y === points[0].y);
    })();
    if (coincident) {
      const primary = involvedNets[0];
      const paths = involvedNets.flatMap((candidate) => this._explicitBranches(candidate));
      const junctions = involvedNets.flatMap((candidate) => candidate.junctions);
      primary.allowDiagonal = involvedNets.some((candidate) => candidate.allowDiagonal);
      this._mergeNets(primary, involvedNets.slice(1), null, { allowNameConflict: true });
      for (const ref of okRefs) {
        if (!primary.terminals.some((t) => t.comp === ref.comp && t.term === ref.term)) {
          primary.terminals.push({ ...ref });
        }
      }
      primary.branches = paths.length
        ? paths.map((path) => clonePath(path, primary.allowDiagonal))
        : null;
      primary.route = primary.branches?.[0] ? clonePath(primary.branches[0], primary.allowDiagonal) : null;
      primary.junctions = [...junctions, ...primary.junctions].filter((point, index, all) =>
        all.findIndex((other) => other.x === point.x && other.y === point.y) === index);
      this._reduceNet(primary);
      this._syncReferenceMarkerNetName(primary);
      this._syncAnalysisAttributes(primary);
      this._syncInterfacePinLabels(primary, { enforceName: true });
      this._inferCrossCoupling(new Set([primary]));
      this.syncJunctionSolders();
      return primary;
    }
    let net;
    if (involvedNets.length > 1 || (involvedNets.length === 1 &&
        okRefs.some((r) => !involved.has(`${r.comp}.${r.term}`)))) {
      net = involvedNets[0] || null;
      try {
        const source = () => net.terminals[0];
        const routeOptions = () => ({ allowDiagonal: net.allowDiagonal });
        for (const other of involvedNets.slice(1)) {
          const target = other.terminals[0];
          const sourceRef = source();
          this.wireTo(`${sourceRef.comp}.${sourceRef.term}`, this.getComponent(target.comp).terminalWorld(target.term), [], routeOptions());
        }
        for (const r of okRefs) {
          if (involved.has(`${r.comp}.${r.term}`)) continue;
          const sourceRef = source();
          const connected = this.wireTo(`${sourceRef.comp}.${sourceRef.term}`, this.getComponent(r.comp).terminalWorld(r.term), [], routeOptions());
          if (!connected.terminals.some((entry) => entry.comp === r.comp && entry.term === r.term)) {
            connected.terminals.push({ ...r });
          }
        }
        if (net) {
          this._syncReferenceMarkerNetName(net);
          this._syncAnalysisAttributes(net);
          this._syncInterfacePinLabels(net, { enforceName: true });
          return net;
        }
      } catch (err) {
        this._restoreNetTopology(topology);
        throw err;
      }
    }
    if (involved.size === 0) {
      net = this._createNet();
    } else {
      const first = [...involved.values()][0];
      net = first;
      const promoteFixed = [...new Set(involved.values())].some((n) => n.routingMode === 'fixed');
      const fixedEntries = promoteFixed
        ? [...new Set(involved.values())].flatMap((n) => this._fixedPathEntries(n))
        : null;
      for (const other of new Set(involved.values())) {
        if (other === net) continue;
        // merge other into net
        net.allowDiagonal = net.allowDiagonal || other.allowDiagonal;
        const otherPaths = other.paths();
        const otherJunctions = other.junctions.map((p) => ({ ...p }));
        this._mergeNets(net, [other], null, { allowNameConflict: true });
        if (!promoteFixed) {
          if (otherPaths.length) {
            const own = net.branches && net.branches.length ? net.branches : net.route ? [net.route] : [];
            net.branches = [...own, ...otherPaths].map((p) => clonePath(p, net.allowDiagonal));
            net.route = net.branches[0] ? clonePath(net.branches[0], net.allowDiagonal) : null;
          }
        }
        for (const p of otherJunctions) if (!net.junctions.some((q) => q.x === p.x && q.y === p.y)) net.junctions.push(p);
      }
      if (promoteFixed) this._setFixedPaths(net, fixedEntries);
    }
    for (const r of okRefs) {
      const key = `${r.comp}.${r.term}`;
      if (!involved.has(key)) net.terminals.push(r);
    }
    // A fresh connect call still optimizes a net made entirely from new
    // terminals. Existing managed geometry is grown through wireTo above:
    // that path appends one branch and leaves committed routes untouched.
    const addedNew = okRefs.some((r) => !involved.has(`${r.comp}.${r.term}`));
    if (addedNew && net.terminals.length >= 2 && net.routingMode === 'managed') {
      try {
        if (this.rerouteNet(net, 'refresh') === false) throw new Error('unable to route wire safely');
      } catch (err) {
        this._restoreNetTopology(topology);
        throw err;
      }
    }
    this._reduceNet(net);
    this._syncReferenceMarkerNetName(net);
    this._syncAnalysisAttributes(net);
    this._syncInterfacePinLabels(net, { enforceName: true });
    this._inferCrossCoupling(new Set([net]));
    this.syncJunctionSolders();
    return net;
  }

  /** Explicit (hand-authored or committed) branch geometry of a net, ignoring
   *  the auto-route fallback so join logic never duplicates it. */
  _fixedPathEntries(net) {
    if (net.routingMode === 'fixed') {
      return net.fixedPaths.map((entry) => Net.fixedPathEntry(entry));
    }
    const terminalAt = (p) => {
      for (const t of net.terminals) {
        const c = this.components.get(t.comp);
        if (!c) continue;
        const q = c.terminalWorld(t.term);
        if (q.x === p.x && q.y === p.y) return { comp: t.comp, term: t.term };
      }
      return null;
    };
    return net.paths().map((points) => ({
      points: cloneFixedPath(points),
      start: points.length ? terminalAt(points[0]) : null,
      end: points.length ? terminalAt(points[points.length - 1]) : null,
    }));
  }

  _dropFixedAnchor(net, ref) {
    if (net.routingMode !== 'fixed') return;
    const matches = (anchor) => anchor && anchor.comp === ref.comp &&
      (ref.term === undefined || anchor.term === ref.term);
    for (const entry of net.fixedPaths) {
      if (matches(entry.start)) entry.start = null;
      if (matches(entry.end)) entry.end = null;
    }
  }

  /** Keep only anchors that still identify a real member terminal. */
  _sanitizeFixedAnchors(net) {
    if (net.routingMode !== 'fixed') return;
    const members = new Set(net.terminals.map((t) => `${t.comp}.${t.term}`));
    const valid = (anchor) => anchor && members.has(`${anchor.comp}.${anchor.term}`) &&
      this.components.get(anchor.comp)?.terminalDefs.some((t) => t.name === anchor.term);
    for (const entry of net.fixedPaths) {
      if (!valid(entry.start)) entry.start = null;
      if (!valid(entry.end)) entry.end = null;
    }
  }

  /**
   * Install literal paths as ordinary managed geometry. Diagonal segments in
   * them are authored and protected individually; orthogonal parts behave
   * like any managed wire. The net's diagonal flag follows the geometry.
   */
  _installLiteralPaths(net, paths, junctions = []) {
    this.invalidateRoutingCache();
    const kept = paths.map((path) => cloneFixedPath(path || [])).filter((path) => path.length >= 2);
    net.routingMode = 'managed';
    net.fixedPaths = [];
    net.allowDiagonal = kept.some(pathHasDiagonal);
    net.branches = kept.length ? kept.map((path) => clonePath(path, net.allowDiagonal)) : null;
    net.route = net.branches?.[0] ? clonePath(net.branches[0], net.allowDiagonal) : null;
    const branches = net.branches || [];
    net.junctions = [...this._netJunctions(net, branches), ...junctions.map((p) => snapPoint(p.x, p.y))]
      .filter((p, index, all) => all.findIndex((q) => q.x === p.x && q.y === p.y) === index)
      .filter((p) => branches.some((path) => pointOnPath(p, path)));
  }

  /**
   * Move one diagonal segment rigidly by `delta` (angle and length kept).
   * The orthogonal wire on each side reroutes: from the nearest fixed point
   * (a pin, a junction, another branch's end, or another diagonal segment's
   * end) to the moved segment end. A free wire end simply moves with it.
   * Atomic: returns false and changes nothing when a route is unsafe.
   */
  moveDiagonalSegment(netOrId, branch, segment, delta) {
    const net = this._resolveNet(netOrId);
    if (net.routingMode !== 'managed') return false;
    const paths = this._explicitBranches(net);
    const path = paths[branch];
    if (!path || segment < 1 || segment >= path.length) return false;
    const A = path[segment - 1];
    const B = path[segment];
    if (!isDiagonalSegment(A, B)) return false;
    const dx = snap(delta.dx);
    const dy = snap(delta.dy);
    if (!dx && !dy) return true;
    const key = (p) => `${p.x},${p.y}`;
    const anchors = new Set();
    for (const p of net.terminalWorlds()) anchors.add(key(p));
    for (const p of net.junctions) anchors.add(key(p));
    paths.forEach((other, index) => {
      if (index === branch) return;
      for (const p of [other[0], other.at(-1)]) anchors.add(key(p));
    });
    const env = this._netEnv(net.id);
    const moved = (p) => ({ x: p.x + dx, y: p.y + dy });
    const clear = (a, b) => !env.rects.some((rect) => segThroughInterior(a, b, rect) && !gateBodyCrossingAllowed(a, b, rect, env));
    // Reconnect a fixed point to a moved end: a still-aligned straight leg
    // just stretches (existing pin legs keep their direction); otherwise the
    // router finds an orthogonal connection.
    const connect = (from, to) => ((from.x === to.x || from.y === to.y) && clear(from, to)
      ? [{ ...from }, { ...to }]
      : smartRoute(from, to, env));
    const A2 = moved(A);
    const B2 = moved(B);
    // Walk from a segment end toward a path end until a fixed point.
    const fixedIndex = (from, step) => {
      let j = from;
      while (j + step >= 0 && j + step < path.length && !anchors.has(key(path[j])) && !isDiagonalSegment(path[j], path[j + step])) j += step;
      return j;
    };
    const left = (() => {
      const j = fixedIndex(segment - 1, -1);
      const freeEnd = j === 0 && !anchors.has(key(path[0])) && j === segment - 1;
      if (freeEnd) return [A2];
      const route = connect(path[j], A2);
      return route ? [...path.slice(0, j), ...route] : null;
    })();
    const right = (() => {
      const j = fixedIndex(segment, 1);
      const freeEnd = j === path.length - 1 && !anchors.has(key(path[j])) && j === segment;
      if (freeEnd) return [B2];
      const route = connect(B2, path[j]);
      return route ? [...route, ...path.slice(j + 1)] : null;
    })();
    if (!left || !right) return false;
    if (!clear(A2, B2)) return false;
    const next = clonePath([...left, ...right], true);
    const branches = paths.map((other, index) => (index === branch ? next : other));
    this.invalidateRoutingCache();
    net.branches = branches;
    net.route = clonePath(branches[0], true);
    net.junctions = net.junctions.filter((p) => branches.some((other) => pointOnPath(p, other)));
    for (const p of this._netJunctions(net, branches)) {
      if (!net.junctions.some((q) => q.x === p.x && q.y === p.y)) net.junctions.push(p);
    }
    this.syncJunctionSolders();
    return true;
  }

  /**
   * Convert every legacy fixed net into managed geometry (see
   * `_installLiteralPaths`). Documents entering the app pass through this, so
   * the editor only ever works with one wire model. Returns the count.
   */
  convertFixedNets() {
    let converted = 0;
    for (const net of this.nets.values()) {
      if (net.routingMode !== 'fixed') continue;
      for (const entry of net.fixedPaths) {
        for (const anchor of [entry.start, entry.end]) {
          if (anchor && !net.terminals.some((t) => t.comp === anchor.comp && t.term === anchor.term)) net.terminals.push({ comp: anchor.comp, term: anchor.term });
        }
      }
      this._installLiteralPaths(net, net.fixedPaths.map((entry) => entry.points), net.junctions);
      converted++;
    }
    if (converted) this.syncJunctionSolders();
    return converted;
  }

  _setFixedPaths(net, entries, junctions = []) {
    this.invalidateRoutingCache();
    net.routingMode = 'fixed';
    net.allowDiagonal = false;
    net.fixedPaths = entries
      .map((entry) => Net.fixedPathEntry(entry))
      .filter((entry) => entry.points.length >= 2);
    net.route = null;
    net.branches = null;
    const seen = new Set();
    net.junctions = (junctions || []).map((p) => ({ x: snap(p.x), y: snap(p.y) }))
      .filter((p) => {
        const key = `${p.x},${p.y}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    this._sanitizeFixedAnchors(net);
  }

  _fixedNet(netOrId) {
    const net = typeof netOrId === 'string' ? this.nets.get(netOrId) : netOrId;
    if (!net || net.routingMode !== 'fixed') throw new Error('fixed geometry edit requires a fixed net');
    return net;
  }

  /** Return an unanchored fixed-path endpoint that is safe to edit.  Endpoints
   * shared by another path or declared as a junction are electrical anchors,
   * even when their terminal anchor field is null, and must not be dragged as
   * free ends.  A tolerance is allowed for the editor's screen-sized hit test;
   * equal nearest candidates are deliberately ambiguous. */
  fixedOpenEndpointAt(point, tolerance = 0) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const candidates = [];
    for (const net of this.nets.values()) {
      if (net.routingMode !== 'fixed') continue;
      const endpointCount = new Map();
      for (const entry of net.fixedPaths) for (const endpoint of [entry.points[0], entry.points.at(-1)]) {
        if (endpoint) endpointCount.set(`${endpoint.x},${endpoint.y}`, (endpointCount.get(`${endpoint.x},${endpoint.y}`) || 0) + 1);
      }
      for (let pathIndex = 0; pathIndex < net.fixedPaths.length; pathIndex++) {
        const entry = net.fixedPaths[pathIndex];
        for (const endpointIndex of [0, entry.points.length - 1]) {
          const endpoint = this._fixedOpenEndpoint(net, pathIndex, endpointIndex, endpointCount);
          if (!endpoint) continue;
          const distance = Math.hypot(endpoint.point.x - point.x, endpoint.point.y - point.y);
          if (distance <= tolerance) candidates.push({ ...endpoint, distance });
        }
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.distance - b.distance);
    if (candidates[1] && Math.abs(candidates[1].distance - candidates[0].distance) < 1e-9) return null;
    const { distance, ...result } = candidates[0];
    return result;
  }

  _fixedOpenEndpoint(net, pathIndex, endpointIndex, endpointCount = null) {
    if (!net || net.routingMode !== 'fixed') return null;
    const entry = net.fixedPaths[pathIndex];
    if (!entry || ![0, entry.points.length - 1].includes(endpointIndex)) return null;
    if ((endpointIndex === 0 ? entry.start : entry.end) !== null) return null;
    const point = entry.points[endpointIndex];
    if (!point) return null;
    const count = endpointCount || new Map();
    if (!endpointCount) {
      for (const item of net.fixedPaths) for (const p of [item.points[0], item.points.at(-1)]) {
        const key = `${p.x},${p.y}`;
        count.set(key, (count.get(key) || 0) + 1);
      }
    }
    if ((count.get(`${point.x},${point.y}`) || 0) !== 1) return null;
    if (net.junctions.some((p) => p.x === point.x && p.y === point.y)) return null;
    return { netId: net.id, pathIndex, endpointIndex, point: { ...point } };
  }

  /** Move one free fixed endpoint.  `active:true` is used by the editor after
   * it has validated the endpoint at drag start, allowing a live preview to
   * pass over a shared point before the eventual explicit attachment. */
  moveFixedEndpoint(endpointOrNet, pathIndex, endpointIndex, point, opts = {}) {
    let endpoint = endpointOrNet;
    if (typeof endpointOrNet === 'string' || endpointOrNet instanceof Net) {
      endpoint = { netId: typeof endpointOrNet === 'string' ? endpointOrNet : endpointOrNet.id, pathIndex, endpointIndex };
    } else {
      point = pathIndex;
      opts = endpointIndex || {};
    }
    const net = this.nets.get(endpoint.netId);
    const entry = net?.fixedPaths?.[endpoint.pathIndex];
    const current = this._fixedOpenEndpoint(net, endpoint.pathIndex, endpoint.endpointIndex);
    if (!opts.active && !current) throw new Error('fixed endpoint is anchored or shared');
    if (opts.active && (!net || net.routingMode !== 'fixed' || !entry || (endpoint.endpointIndex !== 0 && endpoint.endpointIndex !== entry.points.length - 1) ||
        (endpoint.endpointIndex === 0 ? entry.start : entry.end) !== null)) {
      throw new Error('fixed endpoint is anchored');
    }
    const next = this._fixedPoint(point);
    entry.points[endpoint.endpointIndex] = next;
    this.invalidateRoutingCache();
    return net;
  }

  /** Extend a validated free fixed endpoint with a newly authored suffix.
   * `points` are ordered from the old endpoint toward the new endpoint. Smart
   * mode routes only this suffix; the existing fixed path is never optimized. */
  extendFixedEndpoint(endpoint, points = [], opts = {}) {
    const net = this.nets.get(endpoint?.netId);
    const entry = net?.fixedPaths?.[endpoint?.pathIndex];
    const open = this._fixedOpenEndpoint(net, endpoint?.pathIndex, endpoint?.endpointIndex);
    if (!opts.active && !open) throw new Error('fixed endpoint is anchored or shared');
    if (opts.active && (!net || net.routingMode !== 'fixed' || !entry || (endpoint.endpointIndex !== 0 && endpoint.endpointIndex !== entry.points.length - 1) ||
        (endpoint.endpointIndex === 0 ? entry.start : entry.end) !== null)) throw new Error('fixed endpoint is anchored');
    if (!Array.isArray(points) || points.length === 0) throw new Error('fixed endpoint extension requires a target point');
    const start = { ...entry.points[endpoint.endpointIndex] };
    const targets = points.map((p) => this._fixedPoint(p));
    const suffix = [{ ...start }];
    let cursor = start;
    for (const target of targets) {
      const leg = opts.mode === 'smart' ? smartRoute(cursor, target, this._netEnv(net.id)) : [cursor, target];
      if (!leg) throw new Error('unable to route wire safely');
      for (const p of leg.slice(1)) suffix.push({ ...p });
      cursor = target;
    }
    if (endpoint.endpointIndex === 0) entry.points = [...suffix.reverse(), ...entry.points.slice(1)];
    else entry.points = [...entry.points, ...suffix.slice(1)];
    this.invalidateRoutingCache();
    return net;
  }

  /** Restore a fixed net's literal state after a cancelled endpoint drag. */
  restoreFixedGeometry(netOrId, fixedPaths, junctions = []) {
    const net = this._fixedNet(netOrId);
    net.fixedPaths = fixedPaths.map((entry) => Net.fixedPathEntry({
      points: entry.points,
      start: entry.start,
      end: entry.end,
    }));
    net.junctions = junctions.map((p) => ({ x: p.x, y: p.y }));
    this._sanitizeFixedAnchors(net);
    this.invalidateRoutingCache();
    return net;
  }

  _fixedPoint(point, y) {
    if (Number.isFinite(point)) point = { x: point, y };
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error('fixed geometry points must be finite');
    }
    return snapPoint(point.x, point.y);
  }

  /** Replace one protected path without orthogonalizing, reducing, or dropping
   * its terminal anchors or the net's explicit junction annotations. */
  setFixedPath(netOrId, pathIndex, points) {
    const net = this._fixedNet(netOrId);
    if (!Number.isInteger(pathIndex) || pathIndex < 0 || pathIndex >= net.fixedPaths.length) {
      throw new Error(`unknown fixed path ${pathIndex}`);
    }
    if (!Array.isArray(points) || points.length < 2) throw new Error('fixed path requires at least two points');
    const entry = net.fixedPaths[pathIndex];
    const next = points.map((p) => this._fixedPoint(p));
    // An anchor is an electrical endpoint, not an editable free vertex. Keep
    // its current terminal coordinate while retaining the anchor object.
    if (entry.start) {
      const c = this.components.get(entry.start.comp);
      if (c) next[0] = c.terminalWorld(entry.start.term);
    }
    if (entry.end) {
      const c = this.components.get(entry.end.comp);
      if (c) next[next.length - 1] = c.terminalWorld(entry.end.term);
    }
    entry.points = next;
    this.syncJunctionSolders();
    this.invalidateRoutingCache();
    return net;
  }

  /** Move one vertex of a protected path. Shared explicit junction vertices
   * move on every path so the junction annotation and all incident paths stay
   * together; no reduction or route optimization is performed. */
  setFixedPathVertex(netOrId, pathIndex, vertexIndex, point, y) {
    const net = this._fixedNet(netOrId);
    if (!Number.isInteger(pathIndex) || pathIndex < 0 || pathIndex >= net.fixedPaths.length) {
      throw new Error(`unknown fixed path ${pathIndex}`);
    }
    const entry = net.fixedPaths[pathIndex];
    if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= entry.points.length) {
      throw new Error(`unknown fixed vertex ${vertexIndex}`);
    }
    const target = this._fixedPoint(point, y);
    if ((vertexIndex === 0 && entry.start) || (vertexIndex === entry.points.length - 1 && entry.end)) {
      throw new Error('cannot move an anchored fixed endpoint');
    }
    const old = entry.points[vertexIndex];
    const isJunction = net.junctions.some((p) => p.x === old.x && p.y === old.y);
    if (isJunction) {
      for (const path of net.fixedPaths) {
        path.points = path.points.map((p) => p.x === old.x && p.y === old.y ? { ...target } : p);
      }
      net.junctions = net.junctions.map((p) => p.x === old.x && p.y === old.y ? { ...target } : p);
    } else {
      entry.points[vertexIndex] = target;
    }
    this.syncJunctionSolders();
    this.invalidateRoutingCache();
    return net;
  }

  /** Move an explicit junction and every matching fixed-path vertex. */
  setFixedJunction(netOrId, junctionIndex, point, y) {
    const net = this._fixedNet(netOrId);
    if (!Number.isInteger(junctionIndex) || junctionIndex < 0 || junctionIndex >= net.junctions.length) {
      throw new Error(`unknown fixed junction ${junctionIndex}`);
    }
    const old = net.junctions[junctionIndex];
    if (net.fixedPaths.some((entry) =>
      (entry.start && entry.points[0]?.x === old.x && entry.points[0]?.y === old.y) ||
      (entry.end && entry.points.at(-1)?.x === old.x && entry.points.at(-1)?.y === old.y))) {
      throw new Error('cannot move a fixed junction anchored to a terminal');
    }
    const target = this._fixedPoint(point, y);
    for (const entry of net.fixedPaths) {
      entry.points = entry.points.map((p) => p.x === old.x && p.y === old.y ? { ...target } : p);
    }
    net.junctions[junctionIndex] = target;
    this.syncJunctionSolders();
    this.invalidateRoutingCache();
    return net;
  }

  // Verb aliases keep the three edits discoverable to callers that use either
  // the noun or the editor-style "edit" naming convention.
  editFixedPath(...args) { return this.setFixedPath(...args); }
  editFixedVertex(...args) { return this.setFixedPathVertex(...args); }
  editFixedJunction(...args) { return this.setFixedJunction(...args); }

  _explicitBranches(net) {
    if (net.routingMode === 'fixed') return net.fixedPaths.map((entry) => cloneFixedPath(entry.points));
    if (net.branches && net.branches.length) return net.branches.map((p) => clonePath(p, net.allowDiagonal));
    if (net.route && net.route.length >= 2) return [clonePath(net.route, net.allowDiagonal)];
    return [];
  }

  /** Reduce a fresh or explicitly edited managed geometry to a deterministic
   *  minimum spanning tree. Topology growth does not call this: committed
   *  branches remain user-owned until a wire edit, explicit reroute, load
   *  normalization, or another operation that intentionally repairs geometry.
   *  See reduceBranches for the connectivity graph and tie-breaking rules. */
  _reduceNet(net) {
    if (net.routingMode === 'fixed') return;
    // A zero-terminal net is a geometric island, not a connectivity graph.
    // Never run the MST reducer over it or its selected shape can disappear.
    if (net.terminals.length === 0) return;
    const paths = this._explicitBranches(net);
    if (!paths.length) return;
    const terminals = net.terminals
      .map((t) => this.getComponent(t.comp)?.terminalWorld(t.term))
      .filter(Boolean);
    const styledSegments = this._styledSegments(net, paths);
    const reductionAnchors = styledSegments.flatMap(({ a, b }) => [a, b]);
    const reduced = reduceBranches(paths, [...terminals, ...reductionAnchors], net.allowDiagonal);
    if (!reduced.length || samePolylineSet(paths, reduced)) return;
    this._installRestyledBranches(net, reduced, styledSegments);
    net.junctions = this._netJunctions(net, net.branches);
  }

  /** Styled segments of `paths`, keyed by their endpoints so styles survive
   *  a change in how the same geometry is split into branches. */
  _styledSegments(net, paths) {
    return Object.entries(net.wireStyles || {})
      .map(([key, style], order) => {
        const match = key.match(/^(\d+):(\d+)$/);
        if (!match) return null;
        const branch = Number(match[1]);
        const segment = Number(match[2]);
        const a = paths[branch]?.[segment - 1];
        const b = paths[branch]?.[segment];
        return a && b ? { branch, segment, a, b, style: { ...style }, order } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.branch - b.branch || a.segment - b.segment || a.order - b.order);
  }

  _installRestyledBranches(net, paths, styledSegments) {
    const onSegment = (p, a, b) =>
      (b.x - a.x) * (p.y - a.y) === (b.y - a.y) * (p.x - a.x) &&
      p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) &&
      p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
    const rebuiltStyles = {};
    paths.forEach((path, branch) => {
      for (let i = 1; i < path.length; i++) {
        const match = styledSegments.find(({ a, b }) =>
          onSegment(path[i - 1], a, b) && onSegment(path[i], a, b));
        if (match) rebuiltStyles[`${branch}:${i}`] = { ...match.style };
      }
    });
    net.wireStyles = rebuiltStyles;
    net.branches = paths.map((p) => clonePath(p, net.allowDiagonal));
    net.route = clonePath(paths[0], net.allowDiagonal);
  }

  /** Topology growth keeps authored branches, but a new branch that merely
   *  continues an old one at a plain end point joins it, so piecewise wiring
   *  does not leave short split stubs. */
  _joinGrownBranches(net) {
    const paths = this._explicitBranches(net);
    if (paths.length < 2) return;
    const styledSegments = this._styledSegments(net, paths);
    const anchors = [
      ...net.terminals.map((t) => this.getComponent(t.comp)?.terminalWorld(t.term)).filter(Boolean),
      ...(net.junctions || []),
      ...styledSegments.flatMap(({ a, b }) => [a, b]),
    ];
    const joined = joinBranchEnds(paths, anchors, net.allowDiagonal);
    if (samePolylineSet(paths, joined)) return;
    this._installRestyledBranches(net, joined, styledSegments);
    net.junctions = this._netJunctions(net, net.branches);
  }

  /**
   * Short the nets (managed or fixed) whose drawn wires pass through `point` (a crossing
   * or a wire end resting on another wire) into one physical net, with a
   * junction there. This is what placing a solder dot on a crossing means.
   *
   * Name choice: nets with only automatic names keep the first net's
   * identity; a single given name wins. With several given names and no
   * `options.name`, nothing changes and an error with
   * `code === 'net-name-choice'` and `names` is thrown so the caller can ask.
   * Returns the surviving net, or null when fewer than three wire arms meet at
   * the point (nothing to short, e.g. a dot on a plain straight wire).
   */
  shortNetsAt(point, options = {}) {
    const p = snapPoint(point.x, point.y);
    const same = (a, b) => a.x === b.x && a.y === b.y;
    const onInterior = (a, b) => (b.x - a.x) * (p.y - a.y) === (b.y - a.y) * (p.x - a.x) &&
      p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) &&
      p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y) && !same(a, p) && !same(b, p);
    // Arms meeting at p per net: a wire passing through adds two, a wire end
    // or a terminal adds one.
    const nets = [];
    let arms = 0;
    for (const net of this.nets.values()) {
      let netArms = 0;
      for (const path of this._explicitBranches(net)) {
        path.forEach((q, i) => { if (same(q, p)) netArms += (i > 0 ? 1 : 0) + (i < path.length - 1 ? 1 : 0); });
        for (let i = 1; i < path.length; i++) if (onInterior(path[i - 1], path[i])) netArms += 2;
      }
      if (!netArms) continue;
      nets.push(net);
      arms += netArms;
    }
    if (!nets.length || arms < 3) return null;
    if (nets.length === 1 && this._netJunctions(nets[0], this._explicitBranches(nets[0])).some((q) => same(q, p))) return nets[0];

    const names = this._namedNetNames(nets);
    let name = names[0] || '';
    if (options.name !== undefined) {
      name = canonicalNetName(options.name);
      if (names.length && !names.includes(name)) throw new Error(`"${options.name}" is not one of the shorted net names: ${names.join(', ')}`);
    } else if (names.length > 1) {
      const error = new Error(`choose a net name: ${names.join(', ')}`);
      error.code = 'net-name-choice';
      error.names = names;
      throw error;
    }
    this.invalidateRoutingCache();
    const primary = nets.find((net) => name && canonicalNetName(net.name) === name) || nets[0];
    const others = nets.filter((net) => net !== primary);
    const allowDiagonal = nets.some((net) => net.allowDiagonal);
    // Like attachWireEndpoint: joining any fixed net keeps every path literal
    // (cloneFixedPath); an all-managed short normalizes its branches.
    const fixed = nets.some((net) => net.routingMode === 'fixed');
    const splitAtPoint = (path) => {
      const pieces = [];
      let current = [path[0]];
      for (let i = 1; i < path.length; i++) {
        if (onInterior(path[i - 1], path[i])) {
          current.push({ ...p });
          pieces.push(current);
          current = [{ ...p }];
        }
        current.push(path[i]);
        if (same(path[i], p) && i < path.length - 1) {
          pieces.push(current);
          current = [{ ...p }];
        }
      }
      pieces.push(current);
      return pieces.filter((piece) => piece.length >= 2)
        .map((piece) => (fixed ? cloneFixedPath(piece) : clonePath(piece, allowDiagonal)));
    };
    const junctions = nets.flatMap((net) => net.junctions);
    const uniquePoints = (points) => points.filter((q, index, all) => all.findIndex((other) => same(other, q)) === index);
    const entries = fixed
      ? nets.flatMap((net) => this._fixedPathEntries(net)).flatMap((entry) => {
        const pieces = splitAtPoint(entry.points).map((points) => ({ points, start: null, end: null }));
        if (pieces.length) {
          pieces[0].start = entry.start || null;
          pieces[pieces.length - 1].end = entry.end || null;
        }
        return pieces;
      })
      : null;
    const branches = fixed ? null : nets.flatMap((net) => this._explicitBranches(net)).flatMap(splitAtPoint);
    this._mergeNets(primary, others, null, { allowNameConflict: true });
    primary.name = name;
    if (fixed) {
      this._setFixedPaths(primary, entries, uniquePoints([...junctions, p]));
    } else {
      primary.allowDiagonal = allowDiagonal;
      primary.branches = branches;
      primary.route = branches.length ? clonePath(branches[0], allowDiagonal) : null;
      primary.junctions = uniquePoints([...this._netJunctions(primary, branches), ...junctions, p]);
    }
    this._syncReferenceMarkerNetName(primary);
    this._syncAnalysisAttributes(primary);
    this._syncInterfacePinLabels(primary, { enforceName: true });
    this._inferCrossCoupling(new Set([primary]));
    this.syncJunctionSolders();
    return primary;
  }

  /** Junction points of a net's branches, counting each terminal as an arm. */
  _netJunctions(net, paths) {
    const terminals = net.terminals.map((t) => this.getComponent(t.comp)?.terminalWorld(t.term)).filter(Boolean);
    return junctionPoints(paths, terminals, net.allowDiagonal);
  }

  /**
   * A narrowly-scoped inference for the conventional two-device cross-coupled
   * pair.  The geometry test deliberately compares the complete component
   * transforms, rather than just their positions or terminal coordinates: a
   * same-orientation pair can have a superficially rectangular pin layout but
   * is not a mirrored pair.
   */
  _inferCrossCoupling(touched = null) {
    const nets = [...this.nets.values()];
    const candidates = [];
    const samePoint = (a, b) => a && b && a.x === b.x && a.y === b.y;
    const reflectedTransforms = (left, right) => {
      if (left.type !== right.type) return null;
      const la = left.bboxWorld();
      const rb = right.bboxWorld();
      if (la.w !== rb.w || la.h !== rb.h) return null;
      const axes = [];
      const transforms = [
        {
          axis: 'x',
          center: (la.x + la.w / 2 + rb.x + rb.w / 2) / 2,
          matchesBox: la.y === rb.y,
          reflect: (p, center) => ({ x: 2 * center - p.x, y: p.y }),
        },
        {
          axis: 'y',
          center: (la.y + la.h / 2 + rb.y + rb.h / 2) / 2,
          matchesBox: la.x === rb.x,
          reflect: (p, center) => ({ x: p.x, y: 2 * center - p.y }),
        },
      ];
      for (const candidate of transforms) {
        const { axis, center, reflect } = candidate;
        const boxMatches = axis === 'x'
          ? rb.x === 2 * center - la.x - la.w
          : rb.y === 2 * center - la.y - la.h;
        if (!candidate.matchesBox || !boxMatches) continue;
        // Three basis points make this an affine-transform comparison. It also
        // rejects point-symmetric or merely co-located, unmirrored transforms.
        let matches = true;
        for (const p of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]) {
          if (!samePoint(applyTransform(right.transform, p.x, p.y), reflect(applyTransform(left.transform, p.x, p.y), center))) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
        for (const t of left.terminalDefs) {
          if (!samePoint(right.terminalWorld(t.name), reflect(left.terminalWorld(t.name), center))) {
            matches = false;
            break;
          }
        }
        if (matches) axes.push({ axis, center });
      }
      return axes;
    };
    const candidateFor = (a, b) => {
      if (a.routingMode !== 'managed' || b.routingMode !== 'managed') return null;
      if (a.allowDiagonal || b.allowDiagonal) return null;
      if (a.terminals.length !== 2 || b.terminals.length !== 2) return null;
      if (a.junctions.length || b.junctions.length) return null;
      const refsA = a.terminals.map((t) => t.comp);
      const refsB = b.terminals.map((t) => t.comp);
      if (new Set(refsA).size !== 2 || new Set(refsB).size !== 2 ||
          refsA.some((ref) => !refsB.includes(ref))) return null;
      const left = this.components.get(refsA[0]);
      const right = this.components.get(refsA[1]);
      if (!left || !right) return null;
      const axes = reflectedTransforms(left, right);
      if (!axes || axes.length !== 1) return null;
      // The endpoint order is significant: balancedCrossCoupling preserves it
      // so each generated path remains anchored to its original net ends.
      const pairA = a.terminals.map((t) => this.components.get(t.comp).terminalWorld(t.term));
      const pairB = b.terminals.map((t) => this.components.get(t.comp).terminalWorld(t.term));
      let paths;
      try {
        paths = balancedCrossCoupling(pairA, pairB);
      } catch {
        return null;
      }
      // A protected diagonal may not drill any component body. The pin map is
      // deliberately supplied as well: it keeps this safety check aligned with
      // the same outward-pin environment used by managed routing, while still
      // allowing a diagonal to leave a corner pin through its clear side.
      const env = this._netEnv();
      for (const path of paths) {
        for (let k = 1; k < path.length; k++) {
          if (env.rects.some((rect) => segThroughInterior(path[k - 1], path[k], rect))) return null;
        }
      }
      return { a, b, paths };
    };

    for (let i = 0; i < nets.length; i++) {
      for (let j = i + 1; j < nets.length; j++) {
        const candidate = candidateFor(nets[i], nets[j]);
        if (candidate) candidates.push(candidate);
      }
    }
    // A sibling net can make an otherwise plausible pair ambiguous. Do not
    // guess which two routes the author intended in that case.
    if (candidates.length !== 1 || (touched && !candidates.some(({ a, b }) => touched.has(a) || touched.has(b)))) return false;
    const { a, b, paths } = candidates[0];
    const entry = (net, path) => ({
      points: path,
      start: { ...net.terminals[0] },
      end: { ...net.terminals[1] },
    });
    this._installLiteralPaths(a, [entry(a, paths[0]).points]);
    this._installLiteralPaths(b, [entry(b, paths[1]).points]);
    return true;
  }

  /**
   * Commit one literal direct wire. `startRef` and `endRef` are terminal refs
   * (or `{x,y}` free points); `points` are intermediate points. Every point is
   * snapped and only consecutive duplicates are dropped. The path is installed
   * as managed geometry whose diagonal segments are protected; existing paths
   * of either joined net are kept as drawn. `options.fixed` builds a legacy
   * fixed net instead (the app no longer creates those).
   */
  wireDirectTo(startRef, endRef, points = [], options = {}) {
    this.invalidateRoutingCache();
    const endpoint = (value) => {
      if (typeof value === 'string' || (value && value.comp && value.term)) {
        const term = this.resolveTerm(value);
        return { term, point: this.getComponent(term.comp).terminalWorld(term.term) };
      }
      if (value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
        return { term: null, point: snapPoint(value.x, value.y) };
      }
      throw new Error('direct wire endpoints must be terminal refs or points');
    };
    const start = endpoint(startRef);
    const end = endpoint(endRef);
    if (start.term && end.term && start.term.comp === end.term.comp && start.term.term === end.term.term) {
      throw new Error(`cannot connect a terminal to itself: ${startRef}`);
    }
    const netAt = (p) => {
      for (const candidate of this.nets.values()) {
        if (candidate.paths().some((path) => pointOnPath(p, path))) return candidate;
      }
      return null;
    };
    const sourceNet = start.term ? this.netOfTerminal(start.term) : netAt(start.point);
    const targetNet = end.term ? this.netOfTerminal(end.term) : netAt(end.point);
    const involved = [...new Set([sourceNet, targetNet].filter(Boolean))];
    this._mergeNameConflict(involved, { allowConflict: true });
    const net = sourceNet || targetNet || this._createNet();
    net.preserveEmpty = true;
    const entries = involved.flatMap((n) => this._fixedPathEntries(n));
    const junctions = involved.flatMap((n) => n.junctions || []);

    // A free endpoint on existing geometry is a splice; record it as a
    // junction while preserving the existing fixed path.
    const pathAt = (p, candidate) => candidate && this._explicitBranches(candidate)
      .some((path) => pointOnPath(p, path));
    for (const endpointInfo of [start, end]) {
      if (!endpointInfo.term && involved.some((candidate) => pathAt(endpointInfo.point, candidate))) {
        if (!junctions.some((p) => p.x === endpointInfo.point.x && p.y === endpointInfo.point.y)) {
          junctions.push({ ...endpointInfo.point });
        }
      }
    }

    if (involved.length > 1) this._mergeNets(net, involved.filter((other) => other !== net), null, { allowNameConflict: true });
    for (const endpointInfo of [start, end]) {
      const t = endpointInfo.term;
      if (t && !net.terminals.some((q) => q.comp === t.comp && q.term === t.term)) net.terminals.push({ ...t });
    }
    const direct = [start.point, ...(points || []), end.point].map((p) => snapPoint(p.x, p.y));
    if (options.fixed) {
      // Legacy fixed-net construction; the app itself no longer creates these.
      this._setFixedPaths(net, [...entries, Net.fixedPathEntry({ points: direct, start: start.term, end: end.term }, true)], junctions);
    } else {
      this._installLiteralPaths(net, [...entries.map((entry) => entry.points), direct], junctions);
    }
    this._syncReferenceMarkerNetName(net);
    this._syncInterfacePinLabels(net, { enforceName: true });
    this.syncJunctionSolders();
    return net;
  }

  /**
   * Wire a terminal to a grid point `meet` by routing a new orthogonal branch
   * and attaching it to the net `meet` belongs to (an existing terminal or an
   * existing wire). `points` are optional hand-drawn waypoints between the
   * terminal and `meet`. If `meet` lies in the interior of an existing branch,
   * that branch is split at `meet`. Terminal membership and cross-net merging
   * are handled here, and junction solder dots are recomputed from the geometry
   * (never placed by hand). Returns the resulting net.
   */
  wireTo(termRef, meet, points = [], options = null) {
    this.invalidateRoutingCache();
    if (!Array.isArray(points)) { options = points; points = []; }
    const allowDiagonal = diagonalRouteRequested(options);
    const term = this.resolveTerm(termRef);
    const srcPos = this.getComponent(term.comp).terminalWorld(term.term);
    const P = snapPoint(meet.x, meet.y);

    // Terminal targets have priority. An explicitly
    // selected wire target is otherwise authoritative and must be validated;
    // inferred interior targets reject ambiguous cross-net hits instead of
    // depending on Map iteration order.
    const identity = wireTargetIdentity(options);
    const targetNet = resolveWireTarget(this, P, identity);

    const srcNet = this.netOfTerminal(term);
    const preserveExistingGeometry = [srcNet, targetNet].some((net) =>
      net && this._explicitBranches(net).length > 0);
    if (srcNet?.routingMode === 'fixed' || targetNet?.routingMode === 'fixed') {
      throw new Error('fixed net geometry is protected; use wireDirectTo');
    }
    if (srcNet && targetNet && srcNet !== targetNet) {
      this._mergeNameConflict([srcNet, targetNet], { allowConflict: true });
    }
    // Repeating an attachment that is already present is a no-op.  Besides
    // avoiding needless reducer work, this prevents the existing branch from
    // being treated as an obstacle and turning a harmless duplicate request
    // into an apparent routing failure.
    if (points.length === 0 && srcNet && srcNet === targetNet &&
        wirePointsConnected(srcNet, srcPos, P, this, identity?.pathIndex)) {
      if (!srcNet.terminals.some((entry) => entry.comp === term.comp && entry.term === term.term)) {
        srcNet.terminals.push({ comp: term.comp, term: term.term });
      }
      this._syncReferenceMarkerNetName(srcNet);
      this._syncInterfacePinLabels(srcNet, { enforceName: true });
      return srcNet;
    }

    const waypoints = points.map((p) => ({ x: snap(p.x), y: snap(p.y) }));

    // Compute an automatic branch before changing any net membership or
    // geometry.  `smartRoute` returns null when every candidate is unsafe;
    // falling back to [srcPos, P] would let that branch drill a body and would
    // also leave a partially merged net behind if the operation failed later.
    const mergingExisting = srcNet && targetNet && srcNet !== targetNet;
    let env = mergingExisting
      ? this._netEnv(new Set([srcNet.id, targetNet.id]))
      : this._routingEnv(srcNet?.id || null);
    let routed = allowDiagonal ? null : waypoints.length ? null : smartRoute(srcPos, P, env);
    if (!routed && targetNet && !mergingExisting && !waypoints.length && !allowDiagonal) {
      // Prefer a branch that clears every committed wire. If no safe corridor
      // exists, fall back to the target-net-excluded environment so the new
      // branch can still reach its requested attachment without rewriting the
      // existing net.
      env = this._netEnv(targetNet.id);
      routed = smartRoute(srcPos, P, env);
    }
    // Reciprocal MOS routes are the one intentional exception: their diagonal
    // geometry is promoted to protected cross-coupling below.  Do not make a
    // generic direct fallback available to managed wires.
    let direct = null;
    if (!waypoints.length && !routed && srcPos.x !== P.x && srcPos.y !== P.y) {
      const samePoint = (a, b) => a.x === b.x && a.y === b.y;
      for (const existing of this.nets.values()) {
        if (existing.routingMode !== 'managed' || existing.terminals.length !== 2 || existing.junctions.length) continue;
        const pair = existing.terminals.map((t) => this.components.get(t.comp)?.terminalWorld(t.term));
        if (pair.some((p) => !p)) continue;
        let paths;
        try { paths = balancedCrossCoupling(pair, [srcPos, P]); } catch { continue; }
        const candidate = paths.find((path) => path.length === 2 && samePoint(path[0], srcPos) && samePoint(path[1], P));
        if (candidate && !env.rects.some((rect) =>
          segThroughInterior(candidate[0], candidate[1], rect) &&
          !gateBodyCrossingAllowed(candidate[0], candidate[1], rect, env))) {
          direct = candidate;
          break;
        }
      }
    }
    const newPath = allowDiagonal
      ? diagonalDraftPath(this, [srcPos, ...waypoints, P], env)
      : waypoints.length
      ? clonePath([srcPos, ...waypoints, P])
      : routed || direct;
    if (!newPath) throw new Error('unable to route wire safely');

    const topology = this._snapshotNetTopology();
    let net;
    if (srcNet && targetNet && srcNet !== targetNet) {
      net = srcNet;
      const mergedBranches = [...this._explicitBranches(net), ...this._explicitBranches(targetNet)];
      this._mergeNets(net, [targetNet], null, { allowNameConflict: true });
      net.branches = mergedBranches;
    } else {
      net = srcNet || targetNet || this._createNet();
    }
    net.preserveEmpty = true;
    net.allowDiagonal = net.allowDiagonal || (srcNet?.allowDiagonal === true) ||
      (targetNet?.allowDiagonal === true) || allowDiagonal;

    // The wired terminal and any terminal exactly at `meet` become members.
    // The target interior split below is the only permitted edit to old wire
    // geometry during this topology operation.
    if (!net.terminals.some((t) => t.comp === term.comp && t.term === term.term)) {
      net.terminals.push({ comp: term.comp, term: term.term });
    }
    for (const c of this.components.values()) {
      for (const t of c.terminalDefs) {
        const p = c.terminalWorld(t.name);
        if (p.x === P.x && p.y === P.y && !net.terminals.some((q) => q.comp === c.refdes && q.term === t.name)) {
          net.terminals.push({ comp: c.refdes, term: t.name });
        }
      }
    }

    // Existing paths are committed geometry. Adding a terminal appends only
    // the newly routed branch; it never triggers a whole-net Steiner refresh.

    // Split any branch whose interior contains the meet point.
    const branches = [];
    for (const path of this._explicitBranches(net)) {
      const split = splitBranchAt(path, P, net.allowDiagonal);
      if (split) branches.push(...split.filter((h) => h.length >= 2));
      else branches.push(clonePath(path, net.allowDiagonal));
    }
    // Route the new branch from the terminal to the meet point.
    if (newPath) branches.push(clonePath(newPath, net.allowDiagonal));

    net.branches = branches;
    net.route = branches.length ? clonePath(branches[0], net.allowDiagonal) : null;
    net.junctions = this._netJunctions(net, branches);
    if (!preserveExistingGeometry) this._reduceNet(net);
    else this._joinGrownBranches(net);
    if (mergingExisting && !this._pathsConnectedToTerminals(net)) {
      this._restoreNetTopology(topology);
      throw new Error('unable to route wire safely');
    }
    this._syncReferenceMarkerNetName(net);
    this._syncInterfacePinLabels(net, { enforceName: true });
    this._inferCrossCoupling(new Set([net]));
    this.syncJunctionSolders();
    return net;
  }

  /**
   * Route a wire from a free grid point (or a point on an existing wire via
   * `netId`) to `meet`, splicing into the target net. `meet` and the origin
   * point may each touch a component terminal; those terminals are retained
   * as net members. `points` are optional hand-drawn waypoints between the
   * terminal and `meet`. Junction solder dots are derived from the resulting
   * geometry.
   */
  wirePointTo(point, meet, points = [], netId = null, options = null) {
    this.invalidateRoutingCache();
    if (!Array.isArray(points)) { options = points; points = []; }
    if (netId && typeof netId === 'object' && options == null) { options = netId; netId = null; }
    const allowDiagonal = diagonalRouteRequested(options);
    const P0 = snapPoint(point.x, point.y);
    const P = snapPoint(meet.x, meet.y);

    const identity = wireTargetIdentity(options);
    const targetNet = resolveWireTarget(this, P, identity);

    const originNet = netId ? this.nets.get(netId) : null;
    const preserveExistingGeometry = [originNet, targetNet].some((net) =>
      net && this._explicitBranches(net).length > 0);
    if (originNet?.routingMode === 'fixed' || targetNet?.routingMode === 'fixed') {
      throw new Error('fixed net geometry is protected; use wireDirectTo');
    }
    if (originNet && originNet === targetNet && !points.length &&
        wirePointsConnected(originNet, P0, P, this, identity?.pathIndex)) {
      this._syncReferenceMarkerNetName(originNet);
      this._syncInterfacePinLabels(originNet, { enforceName: true });
      return originNet;
    }
    if (P0.x === P.x && originNet && targetNet && originNet !== targetNet) {
      // Re-attaching a detached island at an existing terminal is a topology
      // operation, not a routing request. Preserve both drawn geometries and
      // only merge membership/junction state.
      const branches = [...this._explicitBranches(originNet), ...this._explicitBranches(targetNet)];
      const junctions = [...originNet.junctions, ...targetNet.junctions];
      this._mergeNameConflict([originNet, targetNet], { allowConflict: true });
      this._mergeNets(originNet, [targetNet], null, { allowNameConflict: true });
      originNet.allowDiagonal = originNet.allowDiagonal || targetNet.allowDiagonal;
      originNet.branches = branches;
      originNet.route = branches[0] ? clonePath(branches[0], originNet.allowDiagonal) : null;
      originNet.junctions = this._netJunctions(originNet, branches);
      for (const point of junctions) {
        if (!originNet.junctions.some((p) => p.x === point.x && p.y === point.y)) originNet.junctions.push({ ...point });
      }
      this._syncInterfacePinLabels(originNet, { enforceName: true });
      this.syncJunctionSolders();
      return originNet;
    }


    // Do not mutate the source/target nets until the automatic branch has a
    // valid route.  A straight fallback here can cross a component body.
    const waypoints = points.map((p) => ({ x: snap(p.x), y: snap(p.y) }));
    const newPath = allowDiagonal
      ? diagonalDraftPath(this, [P0, ...waypoints, P], this._routingEnv(new Set([originNet?.id, targetNet?.id].filter(Boolean))))
      : waypoints.length
      ? clonePath([P0, ...waypoints, P])
      : smartRoute(P0, P, this._routingEnv(new Set([originNet?.id, targetNet?.id].filter(Boolean))));
    if (!newPath) throw new Error('unable to route wire safely');

    let net = originNet || targetNet || this._createNet();
    net.preserveEmpty = true;
    if (originNet && targetNet && originNet !== targetNet) {
      const mergedBranches = [...this._explicitBranches(net), ...this._explicitBranches(targetNet)];
      this._mergeNets(net, [targetNet], null, { allowNameConflict: true });
      net.branches = mergedBranches;
    }
    net.allowDiagonal = net.allowDiagonal || originNet?.allowDiagonal === true ||
      targetNet?.allowDiagonal === true || allowDiagonal;
    // A free-point draft can begin exactly on a component terminal (for
    // example, when an authored diagonal X is drawn first and output stubs
    // are connected afterward). Preserve that touched terminal just like the
    // target terminal at P; otherwise the wire is drawable but eval reports a
    // dangling pin.
    for (const endpoint of [P0, P]) {
      for (const c of this.components.values()) {
      for (const t of c.terminalDefs) {
          const p = c.terminalWorld(t.name);
          if (p.x === endpoint.x && p.y === endpoint.y &&
              !net.terminals.some((q) => q.comp === c.refdes && q.term === t.name)) {
            net.terminals.push({ comp: c.refdes, term: t.name });
          }
        }
      }
    }

    const branches = [];
    for (const path of this._explicitBranches(net)) {
      const s0 = splitBranchAt(path, P0, net.allowDiagonal);
      if (s0) { branches.push(...s0.filter((h) => h.length >= 2)); continue; }
      const s = splitBranchAt(path, P, net.allowDiagonal);
      if (s) branches.push(...s.filter((h) => h.length >= 2));
      else branches.push(clonePath(path, net.allowDiagonal));
    }
    branches.push(clonePath(newPath, net.allowDiagonal));

    net.branches = branches;
    net.route = branches.length ? clonePath(branches[0], net.allowDiagonal) : null;
    net.junctions = this._netJunctions(net, branches);
    if (!preserveExistingGeometry) this._reduceNet(net);
    else this._joinGrownBranches(net);
    this._syncReferenceMarkerNetName(net);
    this._syncInterfacePinLabels(net, { enforceName: true });
    this._inferCrossCoupling(new Set([net]));
    this.syncJunctionSolders();
    return net;
  }

  /** Delete one visual segment and update the owning net's topology. */
  deleteWireSegment(netId, branch, segment) {
    return this.deleteWireSegments(netId, [{ branch, segment }]);
  }

  /** Delete several visual segments at once (shift-selected across branches
   *  and/or nets). Segments are cut from their branch polylines simultaneously,
   *  so indices never shift under one another; the affected nets are then split
   *  into the connected components of the remaining geometry. */
  deleteWireSegments(netId, segments) {
    this.invalidateRoutingCache();
    const net = this.nets.get(netId);
    if (!net) throw new Error(`unknown net "${netId}"`);
    if (net.routingMode === 'fixed') return this._deleteFixedWireSegments(net, segments);
    const paths = net.paths();
    const byBranch = new Map();
    for (const { branch, segment } of segments) {
      const path = paths[branch];
      if (!path || segment <= 0 || segment >= path.length) continue;
      if (!byBranch.has(branch)) byBranch.set(branch, new Set());
      byBranch.get(branch).add(segment);
    }
    if (byBranch.size === 0) return net;
    const next = [];
    for (let bi = 0; bi < paths.length; bi++) {
      const path = paths[bi];
      const cuts = [...(byBranch.get(bi) || [])].sort((a, b) => a - b);
      if (!cuts.length) {
        next.push(clonePath(path, net.allowDiagonal));
        continue;
      }
      // Cutting segment `s` removes the span path[s-1]..path[s]: the pieces
      // between consecutive cuts stay connected as separate polylines.
      let prev = 0;
      for (const s of cuts) {
        const piece = normalizePath(path.slice(prev, s));
        if (piece.length > 1) next.push(piece);
        prev = s;
      }
      const last = normalizePath(path.slice(prev));
      if (last.length > 1) next.push(last);
    }
    if (next.length === 0) return this.removeNet(net);
    net.branches = next.map((p) => clonePath(p, net.allowDiagonal));
    net.route = net.branches?.[0] ? clonePath(net.branches[0], net.allowDiagonal) : null;
    net.junctions = this._netJunctions(net, next);
    this._splitDisconnectedNet(net);
    this.syncJunctionSolders();
    return net;
  }

  /**
   * Split a protected direct net at the selected edges without passing its
   * geometry through any managed-wire helper.  The input paths and edge
   * indices are one immutable snapshot: every cut is applied to that snapshot
   * before the resulting pieces are partitioned into electrical islands.
   */
  _deleteFixedWireSegments(net, segments) {
    const original = net.fixedPaths.map((entry) => ({
      points: entry.points.map((p) => ({ ...p })),
      start: entry.start ? { ...entry.start } : null,
      end: entry.end ? { ...entry.end } : null,
    }));
    const cutsByPath = new Map();
    for (const { branch, segment } of segments || []) {
      const entry = original[branch];
      if (!entry || !Number.isInteger(segment) || segment <= 0 || segment >= entry.points.length) continue;
      const a = entry.points[segment - 1];
      const b = entry.points[segment];
      if (a.x === b.x && a.y === b.y) continue;
      if (!cutsByPath.has(branch)) cutsByPath.set(branch, new Set());
      cutsByPath.get(branch).add(segment);
    }
    if (cutsByPath.size === 0) return net;

    const pointKey = (p) => `${p.x},${p.y}`;
    const sameRef = (a, b) => a && b && a.comp === b.comp && a.term === b.term;
    const pieces = [];
    for (let branch = 0; branch < original.length; branch++) {
      const entry = original[branch];
      const cuts = [...(cutsByPath.get(branch) || [])].sort((a, b) => a - b);
      const boundaries = [0, ...cuts, entry.points.length];
      const degenerate = entry.points.length >= 2 &&
        entry.points.every((p) => p.x === entry.points[0].x && p.y === entry.points[0].y) &&
        entry.start && entry.end && !sameRef(entry.start, entry.end);
      for (let i = 0; i + 1 < boundaries.length; i++) {
        const from = boundaries[i];
        const to = boundaries[i + 1];
        const points = entry.points.slice(from, to).map((p) => ({ ...p }));
        if (from === 0 && to === entry.points.length && degenerate) {
          pieces.push({ points, start: entry.start && { ...entry.start }, end: entry.end && { ...entry.end }, branch });
          continue;
        }
        if (points.length < 2) continue;
        const hasGeometry = points.some((p, j) => j > 0 && pointKey(p) !== pointKey(points[j - 1]));
        if (!hasGeometry) continue;
        pieces.push({
          points,
          start: from === 0 && entry.start ? { ...entry.start } : null,
          end: to === entry.points.length && entry.end ? { ...entry.end } : null,
          branch,
        });
      }
    }

    // A fixed junction is electrical only when at least three distinct
    // electrical arms still touch it.  Directions are deduplicated across
    // overlapping/duplicate collinear pieces; an anchored terminal at the
    // junction contributes one additional arm without a geometric direction.
    const armDirections = (junction, piece) => {
      const directions = new Set();
      const direction = (from, to) => {
        const dx = Math.sign(to.x - from.x);
        const dy = Math.sign(to.y - from.y);
        if (dx || dy) directions.add(`${dx},${dy}`);
      };
      for (let i = 1; i < piece.points.length; i++) {
        const a = piece.points[i - 1];
        const b = piece.points[i];
        const on = pointOnPath(junction, [a, b]);
        if (!on || (a.x === b.x && a.y === b.y)) continue;
        direction(junction, a);
        direction(junction, b);
      }
      if ((piece.start && piece.points[0].x === junction.x && piece.points[0].y === junction.y) ||
          (piece.end && piece.points.at(-1).x === junction.x && piece.points.at(-1).y === junction.y)) {
        directions.add('terminal');
      }
      return directions;
    };
    const validJunctions = net.junctions.filter((junction) => {
      const directions = new Set();
      for (const piece of pieces) for (const arm of armDirections(junction, piece)) directions.add(arm);
      return directions.size >= 3;
    });
    const validJunctionKeys = new Set(validJunctions.map(pointKey));

    // Union only literal endpoints, shared terminal anchors, and explicitly
    // declared junctions.  Interior crossings remain unrelated geometry.
    const parent = pieces.map((_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    };
    const join = (a, b) => {
      const ra = find(a); const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };
    const endpointOwners = new Map();
    const anchorOwners = new Map();
    const junctionOwners = new Map();
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      for (const point of [piece.points[0], piece.points.at(-1)]) {
        const key = pointKey(point);
        if (endpointOwners.has(key)) join(i, endpointOwners.get(key));
        else endpointOwners.set(key, i);
      }
      for (const anchor of [piece.start, piece.end]) {
        if (!anchor) continue;
        const key = `${anchor.comp}.${anchor.term}`;
        if (anchorOwners.has(key)) join(i, anchorOwners.get(key));
        else anchorOwners.set(key, i);
      }
      for (const junction of validJunctions) {
        if (!pointOnPath(junction, piece.points)) continue;
        const key = pointKey(junction);
        if (junctionOwners.has(key)) join(i, junctionOwners.get(key));
        else junctionOwners.set(key, i);
      }
    }

    const groups = new Map();
    for (let i = 0; i < pieces.length; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(pieces[i]);
    }
    const islands = [...groups.values()].map((group) => {
      const anchors = [];
      for (const piece of group) for (const anchor of [piece.start, piece.end]) {
        if (anchor && !anchors.some((a) => sameRef(a, anchor))) anchors.push({ ...anchor });
      }
      const junctions = validJunctions.filter((junction) => {
        const key = pointKey(junction);
        return group.some((piece) => validJunctionKeys.has(key) && pointOnPath(junction, piece.points));
      }).map((p) => ({ ...p }));
      return { pieces: group, terminals: anchors, junctions };
    });

    if (islands.length) {
      const install = (target, island) => {
        target.preserveEmpty = true;
        target.terminals = island.terminals.map((t) => ({ ...t }));
        target.routingMode = 'fixed';
        target.route = null;
        target.branches = null;
        target.fixedPaths = island.pieces.map((piece) => Net.fixedPathEntry({
          points: piece.points,
          start: piece.start,
          end: piece.end,
        }));
        target.junctions = island.junctions.map((p) => ({ ...p }));
      };
      install(net, islands[0]);
      const children = [net];
      for (let i = 1; i < islands.length; i++) {
        const child = this.createWireNet({
          name: net.name,
          routingMode: 'fixed',
          drawOrder: net.drawOrder,
          fixedPaths: islands[i].pieces,
          junctions: islands[i].junctions,
          preserveEmpty: true,
        });
        child.terminals = islands[i].terminals.map((t) => ({ ...t }));
        children.push(child);
      }
      this._redistributeNetLabels(net, children);
    } else {
      this.removeNet(net);
    }
    this.ensureUniqueTerminals();
    this.syncJunctionSolders();
    return this.nets.get(net.id) || null;
  }

  _redistributeNetLabels(source, candidates) {
    if (candidates.length > 1) {
      // A split removes the merge conflict; do not keep warning about names
      // that now belong to different physical nets.
      this.netNameWarnings = this.netNameWarnings.filter((warning) => warning.netId !== source.id);
    }
    for (const label of [...this.labels.values()]) {
      if (label.netId !== source.id) continue;
      const point = label.anchorWorld();
      const matches = candidates.filter((net) => net && this._netLabelAnchorOnPath(net, point));
      if (matches.length === 1) label.setNetId(matches[0].id);
      else if (matches.length === 0) this.removeLabel(label);
    }
  }

  _nearestNetPathAttachment(net, point) {
    let best = null;
    let bestDistance = Infinity;
    for (const path of net.paths()) {
      if (path.length < 2) continue;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length2 = dx * dx + dy * dy;
        const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
        const projected = snapPoint(a.x + dx * t, a.y + dy * t);
        const candidate = pointOnPath(projected, [a, b]) ? projected :
          (Math.abs(point.x - a.x) + Math.abs(point.y - a.y) <= Math.abs(point.x - b.x) + Math.abs(point.y - b.y) ? a : b);
        const distance = Math.abs(point.x - candidate.x) + Math.abs(point.y - candidate.y);
        if (distance >= bestDistance) continue;
        const side = Math.abs(dx) >= Math.abs(dy)
          ? (point.y <= candidate.y ? 'above' : 'below')
          : (point.x <= candidate.x ? 'left' : 'right');
        bestDistance = distance;
        best = { point: { ...candidate }, side };
      }
    }
    return best;
  }

  _nearestNetPathPoint(net, point) {
    return this._nearestNetPathAttachment(net, point)?.point || null;
  }

  _repairNetLabels(net) {
    const paths = net.paths().filter((path) => path.length >= 2);
    for (const label of [...this.labels.values()]) {
      if (label.netId !== net.id) continue;
      const anchor = label.anchorWorld();
      if (paths.some((path) => pointOnPath(anchor, path))) continue;
      const replacement = this._nearestNetPathPoint(net, anchor);
      if (replacement) label.anchor = replacement;
      else this.removeLabel(label);
    }
  }

  /** Rebuild terminal membership after geometry deletion. A deleted wire is
   * allowed to split a net into the connected components of the remaining
   * geometry, each preserving its remaining branches. */
  _splitDisconnectedNet(net) {
    const paths = net.branches && net.branches.length ? net.branches : [];
    if (!paths.length || net.terminals.length < 2) return;
    const terminals = net.terminals.map((t) => ({ ...t, point: this.components.get(t.comp)?.terminalWorld(t.term) }));
    const components = splitByComponent(paths, terminals.filter((t) => t.point));
    if (components.length < 2) return;
    const apply = (n, comp) => {
      n.terminals = comp.terminals.map(({ comp, term }) => ({ comp, term }));
      n.branches = comp.paths.length ? comp.paths.map((p) => clonePath(p, n.allowDiagonal)) : null;
      n.route = n.branches && n.branches.length ? clonePath(n.branches[0], n.allowDiagonal) : null;
      n.junctions = this._netJunctions(n, comp.paths);
    };
    apply(net, components[0]);
    const children = [net];
    for (let i = 1; i < components.length; i++) {
      const child = this._createNet(net.name);
      child.allowDiagonal = net.allowDiagonal;
      apply(child, components[i]);
      children.push(child);
    }
    this._redistributeNetLabels(net, children);
  }

  /** Merge managed net pieces whose explicit wire endpoints now coincide.
   * Component moves can temporarily split a net; landing the pieces back on
   * the same grid endpoint restores the electrical junction without routing a
   * new branch. */
  reconnectCoincidentNets(netIds = null) {
    const allowed = netIds ? new Set(netIds) : null;
    let mergedCount = 0;
    const reducedCandidates = new Set();
    while (true) {
      const endpointNets = new Map();
      for (const net of this.nets.values()) {
        if (allowed && !allowed.has(net.id)) continue;
        if (net.routingMode === 'fixed') continue;
        for (const path of this._explicitBranches(net)) {
          if (path.length < 2) continue;
          for (const point of [path[0], path.at(-1)]) {
            const key = `${point.x},${point.y}`;
            if (!endpointNets.has(key)) endpointNets.set(key, []);
            endpointNets.get(key).push(net);
          }
        }
      }
      // A detached move can leave a wire endpoint floating without a terminal
      // in its net. Landing that terminal back on the endpoint restores the
      // endpoint membership before distinct net pieces are merged.
      for (const component of this.components.values()) {
        for (const terminal of component.worldTerminals()) {
          if (this.netOfTerminal({ comp: component.refdes, term: terminal.name })) continue;
          const candidates = endpointNets.get(`${terminal.x},${terminal.y}`) || [];
          const target = candidates.find((net) => this.nets.get(net.id) === net);
          if (target) target.terminals.push(this.resolveTerm(`${component.refdes}.${terminal.name}`));
        }
      }
      let merged = false;
      for (const candidates of endpointNets.values()) {
        const nets = [...new Set(candidates)].filter((net) => this.nets.get(net.id) === net);
        if (nets.length < 2) continue;
        const primary = nets[0];
        const sourcePaths = nets.map((net) => this._explicitBranches(net));
        const paths = sourcePaths.flat();
        const mergedWireStyles = {};
        let branchOffset = 0;
        for (let ni = 0; ni < nets.length; ni++) {
          const source = nets[ni];
          const sourceBranches = sourcePaths[ni];
          for (let branch = 0; branch < sourceBranches.length; branch++) {
            const segmentStyles = source.wireStyles || {};
            for (let segment = 1; segment < sourceBranches[branch].length; segment++) {
              const key = `${branchOffset + branch}:${segment}`;
              const sourceKey = `${branch}:${segment}`;
              mergedWireStyles[key] = { ...(segmentStyles[sourceKey] || source.style) };
            }
          }
          branchOffset += sourceBranches.length;
        }
        const junctions = nets.flatMap((net) => net.junctions);
        const endpointArms = new Map();
        for (const path of paths) {
          for (const point of [path[0], path.at(-1)]) {
            const key = `${point.x},${point.y}`;
            endpointArms.set(key, (endpointArms.get(key) || 0) + 1);
          }
        }
        for (const [key, arms] of endpointArms) {
          if (arms < 3) continue;
          const [x, y] = key.split(',').map(Number);
          junctions.push({ x, y });
        }
        primary.allowDiagonal = nets.some((net) => net.allowDiagonal);
        reducedCandidates.add(primary);
        this._mergeNets(primary, nets.slice(1), null, { allowNameConflict: true });
        primary.wireStyles = mergedWireStyles;
        primary.branches = paths.length
          ? paths.map((path) => clonePath(path, primary.allowDiagonal))
          : null;
        primary.route = primary.branches?.[0]
          ? clonePath(primary.branches[0], primary.allowDiagonal)
          : null;
        primary.junctions = [
          ...junctions,
          ...primary.junctions,
          ...this._netJunctions(primary, primary.branches || []),
        ].filter((point, index, all) =>
          all.findIndex((other) => other.x === point.x && other.y === point.y) === index);
        mergedCount += nets.length - 1;
        merged = true;
        break;
      }
      if (!merged) break;
    }
    for (const candidate of reducedCandidates) {
      if (this.nets.get(candidate.id) !== candidate ||
          candidate.routingMode === 'fixed' || candidate.terminals.length === 0) continue;
      const paths = this._explicitBranches(candidate);
      if (hasPositiveBranchOverlap(paths, candidate.allowDiagonal)) this._reduceNet(candidate);
    }
    this.syncJunctionSolders();
    return mergedCount;

  }

  /** Add one terminal to an existing net. */
  connectTo(netId, ref) {
    this.invalidateRoutingCache();
    const net = this.nets.get(netId);
    if (!net) throw new Error(`unknown net "${netId}"`);
    const r = this.resolveTerm(ref);
    if (net.terminals.some((t) => t.comp === r.comp && t.term === r.term)) return net;
    if (net.routingMode === 'fixed') throw new Error('cannot grow a fixed net with managed connect; use wireDirectTo');
    net.terminals.push(r);
    this._syncReferenceMarkerNetName(net);
    this._syncInterfacePinLabels(net, { enforceName: true });
    this._inferCrossCoupling(new Set([net]));
    this.syncJunctionSolders();
    return net;
  }

  /** Remove a single terminal from its net. Empty nets are dropped (returns null). */
  disconnect(ref) {
    this.invalidateRoutingCache();
    const r = this.resolveTerm(ref);
    let removed = null;
    for (const net of [...this.nets.values()]) {
      const before = net.terminals.length;
      net.terminals = net.terminals.filter((t) => !(t.comp === r.comp && t.term === r.term));
      if (net.terminals.length === before) continue;
      this._dropFixedAnchor(net, r);
      if (net.terminals.length === 0 && (!net.preserveEmpty || !this._netHasGeometry(net))) {
        this.removeNet(net);
      }
      removed = net;
      break;
    }
    if (!removed) throw new Error(`terminal ${ref} is not connected to any net`);
    this.syncJunctionSolders();
    return removed;
  }

  removeNet(netOrId) {
    this.invalidateRoutingCache();
    const net = this._resolveNet(netOrId);
    this.nets.delete(net.id);
    this.netNameWarnings = this.netNameWarnings.filter((warning) => warning.netId !== net.id);
    for (const [id, label] of [...this.labels]) {
      if (label.netId === net.id) this.labels.delete(id);
    }
    this.syncJunctionSolders();
    return net;
  }

  _netHasGeometry(net) {
    return !!net && net.paths().some((path) => path && path.length >= 2);
  }

  /**
   * The routing algorithm places an ACTUAL `solder` component at every junction
   * where >=3 branches of a net meet (the shared point of the balanced path
   * layout). Idempotent: a point already carrying a solder (manual or prior) is
   * left alone. Auto-placed solders are tagged with value "junction" so a later
   * pass can drop the ones whose junction no longer exists (e.g. after moving
   * or deleting a device); manually placed dots (empty value) are preserved.
   * Returns the newly added solders.
   */
  syncJunctionSolders() {
    for (const net of this.nets.values()) {
      this._repairNetLabels(net);
      // Diagonal permission is a property of the drawn segments, not a sticky
      // net-wide mode: joins or edits that leave no diagonal clear it.
      if (net.routingMode === 'managed') net.allowDiagonal = this._explicitBranches(net).some(pathHasDiagonal);
    }
    const at = (c) => `${c.transform.x},${c.transform.y}`;
    const solders = new Map();
    for (const c of this.components.values()) {
      if (c.type === 'solder') solders.set(at(c), c);
    }
    const junctions = new Map();
    const mark = (key, net) => {
      if (!junctions.has(key)) junctions.set(key, new Set());
      junctions.get(key).add(net.id);
    };
    for (const net of this.nets.values()) {
      if (net.routingMode === 'fixed') {
        // Fixed geometry never infers junctions from crossings, but a junction
        // explicitly carried over during promotion still owns its solder dot.
        for (const p of net.junctions) mark(`${p.x},${p.y}`, net);
        continue;
      }
      const paths = net.branches && net.branches.length ? net.branches : net.terminals.length >= 3 ? steinerBranches(net.terminalWorlds(), this._netEnv(net.id)) : [];
      for (const p of this._netJunctions(net, paths)) mark(`${p.x},${p.y}`, net);
      // A terminal landing on the interior of an existing branch is also a
      // visible electrical junction, even when the net has only two terminals.
      for (const t of net.terminals) {
        const c = this.components.get(t.comp);
        if (!c) continue;
        const p = c.terminalWorld(t.term);
        for (const path of paths) for (let i = 1; i < path.length; i++) {
          const a = path[i - 1]; const b = path[i];
          // A terminal at the end of its only branch is not a junction. Only
          // terminals landing in the interior of another wire need a dot.
          if ((a.x === b.x && p.x === a.x && p.y > Math.min(a.y, b.y) && p.y < Math.max(a.y, b.y)) ||
              (a.y === b.y && p.y === a.y && p.x > Math.min(a.x, b.x) && p.x < Math.max(a.x, b.x))) mark(`${p.x},${p.y}`, net);
        }
      }
    }
    const added = [];
    for (const [key, netIds] of junctions) {
      if (this.suppressedJunctions.has(key)) continue;
      const existing = solders.get(key);
      if (existing) {
        if (existing.value === 'junction' || existing.value?.startsWith('junction:')) {
          existing.value = netIds.size === 1 ? 'junction' : `junction:${[...netIds].sort().join('|')}`;
        }
        continue;
      }
      const [x, y] = key.split(',').map(Number);
      added.push(this.addComponent('solder', { x, y, value: netIds.size === 1 ? 'junction' : `junction:${[...netIds].sort().join('|')}` }));
    }
    // Prune every dot that is not on a current same-net junction. This keeps
    // both auto and manually inserted solder annotations from floating.
    for (const [key, comp] of solders) {
      if (!junctions.has(key)) {
        this.components.delete(comp.refdes);
      }
    }
    return added;
  }

  countTerminals() {
    let n = 0;
    for (const c of this.components.values()) n += c.terminalDefs.length;
    return n;
  }

  // ----- queries used by renderer / agent ----------------------------

  /** Bounds of everything drawable (components + nets + labels), with margin. */
  bounds(margin = 0) {
    const rects = [];
    for (const c of this.components.values()) rects.push(c.bboxWorld());
    for (const label of this.labels.values()) rects.push(label.bbox());
    for (const net of this.nets.values()) {
      const pts = net.pathPoints();
      if (pts.length) rects.push(rectFromPoints(pts));
    }
    if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    const r = rectUnion(rects);
    return { x: r.x - margin, y: r.y - margin, w: r.w + 2 * margin, h: r.h + 2 * margin };
  }

  // ----- serialization -------------------------------------------------

  toJSON() {
    return {
      version: 2,
      grid: 40,
      components: [...this.components.values()].map((c) => c.toJSON()),
      nets: [...this.nets.values()].map((n) => n.toJSON()),
      labels: [...this.labels.values()].map((l) => l.toJSON()),
      netNameWarnings: this.netNameWarnings.map((warning) => ({
        netId: warning.netId,
        names: warning.names.slice(),
        message: warning.message,
      })),
      suppressedJunctions: [...this.suppressedJunctions],
    };
  }

  static fromJSON(data) {
    if (!data || ![1, 2].includes(data.version)) throw new Error('unsupported state version');
    const circuit = new Circuit();
    circuit.suppressedJunctions = new Set(data.suppressedJunctions || []);
    circuit._loading = true;
    for (const c of data.components) {
      // The filled terminal marker was folded into the one labelled port.
      circuit.addComponent(serializedComponentType(c.type === 'port_filled' ? 'port' : c.type), {
        refdes: c.refdes,
        value: c.value,
        x: c.transform.x,
        y: c.transform.y,
        rotation: c.transform.rotation,
        mirrorX: c.transform.mirrorX,
        mirrorY: c.transform.mirrorY,
        blockSize: c.blockSize,
        blockTerminals: c.blockTerminals,
        style: c.style,
        analysis: migrateSerializedComponentAnalysis(c.analysis),
        drawOrder: c.drawOrder,
        noLabel: true,
      });
    }
    let maxNetId = 0;
    for (const n of data.nets) {
      const fixed = data.version >= 2 && n.routingMode === 'fixed';
      const net = new Net(circuit, {
        name: n.name,
        style: n.style,
        analysis: n.analysis,
        drawOrder: n.drawOrder,
        wireStyles: n.wireStyles,
        routingMode: fixed ? 'fixed' : 'managed',
        allowDiagonal: !fixed && n.allowDiagonal === true,
        fixedPaths: fixed ? n.fixedPaths : null,
        preserveEmpty: !!n.preserveEmpty || !n.terminals?.length,
      });
      net.id = n.id;
      for (const t of n.terminals) {
        const component = circuit.components.get(t.comp);
        net.terminals.push({ ...t, term: serializedTerminalName(component?.type, t.term) });
      }
      if (!fixed) {
        net.route = n.route ? clonePath(n.route, net.allowDiagonal) : null;
        if (Array.isArray(n.junctions)) net.junctions = n.junctions.map((p) => ({ x: p.x, y: p.y }));
        if (Array.isArray(n.branches)) net.branches = n.branches.map((p) => clonePath(p, net.allowDiagonal));
      } else if (Array.isArray(n.junctions)) {
        const seen = new Set();
        net.junctions = n.junctions
          .filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
          .map((p) => ({ x: snap(p.x), y: snap(p.y) }))
          .filter((p) => {
            const key = `${p.x},${p.y}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        circuit._sanitizeFixedAnchors(net);
      }
      if (fixed) circuit._sanitizeFixedAnchors(net);
      circuit.nets.set(net.id, net);
      const num = parseInt(String(n.id).replace(/\D/g, ''), 10) || 0;
      if (num > maxNetId) maxNetId = num;
    }
    // Keep the id counter ahead of every loaded net so new nets never collide
    // with (and silently overwrite) a loaded one.
    circuit._netId = maxNetId;
    circuit.netNameWarnings = (data.netNameWarnings || [])
      .filter((warning) => circuit.nets.has(warning.netId) && Array.isArray(warning.names) && warning.names.length > 1)
      .map((warning) => ({
        netId: warning.netId,
        names: [...new Set(warning.names.filter(Boolean))],
        message: warning.message || `merged nets with names ${warning.names.join(', ')}`,
      }))
      .filter((warning) => warning.names.length > 1);
    // A secondary name on a separate current net is a stale warning from a
    // merge that was later split.
    circuit.netNameWarnings = circuit.netNameWarnings.filter((warning) => !warning.names.slice(1).some((name) =>
      [...circuit.nets].some(([id, net]) => id !== warning.netId && canonicalNetName(net.name) === canonicalNetName(name))));
    const loadedLabelIds = new Set();
    for (const l of data.labels || []) {
      if (l.id && loadedLabelIds.has(l.id)) throw new Error(`label id "${l.id}" already in use`);
      if (l.id) loadedLabelIds.add(l.id);
      if (l.netId && !circuit.nets.has(l.netId)) {
        continue;
      }
      let label;
      try {
        label = circuit.addLabel({
          id: l.id,
          kind: l.kind,
          text: l.text,
          align: l.align,
          owner: l.owner || null,
          referenceLocal: l.referenceLocal,
          parent: l.parent || null,
          netId: l.netId || null,
          math: !!l.math,
          mathBox: l.mathBox,
          netSide: l.netSide,
          offset: l.offset || null,
          x: l.anchor ? l.anchor.x : 0,
          y: l.anchor ? l.anchor.y : 0,
          end: l.end || null,
          points: l.points || null,
          textAnchor: l.textAnchor || null,
          style: l.style || null,
          drawOrder: l.drawOrder,
        });
      } catch (err) {
        continue;
      }
      if (label.owner && !circuit.components.has(label.owner)) circuit.labels.delete(label.id);
      if (label.netId && !circuit._netLabelAnchorOnPath(label.netId, label.anchorWorld())) circuit.labels.delete(label.id);
    }
    // Ports predating their owned name label get one, like the boxed ports.
    for (const component of circuit.components.values()) {
      if (component.type !== 'port' || circuit.labelOf(component.refdes)) continue;
      try { circuit._ensureComponentInstanceLabel(component); } catch { /* label id in use */ }
    }
    // Restore direct pin contacts that are not represented by wire geometry.
    if (!data.topologyOnly) circuit.connectCoincident();
    // Migrate legacy owned instance labels that persisted a compact trailing
    // number (for example `M1`) to the explicit source used by the current
    // renderer (`M_{1}`). Custom markup such as `R_{D}` is preserved.
    for (const component of circuit.components.values()) {
      const label = circuit.labelOf(component.refdes);
      if (!label || isReferenceMarker(component)) continue;
      if (labelMatchesRefdes(label._text, component.refdes)) {
        label._text = componentLabelText(component.refdes, label._text);
        label.clearRenderedTextBounds();
      }
    }
    for (const net of circuit.nets.values()) {
      circuit._syncReferenceMarkerNetName(net);
      circuit._syncAnalysisAttributes(net);
      circuit._syncInterfacePinLabels(net, { enforceName: !net.name, preserveSource: true });
    }
    // every junction is a real vertex, drop duplicate branches, and reduce each
    // net to a minimal connected structure (no parallel wires, no loops).
    for (const net of circuit.nets.values()) circuit._reduceNet(net);
    circuit.syncJunctionSolders();
    circuit._loading = false;
    return circuit;
  }
}
