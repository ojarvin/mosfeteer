import { applyTransform, transformRect } from '../core/geometry.js';
import { GRID } from '../core/grid.js';

const nearGrid = (value, grid = GRID) => Math.abs(value / grid - Math.round(value / grid)) < 1e-6;
const center = (rect, axis) => rect[axis] + rect[axis === 'x' ? 'w' : 'h'] / 2;
const end = (rect, axis) => rect[axis] + rect[axis === 'x' ? 'w' : 'h'];

/** A symbol may identify the terminals defining its useful placement center.
 * The default origin is already the electrical midpoint for most symbols. */
export function layoutAnchor(def, transform) {
  const names = def?.layoutAnchorTerminals || [];
  const terminals = names.map((name) => def.terminals.find((terminal) => terminal.name === name)).filter(Boolean);
  if (!terminals.length) return { x: transform.x, y: transform.y };
  const x = terminals.reduce((sum, terminal) => sum + terminal.x, 0) / terminals.length;
  const y = terminals.reduce((sum, terminal) => sum + terminal.y, 0) / terminals.length;
  return applyTransform(transform, x, y);
}

export function componentLayoutItem(component) {
  return {
    id: component.refdes,
    kind: 'component',
    type: component.type,
    rotation: component.transform.rotation % 180,
    anchor: layoutAnchor(component.def, component.transform),
    bbox: component.bboxWorld(),
  };
}

export function ghostLayoutItem(ghost) {
  if (!ghost?.def) return null;
  const transform = {
    x: ghost.x, y: ghost.y, rotation: ghost.rotation || 0,
    mirrorX: !!ghost.mirrorX, mirrorY: !!ghost.mirrorY,
  };
  return {
    id: '__ghost__', kind: 'component', type: ghost.def.type,
    rotation: transform.rotation % 180,
    anchor: layoutAnchor(ghost.def, transform),
    bbox: transformRect(transform, ghost.def.bbox),
  };
}

export function labelLayoutItem(label) {
  return {
    id: label.id, kind: 'label', type: label.kind,
    rotation: 0, anchor: label.anchorWorld(), bbox: label.bbox(),
  };
}

/** Align each bbox to the outer edge or center of the selected-set bbox.
 * A target requiring a fractional grid move is unavailable rather than
 * silently claiming that an almost-aligned result is exact. */
export function alignmentPlan(items, direction, grid = GRID) {
  if (items.length < 2) return { ok: false, reason: 'Select at least two movable objects.' };
  const axis = ['left', 'right', 'center-x'].includes(direction) ? 'x' : 'y';
  const low = Math.min(...items.map((item) => item.bbox[axis]));
  const high = Math.max(...items.map((item) => end(item.bbox, axis)));
  const target = direction === 'left' || direction === 'top' ? low
    : direction === 'right' || direction === 'bottom' ? high : (low + high) / 2;
  const deltas = items.map((item) => {
    const current = direction === 'left' || direction === 'top' ? item.bbox[axis]
      : direction === 'right' || direction === 'bottom' ? end(item.bbox, axis)
        : center(item.bbox, axis);
    return { id: item.id, dx: axis === 'x' ? target - current : 0, dy: axis === 'y' ? target - current : 0 };
  });
  if (deltas.some(({ dx, dy }) => !nearGrid(dx || dy, grid))) {
    return { ok: false, reason: 'Exact alignment would move an object off the grid.' };
  }
  return { ok: true, deltas };
}

/** Keep the outer two objects fixed and spread the interior on the grid.
 * `gaps` measures outlines; `anchors` measures meaningful positions. */
