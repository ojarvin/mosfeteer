/**
 * The topology recognizer: where else a set of parts is drawn with the same
 * connections. A topology is the parts' types and shapes and which of their
 * pins share a physical net; a drawing of it in another circuit (or elsewhere
 * in the same one) is a one-to-one map of the parts onto parts there of the
 * same shape, under which two pins share a net exactly when their images
 * do. The parts there may connect to more than the parts mapped (a mirror
 * inside a larger amplifier is still a mirror); the map never joins or
 * splits a net among the parts it maps.
 *
 * A two-pin part drawn the same turned half round (a resistor, a capacitor)
 * may map its pins either way, so a resistor wired the other way round still
 * matches. Solder dots are drawing, not parts, and are never mapped.
 */

/** Two-pin symbols that draw the same turned half round, pins swapped. */
const REVERSIBLE = new Set(['resistor', 'capacitor']);

/** The most drawings one search reports, and the most partial maps it tries:
 *  enough for any real workspace, bounded for a selection of many like parts. */
const MATCH_LIMIT = 400;
const STEP_LIMIT = 200000;

/** A part's shape: its type and where its pins are (a block's or a transfer
 *  function's size moves them), so a map keeps every pin's place. */
function shapeKey(component) {
  const pins = component.terminalDefs.map((t) => {
    const p = component.localTerminal(t.name);
    return `${t.name}@${p.x},${p.y}`;
  });
  return `${component.type}|${pins.join(';')}`;
}

/** The ways a part's pins may map onto a part of its shape: identity, and
 *  for a reversible part the two pins swapped. */
function pinMaps(component) {
  const names = component.terminalDefs.map((t) => t.name);
  const identity = new Map(names.map((n) => [n, n]));
  if (!REVERSIBLE.has(component.type) || names.length !== 2) return [{ pins: identity, swapped: false }];
  return [{ pins: identity, swapped: false }, { pins: new Map([[names[0], names[1]], [names[1], names[0]]]), swapped: true }];
}

/** A circuit's parts by shape and every pin's net, for searching it. A pin on
 *  no net gets a net of its own (`~ref.pin`), which no other pin shares. */
export function topologyIndex(circuit) {
  const pinNet = new Map();
  const netPins = new Map();
  for (const net of circuit.nets.values()) {
    for (const t of net.terminals) {
      const key = `${t.comp}.${t.term}`;
      if (pinNet.has(key)) continue;
      pinNet.set(key, net.id);
      if (!netPins.has(net.id)) netPins.set(net.id, []);
      netPins.get(net.id).push(t);
    }
  }
  const byShape = new Map();
  const shapes = new Map();
  for (const component of circuit.components.values()) {
    if (component.type === 'solder') continue;
    const shape = shapeKey(component);
    shapes.set(component.refdes, shape);
    if (!byShape.has(shape)) byShape.set(shape, []);
    byShape.get(shape).push(component.refdes);
  }
  const netOf = (refdes, term) => pinNet.get(`${refdes}.${term}`) ?? `~${refdes}.${term}`;
  return { circuit, byShape, shapes, netPins, netOf };
}

/** The parts of `refs` in the order a search maps them: each after one it
 *  shares a net with where there is one, starting from the part whose
 *  shape `source` has fewest of. */
function searchOrder(target, refs, source) {
  const remaining = new Set(refs);
  const order = [];
  const rarity = (ref) => source.byShape.get(target.shapes.get(ref))?.length ?? 0;
  const netsOf = (ref) => target.circuit.components.get(ref).terminalDefs.map((t) => target.netOf(ref, t.name));
  while (remaining.size) {
    const placedNets = new Set(order.flatMap(netsOf));
    const linked = [...remaining].filter((ref) => netsOf(ref).some((n) => placedNets.has(n)));
    const pool = linked.length ? linked : [...remaining];
    pool.sort((a, b) => rarity(a) - rarity(b) || a.localeCompare(b));
    order.push(pool[0]);
    remaining.delete(pool[0]);
  }
  return order;
}

