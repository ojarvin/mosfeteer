/** Phase 2: deterministic, topology-only analog placement. */
import { rectsOverlap } from './geometry.js';
import { GRID, onGrid } from './grid.js';
import { Circuit, ComponentInstance } from './model.js';
import { candidateScore, expandCircuitSpec, normalizeCircuitSpec } from './circuitSpec.js';

export const PLACEMENT_VERSION = 1;
export const MAX_PLACEMENT_CANDIDATES = 8;

const geometryCircuit = new Circuit();
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isMos = (type) => ['nmos', 'nmosb', 'pmos', 'pmosb'].includes(type);
const isPmos = (type) => type === 'pmos' || type === 'pmosb';
const isRail = (type) => type === 'supply' || type === 'ground';
const number = (value) => typeof value === 'number' && Number.isFinite(value);
const gridNumber = (value) => number(value) && onGrid(value);

function componentGeometry(component, transform) {
  // ComponentInstance is the model's single source of truth for defaults and
  // transformed geometry, but constructing one here does not add it anywhere.
  const instance = new ComponentInstance(geometryCircuit, component.type, {
    refdes: component.refdes || component.id,
    value: component.value,
    noLabel: true,
    ...transform,
  });
  return {
    bbox: instance.bboxWorld(),
    terminals: instance.worldTerminals(),
  };
}

function groupsFor(spec) {
  const byId = new Map(spec.components.map((c) => [c.id, c]));
  const groups = [];
  const used = new Set();
  const add = (members, source, symmetric = true) => {
    const ids = [...new Set(members)].filter((id) => byId.has(id) && !used.has(id)).sort(compare);
    if (ids.length < 2) return;
    ids.forEach((id) => used.add(id));
    groups.push({ members: ids, source, symmetric });
  };
  for (const group of spec.constraints.groups || []) {
    add(group.members || [], 'constraint', group.symmetric !== false && group.matched !== false);
  }
  const named = new Map();
  for (const component of spec.components) if (component.group) {
    if (!named.has(component.group)) named.set(component.group, []);
    named.get(component.group).push(component.id);
  }
  for (const [name, members] of [...named.entries()].sort(([a], [b]) => compare(a, b))) add(members, `group:${name}`);

  // A shared source or gate is the only topology evidence needed to infer a
  // small matched pair. This covers the supplied analog motifs without
  // inventing a second connectivity graph.
  for (const net of spec.nets) {
    for (const terminalName of ['s', 'g']) {
      const members = net.terminals.filter((t) => t.terminal === terminalName && byId.get(t.component) && isMos(byId.get(t.component).type)).map((t) => t.component);
      if (members.length >= 2) add(members.slice(0, 2), `net:${net.id}.${terminalName}`);
    }
  }
  return groups;
}

function stackGroups(spec) {
  const byId = new Map(spec.components.map((c) => [c.id, c]));
  const out = [];
  for (const column of spec.constraints.columns || []) {
    const members = [...new Set(column.members || [])].filter((id) => byId.has(id)).sort(compare);
    if (members.length > 1) out.push({ ...column, members, source: 'constraint' });
  }
  return out;
}

function rowConstraints(component, spec) {
  return (spec.constraints.rows || []).filter((item) => item.members?.includes(component.id)).flatMap((item) => {
    if (gridNumber(item.y)) return [item.y];
    if (Number.isInteger(item.row)) return [item.row * 160];
    return [];
  });
}

function rowConstraint(component, spec) {
  return rowConstraints(component, spec)[0];
}

function rowOf(component, spec, rowIndex) {
  const constrained = rowConstraint(component, spec);
  if (constrained !== undefined) return constrained;
  if (isRail(component.type)) return component.type === 'supply' ? rowIndex.top : rowIndex.bottom;
  if (isPmos(component.type)) return rowIndex.pmos;
  if (component.type === 'nmos' || component.type === 'nmosb') return rowIndex.nmos;
  return rowIndex.passive;
}