export function distributionPlan(items, axis, measure = 'gaps', grid = GRID) {
  if (items.length < 3) return { ok: false, reason: 'Select at least three movable objects.' };
  if (!['x', 'y'].includes(axis) || !['gaps', 'anchors'].includes(measure)) return { ok: false, reason: 'Unknown spacing mode.' };
  const ordered = [...items].sort((a, b) => (measure === 'gaps' ? a.bbox[axis] - b.bbox[axis] : a.anchor[axis] - b.anchor[axis]) || a.id.localeCompare(b.id));
  const first = ordered[0];
  const last = ordered.at(-1);
  if (measure === 'gaps') {
    const innerSize = ordered.slice(1, -1).reduce((sum, item) => sum + (axis === 'x' ? item.bbox.w : item.bbox.h), 0);
    const free = last.bbox[axis] - end(first.bbox, axis) - innerSize;
    if (free < 0) return { ok: false, reason: 'There is not enough room between the outer objects.' };
    const gap = free / (ordered.length - 1);
    let cursor = end(first.bbox, axis);
    const deltas = [{ id: first.id, dx: 0, dy: 0 }];
    for (const item of ordered.slice(1, -1)) {
      const ideal = cursor + gap;
      const raw = ideal - item.bbox[axis];
      const shift = Math.round(raw / grid) * grid;
      deltas.push({ id: item.id, dx: axis === 'x' ? shift : 0, dy: axis === 'y' ? shift : 0 });
      cursor = item.bbox[axis] + shift + (axis === 'x' ? item.bbox.w : item.bbox.h);
    }
    deltas.push({ id: last.id, dx: 0, dy: 0 });
    return { ok: true, deltas, exact: nearGrid(gap, grid) };
  }
  const span = last.anchor[axis] - first.anchor[axis];
  if (span <= 0) return { ok: false, reason: 'The outer anchors must be distinct.' };
  const pitch = span / (ordered.length - 1);
  const deltas = ordered.map((item, index) => {
    const shift = index === 0 || index === ordered.length - 1 ? 0
      : Math.round((first.anchor[axis] + pitch * index - item.anchor[axis]) / grid) * grid;
    return { id: item.id, dx: axis === 'x' ? shift : 0, dy: axis === 'y' ? shift : 0 };
  });
  return { ok: true, deltas, exact: nearGrid(pitch, grid) };
}

// Live placement guides. They are advisory only: the grid stays authoritative
// and nothing ever snaps. Every number drawn is measured between two real
// anchors and the position the guide points at, never between an anchor and
// wherever the object happens to be sitting -- so a guide that is still a
// suggestion says the same thing as the one that confirms the landing.
const MAX_SPACING_CELLS = 24; // beyond this two objects are not "a spacing"
const MAX_HINT_CELLS = 10; // how far off a target may be and still be offered
const SPACING_POOL = 8; // nearest peers considered as run-defining pairs
const LOCAL_CELLS = 16; // keep a nearby branch in view even when the ghost is beside it
const MAX_REPEAT_GAPS = 4; // enough repeated pitches to reach a deliberate double gap

/** Every position at which the moving object would be evenly spaced against
 *  one pair of peers: continuing their run in either direction, or centred
 *  between them. Pairs are enumerated rather than walked in from the nearest
 *  neighbour, so an unrelated part standing between two of a row does not hide
 *  the row, and the order the three were drawn in never matters. */
function spacingCandidates(peers, moving, axis, grid) {
  const other = axis === 'x' ? 'y' : 'x';
  const m = moving.anchor[axis];
  const pool = [...peers]
    .sort((a, b) => Math.abs(a.anchor[axis] - m) - Math.abs(b.anchor[axis] - m)
      || Math.abs(a.anchor[other] - moving.anchor[other]) - Math.abs(b.anchor[other] - moving.anchor[other])
      || a.id.localeCompare(b.id))
    .slice(0, SPACING_POOL);
  const candidates = [];
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const [a, b] = pool[i].anchor[axis] <= pool[j].anchor[axis] ? [pool[i], pool[j]] : [pool[j], pool[i]];
      const pair = b.anchor[axis] - a.anchor[axis];
      if (pair <= 0 || pair > MAX_SPACING_CELLS * grid) continue;
      // The two are one run only if they stand near each other off the axis,
      // and the moving object only belongs to it if it stands near the run --
      // loosely, since a port centred between two devices sits well to a side.
      const local = LOCAL_CELLS * grid;
      if (Math.abs(a.anchor[other] - b.anchor[other]) > local) continue;
      // The branch being placed can be a full pitch away from its defining
      // pair on the other axis. Do not make that distance grow with the pair's
      // separation: doing so lets a much farther pair displace the nearby one
      // as the pointer moves by a single grid cell.
      if (Math.abs(moving.anchor[other] - (a.anchor[other] + b.anchor[other]) / 2) > local) continue;
      const alike = [a, b].every((peer) => peer.type === moving.type && peer.rotation === moving.rotation);
      // How far the run stands off to the side of the object. Two branches of
      // a symmetric stage offer the same centre from both sides; the guide has
      // to name the one being worked next to, not its mirror image.
      const aside = Math.max(...[a, b].map((peer) => Math.abs(peer.anchor[other] - moving.anchor[other])));
      for (let repeat = 1; repeat <= MAX_REPEAT_GAPS; repeat += 1) {
        candidates.push(
          { target: a.anchor[axis] - pair * repeat, span: pair, run: [null, a, b], alike, aside, repeat, side: -1 },
          { target: b.anchor[axis] + pair * repeat, span: pair, run: [a, b, null], alike, aside, repeat, side: 1 },
        );
      }
      candidates.push(
        { target: (a.anchor[axis] + b.anchor[axis]) / 2, span: pair / 2, run: [a, null, b], alike, aside, repeat: 0, side: 0 },
      );
    }
  }
  return candidates;
}

