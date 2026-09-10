import { GRID, onGrid, snap } from './grid.js';
import { blockArrowGeometry, routeBlockArrow, routeIsOrthogonal } from './block-router.js';

export const BLOCK_DIAGRAM_KIND = 'block';
export const BLOCK_DIAGRAM_VERSION = 1;
export const BLOCK_MIN_SIZE = GRID * 2;
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
  const value = String(text ?? '');
  if (/[\r\n]/.test(value)) throw new Error('block text must be a single line');
  return value;
}

function normalizeRect(input = {}) {
  const source = input.rect || input;
  let x = Number(source.x ?? 0);
  let y = Number(source.y ?? 0);
  let w = Number(source.w ?? source.width ?? BLOCK_MIN_SIZE);
  let h = Number(source.h ?? source.height ?? BLOCK_MIN_SIZE);
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

function textWidth(text) {
  // This is deliberately a small, DOM-free estimate. The browser renderer can
  // use the same label font without making the core model depend on the DOM.
  let width = 0;
  for (const c of text) width += c === ' ' ? 12 : /[ilI.,:;!'|]/.test(c) ? 12 : /[MW@#%&]/.test(c) ? 30 : 23;
  return width;
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
  }

  point(rect) {
    return terminalPoint(rect, this.side, this.offset);
  }

  direction() {
    return { ...SIDE_DIRECTIONS[this.side] };
  }

  get blockId() { return this.block; }

  toJSON() {
    return { id: this.id, side: this.side, offset: this.offset };
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
    this.from = this.detached ? null : normalizeRef(options.from ?? options.source);
    this.to = this.detached ? null : normalizeRef(options.to ?? options.target);
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
    for (const raw of data.blocks || []) {
      const block = raw instanceof BlockNode ? raw : new BlockNode(raw);
      if (this.blocks.has(block.id)) throw new Error(`duplicate block id "${block.id}"`);
      this.blocks.set(block.id, block);
    }
    for (const raw of data.arrows || []) {
      const arrow = raw instanceof BlockArrow ? raw : new BlockArrow(raw);
      if (this.arrows.has(arrow.id)) throw new Error(`duplicate arrow id "${arrow.id}"`);
      this.arrows.set(arrow.id, arrow);
    }
    if (data.validate !== false) this.validate();
  }

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
    try { this.validate(); } catch (error) { this.blocks.delete(block.id); throw error; }
    return block;
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
    const terminal = new BlockTerminal(blockId, data);
    terminal.offset = normalizeOffset(block.rect, terminal.side, terminal.offset);
    if (block.terminals.has(terminal.id)) throw new Error(`duplicate block terminal id "${terminal.id}"`);
    block.terminals.set(terminal.id, terminal);
    try { this.validate(); } catch (error) { block.terminals.delete(terminal.id); throw error; }
    return terminal;
  }

  moveTerminal(ref, side, offset) {
    const endpoint = normalizeRef(ref);
    const block = this.getBlock(endpoint.block);
    const terminal = block.getTerminal(endpoint.terminal);
    const before = { side: terminal.side, offset: terminal.offset, arrows: this._incidentSnapshot(endpoint) };
    const nextSide = normalizeSide(side);
    const nextOffset = normalizeOffset(block.rect, nextSide, offset);
    terminal.side = nextSide;
    terminal.offset = nextOffset;
    try { this._rerouteIncident(endpoint.block, before.arrows); this.validate(); }
    catch (error) { terminal.side = before.side; terminal.offset = before.offset; this._restoreArrows(before.arrows); throw error; }
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
    try { this._rerouteIncident(id); this.validate(); }
    catch (error) { this._restoreJSON(before); throw error; }
    return block;
  }

  resizeBlock(id, w, h) {
    const block = this.getBlock(id);
    const before = this.toJSON();
    const size = typeof w === 'object' ? w : { w, h };
    const next = normalizeRect({ ...block.rect, w: size.w, h: size.h });
    block.rect.w = next.w;
    block.rect.h = next.h;
    for (const terminal of block.terminals.values()) terminal.offset = normalizeOffset(block.rect, terminal.side, terminal.offset, true);
    try { this._rerouteIncident(id); this.validate(); }
    catch (error) { this._restoreJSON(before); throw error; }
    return block;
  }

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
      this.validate();
    } catch (error) { Object.assign(arrow, new BlockArrow(before)); throw error; }
    return arrow;
  }

  removeArrow(id) {
    const arrow = this.getArrow(id);
    this.arrows.delete(id);
    return arrow;
  }

  removeBlock(id) {
    const block = this.getBlock(id);
    for (const [arrowId, arrow] of this.arrows) {
      if (!arrow.detached && (arrow.from.block === id || arrow.to.block === id)) this.arrows.delete(arrowId);
    }
    this.blocks.delete(id);
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
    for (const arrow of [...this.arrows.values()]) {
      if (arrow.detached) continue;
      const fromSelected = selected.has(arrow.from.block);
      const toSelected = selected.has(arrow.to.block);
      if (fromSelected !== toSelected) this.detachArrow(arrow.id);
    }
  }

  _anchorFixedArrow(arrow) {
    const from = this.terminalPoint(arrow.from);
    const to = this.terminalPoint(arrow.to);
    if (!arrow.points?.length) throw new Error(`fixed arrow "${arrow.id}" requires points`);
    arrow.points = [from, ...arrow.points.slice(1, -1), to].map((point) => ({ x: point.x, y: point.y }));
    if (!routeIsOrthogonal(arrow.points)) throw new Error(`arrow "${arrow.id}" route must be orthogonal`);
    if (!routeClearOfBlocks(arrow.points, this)) throw new Error(`arrow "${arrow.id}" route enters a block`);
  }

  _incidentSnapshot(blockId) {
    return [...this.arrows.values()]
      .filter((arrow) => !arrow.detached && (arrow.from.block === blockId || arrow.to.block === blockId))
      .map((arrow) => arrow.toJSON());
  }

  _restoreArrows(snapshot) {
    for (const raw of snapshot) this.arrows.set(raw.id, new BlockArrow(raw));
  }

  _rerouteIncident(blockId, snapshot = null) {
    const old = snapshot || this._incidentSnapshot(blockId);
    try {
      for (const arrow of this.arrows.values()) {
        if (arrow.detached || (arrow.from.block !== blockId && arrow.to.block !== blockId)) continue;
        if (arrow.routingMode === 'auto') {
          arrow.points = routeBlockArrow(this, arrow);
          if (!arrow.points) throw new Error(`no safe route for arrow "${arrow.id}"`);
        } else this._anchorFixedArrow(arrow);
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
      if (typeof block.text !== 'string' || /[\r\n]/.test(block.text)) errors.push(`block "${id}" text must be one line`);
      const seen = new Set();
      for (const [terminalId, terminal] of block.terminals) {
        if (seen.has(terminalId) || terminalId !== terminal.id || terminal.block !== id) errors.push(`invalid terminal id on block "${id}"`);
        seen.add(terminalId);
        if (!BLOCK_SIDES.includes(terminal.side)) errors.push(`invalid side for terminal "${id}.${terminalId}"`);
        else if (!finite(terminal.offset) || !onGrid(terminal.offset) || terminal.offset < 0 || terminal.offset > sideLength(r, terminal.side)) errors.push(`invalid offset for terminal "${id}.${terminalId}"`);
      }
    }
    for (const [id, arrow] of this.arrows) {
      if (id !== arrow.id || !arrow.id) errors.push('arrow ids must be non-empty and match their map keys');
      if (arrow.detached) {
        if (!Array.isArray(arrow.points) || arrow.points.length < 2) errors.push(`detached arrow "${id}" needs at least two route points`);
        else if (arrow.points.some((point) => !point || !finite(point.x) || !finite(point.y) || !onGrid(point.x) || !onGrid(point.y))) errors.push(`arrow "${id}" points must be finite and grid-aligned`);
        else if (!routeIsOrthogonal(arrow.points)) errors.push(`arrow "${id}" route must be orthogonal`);
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