function stackRow(spec, stack, rowIndex) {
  const bases = stack.members.flatMap((id, index) => rowConstraints({ id }, spec).map((row) => row - index * 160));
  const base = bases[0] ?? (stack.members.every((id) => isPmos(spec.components.find((c) => c.id === id).type)) ? rowIndex.pmos : rowIndex.nmos);
  return { base, conflict: bases.some((row) => row !== base) };
}

function axisX(column, originX, xStep, index) {
  if (gridNumber(column.x)) return column.x;
  if (Number.isInteger(column.column)) return originX + column.column * xStep;
  return originX + index * xStep;
}

function corridorRect(c) {
  if (!c || typeof c !== 'object') return null;
  if ([c.x, c.y, c.w, c.h].every(gridNumber) && c.w >= 0 && c.h >= 0) return { x: c.x, y: c.y, w: c.w, h: c.h };
  if (c.axis === 'horizontal' && gridNumber(c.y) && gridNumber(c.x0) && gridNumber(c.x1)) {
    return { x: Math.min(c.x0, c.x1), y: c.y, w: Math.abs(c.x1 - c.x0), h: GRID };
  }
  if (c.axis === 'vertical' && gridNumber(c.x) && gridNumber(c.y0) && gridNumber(c.y1)) {
    return { x: c.x, y: Math.min(c.y0, c.y1), w: GRID, h: Math.abs(c.y1 - c.y0) };
  }
  return null;
}

function isHardCorridor(c) {
  return c?.hard === true || c?.critical === true || c?.kind === 'critical' || c?.kind === 'feedback';
}

function netForPort(spec, port) {
  return spec.nets.find((net) => net.id === port.net);
}

function portPlacement(spec, port, components, bounds, indexBySide) {
  const type = port.type || 'input';
  const right = type === 'output';
  const x = right ? bounds.x + bounds.w + 320 : bounds.x - 320;
  const net = netForPort(spec, port);
  const ys = (net?.terminals || []).flatMap((t) => components.get(t.component)?.terminals.filter((p) => p.name === t.terminal).map((p) => p.y) || []);
  const baseY = ys.length ? Math.round(ys.reduce((a, b) => a + b, 0) / ys.length / GRID) * GRID : 0;
  const slot = indexBySide[right ? 'right' : 'left']++;
  const y = baseY + slot * 80;
  const transform = { x, y, rotation: 0, mirrorX: right, mirrorY: false };
  return { id: port.id, refdes: port.id, type, net: port.net, direction: type, transform, ...componentGeometry({ id: port.id, refdes: port.id, type }, transform) };
}