/** The even spacing the moving object stands in, or the nearest one it could
 *  reach: no target further away than half the interval it would create, so
 *  crossing the midpoint hands over to the next position along.
 *
 *  A target off the grid is reported rather than hidden. Only a centre can be
 *  one -- continuing a run from two grid-aligned peers always lands on the
 *  grid -- and it means the pair's own gap is an odd number of cells, so there
 *  is no centre to place anything on. Saying so where it is being attempted is
 *  what steers a layout toward even gaps; the guide states the half-cell
 *  intervals it would take, and the remedy (move the pair one cell apart or
 *  together) follows from that. */
function spacingGuide(peers, moving, axis, grid) {
  const m = moving.anchor[axis];
  const within = spacingCandidates(peers, moving, axis, grid).filter(({ target, span }) =>
    span > 0 && Math.abs(target - m) <= Math.min(span / 2, MAX_HINT_CELLS * grid));
  // Keep the closest defining couple stable first. Ranking target distance
  // before branch distance made a one-cell pointer move switch from the local
  // column to a much farther pair whose midpoint happened to be nearer. A
  // repeated pitch is considered after the local couple, so walking past the
  // first target extends that same measured run instead of changing context.
  const rank = (list) => list.sort((a, b) => a.aside - b.aside
    || a.repeat - b.repeat
    || Math.abs(a.target - m) - Math.abs(b.target - m)
    || a.span - b.span
    || (a.alike === b.alike ? 0 : a.alike ? -1 : 1)
    || a.run.map((item) => item?.id || '').join().localeCompare(b.run.map((item) => item?.id || '').join()))[0];
  const onGrid = ({ target }) => nearGrid(target - m, grid);
  const best = rank(within.filter(onGrid)) || rank(within.filter((candidate) => !onGrid(candidate)));
  if (!best) return null;
  // The moving object's own point is placed ON the target: a suggestion and a
  // confirmation then measure the same two intervals, and no label ever states
  // a distance to a position nothing would occupy.
  const realPoint = (item) => item && { id: item.id, x: item.anchor.x, y: item.anchor.y, moving: false };
  let points;
  if (best.side === 1) {
    const a = best.run[0];
    const b = best.run[1];
    points = [realPoint(a), realPoint(b)];
    for (let repeat = 1; repeat <= best.repeat; repeat += 1) {
      const value = b.anchor[axis] + best.span * repeat;
      points.push({
        id: repeat === best.repeat ? moving.id : `__spacing_${axis}_${repeat}`,
        x: axis === 'x' ? value : moving.anchor.x,
        y: axis === 'y' ? value : moving.anchor.y,
        moving: true,
        ...(repeat !== best.repeat ? { synthetic: true } : {}),
      });
    }
  } else if (best.side === -1) {
    const a = best.run[1];
    const b = best.run[2];
    points = [];
    for (let repeat = best.repeat; repeat >= 1; repeat -= 1) {
      const value = a.anchor[axis] - best.span * repeat;
      points.push({
        id: repeat === best.repeat ? moving.id : `__spacing_${axis}_${repeat}`,
        x: axis === 'x' ? value : moving.anchor.x,
        y: axis === 'y' ? value : moving.anchor.y,
        moving: true,
        ...(repeat !== best.repeat ? { synthetic: true } : {}),
      });
    }
    points.push(realPoint(a), realPoint(b));
  } else {
    points = best.run.map((item) => (item
      ? realPoint(item)
      : {
          id: moving.id,
          x: axis === 'x' ? best.target : moving.anchor.x,
          y: axis === 'y' ? best.target : moving.anchor.y,
          moving: true,
        }));
  }
  return {
    kind: 'spacing',
    axis,
    cells: best.span / grid,
    exact: best.target === m,
    offGrid: !nearGrid(best.target - m, grid),
    away: (best.target - m) / grid,
    target: best.target,
    points,
  };
}

/** The nearest peer on each side that the moving object currently shares a row
 *  (`axis:'y'`) or column (`axis:'x'`) with, as one line through their anchors.
 *  Only the immediate neighbours: a part on the far side of the drawing shares
 *  the row by coincidence, and a line reaching it says nothing about this
 *  placement while covering everything in between. */