/**
 * Every drawing in `sourceCircuit` of the topology the parts `refs` of
 * `targetCircuit` have: a list of `{ parts }`, each a Map from a part of
 * `refs` to `{ refdes, swapped }` there (`swapped`: a reversible part's pins
 * map the other way round). `exclude` lists parts there never mapped onto
 * (the parts themselves, when both are one circuit). Empty when a part of
 * `refs` is unknown or none of its shape is there.
 */
export function findTopology(targetCircuit, refs, sourceCircuit, { exclude = [], limit = MATCH_LIMIT } = {}) {
  const parts = refs.filter((ref) => targetCircuit.components.get(ref)?.type !== 'solder');
  if (!parts.length || parts.some((ref) => !targetCircuit.components.has(ref))) return [];
  const target = topologyIndex(targetCircuit);
  const source = sourceCircuit === targetCircuit ? target : topologyIndex(sourceCircuit);
  if (parts.some((ref) => !source.byShape.has(target.shapes.get(ref)))) return [];
  const excluded = new Set(exclude);
  const order = searchOrder(target, parts, source);
  const pins = new Map(order.map((ref) => [ref, targetCircuit.components.get(ref).terminalDefs.map((t) => t.name)]));
  const maps = new Map(order.map((ref) => [ref, pinMaps(targetCircuit.components.get(ref))]));
  const netMap = new Map();
  const netBack = new Map();
  const assigned = new Map();
  const used = new Set();
  const found = [];
  let steps = 0;

  // Parts there of the shape that have a pin on a net already mapped onto,
  // else every part of the shape.
  const candidatesFor = (ref) => {
    const shaped = source.byShape.get(target.shapes.get(ref)) || [];
    for (const term of pins.get(ref)) {
      const mapped = netMap.get(target.netOf(ref, term));
      if (mapped === undefined) continue;
      const shape = target.shapes.get(ref);
      const onNet = (source.netPins.get(mapped) || []).map((t) => t.comp);
      return [...new Set(onNet)].filter((comp) => source.shapes.get(comp) === shape);
    }
    return shaped;
  };

  const visit = (index) => {
    if (found.length >= limit || ++steps > STEP_LIMIT) return;
    if (index === order.length) {
      found.push({ parts: new Map(assigned) });
      return;
    }
    const ref = order[index];
    for (const candidate of candidatesFor(ref)) {
      if (used.has(candidate) || excluded.has(candidate)) continue;
      for (const map of maps.get(ref)) {
        const bound = [];
        let fits = true;
        for (const term of pins.get(ref)) {
          const from = target.netOf(ref, term);
          const to = source.netOf(candidate, map.pins.get(term));
          const known = netMap.get(from);
          if (known !== undefined) {
            if (known !== to) { fits = false; break; }
            continue;
          }
          if (netBack.has(to)) { fits = false; break; }
          netMap.set(from, to);
          netBack.set(to, from);
          bound.push(from);
        }
        if (fits) {
          assigned.set(ref, { refdes: candidate, swapped: map.swapped });
          used.add(candidate);
          visit(index + 1);
          used.delete(candidate);
          assigned.delete(ref);
        }
        for (const from of bound) {
          netBack.delete(netMap.get(from));
          netMap.delete(from);
        }
        if (found.length >= limit || steps > STEP_LIMIT) return;
      }
    }
  };
  visit(0);
  return found;
}

const pointKey = (p) => `${p.x},${p.y}`;

function onSegment(p, a, b) {
  if (a.x === b.x) return p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
  if (a.y === b.y) return p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x);
  // A diagonal: on the line between the ends.
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return cross === 0 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
    && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}