function buildCandidate(spec, variant) {
  const components = new Map(spec.components.map((c) => [c.id, c]));
  const groups = groupsFor(spec);
  const stacks = stackGroups(spec);
  const inStack = new Set(stacks.flatMap((g) => g.members));
  const rowIndex = { pmos: -160 - variant.rowGap, passive: 0, nmos: 160 + variant.rowGap, top: -400 - variant.rowGap, bottom: 640 + variant.rowGap };
  const transforms = new Map();
  const place = (component, x, y, mirrorX = false) => {
    const transform = { x, y, rotation: 0, mirrorX, mirrorY: isPmos(component.type) };
    transforms.set(component.id, { ...transform });
  };

  let block = 0;
  for (const stack of stacks) {
    const x = axisX(stack, variant.originX, variant.xStep, block++);
    const { base: y, conflict } = stackRow(spec, stack, rowIndex);
    stack.rowConflict = conflict;
    stack.members.forEach((id, i) => place(components.get(id), x, y + i * 160));
  }
  const groupCenters = new Map();
  for (const group of groups) {
    if (group.members.some((id) => inStack.has(id))) continue;
    const first = components.get(group.members[0]);
    const peer = groups.find((other) => other !== group && other.members.length === group.members.length &&
      other.members.every((id) => !inStack.has(id)) && isPmos(components.get(other.members[0]).type) !== isPmos(first.type));
    const center = peer && groupCenters.has(peer) ? groupCenters.get(peer) : variant.originX + block++ * variant.xStep;
    groupCenters.set(group, center);
    const n = group.members.length;
    group.members.forEach((id, i) => {
      const component = components.get(id);
      const x = center + (i * 2 - (n - 1)) * (variant.xStep / 2);
      const centerIndex = (n - 1) / 2;
      place(component, x, rowOf(component, spec, rowIndex), group.symmetric && (isPmos(component.type) ? i < centerIndex : i > centerIndex));
    });
  }
  const matchedCenter = [...groupCenters.values()][0];
  for (const component of spec.components) {
    if (transforms.has(component.id)) continue;
    const column = (spec.constraints.columns || []).find((item) => item.members?.includes(component.id));
    const sharedTail = spec.nets.some((net) => net.terminals.some((t) => t.component === component.id && t.terminal === 'd') &&
      net.terminals.filter((t) => t.terminal === 's').length > 1);
    const x = column ? axisX(column, variant.originX, variant.xStep, block) : sharedTail && matchedCenter !== undefined ? matchedCenter : variant.originX + block * variant.xStep;
    if (column || !sharedTail) block++;
    const y = sharedTail ? rowIndex.nmos + 160 : rowOf(component, spec, rowIndex);
    place(component, x, y);
  }

  const geometry = new Map(spec.components.map((component) => {
    const transform = transforms.get(component.id);
    return [component.id, { ...component, refdes: component.refdes || component.id, transform, ...componentGeometry(component, transform) }];
  }));
  const stackConstraintViolations = stacks.filter((stack) => stack.rowConflict).length;
  const stackViolations = stacks.reduce((count, stack) => count + stack.members.slice(1).filter((id, i) => {
    const upper = geometry.get(stack.members[i]);
    const lower = geometry.get(id);
    const upperName = isPmos(upper.type) ? 'd' : 's';
    const lowerName = isPmos(upper.type) ? 's' : 'd';
    const a = upper.terminals.find((point) => point.name === upperName);
    const b = lower.terminals.find((point) => point.name === lowerName);
    return !a || !b || a.x !== b.x || a.y !== b.y;
  }).length, 0);
  const boxes = [...geometry.values()].map((item) => item.bbox);
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if (rectsOverlap(boxes[i], boxes[j])) overlaps.push([spec.components[i].id, spec.components[j].id]);
  }
  const corridors = (spec.constraints.corridors || []).map((item) => ({ ...item, rect: corridorRect(item) })).filter((item) => item.rect);
  const corridorHits = corridors.filter((corridor) => [...geometry.values()].some((item) => rectsOverlap(item.bbox, corridor.rect)));
  const bounds = boxes.length ? (() => {
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    return { x, y, w: Math.max(...boxes.map((box) => box.x + box.w)) - x, h: Math.max(...boxes.map((box) => box.y + box.h)) - y };
  })() : { x: 0, y: 0, w: 0, h: 0 };
  const ports = [];
  const indexBySide = { left: 0, right: 0 };
  for (const port of spec.ports || []) ports.push(portPlacement(spec, port, geometry, bounds, indexBySide));
  const rails = [];
  const railNetIds = (type) => spec.nets.filter((net) => {
    const named = type === 'supply'
      ? /^(VDD|VCC|AVDD|DVDD)$/i.test(net.name || net.id) || net.kind === 'supply'
      : /^(GND|VSS|AGND|DGND)$/i.test(net.name || net.id) || net.kind === 'ground';
    const symbol = net.terminals.some((terminal) => spec.components.find((c) => c.id === terminal.component)?.type === type);
    return named || symbol;
  }).map((net) => net.id);
  const railY = (type, fallback) => {
    const ys = [...geometry.values()].filter((item) => item.type === type).flatMap((item) => item.terminals.map((point) => point.y));
    return ys.length ? ys[0] : fallback;
  };
  const supplyNets = railNetIds('supply');
  const groundNets = railNetIds('ground');
  if (supplyNets.length) rails.push({ side: 'top', y: railY('supply', Math.floor((bounds.y - 80) / GRID) * GRID), nets: supplyNets });
  if (groundNets.length) rails.push({ side: 'bottom', y: railY('ground', Math.ceil((bounds.y + bounds.h + 80) / GRID) * GRID), nets: groundNets });
  const scoreData = {
    hardViolations: overlaps.length + corridorHits.filter((c) => isHardCorridor(c)).length,
    topologyViolations: stackViolations,
    stackConstraintViolations,
    componentClearance: 0,
    labelClearance: 0,
    pinConformity: 0,
    turns: 0,
    length: Math.round(bounds.w + bounds.h),
  };
  const placements = [...geometry.values()].map(({ id, refdes, type, value, transform, bbox, terminals }) => ({ id, refdes, type, ...(value === undefined ? {} : { value }), transform, bbox, terminals }));
  return { placements, ports, rails, corridors, scoreData, geometry, overlaps, corridorHits, bounds };
}