function alignGuide(peers, moving, axis, grid) {
  const along = axis === 'x' ? 'y' : 'x';
  const value = moving.anchor[axis];
  const reach = MAX_SPACING_CELLS * grid;
  const shared = peers.filter((peer) => peer.anchor[axis] === value
    && Math.abs(peer.anchor[along] - moving.anchor[along]) <= reach);
  const nearest = (dir) => shared
    .filter((peer) => dir * (peer.anchor[along] - moving.anchor[along]) > 0)
    .sort((a, b) => dir * (a.anchor[along] - b.anchor[along]) || a.id.localeCompare(b.id))[0];
  const members = [nearest(-1), nearest(1)].filter(Boolean);
  if (!members.length) return null;
  const points = [...members, moving]
    .map((item) => ({ id: item.id, x: item.anchor.x, y: item.anchor.y, moving: item.id === moving.id }))
    .sort((a, b) => a[along] - b[along] || a.id.localeCompare(b.id));
  return { kind: 'align', axis, value, points };
}

// Free space is not the same as the space between two centres. A wire crossing
// the gap, a label, a stub -- anything drawn narrows what is actually empty,
// and an object dropped at the midpoint of two component centres can sit hard
// against the ink on one side. The visual centre is measured between the
// facing edges of whatever is drawn, so both readings can be offered and the
// difference between them is the thing worth seeing.
const MIN_VISUAL_GAP_CELLS = 2;

/** The occupied rectangles that face the moving object across `axis`: only
 *  what shares its corridor on the other axis, since ink elsewhere in the
 *  drawing does not narrow this gap. */
function facingEdges(moving, occupancy, axis, grid) {
  const other = axis === 'x' ? 'y' : 'x';
  const size = other === 'x' ? 'w' : 'h';
  const span = moving.bbox[size];
  // The corridor is the moving object's own width, never less than a cell, so
  // a port-sized marker still sees the devices it is being placed between.
  const half = Math.max(span, grid) / 2;
  const lo = moving.anchor[other] - half;
  const hi = moving.anchor[other] + half;
  const at = moving.anchor[axis];
  let below = -Infinity;
  let above = Infinity;
  for (const rect of occupancy || []) {
    if (rect.id === moving.id) continue;
    const rLo = rect[other];
    const rHi = rect[other] + rect[size];
    if (rHi <= lo || rLo >= hi) continue; // not in the corridor
    const near = rect[axis];
    const far = rect[axis] + rect[axis === 'x' ? 'w' : 'h'];
    if (far <= at) below = Math.max(below, far);
    else if (near >= at) above = Math.min(above, near);
    else return null; // the object overlaps this ink: there is no gap to centre in
  }
  return Number.isFinite(below) && Number.isFinite(above) ? { below, above } : null;
}

/** The centre of the drawn gap the object stands in.
 *
 *  Unlike every other guide this one is a reference line rather than a place
 *  to land: the edges of a gap are wherever the ink happens to be, so its
 *  middle is usually off the grid and no object can sit exactly on it. Saying
 *  "you cannot have this" would be useless -- what is wanted is to see where
 *  the eye will read the centre, and to place beside it. So it is offered
 *  whenever the object is inside a gap, grid or no grid, and the two halves it
 *  measures are what makes the reading checkable. */
function visualCentreGuide(moving, occupancy, axis, grid) {
  const edges = facingEdges(moving, occupancy, axis, grid);
  if (!edges) return null;
  const gap = edges.above - edges.below;
  if (gap < MIN_VISUAL_GAP_CELLS * grid) return null;
  const target = (edges.below + edges.above) / 2;
  const m = moving.anchor[axis];
  const other = axis === 'x' ? 'y' : 'x';
  const point = (value) => ({
    id: moving.id,
    x: axis === 'x' ? value : moving.anchor.x,
    y: axis === 'y' ? value : moving.anchor.y,
    moving: value === target,
  });
  return {
    kind: 'spacing',
    basis: 'space',
    reference: true,
    axis,
    cells: Math.round((gap / 2 / grid) * 100) / 100,
    exact: target === m,
    offGrid: !nearGrid(target - m, grid),
    away: (target - m) / grid,
    target,
    edges,
    points: [point(edges.below), point(target), point(edges.above)],
    other: moving.anchor[other],
  };
}

/** Advisory guides for an inserted or moving object. They never alter its
 *  coordinates: the existing placement grid remains authoritative. At most one
 *  spacing and one alignment guide per axis, and since an object cannot both
 *  share a column and be evenly spaced along it, two is the usual number. */
