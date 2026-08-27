import { applyTransform, inverseTransform, rectFromPoints, rectUnion, transformRect } from './geometry.js';
import { snap, snapPoint, GRID } from './grid.js';
import { getSymbol } from './components/index.js';
import { autoRoute } from './router.js';

/** Nominal world units of text width per character (font-size 12 sans-serif). */
export const LABEL_CHAR_W = 7;

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
 * a grid point. The auto-sized bbox (width rounded up to a grid multiple; the
 * text vertically centered, height one grid cell) is derived from the text:
 *   center  — bbox is horizontally centered on the anchor (width rounded to an
 *             even number of cells so the center stays on grid)
 *   left    — bbox starts at the anchor's x
 *   right   — bbox ends at the anchor's x
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

  /** Bbox width in grid cells; center-aligned widths are even so the center stays on grid. */
  colWidth() {
    let n = Math.ceil((this.text.length * LABEL_CHAR_W) / GRID);
    if (this.align === 'center') n += n % 2;
    return Math.max(1, n);
  }

  bbox() {
    const a = this.anchorWorld();
    const w = this.colWidth() * GRID;
    const x = this.align === 'center' ? a.x - w / 2 : this.align === 'left' ? a.x : a.x - w;
    return { x, y: a.y - GRID / 2, w, h: GRID };
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
      mirrorX: !!opts.mirrorX,
      mirrorY: !!opts.mirrorY,
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
    this.route = opts.route || null;
  }

  terminalCount() {
    return this.terminals.length;
  }

  /** World points of the terminals in connection order. */
  terminalWorlds() {
    return this.terminals.map(({ comp, term }) => this.circuit.components.get(comp)?.terminalWorld(term));
  }

  /** Resulting wire polyline (grid points). Auto-laid-out unless a route was set. */
  points() {
    const pts = this.terminalWorlds().filter(Boolean);
    if (pts.length === 0) return [];
    if (this.route && this.route.length >= 2) return this.route.slice();
    return autoRoute(pts);
  }

  /** Total manhattan length of the drawn wire. */
  length() {
    const pts = this.points();
    let sum = 0;
    for (let i = 1; i < pts.length; i++) sum += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
    return sum;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      terminals: this.terminals.map((t) => ({ ...t })),
      route: this.route ? this.route.map((p) => ({ ...p })) : null,
    };
  }
}

export class Circuit {
  constructor() {
    this.components = new Map();
    this.nets = new Map();
    this.labels = new Map();
    this._netId = 0;
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
    return c;
  }

  setValue(refdes, value) {
    const c = this.getComponent(refdes);
    c.value = String(value);
    return c;
  }

  removeComponent(refdes) {
    const c = this.getComponent(refdes);
    for (const net of this.nets.values()) {
      net.terminals = net.terminals.filter((t) => t.comp !== refdes);
      if (net.terminals.length === 0) this.nets.delete(net.id);
    }
    for (const [id, l] of [...this.labels]) if (l.owner === refdes) this.labels.delete(id);
    this.components.delete(refdes);
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
        this.nets.delete(other.id);
      }
    }
    for (const r of okRefs) {
      const key = `${r.comp}.${r.term}`;
      if (!involved.has(key)) net.terminals.push(r);
    }
    return net;
  }

  /** Add one terminal to an existing net. */
  connectTo(netId, ref) {
    const net = this.nets.get(netId);
    if (!net) throw new Error(`unknown net "${netId}"`);
    const r = this.resolveTerm(ref);
    if (net.terminals.some((t) => t.comp === r.comp && t.term === r.term)) return net;
    net.terminals.push(r);
    return net;
  }

  /** Remove a single terminal from its net. Empty nets are dropped (returns null). */
  disconnect(ref) {
    const r = this.resolveTerm(ref);
    for (const net of [...this.nets.values()]) {
      const before = net.terminals.length;
      net.terminals = net.terminals.filter((t) => !(t.comp === r.comp && t.term === r.term));
      if (net.terminals.length === before) continue;
      if (net.terminals.length === 0) {
        this.nets.delete(net.id);
        return net;
      }
      return net;
    }
    throw new Error(`terminal ${ref} is not connected to any net`);
  }

  removeNet(netId) {
    return this.nets.delete(netId);
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
      const pts = net.points();
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
    };
  }

  static fromJSON(data) {
    if (!data || data.version !== 1) throw new Error('unsupported state version');
    const circuit = new Circuit();
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
    for (const n of data.nets) {
      const net = circuit._createNet(n.name);
      net.id = n.id;
      for (const t of n.terminals) net.terminals.push(t);
      net.route = n.route || null;
    }
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
    return circuit;
  }
}