function validateCandidate(spec, candidate) {
  const errors = [];
  if (candidate.overlaps.length) errors.push('component bounding boxes overlap');
  if (candidate.scoreData.topologyViolations) errors.push('stack terminals do not coincide');
  if (candidate.scoreData.stackConstraintViolations) errors.push('conflicting row constraints for stack');
  for (const item of candidate.corridorHits) if (isHardCorridor(item)) errors.push(`component intersects reserved ${item.kind || 'critical'} corridor`);
  for (const placement of [...candidate.placements, ...candidate.ports]) {
    if (![placement.transform.x, placement.transform.y].every(gridNumber)) errors.push(`${placement.id} transform is off grid`);
    if (placement.terminals.some((p) => ![p.x, p.y].every(gridNumber))) errors.push(`${placement.id} terminal is off grid`);
  }
  const hard = new Set(spec.constraints.hard || []);
  if (hard.has('ports-required') && !candidate.ports.length) errors.push('hard constraint ports-required cannot be satisfied');
  return [...new Set(errors)];
}

function sourceSpec(input) {
  if (input?.spec?.components && input?.spec?.nets) return input.spec;
  return input?.components && input?.nets ? input : expandCircuitSpec(input);
}

function deferredConstraints(spec) {
  return [...(spec.constraints.hard || []), ...(spec.constraints.soft || []), ...(spec.constraints.flow ? [spec.constraints.flow] : [])];
}

function metadataErrors(spec) {
  const errors = [];
  const componentIds = new Set(spec.components.map((component) => component.id));
  const columned = new Set();
  for (const column of spec.constraints.columns || []) for (const member of column.members || []) {
    if (columned.has(member)) errors.push(`overlapping column constraints for ${member}`);
    columned.add(member);
  }
  const grouped = new Set();
  const namedGroups = new Map();
  for (const component of spec.components) if (component.group) {
    if (!namedGroups.has(component.group)) namedGroups.set(component.group, new Set());
    namedGroups.get(component.group).add(component.id);
  }
  for (const group of spec.constraints.groups || []) for (const member of group.members || []) {
    if (grouped.has(member) || columned.has(member)) errors.push(`overlapping group constraints for ${member}`);
    for (const members of namedGroups.values()) if (members.has(member) && [...members].some((id) => !(group.members || []).includes(id))) {
      errors.push(`conflicting named and explicit group constraints for ${member}`);
    }
    grouped.add(member);
  }
  for (const field of ['groups', 'rows', 'columns']) for (const item of spec.constraints[field] || []) {
    for (const member of item.members || []) if (!componentIds.has(member)) errors.push(`${field} constraint references unknown component ${member}`);
  }
  for (const component of spec.components) {
    const rows = rowConstraints(component, spec);
    if (new Set(rows).size > 1) errors.push(`conflicting row constraints for ${component.id}`);
  }
  for (const field of ['rows', 'columns']) for (const item of spec.constraints[field] || []) {
    for (const coordinate of field === 'rows' ? ['y'] : ['x']) {
      if (item[coordinate] !== undefined && (!number(item[coordinate]) || !onGrid(item[coordinate]))) errors.push(`${field} constraint coordinate is off grid`);
    }
    const ordinal = field === 'rows' ? 'row' : 'column';
    if (item[ordinal] !== undefined && !Number.isInteger(item[ordinal])) errors.push(`${field} constraint ordinal must be an integer`);
  }
  for (const corridor of spec.constraints.corridors || []) {
    if (!corridorRect(corridor) && isHardCorridor(corridor)) errors.push('reserved corridor geometry is invalid');
  }
  return [...new Set(errors)];
}