export function placementGuides(items, moving, grid = GRID, occupancy = null) {
  if (!moving || moving.kind !== 'component') return [];
  const others = items.filter((item) => item.id !== moving.id && item.kind === 'component');
  const alike = others.filter((item) => item.type === moving.type && item.rotation === moving.rotation);
  const guides = [];
  for (const axis of ['x', 'y']) {
    // Geometry chooses the defining couple first. A mixed pair can be the
    // nearest meaningful middle even when a same-type pair offers a farther
    // continuation; type/orientation remains a tie-breaker inside
    // `spacingGuide`, so repeated identical parts still win when the measured
    // relationship is otherwise equal.
    const spacing = spacingGuide(others, moving, axis, grid);
    if (spacing) guides.push(spacing);
    // The drawn gap, offered beside the centre of the components whenever the
    // two disagree -- if they coincide there is only one line to draw.
    const visual = occupancy && visualCentreGuide(moving, occupancy, axis, grid);
    if (visual && visual.target !== spacing?.target) guides.push(visual);
    const align = alignGuide(alike, moving, axis, grid) || alignGuide(others, moving, axis, grid);
    if (align) guides.push(align);
  }
  return guides;
}

/** The guides in words for the status line: the drawing shows the geometry,
 *  this names the objects it was measured against and whether the object is
 *  standing in the relationship or being offered it. */
export function describeGuides(guides = []) {
  const peers = (guide) => guide.points.filter((point) => !point.moving && !point.synthetic).map((point) => point.id).join(', ');
  const direction = (guide) => {
    const away = Math.abs(guide.away);
    // World y grows downward, so a target further along the y axis is below.
    const toward = guide.axis === 'x'
      ? (guide.away > 0 ? 'right' : 'left')
      : (guide.away > 0 ? 'down' : 'up');
    return `${away} ${away === 1 ? 'cell' : 'cells'} ${toward}`;
  };
  return guides.map((guide) => {
    if (guide.kind === 'align') return `${guide.axis === 'y' ? 'row' : 'column'} with ${peers(guide)}`;
    if (guide.basis === 'space') {
      const where = `${guide.axis === 'x' ? 'horizontal' : 'vertical'} centre of the drawn gap, ${guide.cells} cells each side`;
      if (guide.exact) return where;
      return guide.offGrid ? `${where} (between grid lines)` : `${where} ${direction(guide)}`;
    }
    const spacing = `even ${guide.axis === 'x' ? 'horizontal' : 'vertical'} spacing ${guide.cells} cells (${peers(guide)})`;
    if (guide.offGrid) return `no grid centre between ${peers(guide)}: an odd gap halves to ${guide.cells} cells`;
    return guide.exact ? spacing : `${spacing} ${direction(guide)}`;
  }).join(' · ');
}

/** Gentle, opt-in-to-Check observations. A spacing mismatch needs a whole
 * three-item sequence; an off-row item needs three aligned peers. */
export function layoutSuggestions(items, grid = GRID) {
  const groups = new Map();
  for (const item of items.filter((item) => item.kind === 'component')) {
    const key = `${item.type}:${item.rotation}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const result = [];
  for (const group of groups.values()) {
    for (const axis of ['x', 'y']) {
      const other = axis === 'x' ? 'y' : 'x';
      const lines = new Map();
      for (const item of group) {
        const key = item.anchor[other];
        if (!lines.has(key)) lines.set(key, []);
        lines.get(key).push(item);
      }
      for (const [line, row] of lines) {
        const ordered = [...row].sort((a, b) => a.anchor[axis] - b.anchor[axis]);
        if (ordered.length >= 3) {
          const intervals = ordered.slice(1).map((item, index) => item.anchor[axis] - ordered[index].anchor[axis]);
          const min = Math.min(...intervals); const max = Math.max(...intervals);
          if (min > 0 && max - min === grid && max <= 20 * grid) {
            result.push({ kind: 'spacing', ids: ordered.map((item) => item.id),
              message: `${ordered.map((item) => item.id).join(', ')}: ${axis === 'x' ? 'horizontal' : 'vertical'} spacing varies by 1 cell.` });
          }
        }
        if (row.length < 3) continue;
        const low = Math.min(...row.map((item) => item.anchor[axis]));
        const high = Math.max(...row.map((item) => item.anchor[axis]));
        for (const candidate of group) {
          if (candidate.anchor[other] === line || Math.abs(candidate.anchor[other] - line) !== grid) continue;
          if (candidate.anchor[axis] < low - 20 * grid || candidate.anchor[axis] > high + 20 * grid) continue;
          result.push({ kind: 'alignment', ids: [...row.map((item) => item.id), candidate.id],
            message: `${candidate.id} is 1 cell off a nearby ${axis === 'x' ? 'row' : 'column'} of ${row.length} similar components.` });
        }
      }
    }
  }
  return result.slice(0, 12);
}
