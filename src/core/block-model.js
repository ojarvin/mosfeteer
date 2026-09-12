import { GRID, onGrid, snap } from './grid.js';
import { LabelInstance } from './model.js';
import { blockArrowGeometry, conformBlockArrowEndpoints, routeBlockArrow, routeBlockDiagram, routeIsOrthogonal } from './block-router.js';

export const BLOCK_DIAGRAM_KIND = 'block';
export const BLOCK_DIAGRAM_VERSION = 1;
export const BLOCK_MIN_SIZE = GRID * 2;
export const BLOCK_DEFAULT_SIZE = GRID * 4;
export const BLOCK_SIDES = Object.freeze(['top', 'right', 'bottom', 'left']);

const DEFAULT_STYLE = Object.freeze({
  color: '#111',
  lineStyle: 'solid',
  width: 'normal',
  bold: true,
  italic: true,
});
const SIDE_DIRECTIONS = Object.freeze({
  top: Object.freeze({ x: 0, y: -1 }),
  right: Object.freeze({ x: 1, y: 0 }),
  bottom: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
});

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const samePoint = (a, b) => a?.x === b?.x && a?.y === b?.y;
const finite = (n) => Number.isFinite(n);

function nextId(items, prefix) {
  const ids = new Set(items instanceof Map ? items.keys() : items.map((item) => item.id));
  for (let i = 1; ; i++) if (!ids.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

function normalizeStyle(style = {}, fallback = DEFAULT_STYLE) {
  return { ...fallback, ...clone(style) };
}

function normalizeText(text) {
  return String(text ?? '');
}

function normalizeRect(input = {}) {
  const source = input.rect || input;
  let x = Number(source.x ?? 0);
  let y = Number(source.y ?? 0);
  let w = Number(source.w ?? source.width ?? BLOCK_DEFAULT_SIZE);
  let h = Number(source.h ?? source.height ?? BLOCK_DEFAULT_SIZE);
  if (![x, y, w, h].every(finite)) throw new Error('block rectangle must contain finite coordinates');
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  x = snap(x);
  y = snap(y);
  w = Math.max(BLOCK_MIN_SIZE, snap(w));
  h = Math.max(BLOCK_MIN_SIZE, snap(h));
  return { x, y, w, h };
}

function normalizeSide(side) {
  const value = String(side || '').toLowerCase();
  if (!BLOCK_SIDES.includes(value)) throw new Error(`invalid block terminal side "${side}"`);
  return value;
}

function sideLength(rect, side) {
  return side === 'top' || side === 'bottom' ? rect.w : rect.h;
}

function normalizeOffset(rect, side, offset, clamp = false) {
  const max = sideLength(rect, side);
  let value = Number(offset);
  if (!finite(value)) throw new Error('block terminal offset must be finite');
  value = snap(value);
  if (clamp) value = Math.max(0, Math.min(max, value));
  if (value < 0 || value > max) throw new Error(`block terminal offset must be between 0 and ${max}`);
  if (!onGrid(value)) throw new Error('block terminal offset must be grid-aligned');
  return value;
}

function terminalPoint(rect, side, offset) {
  switch (side) {
    case 'top': return { x: rect.x + offset, y: rect.y };
    case 'right': return { x: rect.x + rect.w, y: rect.y + offset };
    case 'bottom': return { x: rect.x + offset, y: rect.y + rect.h };
    case 'left': return { x: rect.x, y: rect.y + offset };
    default: throw new Error(`invalid block terminal side "${side}"`);
  }
}

/** Unique, clockwise grid points around a block, excluding corners. */
function perimeterTerminalSpecs(rect) {
  const specs = [];
  // Keep one grid square of corner clearance, but include both end points of
  // every valid side run.  The old strict upper bounds dropped the rightmost
  // and bottommost attachment positions (and all positions on two-cell sides).
  for (let offset = GRID; offset <= rect.w - GRID; offset += GRID) specs.push({ side: 'top', offset });
  for (let offset = GRID; offset <= rect.h - GRID; offset += GRID) specs.push({ side: 'right', offset });
  for (let offset = rect.w - GRID; offset >= GRID; offset -= GRID) specs.push({ side: 'bottom', offset });
  for (let offset = rect.h - GRID; offset >= GRID; offset -= GRID) specs.push({ side: 'left', offset });
  return specs;
}

function terminalLocation(terminal) {
  return `${terminal.side}:${terminal.offset}`;
}

function terminalPointsUnique(block) {
  const points = new Set();
  for (const terminal of block.terminals.values()) {
    const point = terminal.point(block.rect);
    const key = `${point.x},${point.y}`;
    if (points.has(key)) return false;
    points.add(key);
  }
  return true;
}

function availableGeneratedSlots(rect, terminals) {
  const occupied = new Set([...terminals].filter((terminal) => !terminal.generated).map(terminalLocation));
  return perimeterTerminalSpecs(rect).filter((spec) => !occupied.has(`${spec.side}:${spec.offset}`)).length;
}

function textWidth(text) {
  // This is deliberately a small, DOM-free estimate. The browser renderer can
  // use the same label font without making the core model depend on the DOM.
  return Math.max(...String(text).split('\n').map((line) => {
    let width = 0;
    for (const c of line) width += c === ' ' ? 12 : /[ilI.,:;!'|]/.test(c) ? 12 : /[MW@#%&]/.test(c) ? 30 : 23;
    return width;
  }), 0);
}

function routeClearOfBlocks(points, diagram, ignored = new Set()) {
  if (!Array.isArray(points)) return false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    for (const block of diagram.blocks.values()) {
      if (ignored.has(block.id)) continue;
      const r = block.rect;
      if (a.x === b.x && a.x > r.x && a.x < r.x + r.w &&
          Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h) return false;
      if (a.y === b.y && a.y > r.y && a.y < r.y + r.h &&
          Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w) return false;
    }
  }
  return true;
}

export class BlockTerminal {
  constructor(block, options = {}) {
    this.id = String(options.id ?? options.name ?? '');
    if (!this.id) throw new Error('block terminal id is required');
    this.block = String(block);
    this.side = normalizeSide(options.side);
    this.offset = Number(options.offset);
    // T<n> is the generic perimeter identity used by new block placement.
    // Legacy in/out ids remain loadable and are intentionally preserved.
    this.generated = options.generated ?? /^T\d+$/.test(this.id);
    this._persistGenerated = options.generated === true;
  }

  point(rect) {
    return terminalPoint(rect, this.side, this.offset);
  }

  direction() {
    return { ...SIDE_DIRECTIONS[this.side] };
  }

  get blockId() { return this.block; }

  toJSON() {
    return { id: this.id, side: this.side, offset: this.offset, ...(this._persistGenerated ? { generated: true } : {}) };
  }
}

export class BlockNode {
  constructor(options = {}) {
    this.id = String(options.id ?? '');
    if (!this.id) throw new Error('block id is required');
    this.text = normalizeText(options.text ?? options.label ?? '');
    this.rect = normalizeRect(options.rect || options);
    this.style = normalizeStyle(options.style);
    this.drawOrder = Number(options.drawOrder ?? 0);
    if (!Number.isFinite(this.drawOrder)) throw new Error('block drawOrder must be finite');
    this.terminals = new Map();
    for (const terminal of normalizeTerminals(options.terminals)) {
      const item = new BlockTerminal(this.id, terminal);
      item.offset = normalizeOffset(this.rect, item.side, item.offset);
      if (this.terminals.has(item.id)) throw new Error(`duplicate block terminal id "${item.id}"`);
      this.terminals.set(item.id, item);
    }
    if (!Array.isArray(options.terminals) || options.terminals.length === 0) this.ensurePerimeterTerminals();
  }

  /** Fill missing perimeter grid points without replacing legacy terminal ids.
   * Generic T<n> terminals keep their identity when a block is resized. */
  ensurePerimeterTerminals() {
    const explicit = [...this.terminals.values()].filter((terminal) => !terminal.generated);
    const occupied = new Set(explicit.map(terminalLocation));
    const specs = perimeterTerminalSpecs(this.rect);
    const valid = new Set(specs.map((spec) => `${spec.side}:${spec.offset}`));
    const generated = [...this.terminals.values()]
      .filter((terminal) => terminal.generated)
      .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    const availableCount = availableGeneratedSlots(this.rect, this.terminals.values());
    if (generated.length > availableCount) throw new Error(`block ${this.id} is too small for ${generated.length} generated terminals`);
    const used = new Set(occupied);
    const available = () => specs.find((spec) => !used.has(`${spec.side}:${spec.offset}`));
    for (const item of generated) {
      const oldLocation = terminalLocation(item);
      if (valid.has(oldLocation) && !used.has(oldLocation)) {
        used.add(oldLocation);
        continue;
      }
      const replacement = available();
      item.side = replacement.side;
      item.offset = replacement.offset;
      used.add(terminalLocation(item));
    }
    let index = 1;
    for (const spec of specs) {
      const location = `${spec.side}:${spec.offset}`;
      if (used.has(location)) continue;
      while (this.terminals.has(`T${index}`)) index++;
      this.terminals.set(`T${index}`, new BlockTerminal(this.id, { id: `T${index}`, ...spec, generated: true }));
      used.add(location);
      index++;
    }
  }

  getTerminal(id) {
    const terminal = this.terminals.get(id);
    if (!terminal) throw new Error(`unknown terminal "${this.id}.${id}"`);
    return terminal;
  }

  terminal(id) { return this.getTerminal(id); }

  terminalPoint(id) { return this.getTerminal(id).point(this.rect); }

  labelPosition() {
    return { x: this.rect.x + this.rect.w / 2, y: this.rect.y + this.rect.h / 2, anchor: 'middle' };
  }

  setText(text) {
    this.text = normalizeText(text);
    let cells = Math.max(this.rect.w / GRID, Math.ceil((textWidth(this.text) + GRID * 4) / GRID));
    if ((cells - this.rect.w / GRID) % 2 !== 0) cells++;
    const needed = cells * GRID;
    if (needed > this.rect.w) {
      const center = this.rect.x + this.rect.w / 2;
      this.rect.x = center - (needed - this.rect.w) / 2 - this.rect.w / 2;
      this.rect.w = needed;
      this.ensurePerimeterTerminals();
    }
  }

  toJSON() {
    return {
      id: this.id,
      text: this.text,
      rect: { ...this.rect },
      terminals: [...this.terminals.values()].map((terminal) => terminal.toJSON()),
      style: clone(this.style),
      drawOrder: this.drawOrder,
    };
  }
}

export class BlockArrow {
  constructor(options = {}) {
    this.id = String(options.id ?? '');
    if (!this.id) throw new Error('arrow id is required');
    this.detached = options.detached === true;
    // A detached connector may retain either endpoint when it lands on a
    // terminal. The missing endpoint stays a free visual endpoint.
    this.from = options.from == null && options.source == null
      ? null : normalizeRef(options.from ?? options.source);
    this.to = options.to == null && options.target == null
      ? null : normalizeRef(options.to ?? options.target);
    if (!this.detached && (!this.from || !this.to)) throw new Error('attached arrow requires two endpoints');
    this.routingMode = options.routingMode ?? 'auto';
    if (!['auto', 'fixed'].includes(this.routingMode)) throw new Error(`invalid arrow routing mode "${this.routingMode}"`);
    this.points = clone(options.points || []);
    this.style = normalizeStyle(options.style, { color: '#111', lineStyle: 'solid', width: 'normal' });
    this.drawOrder = Number(options.drawOrder ?? 0);
    if (!Number.isFinite(this.drawOrder)) throw new Error('arrow drawOrder must be finite');
  }

  toJSON() {
    return {
      id: this.id,
      detached: this.detached,
      from: clone(this.from),
      to: clone(this.to),
      routingMode: this.routingMode,
      points: clone(this.points),
      style: clone(this.style),
      drawOrder: this.drawOrder,
    };
  }
}

function normalizeTerminals(terminals) {
  if (!terminals) return [];
  if (terminals instanceof Map) return [...terminals.values()];
  if (Array.isArray(terminals)) return terminals;
  return Object.entries(terminals).map(([id, value]) => ({ id, ...value }));
}

function normalizeRef(ref) {
  if (typeof ref === 'string') {
    const dot = ref.indexOf('.');
    if (dot <= 0 || dot === ref.length - 1) throw new Error(`invalid block terminal reference "${ref}"`);
    return { block: ref.slice(0, dot), terminal: ref.slice(dot + 1) };
  }
  if (!ref || !ref.block || !ref.terminal) throw new Error('arrow endpoint requires block and terminal');
  return { block: String(ref.block), terminal: String(ref.terminal) };
}

function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

function pathPointAt(points, ratio) {
  const total = pathLength(points);
  if (!total) return points[0] ? { ...points[0] } : null;
  let remaining = total * Math.max(0, Math.min(1, ratio));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]; const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= length) {
      const t = length ? remaining / length : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= length;
  }
  return { ...points.at(-1) };
}

