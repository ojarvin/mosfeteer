import { transformRect } from './geometry.js';
import { canonicalNetName, referenceMarkerInfo, referenceMarkerName } from './model.js';

// Joined supply bars. Supplies that share one bar line may draw their
// horizontal slabs as one continuous bar. The bar is purely visual: the
// markers are already one rail by name, so it adds no connectivity, and it is
// never drawn between supplies of different names, across another part, or
// across a wire, where it would read as a connection that does not exist.

const EPS = 1e-6;

/** The filled slab of the supply symbol, in local coordinates. */
function localSlab(def) {
  const slab = def.graphics.find((g) => g.kind === 'polygon' && g.fill === 'foreground');
  const xs = slab.points.map((p) => p.x);
  const ys = slab.points.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/** A supply's rail identity: its own marker name (or, for a scripted marker
 *  without a label, its value), else the global supply rail. Erring toward
 *  distinct names only ever breaks a bar. */
export function supplyRailName(component) {
  return referenceMarkerName(component) || canonicalNetName(component.value || '')
    || referenceMarkerInfo('supply').globalName;
}

function slabOf(component) {
  const rect = transformRect(component.transform, localSlab(component.def));
  const axis = rect.w >= rect.h ? 'x' : 'y';
  const cross = axis === 'x' ? 'y' : 'x';
  const size = axis === 'x' ? 'h' : 'w';
  // Two slabs lie on one bar line only if they cover the same band across it,
  // which also keeps supplies hanging the opposite way apart.
  const line = `${axis}:${Math.round(rect[cross] * 100)}:${Math.round(rect[size] * 100)}`;
  return { component, rect, axis, line };
}

/** Every supply sharing a bar line with any other supply, ordered along it. */
function barLines(circuit) {
  const lines = new Map();
  for (const component of circuit.components.values()) {
    if (component.type !== 'supply') continue;
    const slab = slabOf(component);
    if (!lines.has(slab.line)) lines.set(slab.line, []);
    lines.get(slab.line).push(slab);
  }
  for (const row of lines.values()) row.sort((a, b) => a.rect[a.axis] - b.rect[b.axis] || a.component.refdes.localeCompare(b.component.refdes));
  return lines;
}

const overlaps = (a, b) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;

function segmentCrosses(p, q, r) {
  const lo = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) };
  const hi = { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y) };
  // Wires are orthogonal or diagonal; a bounding-box test is exact for the
  // former and conservative for the latter, which only ever breaks a bar.
  return lo.x <= r.x + r.w && hi.x >= r.x && lo.y <= r.y + r.h && hi.y >= r.y;
}

function gapBlocked(circuit, gap) {
  for (const component of circuit.components.values()) {
    if (component.type === 'supply' || component.type === 'solder') continue;
    if (overlaps(component.bboxWorld(), gap)) return true;
  }
  for (const net of circuit.nets.values()) {
    for (const path of net.paths()) {
      for (let i = 1; i < path.length; i += 1) if (segmentCrosses(path[i - 1], path[i], gap)) return true;
    }
  }
  return false;
}

/** The bar pieces to draw between joined neighbours:
 *  [{ from, to, rect }] with world rectangles. */
export function supplyBarJoins(circuit) {
  const joins = [];
  for (const row of barLines(circuit).values()) {
    for (let i = 0; i + 1 < row.length; i += 1) {
      const a = row[i];
      const b = row[i + 1];
      if (!a.component.joinBar || !b.component.joinBar) continue;
      if (supplyRailName(a.component) !== supplyRailName(b.component)) continue;
      const axis = a.axis;
      const start = a.rect[axis] + (axis === 'x' ? a.rect.w : a.rect.h);
      const end = b.rect[axis];
      if (end - start <= EPS) continue;
      const gap = axis === 'x'
        ? { x: start, y: a.rect.y, w: end - start, h: a.rect.h }
        : { x: a.rect.x, y: start, w: a.rect.w, h: end - start };
      if (gapBlocked(circuit, gap)) continue;
      joins.push({ from: a.component.refdes, to: b.component.refdes, rect: gap, axis, start: a.rect[axis], end: end + (axis === 'x' ? b.rect.w : b.rect.h) });
    }
  }
  return joins;
}

/** Joined neighbours merged into continuous bars, each spanning its end
 *  supplies' slabs: [{ refs, rect }]. Drawing one shape over the slabs, rather
 *  than filling only the gaps, leaves no anti-aliased seam where a gap meets a
 *  slab edge. */
export function supplyBars(circuit) {
  const bars = [];
  for (const join of supplyBarJoins(circuit)) {
    const last = bars.at(-1);
    if (last && last.refs.at(-1) === join.from) {
      last.refs.push(join.to);
      last.end = join.end;
    } else bars.push({ refs: [join.from, join.to], axis: join.axis, band: join.rect, start: join.start, end: join.end });
  }
  return bars.map(({ refs, axis, band, start, end }) => ({
    refs,
    rect: axis === 'x'
      ? { x: start, y: band.y, w: end - start, h: band.h }
      : { x: band.x, y: start, w: band.w, h: end - start },
  }));
}

/** Owned labels that a joined bar keeps out of sight. Every supply on a bar
 *  carries the rail name in its own label, so electrical naming never depends
 *  on the drawing; the bar shows one of them (its first labelled supply's)
 *  and hides the rest. Splitting the bar shows them all again. */
export function hiddenSupplyBarLabels(circuit) {
  const hidden = new Set();
  for (const bar of supplyBars(circuit)) {
    const owned = bar.refs.map((ref) => circuit.labelOf(ref)).filter(Boolean);
    for (const label of owned.slice(1)) hidden.add(label.id);
  }
  return hidden;
}

/** The supplies a bar join applies to from one of them: the same-rail
 *  supplies on its bar line, itself included, in order along the line. */
export function supplyBarRow(circuit, refdes) {
  const component = circuit.components.get(refdes);
  if (component?.type !== 'supply') return [];
  const line = slabOf(component).line;
  const row = barLines(circuit).get(line) || [];
  const rail = supplyRailName(component);
  return row.filter((slab) => supplyRailName(slab.component) === rail).map((slab) => slab.component.refdes);
}
