import { applyTransform, applyDir, inverseTransform, rectFromPoints, rectUnion, transformRect } from './geometry.js';
import { snap, snapPoint, GRID } from './grid.js';
import { getSymbol } from './components/index.js';
import { autoRoute, balancedPaths, balancedRoute, smartRoute } from './router.js';
import { collapseCollinear } from './wireedit.js';
import { clonePath, deleteWireSegment, junctionPoints, normalizeBranches, pathLength, pointOnPath, splitBranchAt, splitByComponent, validateWiring } from './wiring.js';

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
 * superscript runs (e.g. "C_{GS}", "V^{DD}"). Owned instance labels
 * (autoSubscript) additionally subscript a trailing numeric suffix so a refdes
 * like "M1" renders as M with a subscript 1. Returns [{text, sub, super}].
 */
export function parseLabelRuns(text, opts = {}) {
  const auto = opts.autoSubscript;
  const str = String(text);
  const runs = [];
  let normal = '';
  let i = 0;
  const flush = () => {
    if (!normal) return;
    if (auto && !normal.includes('_') && !normal.includes('^')) {
      const m = normal.match(/^([^\d]+)(\d+)$/);
      if (m) {
        runs.push({ text: m[1] });
        runs.push({ text: m[2], sub: true });
        normal = '';
        return;
      }
    }
    runs.push({ text: normal });
    normal = '';
  };
  while (i < str.length) {
    const c = str[i];
    if ((c === '_' || c === '^') && str[i + 1] === '{') {
      const end = str.indexOf('}', i + 2);
      if (end !== -1) {
        flush();
        runs.push({ text: str.slice(i + 2, end), sub: c === '_', super: c === '^' });
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

/** Tight height (world units) of a rendered label line (cap height). */
export const LABEL_CAP_H = Math.round(LABEL_FONT_SIZE * 0.7);

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

/**
 * A free-floating or component-owned text label. The label's ANCHOR is always
 * a grid point. The label's rendered box is derived from the tight bounding
 * box of its text metric, then expanded so BOTH dimensions are even multiples
 * of a grid square (2, 4, 6 ... cells) and the whole box is centered on the
 * anchor — so the box center always lands on a grid point, and the text (which
 * is vertically centered, and horizontally aligned left/center/right within the
 * box) is always symmetric about the grid. The box always updates as the text
 * changes (setText).
 * Owned labels ("instance labels", e.g. M1 on a transistor) live in local
 * component space via `offset` and follow the owner's transform.
 */
export class LabelInstance {
  constructor(circuit, opts = {}) {
    this.circuit = circuit;
    this.id = opts.id || uid();
    this.text = opts.text !== undefined ? String(opts.text) : 'label';
    this.align = ['center', 'left', 'right'].includes(opts.align) ? opts.align : 'center';
    this.owner = opts.owner || null;
    this.offset = opts.offset ? { x: snap(opts.offset.x), y: snap(opts.offset.y) } : null;
    const p = snapPoint(opts.x || 0, opts.y || 0);
    this.anchor = { x: p.x, y: p.y };
  }

  isOwned() {
    return !!this.owner;
  }

  /** World position of the label anchor (underline anchor), grid-snapped. */
  anchorWorld() {
    if (this.owner) {
      const c = this.circuit.components.get(this.owner);
      if (c) return applyTransform(c.transform, this.offset.x, this.offset.y);
    }
    return { x: this.anchor.x, y: this.anchor.y };
  }

  /** Tight width (world units) of the rendered text line. Sub/superscript runs
   *  render smaller (0.62 em) so they contribute less width to the box. */
  textWidth() {
    const runs = this.runs();
    let w = 0;
    for (const r of runs) {
      const scale = r.sub || r.super ? 0.62 : 1;
      for (const ch of r.text) w += charWidth(ch) * scale;
    }
    return w;
  }

  /** Rich-text runs of this label's text (subscripts for owned instance ids). */
  runs() {
    return parseLabelRuns(this.text, { autoSubscript: !!this.owner });
  }

  /** Tight height (world units) of the rendered text line. */
  textHeight() {
    return LABEL_CAP_H;
  }

  /** Even number of grid cells >= 2 needed to hold the text horizontally. */
  colWidth() {
    let n = Math.ceil(this.textWidth() / GRID);
    n += n % 2; // even so the centered box's center stays on a grid point
    return Math.max(2, n);
  }

  /** Even number of grid cells >= 2 needed to hold the text vertically. */
  rowHeight() {
    let n = Math.ceil(this.textHeight() / GRID);
    n += n % 2;
    return Math.max(2, n);
  }

  /**
   * The rendered box, centered on the anchor (a grid point) with its
   * width/height as even multiples of a grid square. Independent of align:
   * alignment only positions the text inside this box.
   */
  bbox() {
    const a = this.anchorWorld();
    const w = this.colWidth() * GRID;
    const h = this.rowHeight() * GRID;
    return { x: a.x - w / 2, y: a.y - h / 2, w, h };
  }

  /**
   * Where to draw the text and its text-anchor so the text is horizontally
   * aligned within the box (left/center/right) and vertically centered on the
   * anchor. Returns {x, y, anchor} for an SVG <text> element.
   */
  textPos() {
    const a = this.anchorWorld();
    const b = this.bbox();
    let x, anchor;
    if (this.align === 'left') {
      x = b.x;
      anchor = 'start';
    } else if (this.align === 'right') {
      x = b.x + b.w;
      anchor = 'end';
    } else {
      x = a.x;
      anchor = 'middle';
    }
    // Baseline sits below the box center so the cap height is vertically
    // centered on the anchor (grid point).
    const y = a.y + LABEL_CAP_H / 2;
    return { x, y, anchor };
  }

  setText(text) {
    this.text = String(text);
  }

  setAlign(a) {
    if (['center', 'left', 'right'].includes(a)) this.align = a;
  }

  /** Move the anchor to a world point (snapped). Owned labels move via their local offset. */
  moveTo(wx, wy) {
    wx = snap(wx);
    wy = snap(wy);
    if (this.owner) {
      const c = this.circuit.components.get(this.owner);
      if (c) {
        const lo = inverseTransform(c.transform, wx, wy);
        this.offset = { x: snap(lo.x), y: snap(lo.y) };
        return;
      }
    }
    this.anchor = { x: wx, y: wy };
  }

  /** Translate the anchor by a grid-aligned delta. */
  translate(dx, dy) {
    const a = this.anchorWorld();
    this.moveTo(a.x + dx, a.y + dy);
  }

  toJSON() {
    return {
      id: this.id,
      text: this.text,
      align: this.align,
      owner: this.owner,
      offset: this.offset ? { ...this.offset } : null,
      anchor: this.owner ? null : { ...this.anchor },
    };
  }
}

export class ComponentInstance {
  constructor(circuit, type, opts = {}) {
    this.circuit = circuit;
    this.type = type;
    this.def = getSymbol(type);
    this.refdes = opts.refdes || circuit.nextRefdes(this.def.refPrefix || type.toUpperCase());
    this.value = opts.value !== undefined ? String(opts.value) : this.def.defaultValue;
    this.transform = {
      x: snapPoint(opts.x || 0, opts.y || 0).x,
      y: snapPoint(opts.x || 0, opts.y || 0).y,
      rotation: opts.rotation || 0,
      mirrorX: opts.mirrorX !== undefined ? !!opts.mirrorX : !!(this.def && this.def.defaultMirrorX),
      mirrorY: opts.mirrorY !== undefined ? !!opts.mirrorY : !!(this.def && this.def.defaultMirrorY),
    };
  }

  localTerminal(name) {
    const t = this.def.terminals.find((t) => t.name === name);
    if (!t) throw new Error(`component ${this.refdes} has no terminal "${name}"`);
    return t;
  }

  /** World (absolute, grid-snapped) position of a terminal. */
  terminalWorld(name) {
    const t = this.localTerminal(name);
    return applyTransform(this.transform, t.x, t.y);
  }

  worldTerminals() {
    return this.def.terminals.map((t) => ({ name: t.name, ...this.terminalWorld(t.name) }));
  }

  bboxWorld() {
    return transformRect(this.transform, this.def.bbox);
  }

  toJSON() {
    return {
      refdes: this.refdes,
      type: this.type,
      value: this.value,
      transform: { ...this.transform },
    };
  }
}

export class Net {
  constructor(circuit, opts = {}) {
    this.circuit = circuit;
    this.id = opts.id || uid();
    this.name = opts.name || '';
    /** Ordered list of {comp, term} terminal references. */
    this.terminals = [];
    /** Optional explicit grid-snapped wire path points. null => auto-route. */
    this.route = opts.route ? clonePath(opts.route) : null;
    /** Grid points where other wires join this net (mid-wire junctions). */
    this.junctions = opts.junctions ? opts.junctions.map((p) => ({ x: p.x, y: p.y })) : [];
    /** Optional list of wire branches (each a polyline) for multi-way joined
     *  nets; when present the renderer draws every branch. */
    this.branches = opts.branches ? opts.branches.map(clonePath) : null;
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
    const anchors = this.anchorWorlds();
    if (anchors.length === 0) return [];
    if (this.route && this.route.length >= 2) return this.route.slice();
    if (this.branches && this.branches.length) return this.branches[0].slice();
    const env = this.circuit._netEnv();
    if (this.junctions.length) {
      const path = [{ ...anchors[0] }];
      for (let i = 1; i < anchors.length; i++) {
        const seg = smartRoute(path[path.length - 1], anchors[i], env);
        if (seg && seg.length >= 2) for (let k = 1; k < seg.length; k++) path.push({ ...seg[k] });
      }
      return path;
    }
    if (anchors.length === 2) {
      // Match the editor preview: two-terminal nets escape each pin one cell
      // outward before bending, so a committed wire never drills a body.
      return smartRoute(anchors[0], anchors[1], env);
    }
    return autoRoute(anchors);
  }

  /** Canonical editable paths. Automatic nets are deliberately not materialized. */
  paths() {
    if (this.branches && this.branches.length) return this.branches.map(clonePath);
    if (this.route && this.route.length >= 2) return [clonePath(this.route)];
    const pts = this.points();
    return pts.length >= 2 ? [pts] : [];
  }

  wireSegments() {
    return this.paths().flatMap((path, branch) => path.slice(1).map((b, i) => ({ branch, index: i + 1, a: path[i], b })));
  }

  /** Every drawn polyline of the net (all branches), for bounds and evaluation. */
  pathPoints() {
    return this.paths().flatMap((b) => b);
  }

  /** Total manhattan length of the drawn wire(s). */
  length() {
    return this.paths().reduce((sum, pts) => sum + pathLength(pts), 0);
  }

  wiringErrors() { return validateWiring(this); }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      terminals: this.terminals.map((t) => ({ ...t })),
      route: this.route ? this.route.map((p) => ({ ...p })) : null,
      junctions: this.junctions.map((p) => ({ ...p })),
      branches: this.branches ? this.branches.map((b) => b.map((p) => ({ ...p }))) : null,
    };
  }
}

export class Circuit {
  constructor() {
    this.components = new Map();
    this.nets = new Map();
    this.labels = new Map();
    this._netId = 0;
    /** Junction annotations explicitly removed by the user stay removed. */
    this.suppressedJunctions = new Set();
  }

  // ----- components -------------------------------------------------

  /** Smallest unused refdes index for a prefix ("R" -> R1, R2, R4 if R3 exists...). */
  nextRefdes(prefix) {
    const used = new Set();
    for (const c of this.components.values()) {
      if (c.refdes.startsWith(prefix)) {
        const n = Number(c.refdes.slice(prefix.length));
        if (Number.isInteger(n) && n > 0) used.add(n);
      }
    }
    let n = 1;
    while (used.has(n)) n++;
    return `${prefix}${n}`;
  }

  addComponent(type, opts = {}) {
    const inst = new ComponentInstance(this, type, opts);
    if (this.components.has(inst.refdes)) throw new Error(`reference designator ${inst.refdes} already in use`);
    this.components.set(inst.refdes, inst);
    // Transistor-style symbols carry a dedicated instance label from the start.
    if (inst.def.labelOffset && !opts.noLabel) {
      this.addLabel({ text: inst.refdes, owner: inst.refdes, offset: inst.def.labelOffset, align: 'center' });
    }
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

  moveComponent(refdes, x, y) {
    const c = this.getComponent(refdes);
    const p = snapPoint(x, y);
    c.transform.x = p.x;
    c.transform.y = p.y;
    return c;
  }

  setTransform(refdes, { rotation, mirrorX, mirrorY } = {}) {
    const c = this.getComponent(refdes);
    if (rotation !== undefined) c.transform.rotation = ((Math.round(rotation / 90) % 4) + 4) % 4 * 90;
    if (mirrorX !== undefined) c.transform.mirrorX = !!mirrorX;
    if (mirrorY !== undefined) c.transform.mirrorY = !!mirrorY;
    this.connectCoincident(refdes);
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
    return c;
  }

  removeComponent(refdes) {
    const c = this.getComponent(refdes);
    if (c.type === 'solder') this.suppressedJunctions.add(`${c.transform.x},${c.transform.y}`);
    for (const net of this.nets.values()) {
      net.terminals = net.terminals.filter((t) => t.comp !== refdes);
      if (net.terminals.length === 0) this.nets.delete(net.id);
    }
    for (const [id, l] of [...this.labels]) if (l.owner === refdes) this.labels.delete(id);
    this.components.delete(refdes);
    this.syncJunctionSolders();
    return true;
  }

  // ----- labels -------------------------------------------------

  addLabel(opts = {}) {
    const inst = new LabelInstance(this, opts);
    this.labels.set(inst.id, inst);
    return inst;
  }

  removeLabel(id) {
    return this.labels.delete(id);
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

  /** Routing environment for a net's default route: component bboxes + pins. */
  _netEnv() {
    const rects = [];
    const pins = new Map();
    for (const c of this.components.values()) {
      if (c.type === 'solder') continue;
      rects.push(c.bboxWorld());
      for (const t of c.def.terminals) {
        const w = c.terminalWorld(t.name);
        pins.set(`${w.x},${w.y}`, this._pinDir(c, t, w.x, w.y));
      }
    }
    return { rects, pins, wires: [] };
  }

  /** Routing environment that also treats every existing wire as an obstacle
   *  (collinear overlap is forbidden, crossing is allowed). Used when routing a
   *  new branch so it never runs along an existing wire. */
  _routingEnv() {
    const env = this._netEnv();
    const wires = [];
    for (const n of this.nets.values()) wires.push(...this._explicitBranches(n));
    env.wires = wires;
    return env;
  }

  /** Re-route a net, preserving hand-drawn wire shapes. `moved` (optional) is a
   *  Map of refdes -> {dx,dy} for components that just moved: polylines whose
   *  endpoints ride the SAME moved component slide with it (manual loops are
   *  kept), one-end-moved legs get re-anchored at the new pin with their drawn
   *  body intact, and untouched polylines stay byte-identical. Routes that were
   *  never hand-drawn are laid out fresh. This is the general-purpose router —
   *  no symbol- or net-type special cases. */
  rerouteNet(net, moved = null) {
    const env = this._netEnv();
    const anchors = net.anchorWorlds();
    // A non-translation transform (rotate/mirror) relocates terminals in a way
    // the drawn body cannot follow; lay the net out fresh from its terminals.
    if (moved === 'refresh') {
      net.branches = null;
      net.route = null;
      net.junctions = []; // stale junction points would steer _layoutFresh into the single-polyline branch and skip balancedPaths
      this._layoutFresh(net, anchors, env);
      return;
    }
    if (net.branches && net.branches.length) {
      net.branches = net.branches.map((b) => clonePath(this._reroutePolyline(net, b, moved, env)));
      net.route = net.branches[0] ? clonePath(net.branches[0]) : null;
      return;
    }
    if (net.route && net.route.length >= 2) {
      net.route = clonePath(this._reroutePolyline(net, net.route, moved, env));
      return;
    }
    // A one-terminal net may own a deliberate wire stub. Never erase that
    // geometry merely because it has no second electrical endpoint yet.
    if (anchors.length < 2) return;
    // No drawn shape to preserve: lay out fresh from the anchors.
    this._layoutFresh(net, anchors, env);
  }

  /** Lay a net out from its terminals without consulting any existing route. */
  _layoutFresh(net, anchors, env) {
    if (net.junctions.length) {
      const path = [{ ...anchors[0] }];
      for (let i = 1; i < anchors.length; i++) {
        const seg = smartRoute(path[path.length - 1], anchors[i], env);
        if (seg && seg.length >= 2) for (let k = 1; k < seg.length; k++) path.push({ ...seg[k] });
      }
      collapseCollinear(path);
      net.route = path.slice();
      net.branches = [net.route.slice()];
    } else if (anchors.length === 2) {
      net.route = smartRoute(anchors[0], anchors[1], env);
      net.branches = null;
    } else {
      // 3+ terminal net with no explicit junction: store the balanced T-junction
      // as multiple branches (external → junction → each pair terminal) so the
      // renderer draws a clean centered T and the junction solder lands at the
      // shared point. Previously a single polyline was used, which collapsed
      // the three arms into one winding path and looked asymmetric.
      const paths = balancedPaths(anchors, env);
      net.branches = paths.map(clonePath);
      net.route = paths[0] ? clonePath(paths[0]) : null;
      net.junctions = this._netJunctions(net, paths);
    }
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
        for (const t of c.def.terminals) {
          const cur = c.terminalWorld(t.name);
          const old = { x: cur.x - delta.dx, y: cur.y - delta.dy };
          if (Math.abs(p.x - old.x) <= 1 && Math.abs(p.y - old.y) <= 1) return { refdes, cur, delta };
        }
      }
      return null;
    };
    const a0 = classify(poly[0]);
    const a1 = classify(poly[n - 1]);
    if (a0 && a1 && a0.refdes === a1.refdes) {
      // Both ends ride the same moved component: slide the whole drawn body.
      return poly.map((p) => ({ x: p.x + a0.delta.dx, y: p.y + a0.delta.dy }));
    }
    if (a0) {
      // The start pin moved: re-anchor the first leg, keep the drawn body.
      const leg = smartRoute({ x: a0.cur.x, y: a0.cur.y }, poly[1], env);
      const out = leg && leg.length >= 2 ? [...leg, ...poly.slice(1)] : [{ x: a0.cur.x, y: a0.cur.y }, ...poly.slice(1)];
      collapseCollinear(out);
      return out;
    }
    if (a1) {
      // The path is stored in start-to-end order. Route forward from the old
      // penultimate point to the moved end pin; routing in the opposite order
      // leaves the visible branch ending at the old penultimate point.
      const leg = smartRoute(poly[n - 2], { x: a1.cur.x, y: a1.cur.y }, env);
      const out = leg && leg.length >= 2 ? [...poly.slice(0, n - 2), ...leg] : [...poly.slice(0, n - 1), { x: a1.cur.x, y: a1.cur.y }];
      collapseCollinear(out);
      return out;
    }
    return poly.map((p) => ({ ...p }));
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
    const net = new Net(this, { name });
    this._netId += 1;
    net.id = `N${this._netId}`;
    this.nets.set(net.id, net);
    return net;
  }

  /**
   * Connect terminals. Accepts many refs ("R1.a", "C2.b", ...) as the same
   * net; nets are created/merged as needed. Returns the resulting net.
   */
  connect(...refs) {
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
    let net;
    if (involved.size === 0) {
      net = this._createNet();
    } else {
      const first = [...involved.values()][0];
      net = first;
      for (const other of new Set(involved.values())) {
        if (other === net) continue;
        // merge other into net
        for (const t of other.terminals) net.terminals.push(t);
        const paths = other.paths();
        if (paths.length) {
          const own = net.branches && net.branches.length ? net.branches : net.route ? [net.route] : [];
          net.branches = [...own, ...paths].map(clonePath);
          net.route = net.branches[0] ? clonePath(net.branches[0]) : null;
        }
        for (const p of other.junctions) if (!net.junctions.some((q) => q.x === p.x && q.y === p.y)) net.junctions.push({ ...p });
        this.nets.delete(other.id);
      }
    }
    for (const r of okRefs) {
      const key = `${r.comp}.${r.term}`;
      if (!involved.has(key)) net.terminals.push(r);
    }
    // Re-layout fresh whenever at least one terminal was added to an existing
    // net. Without this, the new terminal is appended to `net.terminals` but
    // the carried-over `net.branches`/`net.route` still cover only the
    // original terminals — `paths()` (and after a save/reload, the persisted
    // file) returns the smaller wire and the new terminal ends up connected
    // "by reference" only, with no drawn branch reaching it. The all-new-refs
    // case below also benefits (cheaper than two separate routing calls).
    // The all-existing-refs edge case (rare; nothing was added) keeps any
    // hand-drawn geometry.
    const addedNew = okRefs.some((r) => !involved.has(`${r.comp}.${r.term}`));
    if (addedNew && net.terminals.length >= 2) {
      this.rerouteNet(net, 'refresh');
    }
    this.syncJunctionSolders();
    return net;
  }

  /** Explicit (hand-authored or committed) branch geometry of a net, ignoring
   *  the auto-route fallback so join logic never duplicates it. */
  _explicitBranches(net) {
    if (net.branches && net.branches.length) return net.branches.map(clonePath);
    if (net.route && net.route.length >= 2) return [clonePath(net.route)];
    return [];
  }

  /** Junction points of a net's branches, counting each terminal as an arm. */
  _netJunctions(net, paths) {
    const terminals = net.terminals.map((t) => this.getComponent(t.comp)?.terminalWorld(t.term)).filter(Boolean);
    return junctionPoints(paths, terminals);
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
  wireTo(termRef, meet, points = []) {
    const term = this.resolveTerm(termRef);
    const srcPos = this.getComponent(term.comp).terminalWorld(term.term);
    const P = snapPoint(meet.x, meet.y);

    // The net `meet` belongs to: either a terminal exactly there, or a branch.
    let targetNet = null;
    for (const net of this.nets.values()) {
      for (const t of net.terminals) {
        const p = this.getComponent(t.comp).terminalWorld(t.term);
        if (p.x === P.x && p.y === P.y) { targetNet = net; break; }
      }
      if (targetNet) break;
    }
    if (!targetNet) {
      for (const net of this.nets.values()) {
        if (this._explicitBranches(net).some((path) => pointOnPath(P, path))) { targetNet = net; break; }
      }
    }

    const srcNet = this.netOfTerminal(term);

    // Merge the source terminal's net with the target net when they differ.
    let net;
    if (srcNet && targetNet && srcNet !== targetNet) {
      net = srcNet;
      for (const t of targetNet.terminals) net.terminals.push(t);
      net.branches = [...this._explicitBranches(net), ...this._explicitBranches(targetNet)];
      this.nets.delete(targetNet.id);
    } else {
      net = srcNet || targetNet || this._createNet();
    }

    // Ensure the wired terminal (and any terminal exactly at `meet`) is a member.
    if (!net.terminals.some((t) => t.comp === term.comp && t.term === term.term)) {
      net.terminals.push({ comp: term.comp, term: term.term });
    }
    for (const c of this.components.values()) {
      for (const t of c.def.terminals) {
        const p = c.terminalWorld(t.name);
        if (p.x === P.x && p.y === P.y && !net.terminals.some((q) => q.comp === c.refdes && q.term === t.name)) {
          net.terminals.push({ comp: c.refdes, term: t.name });
        }
      }
    }

    // Split any branch whose interior contains the meet point.
    const branches = [];
    for (const path of this._explicitBranches(net)) {
      const split = splitBranchAt(path, P);
      if (split) branches.push(...split.filter((h) => h.length >= 2));
      else branches.push(clonePath(path));
    }
    // Route the new branch from the terminal to the meet point.
    const waypoints = points.map((p) => ({ x: snap(p.x), y: snap(p.y) }));
    const newPath = waypoints.length
      ? clonePath([srcPos, ...waypoints, P])
      : (smartRoute(srcPos, P, this._routingEnv()) || [{ ...srcPos }, { ...P }]);
    branches.push(clonePath(newPath));

    net.branches = branches;
    net.route = branches.length ? clonePath(branches[0]) : null;
    net.junctions = this._netJunctions(net, branches);
    this.syncJunctionSolders();
    return net;
  }

  /**
   * Route a wire from a free grid point (or a point on an existing wire via
   * `netId`) to `meet`, splicing into the target net. Terminal membership is
   * untouched here; use wireTo for terminal origins. Junction solder dots are
   * derived from the resulting geometry.
   */
  wirePointTo(point, meet, points = [], netId = null) {
    const P0 = snapPoint(point.x, point.y);
    const P = snapPoint(meet.x, meet.y);

    let targetNet = null;
    for (const net of this.nets.values()) {
      for (const t of net.terminals) {
        const p = this.getComponent(t.comp).terminalWorld(t.term);
        if (p.x === P.x && p.y === P.y) { targetNet = net; break; }
      }
      if (targetNet) break;
    }
    if (!targetNet) {
      for (const net of this.nets.values()) {
        if (this._explicitBranches(net).some((path) => pointOnPath(P, path))) { targetNet = net; break; }
      }
    }

    const originNet = netId ? this.nets.get(netId) : null;
    let net = originNet || targetNet || this._createNet();
    if (originNet && targetNet && originNet !== targetNet) {
      for (const t of targetNet.terminals) net.terminals.push(t);
      net.branches = [...this._explicitBranches(net), ...this._explicitBranches(targetNet)];
      this.nets.delete(targetNet.id);
    }
    for (const c of this.components.values()) {
      for (const t of c.def.terminals) {
        const p = c.terminalWorld(t.name);
        if (p.x === P.x && p.y === P.y && !net.terminals.some((q) => q.comp === c.refdes && q.term === t.name)) {
          net.terminals.push({ comp: c.refdes, term: t.name });
        }
      }
    }

    const branches = [];
    for (const path of this._explicitBranches(net)) {
      const s0 = splitBranchAt(path, P0);
      if (s0) { branches.push(...s0.filter((h) => h.length >= 2)); continue; }
      const s = splitBranchAt(path, P);
      if (s) branches.push(...s.filter((h) => h.length >= 2));
      else branches.push(clonePath(path));
    }
    const waypoints = points.map((p) => ({ x: snap(p.x), y: snap(p.y) }));
    const newPath = waypoints.length
      ? clonePath([P0, ...waypoints, P])
      : (smartRoute(P0, P, this._routingEnv()) || [{ ...P0 }, { ...P }]);
    branches.push(clonePath(newPath));

    net.branches = branches;
    net.route = branches.length ? clonePath(branches[0]) : null;
    net.junctions = this._netJunctions(net, branches);
    this.syncJunctionSolders();
    return net;
  }

  /** Delete one visual segment and update the owning net's topology. */
  deleteWireSegment(netId, branch, segment) {
    const net = this.nets.get(netId);
    if (!net) throw new Error(`unknown net "${netId}"`);
    const paths = net.paths();
    const next = deleteWireSegment(paths, branch, segment);
    net.branches = next.length ? next.map(clonePath) : null;
    net.route = net.branches?.[0] ? clonePath(net.branches[0]) : null;
    net.junctions = this._netJunctions(net, next);
    this._splitDisconnectedNet(net);
    this.syncJunctionSolders();
    return net;
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
      n.branches = comp.paths.length ? comp.paths.map(clonePath) : null;
      n.route = n.branches && n.branches.length ? clonePath(n.branches[0]) : null;
      n.junctions = this._netJunctions(n, comp.paths);
    };
    apply(net, components[0]);
    for (let i = 1; i < components.length; i++) {
      const child = this._createNet(net.name);
      apply(child, components[i]);
    }
  }

  /** Add one terminal to an existing net. */
  connectTo(netId, ref) {
    const net = this.nets.get(netId);
    if (!net) throw new Error(`unknown net "${netId}"`);
    const r = this.resolveTerm(ref);
    if (net.terminals.some((t) => t.comp === r.comp && t.term === r.term)) return net;
    net.terminals.push(r);
    this.syncJunctionSolders();
    return net;
  }

  /** Remove a single terminal from its net. Empty nets are dropped (returns null). */
  disconnect(ref) {
    const r = this.resolveTerm(ref);
    let removed = null;
    for (const net of [...this.nets.values()]) {
      const before = net.terminals.length;
      net.terminals = net.terminals.filter((t) => !(t.comp === r.comp && t.term === r.term));
      if (net.terminals.length === before) continue;
      if (net.terminals.length === 0) this.nets.delete(net.id);
      removed = net;
      break;
    }
    if (!removed) throw new Error(`terminal ${ref} is not connected to any net`);
    this.syncJunctionSolders();
    return removed;
  }

  removeNet(netId) {
    const removed = this.nets.delete(netId);
    if (removed) this.syncJunctionSolders();
    return removed;
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
      const paths = net.branches && net.branches.length ? net.branches : net.terminals.length >= 3 ? balancedPaths(net.terminalWorlds(), this._netEnv()) : [];
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
    for (const c of this.components.values()) n += c.def.terminals.length;
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
      version: 1,
      grid: 40,
      components: [...this.components.values()].map((c) => c.toJSON()),
      nets: [...this.nets.values()].map((n) => n.toJSON()),
      labels: [...this.labels.values()].map((l) => l.toJSON()),
      suppressedJunctions: [...this.suppressedJunctions],
    };
  }

  static fromJSON(data) {
    if (!data || data.version !== 1) throw new Error('unsupported state version');
    const circuit = new Circuit();
    circuit.suppressedJunctions = new Set(data.suppressedJunctions || []);
    circuit._loading = true;
    for (const c of data.components) {
      circuit.addComponent(c.type, {
        refdes: c.refdes,
        value: c.value,
        x: c.transform.x,
        y: c.transform.y,
        rotation: c.transform.rotation,
        mirrorX: c.transform.mirrorX,
        mirrorY: c.transform.mirrorY,
        noLabel: true, // instance labels come from data.labels below
      });
    }
    let maxNetId = 0;
    for (const n of data.nets) {
      const net = new Net(circuit, { name: n.name });
      net.id = n.id;
      for (const t of n.terminals) net.terminals.push(t);
      net.route = n.route ? clonePath(n.route) : null;
      if (Array.isArray(n.junctions)) net.junctions = n.junctions.map((p) => ({ x: p.x, y: p.y }));
      if (Array.isArray(n.branches)) net.branches = n.branches.map(clonePath);
      circuit.nets.set(net.id, net);
      const num = parseInt(String(n.id).replace(/\D/g, ''), 10) || 0;
      if (num > maxNetId) maxNetId = num;
    }
    // Keep the id counter ahead of every loaded net so new nets never collide
    // with (and silently overwrite) a loaded one.
    circuit._netId = maxNetId;
    for (const l of data.labels || []) {
      const label = circuit.addLabel({
        id: l.id,
        text: l.text,
        align: l.align,
        owner: l.owner || null,
        offset: l.offset || null,
        x: l.anchor ? l.anchor.x : 0,
        y: l.anchor ? l.anchor.y : 0,
      });
      if (label.owner && !circuit.components.has(label.owner)) circuit.labels.delete(label.id);
    }
    // Touching pins connect (e.g. a ground dropped on a source) and the routing
    // algorithm back-fills real solder components at any remaining junctions.
    circuit._loading = false;
    circuit.connectCoincident();
    // Repair any stale/overlapping geometry: split branches at shared points so
    // every junction is a real vertex, and drop duplicate branches.
    for (const net of circuit.nets.values()) {
      const paths = circuit._explicitBranches(net);
      if (paths.length) {
        const terminals = net.terminals.map((t) => circuit.getComponent(t.comp)?.terminalWorld(t.term)).filter(Boolean);
        net.branches = normalizeBranches(paths, terminals);
        net.route = net.branches.length ? clonePath(net.branches[0]) : null;
        net.junctions = circuit._netJunctions(net, net.branches);
      }
    }
    circuit.syncJunctionSolders();
    return circuit;
  }
}