function pathRatioAt(points, point) {
  let total = pathLength(points); let travelled = 0; let best = 0; let distance = Infinity;
  if (!total) return 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]; const b = points[i];
    const dx = b.x - a.x; const dy = b.y - a.y; const length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
    const candidate = { x: a.x + dx * t, y: a.y + dy * t };
    const d = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (d < distance) { distance = d; best = (travelled + Math.sqrt(length2) * t) / total; }
    travelled += Math.sqrt(length2);
  }
  return best;
}

function blockData(options, text, rect) {
  if (typeof options === 'string') {
    if (typeof text === 'object') return { ...text, id: options };
    return { ...(rect || {}), id: options, text };
  }
  return options || {};
}

function arrowData(options, from, to) {
  if (typeof options === 'string') return { id: options, from, to };
  return { ...(options || {}), ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
}

export class BlockDiagram {
  constructor(data = {}) {
    this.kind = BLOCK_DIAGRAM_KIND;
    this.version = BLOCK_DIAGRAM_VERSION;
    this.grid = Number(data.grid ?? GRID);
    if (this.grid !== GRID) throw new Error(`block diagram grid must be ${GRID}`);
    this.blocks = new Map();
    this.arrows = new Map();
    // Visual labels/annotations share the proven LabelInstance geometry, but
    // this map is local to the block document and has no electrical methods.
    this.labels = new Map();
    for (const raw of data.blocks || []) {
      const block = raw instanceof BlockNode ? raw : new BlockNode(raw);
      // Legacy documents only had directional terminals. Add generic
      // perimeter points on load, while preserving already-materialized T<n>
      // terminal identities from current documents byte-for-byte.
      if (!(raw instanceof BlockNode) && !raw.terminals?.some((terminal) => /^T\d+$/.test(String(terminal.id ?? terminal.name)))) block.ensurePerimeterTerminals();
      if (this.blocks.has(block.id)) throw new Error(`duplicate block id "${block.id}"`);
      this.blocks.set(block.id, block);
    }
    for (const raw of data.arrows || []) {
      const arrow = raw instanceof BlockArrow ? raw : new BlockArrow(raw);
      if (this.arrows.has(arrow.id)) throw new Error(`duplicate arrow id "${arrow.id}"`);
      this.arrows.set(arrow.id, arrow);
    }
    for (const raw of data.labels || []) {
      const label = raw instanceof LabelInstance ? raw : new LabelInstance(this, {
        ...raw,
        x: raw.x ?? raw.anchor?.x,
        y: raw.y ?? raw.anchor?.y,
        end: raw.end,
      });
      if (label.netId || label.owner) throw new Error('block labels cannot be electrical or component-owned');
      if (this.labels.has(label.id)) throw new Error(`duplicate label id "${label.id}"`);
      this.labels.set(label.id, label);
    }
    for (const arrow of this.arrows.values()) this._syncConnectorLabels(arrow);
    if (data.validate !== false) this.validate();
  }

  // LabelInstance uses these hooks for text/style edits. They deliberately do
  // nothing in a non-electrical document.
  invalidateRoutingCache() {}
  nextLabelId() { return nextId(this.labels, 'L'); }

  get annotations() { return this.labels; }

  nextBlockId() { return nextId(this.blocks, 'B'); }
  nextArrowId() { return nextId(this.arrows, 'A'); }
  nextTerminalId(blockId) { return nextId(this.getBlock(blockId).terminals, 'T'); }

  getBlock(id) {
    const block = this.blocks.get(id);
    if (!block) throw new Error(`unknown block "${id}"`);
    return block;
  }

  getArrow(id) {
    const arrow = this.arrows.get(id);
    if (!arrow) throw new Error(`unknown arrow "${id}"`);
    return arrow;
  }

  addLabel(options = {}) {
    const connectorId = options.connectorId ?? options.arrowId ?? null;
    if (connectorId && !this.arrows.has(String(connectorId))) throw new Error(`unknown connector "${connectorId}"`);
    const label = new LabelInstance(this, {
      ...options,
      id: options.id || this.nextLabelId(),
      owner: null,
      netId: null,
      ...(connectorId ? { connectorId: String(connectorId) } : {}),
    });
    if (this.labels.has(label.id)) throw new Error(`label id "${label.id}" already in use`);
    this.labels.set(label.id, label);
    if (connectorId) this._syncConnectorLabel(label, this.arrows.get(String(connectorId)));
    this.validate();
    return label;
  }

  /** Add a text label attached to a visual connector, without creating an
   * electrical net. `addNetLabel` is the muscle-memory-compatible alias used
   * by the block editor. */
  addConnectorLabel(arrowOrId, options = {}) {
    const arrowId = typeof arrowOrId === 'string' ? arrowOrId : arrowOrId?.id;
    const arrow = arrowId && this.arrows.get(String(arrowId));
    if (!arrow) throw new Error(`unknown connector "${arrowId}"`);
    const point = options.anchor || options.point || arrow.points[Math.floor(arrow.points.length / 2)];
    return this.addLabel({ ...options, connectorId: arrow.id, x: point.x, y: point.y, text: options.text ?? 'label' });
  }

  addNetLabel(arrowOrId, options = {}) { return this.addConnectorLabel(arrowOrId, options); }

  _syncConnectorLabel(label, arrow) {
    if (!label?.connectorId || !arrow?.points?.length) return;
    const ratio = Number.isFinite(label.connectorT) ? label.connectorT : pathRatioAt(arrow.points, label.anchor);
    label.connectorT = Math.max(0, Math.min(1, ratio));
    const point = pathPointAt(arrow.points, label.connectorT);
    if (point) label.anchor = { x: snap(point.x), y: snap(point.y) };
  }

  _syncConnectorLabels(arrow) {
    for (const label of this.labels.values()) if (label.connectorId === arrow.id) this._syncConnectorLabel(label, arrow);
  }

  moveConnectorLabel(label, x, y) {
    const arrow = this.arrows.get(label?.connectorId);
    if (!arrow) throw new Error('label connector no longer exists');
    label.connectorT = pathRatioAt(arrow.points, { x, y });
    this._syncConnectorLabel(label, arrow);
    this.invalidateRoutingCache();
    return label;
  }

  _terminalAtPoint(point, excludeArrow = null) {
    const candidates = [];
    for (const block of this.blocks.values()) for (const terminal of block.terminals.values()) {
      const max = sideLength(block.rect, terminal.side);
      if (terminal.offset <= 0 || terminal.offset >= max) continue;
      if (samePoint(terminal.point(block.rect), point)) candidates.push({ block: block.id, terminal: terminal.id });
    }
    if (candidates.length !== 1) return null;
    return candidates[0];
  }

  /** Reattach only unambiguous detached endpoints at valid, unoccupied
   * terminals. This is intentionally called at commit boundaries, never by
   * preview/drag code. A connector may become half-attached when only one
   * endpoint lands on a terminal. */
  reattachDetachedArrows(ids = null) {
    const wanted = ids ? new Set(ids) : null;
    const attached = [];
    for (const arrow of this.arrows.values()) {
      if (!arrow.detached || (wanted && !wanted.has(arrow.id)) || arrow.points.length < 2) continue;
      const from = arrow.from || this._terminalAtPoint(arrow.points[0], arrow);
      const to = arrow.to || this._terminalAtPoint(arrow.points.at(-1), arrow);
      if (from && to && refsEqual(from, to)) continue;
      const changed = !refsEqual(from, arrow.from) || !refsEqual(to, arrow.to);
      if (!changed) continue;
      const before = arrow.toJSON();
      arrow.from = from;
      arrow.to = to;
      arrow.detached = !(from && to);
      arrow.routingMode = 'fixed';
      try {
        this._anchorFixedArrow(arrow);
        this.validate();
        attached.push(arrow.id);
      } catch {
        Object.assign(arrow, new BlockArrow(before));
      }
    }
    return attached;
  }

  addAnnotation(kind, options = {}) {
    if (!['arrow', 'box', 'line'].includes(kind)) throw new Error(`unknown annotation kind "${kind}"`);
    const points = ['arrow', 'line'].includes(kind) && Array.isArray(options.points)
      ? options.points.map((point) => ({ x: snap(point.x), y: snap(point.y) })) : null;
    const a = points?.[0] || { x: snap(options.x || 0), y: snap(options.y || 0) };
    const b = points?.at(-1) || (options.end ? { x: snap(options.end.x), y: snap(options.end.y) } : a);
    const pathLength = points?.reduce((sum, point, index) => index ? sum + Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) : 0, 0)
      ?? Math.hypot(a.x - b.x, a.y - b.y);
    if (kind === 'arrow' && ((points && points.length < 2) || pathLength < GRID * 2)) throw new Error('arrow must have non-zero length and minimum length of two grid cells');
    if (kind === 'box' && (a.x === b.x || a.y === b.y)) throw new Error('box must have non-zero width and height');
    if (kind === 'line' && (!points || points.length < 2 || points.every((point) => point.x === a.x && point.y === a.y))) throw new Error('line must have at least two distinct points');
    const shape = this.addLabel({ ...options, kind, text: '', style: { ...(options.style || {}), lineStyle: options.style?.lineStyle || (kind === 'box' ? 'dashed' : 'solid') }, x: a.x, y: a.y, end: b, ...(points ? { points } : {}) });
    if (options.text) {
      const child = this.addLabel({ text: options.text, align: options.align, parent: shape.id, x: options.textAnchor?.x ?? a.x, y: options.textAnchor?.y ?? a.y, style: { color: shape.style.color } });
      if (!options.textAnchor) {
        const w = child.colWidth() * GRID; const h = child.rowHeight() * GRID;
        if (kind === 'box') child.anchor = { x: snap((a.x + b.x) / 2), y: snap(Math.min(a.y, b.y) - h / 2) };
        else {
          const first = points?.[1] || b;
          const dx = Math.sign(first.x - a.x); const dy = Math.sign(first.y - a.y);
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

  removeLabel(id) {
    const key = typeof id === 'string' ? id : id?.id;
    const removed = this.labels.delete(key);
    if (removed) for (const [childId, label] of this.labels) if (label.parent === key) this.labels.delete(childId);
    return removed;
  }

  getTerminal(ref) {
    const endpoint = normalizeRef(ref);
    return this.getBlock(endpoint.block).getTerminal(endpoint.terminal);
  }

  terminalPoint(ref) {
    const endpoint = normalizeRef(ref);
    const block = this.getBlock(endpoint.block);
    return block.getTerminal(endpoint.terminal).point(block.rect);
  }

  addBlock(options = {}, text, rect) {
    const data = blockData(options, text, rect);
    const block = new BlockNode({ ...data, id: data.id || this.nextBlockId() });
    if (this.blocks.has(block.id)) throw new Error(`duplicate block id "${block.id}"`);
    this.blocks.set(block.id, block);
    try {
      this.validate();
      // Placement and movement share the same commit-boundary attachment
      // rule: a free connector endpoint exactly on a unique terminal connects.
      this.reattachDetachedArrows();
    } catch (error) { this.blocks.delete(block.id); throw error; }
    return block;
  }

  attachArrowEndpoint(id, endpoint, ref) {
    if (!['from', 'to'].includes(endpoint)) throw new Error(`invalid connector endpoint "${endpoint}"`);
    const arrow = this.getArrow(id);
    const before = arrow.toJSON();
    try {
      const target = normalizeRef(ref);
      this.getTerminal(target);
      const other = endpoint === 'from' ? arrow.to : arrow.from;
      if (other && refsEqual(other, target)) throw new Error('connector endpoints must use different terminals');
      arrow[endpoint] = target;
      arrow.detached = !(arrow.from && arrow.to);
      if (arrow.detached) {
        arrow.routingMode = 'fixed';
        this._anchorFixedArrow(arrow);
      } else {
        arrow.routingMode = 'auto';
        arrow.points = routeBlockArrow(this, arrow);
        if (!arrow.points) throw new Error(`no safe route for arrow "${id}"`);
      }
      this._syncConnectorLabels(arrow);
      this.validate();
      return arrow;
    } catch (error) {
      Object.assign(arrow, new BlockArrow(before));
      throw error;
    }
  }

  renameBlock(id, text) {
    const block = this.getBlock(id);
    const before = block.toJSON();
    const beforeArrows = this._incidentSnapshot(id);
    try {
      block.setText(text);
      if (block.rect.x !== before.rect.x || block.rect.w !== before.rect.w) this._rerouteIncident(id, beforeArrows);
      this.validate();
    } catch (error) { Object.assign(block, new BlockNode(before)); this._restoreArrows(beforeArrows); throw error; }
    return block;
  }

  setText(id, text) { return this.renameBlock(id, text); }

  addTerminal(blockId, options = {}, side, offset) {
    const block = this.getBlock(blockId);
    const data = typeof options === 'string' ? { id: options, side, offset } : { ...options };
    data.id ||= this.nextTerminalId(blockId);
    const terminal = new BlockTerminal(blockId, { ...data, generated: false });
    terminal.offset = normalizeOffset(block.rect, terminal.side, terminal.offset);
    if (block.terminals.has(terminal.id)) throw new Error(`duplicate block terminal id "${terminal.id}"`);
    const occupied = [...block.terminals.values()].find((item) => item.point(block.rect).x === terminal.point(block.rect).x && item.point(block.rect).y === terminal.point(block.rect).y);
    if (occupied && !occupied.generated) throw new Error(`terminal location ${terminal.side}:${terminal.offset} is already occupied`);
    if (occupied) block.terminals.delete(occupied.id);
    block.terminals.set(terminal.id, terminal);
    try { this.validate(); } catch (error) {
      block.terminals.delete(terminal.id);
      if (occupied) block.terminals.set(occupied.id, occupied);
      throw error;
    }
    return terminal;
  }

  moveTerminal(ref, side, offset) {
    const endpoint = normalizeRef(ref);
    const block = this.getBlock(endpoint.block);
    const terminal = block.getTerminal(endpoint.terminal);
    const before = { side: terminal.side, offset: terminal.offset, arrows: this._incidentSnapshot(endpoint) };
    const nextSide = normalizeSide(side);
    const nextOffset = normalizeOffset(block.rect, nextSide, offset);
    const occupied = [...block.terminals.values()].find((item) => item !== terminal &&
      samePoint(item.point(block.rect), terminalPoint(block.rect, nextSide, nextOffset)));
    if (occupied && !occupied.generated) throw new Error(`terminal location ${nextSide}:${nextOffset} is already occupied`);
    if (occupied) block.terminals.delete(occupied.id);
    terminal.side = nextSide;
    terminal.offset = nextOffset;
    try { this._rerouteIncident(endpoint.block, before.arrows); this.validate(); }
    catch (error) { terminal.side = before.side; terminal.offset = before.offset; if (occupied) block.terminals.set(occupied.id, occupied); this._restoreArrows(before.arrows); throw error; }
    return terminal;
  }

  removeTerminal(ref) {
    const endpoint = normalizeRef(ref);
    const block = this.getBlock(endpoint.block);
    const incident = [...this.arrows.values()].filter((arrow) => refsEqual(arrow.from, endpoint) || refsEqual(arrow.to, endpoint));
    if (incident.length) throw new Error(`cannot remove terminal "${endpoint.block}.${endpoint.terminal}" while arrows reference it`);
    return block.terminals.delete(endpoint.terminal);
  }

  moveBlock(id, x, y) {
    const block = this.getBlock(id);
    const before = this.toJSON();
    const point = typeof x === 'object' ? x : { x, y };
    const next = normalizeRect({ ...block.rect, x: point.x, y: point.y });
    block.rect.x = next.x;
    block.rect.y = next.y;
    try { this._rerouteIncident(id, null, { fresh: true, clearance: GRID * 2 }); this.validate(); }
    catch (error) { this._restoreJSON(before); throw error; }
    return block;
  }

  /** Move a connected block set atomically. Internal arrows translate with the
   * set; arrows crossing its boundary are re-routed after all blocks land. */
  moveBlocks(ids, dx, dy) {
    const selected = new Set(ids);
    const before = this.toJSON();
    const x = snap(Number(dx)); const y = snap(Number(dy));
    const internal = new Set([...this.arrows.values()]
      .filter((arrow) => !arrow.detached && selected.has(arrow.from?.block) && selected.has(arrow.to?.block))
      .map((arrow) => arrow.id));
    try {
      for (const id of selected) {
        const block = this.getBlock(id);
        const next = normalizeRect({ ...block.rect, x: block.rect.x + x, y: block.rect.y + y });
        block.rect.x = next.x; block.rect.y = next.y;
      }
      for (const id of internal) {
        const arrow = this.getArrow(id);
        if (arrow.routingMode !== 'auto') {
          arrow.points = arrow.points.map((point) => ({ x: point.x + x, y: point.y + y }));
          this._syncConnectorLabels(arrow);
        }
      }
      for (const arrow of this.arrows.values()) {
        if (arrow.detached) {
          if (selected.has(arrow.from?.block) || selected.has(arrow.to?.block)) {
            this._anchorFixedArrow(arrow);
            this._syncConnectorLabels(arrow);
          }
          continue;
        }
        if (internal.has(arrow.id) || arrow.routingMode === 'auto' ||
            (!selected.has(arrow.from?.block) && !selected.has(arrow.to?.block))) continue;
        const occupied = [...this.arrows.values()]
          .filter((other) => other !== arrow && !other.detached)
          .map((other) => ({ points: other.points, from: other.from, to: other.to }));
        arrow.points = routeBlockArrow(this, arrow, { clearance: GRID * 2, occupied });
        if (!arrow.points) throw new Error(`no safe route for arrow "${arrow.id}"`);
        this._syncConnectorLabels(arrow);
      }
      // Route every automatic connector in one deterministic pass. Existing
      // fixed connectors reserve their exact runs; newly planned automatic
      // connectors reserve each previous route, preventing positive-length
      // collinear overlap after a connected block drag.
      const occupied = [...this.arrows.values()]
        .filter((arrow) => !arrow.detached && arrow.routingMode === 'fixed')
        .map((arrow) => ({ points: arrow.points, from: arrow.from, to: arrow.to }));
      const routes = routeBlockDiagram(this, { occupied, clearance: GRID * 2 });
      if (!routes) throw new Error('no safe route for automatic block connector');
      for (const [arrowId, points] of routes) {
        const arrow = this.getArrow(arrowId);
        arrow.points = points.map((point) => ({ ...point }));
        this._syncConnectorLabels(arrow);
      }
      this.validate();
    } catch (error) { this._restoreJSON(before); throw error; }
    return [...selected].map((id) => this.getBlock(id));
  }

  resizeBlock(id, w, h) {
    const block = this.getBlock(id);
    const before = this.toJSON();
    const size = typeof w === 'object' ? w : { w, h };
    const next = normalizeRect({ ...block.rect, ...size });
    // A connected pin must retain one clear grid cell between itself and a
    // side that is being pulled inward.  Unconnected pins may be clamped to
    // the new perimeter below; connected pins are the resize guardrail.
    const old = block.rect;
    const reduced = {
      left: next.x > old.x,
      right: next.x + next.w < old.x + old.w,
      top: next.y > old.y,
      bottom: next.y + next.h < old.y + old.h,
    };
    const incident = new Set();
    for (const arrow of this.arrows.values()) {
      if (arrow.from?.block === id) incident.add(`${arrow.from.block}.${arrow.from.terminal}`);
      if (arrow.to?.block === id) incident.add(`${arrow.to.block}.${arrow.to.terminal}`);
    }
    for (const key of incident) {
      const terminal = block.getTerminal(key.slice(key.indexOf('.') + 1));
      const oldPoint = terminal.point(old);
      if (reduced.left && ['top', 'bottom'].includes(terminal.side) && next.x > oldPoint.x - GRID) {
        throw new Error(`block ${id} left edge cannot pass connected terminal ${terminal.id} plus one grid cell`);
      }
      if (reduced.right && ['top', 'bottom'].includes(terminal.side) && next.x + next.w < oldPoint.x + GRID) {
        throw new Error(`block ${id} right edge cannot pass connected terminal ${terminal.id} plus one grid cell`);
      }
      if (reduced.top && ['left', 'right'].includes(terminal.side) && next.y > oldPoint.y - GRID) {
        throw new Error(`block ${id} top edge cannot pass connected terminal ${terminal.id} plus one grid cell`);
      }
      if (reduced.bottom && ['left', 'right'].includes(terminal.side) && next.y + next.h < oldPoint.y + GRID) {
        throw new Error(`block ${id} bottom edge cannot pass connected terminal ${terminal.id} plus one grid cell`);
      }
    }
    const resizedData = block.toJSON();
    resizedData.rect = next;
    // Generated perimeter points are an editing affordance, not permanent
    // content. Keep generated terminals that carry connectors, discard the
    // rest, and refill the resized perimeter with stable available IDs.
    resizedData.terminals = resizedData.terminals
      .filter((terminal) => !/^T\d+$/.test(terminal.id) || incident.has(`${id}.${terminal.id}`))
      .map((terminal) => ({ ...terminal, offset: normalizeOffset(next, terminal.side, terminal.offset, true) }));
    const resized = new BlockNode(resizedData);
    resized.ensurePerimeterTerminals();
    for (const terminal of resized.terminals.values()) terminal.offset = normalizeOffset(resized.rect, terminal.side, terminal.offset, true);
    if (!terminalPointsUnique(resized)) throw new Error(`block ${id} resize creates coincident terminal points`);
    block.rect = next;
    try {
      block.terminals = resized.terminals;
      this._rerouteIncident(id); this.validate();
    } catch (error) { this._restoreJSON(before); throw error; }
    return block;
  }

  setBlockRect(id, rect) { return this.resizeBlock(id, rect); }

  addArrow(options = {}, from, to) {
    const data = arrowData(options, from, to);
    const arrow = new BlockArrow({ ...data, id: data.id || this.nextArrowId() });
    if (this.arrows.has(arrow.id)) throw new Error(`duplicate arrow id "${arrow.id}"`);
    if (arrow.detached) {
      if (arrow.points.length < 2) throw new Error(`detached arrow "${arrow.id}" requires points`);
    } else if (arrow.routingMode === 'auto') {
      arrow.points = routeBlockArrow(this, arrow);
      if (!arrow.points) throw new Error(`no safe route for arrow "${arrow.id}"`);
    } else {
      this._anchorFixedArrow(arrow);
    }
    this.arrows.set(arrow.id, arrow);
    try { this.validate(); } catch (error) { this.arrows.delete(arrow.id); throw error; }
    return arrow;
  }

  setArrowRoute(id, points, routingMode = 'fixed') {
    const arrow = this.getArrow(id);
    const before = arrow.toJSON();
    try {
      if (!['auto', 'fixed'].includes(routingMode)) throw new Error(`invalid arrow routing mode "${routingMode}"`);
      arrow.routingMode = routingMode;
      if (arrow.detached) {
        if (arrow.routingMode === 'auto') throw new Error(`detached arrow "${id}" requires a fixed route`);
        arrow.points = clone(points || []);
      } else if (arrow.routingMode === 'auto') {
        arrow.points = routeBlockArrow(this, arrow);
        if (!arrow.points) throw new Error(`no safe route for arrow "${id}"`);
      } else {
        arrow.points = clone(points || []);
        this._anchorFixedArrow(arrow);
      }
      this._syncConnectorLabels(arrow);
      this.validate();
    } catch (error) { Object.assign(arrow, new BlockArrow(before)); throw error; }
    return arrow;
  }

  removeArrow(id) {
    const arrow = this.getArrow(id);
    this.arrows.delete(id);
    for (const [labelId, label] of this.labels) if (label.connectorId === arrow.id) this.labels.delete(labelId);
    return arrow;
  }

  removeBlock(id) {
    const block = this.getBlock(id);
    for (const [arrowId, arrow] of this.arrows) {
      if (arrow.from?.block !== id && arrow.to?.block !== id) continue;
      // Keep visual connectors when their block disappears.  Preserve the
      // surviving endpoint (if any), its route, and connector labels; this is
      // the same half-attached representation used by detached moves.
      if (arrow.from?.block === id) arrow.from = null;
      if (arrow.to?.block === id) arrow.to = null;
      arrow.detached = true;
      arrow.routingMode = 'fixed';
    }
    this.blocks.delete(id);
    this.validate();
    return block;
  }

  detachArrow(id) {
    const arrow = this.getArrow(id);
    if (arrow.detached) return arrow;
    arrow.detached = true;
    arrow.from = null;
    arrow.to = null;
    arrow.routingMode = 'fixed';
    this.validate();
    return arrow;
  }

  detachBoundaryArrows(blockIds) {
    const selected = new Set(blockIds);
    const detached = [];
    for (const arrow of [...this.arrows.values()]) {
      if (arrow.detached) continue;
      const fromSelected = selected.has(arrow.from.block);
      const toSelected = selected.has(arrow.to.block);
      if (fromSelected !== toSelected) { this.detachArrow(arrow.id); detached.push(arrow.id); }
    }
    return detached;
  }

  _anchorFixedArrow(arrow) {
    if (!arrow.points?.length) throw new Error(`fixed arrow "${arrow.id}" requires points`);
    const from = arrow.from ? this.terminalPoint(arrow.from) : arrow.points[0];
    const to = arrow.to ? this.terminalPoint(arrow.to) : arrow.points.at(-1);
    const interior = arrow.points.slice(1, -1).map((point) => ({ x: point.x, y: point.y }));
    arrow.points = [from, ...interior, to].map((point) => ({ x: point.x, y: point.y }));
    if (!routeIsOrthogonal(arrow.points)) {
      const first = interior[0]; const last = interior.at(-1);
      const starts = first && !samePoint(from, first) ? [
        [from, { x: first.x, y: from.y }, first],
        [from, { x: from.x, y: first.y }, first],
      ] : [[from]];
      const ends = last && !samePoint(last, to) ? [
        [last, { x: to.x, y: last.y }, to],
        [last, { x: last.x, y: to.y }, to],
      ] : [[to]];
      const candidates = starts.flatMap((start) => ends.map((end) => [
        ...start, ...interior.slice(1, -1), ...end,
      ].filter((point, index, path) => !index || !samePoint(point, path[index - 1]))));
      if (!first && !last) candidates.push(
        [from, { x: to.x, y: from.y }, to],
        [from, { x: from.x, y: to.y }, to],
      );
      const safe = candidates.find((path) => routeIsOrthogonal(path) && routeClearOfBlocks(path, this));
      if (safe) arrow.points = safe;
    }
    arrow.points = conformBlockArrowEndpoints(this, arrow, arrow.points);
    if (!routeIsOrthogonal(arrow.points)) throw new Error(`arrow "${arrow.id}" route must be orthogonal`);
    if (!routeClearOfBlocks(arrow.points, this)) throw new Error(`arrow "${arrow.id}" route enters a block`);
  }

  _incidentSnapshot(blockId) {
    return [...this.arrows.values()]
      .filter((arrow) => arrow.from?.block === blockId || arrow.to?.block === blockId)
      .map((arrow) => arrow.toJSON());
  }

  _restoreArrows(snapshot) {
    for (const raw of snapshot) this.arrows.set(raw.id, new BlockArrow(raw));
  }

  _rerouteIncident(blockId, snapshot = null, options = {}) {
    const old = snapshot || this._incidentSnapshot(blockId);
    try {
      for (const arrow of this.arrows.values()) {
        if (arrow.detached && !arrow.from?.block && !arrow.to?.block) continue;
        if (arrow.from?.block !== blockId && arrow.to?.block !== blockId) continue;
        if (!arrow.detached && (arrow.routingMode === 'auto' || options.fresh)) {
          const occupied = [...this.arrows.values()]
            .filter((other) => other !== arrow && !other.detached)
            .map((other) => ({ points: other.points, from: other.from, to: other.to }));
          arrow.points = routeBlockArrow(this, arrow, { clearance: options.clearance, occupied });
          if (!arrow.points) throw new Error(`no safe route for arrow "${arrow.id}"`);
        } else this._anchorFixedArrow(arrow);
        this._syncConnectorLabels(arrow);
      }
    } catch (error) {
      this._restoreArrows(old);
      throw error;
    }
  }

  _restoreJSON(data) {
    const restored = BlockDiagram.fromJSON(data);
    this.blocks = restored.blocks;
    this.arrows = restored.arrows;
    this.labels = restored.labels;
  }

  labelPosition(id) { return this.getBlock(id).labelPosition(); }

  bounds() {
    const points = [];
    for (const block of this.blocks.values()) {
      points.push(
        { x: block.rect.x, y: block.rect.y },
        { x: block.rect.x + block.rect.w, y: block.rect.y + block.rect.h },
      );
      const label = block.labelPosition();
      const half = textWidth(block.text) / 2;
      points.push({ x: label.x - half, y: label.y - 20 }, { x: label.x + half, y: label.y + 20 });
      for (const terminal of block.terminals.values()) {
        const p = terminal.point(block.rect);
        points.push({ x: p.x - 8, y: p.y - 8 }, { x: p.x + 8, y: p.y + 8 });
      }
    }
    for (const arrow of this.arrows.values()) {
      points.push(...arrow.points);
      if (arrow.points.length >= 2) {
        const head = blockArrowGeometry(arrow.points);
        points.push(head.left, head.right, head.tip);
      }
    }
    for (const label of this.labels.values()) {
      const box = label.bbox();
      points.push({ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h });
    }
    if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  validate() {
    const errors = this.validationErrors();
    if (errors.length) throw new Error(`invalid block diagram: ${errors.join('; ')}`);
    return true;
  }

  validationErrors() {
    const errors = [];
    if (this.kind !== BLOCK_DIAGRAM_KIND) errors.push(`kind must be "${BLOCK_DIAGRAM_KIND}"`);
    if (this.version !== BLOCK_DIAGRAM_VERSION) errors.push(`unsupported version ${this.version}`);
    if (this.grid !== GRID) errors.push(`grid must be ${GRID}`);
    for (const [id, block] of this.blocks) {
      if (id !== block.id || !block.id) errors.push('block ids must be non-empty and match their map keys');
      const r = block.rect;
      if (!r || ![r.x, r.y, r.w, r.h].every(finite) || r.w < BLOCK_MIN_SIZE || r.h < BLOCK_MIN_SIZE) errors.push(`invalid rectangle for block "${id}"`);
      else if (![r.x, r.y, r.w, r.h].every((value) => onGrid(value))) errors.push(`block "${id}" rectangle must be grid-aligned`);
      if (typeof block.text !== 'string') errors.push(`block "${id}" text must be text`);
      const seen = new Set();
      const points = new Set();
      for (const [terminalId, terminal] of block.terminals) {
        if (seen.has(terminalId) || terminalId !== terminal.id || terminal.block !== id) errors.push(`invalid terminal id on block "${id}"`);
        seen.add(terminalId);
        if (!BLOCK_SIDES.includes(terminal.side)) errors.push(`invalid side for terminal "${id}.${terminalId}"`);
        else if (!finite(terminal.offset) || !onGrid(terminal.offset) || terminal.offset < 0 || terminal.offset > sideLength(r, terminal.side)) errors.push(`invalid offset for terminal "${id}.${terminalId}"`);
        else {
          const point = terminal.point(r);
          const key = `${point.x},${point.y}`;
          if (points.has(key)) errors.push(`coincident terminal point on block "${id}"`);
          points.add(key);
        }
      }
    }
    for (const [id, label] of this.labels) {
      if (id !== label.id || !label.id) errors.push('label ids must be non-empty and match their map keys');
      if (label.netId || label.owner) errors.push(`block label "${id}" cannot be electrical or owned`);
      if (label.connectorId && (!this.arrows.has(label.connectorId) || label.kind !== 'label')) errors.push(`block label "${id}" references an invalid connector`);
      if (label.connectorId) {
        const arrow = this.arrows.get(label.connectorId);
        if (arrow?.points?.length && !arrow.points.some((point, i) => i > 0 &&
          ((point.x === arrow.points[i - 1].x && label.anchor.x === point.x && label.anchor.y >= Math.min(arrow.points[i - 1].y, point.y) && label.anchor.y <= Math.max(arrow.points[i - 1].y, point.y)) ||
           (point.y === arrow.points[i - 1].y && label.anchor.y === point.y && label.anchor.x >= Math.min(arrow.points[i - 1].x, point.x) && label.anchor.x <= Math.max(arrow.points[i - 1].x, point.x))))) {
          errors.push(`block label "${id}" anchor is not on connector ${label.connectorId}`);
        }
      }
      if (!['label', 'arrow', 'box', 'line'].includes(label.kind)) errors.push(`invalid block label kind "${id}"`);
      if (['arrow', 'line'].includes(label.kind) && (!Array.isArray(label.points) || label.points.length < 2)) errors.push(`${label.kind} annotation "${id}" needs points`);
      const points = ['arrow', 'line'].includes(label.kind) ? label.points : [label.anchor, label.end];
      if (points.some((point) => !point || !finite(point.x) || !finite(point.y) || !onGrid(point.x) || !onGrid(point.y))) errors.push(`block label "${id}" points must be grid-aligned`);
      if (label.parent && !this.labels.has(label.parent)) errors.push(`block label "${id}" references a missing parent`);
    }
    for (const [id, arrow] of this.arrows) {
      if (id !== arrow.id || !arrow.id) errors.push('arrow ids must be non-empty and match their map keys');
      if (arrow.detached) {
        if (!Array.isArray(arrow.points) || arrow.points.length < 2) errors.push(`detached arrow "${id}" needs at least two route points`);
        else if (arrow.points.some((point) => !point || !finite(point.x) || !finite(point.y) || !onGrid(point.x) || !onGrid(point.y))) errors.push(`arrow "${id}" points must be finite and grid-aligned`);
        else if (!routeIsOrthogonal(arrow.points)) errors.push(`arrow "${id}" route must be orthogonal`);
        for (const [endpoint, point] of [['from', arrow.points?.[0]], ['to', arrow.points?.at(-1)]]) {
          const ref = arrow[endpoint];
          if (!ref) continue;
          const block = this.blocks.get(ref.block);
          const terminal = block?.terminals.get(ref.terminal);
          if (!block || !terminal) errors.push(`arrow "${id}" references a missing terminal`);
          else if (!samePoint(terminal.point(block.rect), point)) errors.push(`arrow "${id}" does not start/end at its ${endpoint} terminal`);
        }
        continue;
      }
      for (const ref of [arrow.from, arrow.to]) {
        const block = this.blocks.get(ref?.block);
        if (!block || !block.terminals.has(ref?.terminal)) errors.push(`arrow "${id}" references a missing terminal`);
      }
      if (!['auto', 'fixed'].includes(arrow.routingMode)) errors.push(`arrow "${id}" has an invalid routing mode`);
      if (!Array.isArray(arrow.points) || arrow.points.length < 2) { errors.push(`arrow "${id}" needs at least two route points`); continue; }
      if (arrow.points.some((point) => !point || !finite(point.x) || !finite(point.y) || !onGrid(point.x) || !onGrid(point.y))) errors.push(`arrow "${id}" points must be finite and grid-aligned`);
      if (!routeIsOrthogonal(arrow.points)) errors.push(`arrow "${id}" route must be orthogonal`);
      const from = this.blocks.get(arrow.from.block)?.terminals.get(arrow.from.terminal);
      const to = this.blocks.get(arrow.to.block)?.terminals.get(arrow.to.terminal);
      if (from && to) {
        const first = terminalPoint(this.blocks.get(arrow.from.block).rect, from.side, from.offset);
        const last = terminalPoint(this.blocks.get(arrow.to.block).rect, to.side, to.offset);
        if (!samePoint(arrow.points[0], first)) errors.push(`arrow "${id}" does not start at its source terminal`);
        if (!samePoint(arrow.points.at(-1), last)) errors.push(`arrow "${id}" does not end at its target terminal`);
      }
    }
    return errors;
  }

  toJSON() {
    this.validate();
    return {
      kind: BLOCK_DIAGRAM_KIND,
      version: BLOCK_DIAGRAM_VERSION,
      grid: GRID,
      blocks: [...this.blocks.values()].map((block) => block.toJSON()),
      arrows: [...this.arrows.values()].map((arrow) => arrow.toJSON()),
      ...(this.labels.size ? { labels: [...this.labels.values()].map((label) => label.toJSON()) } : {}),
    };
  }

  static fromJSON(data) {
    if (!data || data.kind !== BLOCK_DIAGRAM_KIND) throw new Error('not a block diagram');
    if (data.version !== BLOCK_DIAGRAM_VERSION) throw new Error(`unsupported block diagram version ${data.version}`);
    return new BlockDiagram(data);
  }
}

function refsEqual(a, b) {
  return a?.block === b?.block && a?.terminal === b?.terminal;
}

export function validateBlockDiagram(diagram) {
  if (!(diagram instanceof BlockDiagram)) throw new Error('expected a BlockDiagram');
  return diagram.validate();
}

export function blockTerminalPoint(rect, side, offset) {
  return terminalPoint(rect, normalizeSide(side), offset);
}

export function blockTerminalDirection(side) {
  const value = normalizeSide(side);
  return { ...SIDE_DIRECTIONS[value] };
}

export function blockLabelPosition(rect) {
  const normalized = normalizeRect(rect);
  return { x: normalized.x + normalized.w / 2, y: normalized.y + normalized.h / 2, anchor: 'middle' };
}

export function isBlockDiagram(value) {
  return value?.kind === BLOCK_DIAGRAM_KIND;
}