/** Pure deterministic placement pass. It never writes to a Circuit. */
export function placeCircuit(input, options = {}) {
  const spec = normalizeCircuitSpec(sourceSpec(input));
  const metadata = metadataErrors(spec);
  if (metadata.length) return { ok: false, success: false, spec, placements: [], ports: [], rails: [], corridors: [], report: { ok: false, version: PLACEMENT_VERSION, motif: spec.motif, candidateCount: 0, score: candidateScore({ hardViolations: metadata.length }), errors: metadata, interpretedConstraints: [], deferredConstraints: deferredConstraints(spec) } };
  const requested = Number.isInteger(options.maxCandidates) ? options.maxCandidates : MAX_PLACEMENT_CANDIDATES;
  const maxCandidates = Math.max(1, Math.min(MAX_PLACEMENT_CANDIDATES, requested));
  const spacing = Number.isInteger(spec.constraints.spacing?.minCells) ? spec.constraints.spacing.minCells : 2;
  const baseStep = Math.max(480, (spacing + 4) * GRID);
  const variants = [
    { originX: 320, xStep: baseStep, rowGap: 0 },
    { originX: 320, xStep: baseStep + 80, rowGap: 0 },
    { originX: 320, xStep: baseStep, rowGap: 80 },
    { originX: 320, xStep: baseStep + 160, rowGap: 80 },
  ].slice(0, maxCandidates);
  const candidates = variants.map((variant) => {
    const candidate = buildCandidate(spec, variant);
    return { ...candidate, variant, errors: validateCandidate(spec, candidate), score: candidateScore(candidate.scoreData) };
  });
  candidates.sort((a, b) => {
    for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
    return compare(JSON.stringify(a.variant), JSON.stringify(b.variant));
  });
  const best = candidates[0];
  const report = {
    ok: best.errors.length === 0,
    version: PLACEMENT_VERSION,
    motif: spec.motif,
    candidateCount: candidates.length,
    score: best.score,
    errors: best.errors,
    interpretedConstraints: ['groups', 'rows', 'columns', 'spacing', 'corridors'].filter((field) => spec.constraints[field] !== undefined),
    componentCount: spec.components.length,
    portCount: spec.ports?.length || 0,
    railCount: best.rails.length,
    corridorCount: best.corridors.length,
    deferredConstraints: deferredConstraints(spec).filter((item) => !['ports-required'].includes(item)),
  };
  if (!report.ok) return { ok: false, success: false, report, spec, placements: [], ports: [], rails: [], corridors: best.corridors };
  return {
    ok: true,
    success: true,
    report,
    spec,
    constraints: spec.constraints,
    placements: best.placements,
    ports: best.ports,
    rails: best.rails,
    corridors: best.corridors,
  };
}

export function tryPlaceCircuit(input, options = {}) {
  try { return placeCircuit(input, options); }
  catch (error) { return { ok: false, success: false, report: { ok: false, errors: [error.message] }, error }; }
}