/**
 * The part of a net's drawn wires that joins the points `keep` (pins): the
 * wires pruned back from every end that reaches none of them, as polylines.
 * Null when the wires do not join every kept point, else a list (empty when
 * the points coincide or there is just one).
 */
export function wiresJoining(paths, keep) {
  const kept = new Map(keep.map((p) => [pointKey(p), p]));
  if (kept.size <= 1) return [];
  // Split every segment where a vertex of another path, or a kept point, lies
  // on it: branches meet mid-segment, and a pin may sit on a straight run.
  const marks = [...kept.values(), ...paths.flat()];
  const adjacency = new Map();
  const node = (p) => {
    const key = pointKey(p);
    if (!adjacency.has(key)) adjacency.set(key, { point: { x: p.x, y: p.y }, next: new Set() });
    return adjacency.get(key);
  };
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (a.x === b.x && a.y === b.y) continue;
      const stops = [a, b, ...marks.filter((p) => onSegment(p, a, b))];
      const unique = [...new Map(stops.map((p) => [pointKey(p), p])).values()];
      unique.sort((u, v) => Math.hypot(u.x - a.x, u.y - a.y) - Math.hypot(v.x - a.x, v.y - a.y));
      for (let k = 1; k < unique.length; k++) {
        const u = node(unique[k - 1]);
        const v = node(unique[k]);
        u.next.add(pointKey(v.point));
        v.next.add(pointKey(u.point));
      }
    }
  }
  for (const key of kept.keys()) if (!adjacency.has(key)) return null;
  // Prune ends that reach no kept point.
  const leaves = [...adjacency.keys()].filter((key) => adjacency.get(key).next.size <= 1 && !kept.has(key));
  while (leaves.length) {
    const key = leaves.pop();
    const entry = adjacency.get(key);
    if (!entry) continue;
    for (const other of entry.next) {
      const neighbour = adjacency.get(other);
      neighbour.next.delete(key);
      if (neighbour.next.size <= 1 && !kept.has(other)) leaves.push(other);
    }
    adjacency.delete(key);
  }
  // Every kept point reached from the first.
  const start = kept.keys().next().value;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const other of adjacency.get(queue.pop()).next) if (!seen.has(other)) { seen.add(other); queue.push(other); }
  }
  for (const key of kept.keys()) if (!seen.has(key)) return null;
  // Walk the remaining graph into polylines between stops: kept points and
  // nodes of any degree but two.
  const isStop = (key) => kept.has(key) || adjacency.get(key).next.size !== 2;
  const walked = new Set();
  const edge = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const polylines = [];
  const walkFrom = (from, first) => {
    const line = [adjacency.get(from).point];
    let previous = from;
    let current = first;
    walked.add(edge(from, first));
    while (true) {
      line.push(adjacency.get(current).point);
      if (isStop(current)) break;
      const next = [...adjacency.get(current).next].find((key) => key !== previous && !walked.has(edge(current, key)));
      if (!next) break;
      walked.add(edge(current, next));
      previous = current;
      current = next;
    }
    polylines.push(straightened(line));
  };
  const keys = [...adjacency.keys()].sort();
  for (const key of keys) {
    if (!isStop(key)) continue;
    for (const other of [...adjacency.get(key).next].sort()) if (!walked.has(edge(key, other))) walkFrom(key, other);
  }
  // A loop with no stop on it.
  for (const key of keys) {
    for (const other of [...adjacency.get(key).next].sort()) if (!walked.has(edge(key, other))) walkFrom(key, other);
  }
  return polylines;
}

/** A polyline without the points where it runs straight on. */
function straightened(line) {
  const out = [line[0]];
  for (let i = 1; i < line.length - 1; i++) {
    const a = out.at(-1);
    const b = line[i];
    const c = line[i + 1];
    if ((b.x - a.x) * (c.y - b.y) === (b.y - a.y) * (c.x - b.x)) continue;
    out.push(b);
  }
  out.push(line.at(-1));
  return out;
}
