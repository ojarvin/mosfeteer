/**
 * Shift+T in the Atlas: the desk arranged by kinship, the same every time.
 *
 * Every design gets a target place from the kinship between designs alone
 * (stress majorization over graph distances, started from classical MDS:
 * no randomness, no dependence on earlier arrangements), so the same
 * designs with the same tags always come out the same, whatever the
 * window. Related designs sit near each other; a design with no close kin
 * is tied to its most similar ones, so none is left on its own. The
 * targets are then made a desk: designs pushed apart where they overlap,
 * each pulled back to its target, and laid on the grid. The previous desk
 * only picks which way round the result lies (mirrored or not), so it does
 * not flip from one arrangement to the next.
 */

import { GRID } from '../core/grid.js';
import { ATLAS_CAPTION, ATLAS_GAP, layoutAtlas } from './atlas-layout.js';

/** The desk's width over height, whatever the window's: fitting the view
 *  takes up the difference. */
export const DESK_ASPECT = 1.6;

/** Kinship below this is none (as in atlas-layout.js). */
const RELATED = 0.3;
/** How much farther than kin designs with no kinship at all lie. */
const UNRELATED = 4;
/** How much of the desk the designs cover, roughly. */
const FILL = 0.55;
const STRESS_ROUNDS = 150;
const RELAX_STEPS = 200;
const PULL = 0.1;
/** Toward the middle, which closes the room between neighborhoods. */
const MIDDLE = 0.05;

const snap = (value) => Math.round(value / GRID) * GRID;

/**
 * Arrange `items` ({ id, w, h } in drawing units) by `related(a, b)`
 * (0..1). `previous` (id -> slot), if any, picks the mirroring nearest it.
 * Returns what layoutAtlas returns.
 */
export function arrangeAtlas(items, { related, previous = null, aspect = DESK_ASPECT, gap = ATLAS_GAP, caption = ATLAS_CAPTION } = {}) {
  if (items.length < 2) return layoutAtlas(items, { aspect, gap, caption });
  // The same designs in any order give the same desk.
  const list = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = list.length;
  const sizes = list.map((item) => ({ w: item.w + gap, h: item.h + caption + gap }));
  const radius = sizes.map(({ w, h }) => Math.sqrt(w * h) / 2);
  const affinity = list.map((a, i) => list.map((b, j) => (i === j ? 0 : related(a.id, b.id))));

  // How far apart two designs should be: as far as the two side by side,
  // longer the weaker their kinship -- much longer below kinship, where
  // only the faint likeness of designs not related orders them -- or
  // through designs between, if that is shorter.
  const dist = list.map(() => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = Math.min(1, affinity[i][j]);
      const stretch = a >= RELATED ? 1 + 1.5 * (1 - a) : 2.5 + UNRELATED * (1 - a / RELATED);
      dist[i][j] = i === j ? 0 : (radius[i] + radius[j]) * stretch;
    }
  }
  for (let k = 0; k < n; k++) {
    const dk = dist[k];
    for (let i = 0; i < n; i++) {
      const di = dist[i];
      const dik = di[k];
      for (let j = 0; j < n; j++) if (dik + dk[j] < di[j]) di[j] = dik + dk[j];
    }
  }

  const embedded = stressLayout(dist, n);
  const area = sizes.reduce((sum, { w, h }) => sum + w * h, 0) / FILL;
  const deskTurned = ([angle, mirror]) => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let at = embedded.map(([x, y0]) => { const y = mirror * y0; return [x * c - y * s, x * s + y * c]; });
    // Wider than tall, by the desk's shape, and scaled so the designs
    // about fill it.
    const spread = (axis) => Math.sqrt(at.reduce((sum, p) => sum + p[axis] ** 2, 0) / n) || 1;
    const [sx, sy] = [spread(0), spread(1)];
    at = at.map(([x, y]) => [x / sx * Math.sqrt(aspect), y / sy / Math.sqrt(aspect)]);
    const span = (axis) => Math.max(...at.map((p) => p[axis])) - Math.min(...at.map((p) => p[axis])) || 1;
    const scale = Math.sqrt(area / (span(0) * span(1)));
    const placed = settleOnDesk(at.map(([x, y]) => ({ x: x * scale, y: y * scale })), sizes, aspect);
    const slots = new Map(list.map((item, i) => [item.id, { x: placed[i].x, y: placed[i].y, w: item.w, h: item.h + caption }]));
    return layoutAtlas(items, { aspect, gap, caption, previous: slots, related });
  };
  const ways = orientations(embedded, list, previous, aspect);
  // The desk a press made comes back as it was from the next one.
  if (previous) {
    for (const way of ways) {
      const desk = deskTurned(way);
      if ([...desk.slots].every(([id, slot]) => previous.get(id)?.x === slot.x && previous.get(id)?.y === slot.y && previous.get(id)?.w === slot.w && previous.get(id)?.h === slot.h)) return desk;
    }
  }
  return deskTurned(ways[0]);
}

/**
 * Stress majorization (Gansner, Koren & North): 2-D places whose distances
 * match `dist`, each pair weighted by 1/d^2, started from classical MDS.
 */
function stressLayout(dist, n) {
  const d = dist.map((row) => Array.from(row));
  const at = classicalMds(d, n);
  for (let round = 0; round < STRESS_ROUNDS; round += 1) {
    for (let i = 0; i < n; i++) {
      let x = 0;
      let y = 0;
      let total = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const w = 1 / (d[i][j] * d[i][j]);
        const dx = at[i][0] - at[j][0];
        const dy = at[i][1] - at[j][1];
        const now = Math.hypot(dx, dy) || 1e-9;
        x += w * (at[j][0] + d[i][j] * dx / now);
        y += w * (at[j][1] + d[i][j] * dy / now);
        total += w;
      }
      at[i] = [x / total, y / total];
    }
  }
  return at;
}

/** Classical MDS: the two leading eigenvectors of the double-centered
 *  squared distances, by power iteration from fixed starts. */
function classicalMds(d, n) {
  const sq = d.map((row) => row.map((v) => v * v));
  const rowMean = sq.map((row) => row.reduce((sum, v) => sum + v, 0) / n);
  const mean = rowMean.reduce((sum, v) => sum + v, 0) / n;
  const b = sq.map((row, i) => row.map((v, j) => -0.5 * (v - rowMean[i] - rowMean[j] + mean)));
  const vectors = [];
  for (let k = 0; k < 2; k++) {
    // A fixed start, not orthogonal to anything in particular.
    let v = Array.from({ length: n }, (_, i) => Math.cos(i * (k + 1.3)) + 0.5);
    let value = 0;
    for (let iter = 0; iter < 200; iter++) {
      for (const [u] of vectors) {
        const dot = u.reduce((sum, x, i) => sum + x * v[i], 0);
        v = v.map((x, i) => x - dot * u[i]);
      }
      const next = b.map((row) => row.reduce((sum, x, j) => sum + x * v[j], 0));
      const norm = Math.hypot(...next) || 1;
      value = norm;
      v = next.map((x) => x / norm);
    }
    vectors.push([v, value]);
  }
  return Array.from({ length: n }, (_, i) => [vectors[0][0][i] * Math.sqrt(vectors[0][1]), vectors[1][0][i] * Math.sqrt(vectors[1][1]) + 1e-6 * i]);
}

/**
 * How to turn the places ([angle, mirror], mirror -1 flipping y first):
 * the best first, then its neighbors a step either way. With a previous
 * desk, the turn and mirroring lying nearest it (orthogonal Procrustes,
 * its stretch to the desk's shape taken out), in whole steps; without
 * one, the widest spread across, the first design alphabetically up and
 * left.
 */
function orientations(at, list, previous, aspect) {
  const n = at.length;
  const cx = at.reduce((sum, p) => sum + p[0], 0) / n;
  const cy = at.reduce((sum, p) => sum + p[1], 0) / n;
  const known = list.map((item, i) => [i, previous?.get(item.id)]).filter(([, slot]) => slot && slot.w !== undefined);
  let best;
  if (known.length >= 3) {
    const was = known.map(([, slot]) => [(slot.x + slot.w / 2) / Math.sqrt(aspect), (slot.y + slot.h / 2) * Math.sqrt(aspect)]);
    const mx = was.reduce((sum, p) => sum + p[0], 0) / was.length;
    const my = was.reduce((sum, p) => sum + p[1], 0) / was.length;
    for (const mirror of [1, -1]) {
      let dot = 0;
      let cross = 0;
      known.forEach(([i], k) => {
        const x = at[i][0] - cx;
        const y = mirror * (at[i][1] - cy);
        const [px, py] = [was[k][0] - mx, was[k][1] - my];
        dot += x * px + y * py;
        cross += x * py - y * px;
      });
      const fit = Math.hypot(dot, cross);
      if (!best || fit > best.fit + 1e-9) best = { fit, angle: Math.atan2(cross, dot), mirror };
    }
  } else {
    let [xx, yy, xy] = [0, 0, 0];
    for (const [x0, y0] of at) { const [x, y] = [x0 - cx, y0 - cy]; xx += x * x; yy += y * y; xy += x * y; }
    const angle = -0.5 * Math.atan2(2 * xy, xx - yy);
    const turned = (i) => [(at[i][0] - cx) * Math.cos(angle) - (at[i][1] - cy) * Math.sin(angle), (at[i][0] - cx) * Math.sin(angle) + (at[i][1] - cy) * Math.cos(angle)];
    const [fx, fy] = turned(0);
    // Up and left: a half turn fixes x; a mirror then fixes y.
    const half = fx > 0 ? Math.PI : 0;
    const mirror = (half ? -fy : fy) > 0 ? -1 : 1;
    best = { angle: mirror === -1 ? -(angle + half) : angle + half, mirror };
  }
  const step = Math.round(best.angle / TURN_STEP);
  return [step, step - 1, step + 1].map((k) => [k * TURN_STEP, best.mirror]);
}

/** Turns are whole steps of this (10 degrees). */
const TURN_STEP = Math.PI / 18;

/**
 * Designs (`sizes`, gap included) at their `target` centers made a desk:
 * pushed apart where they overlap, the shorter way out, and pulled back
 * toward their targets, then laid on the grid from the middle out, each in
 * the nearest free cell. Returns top-left corners.
 */
function settleOnDesk(target, sizes, aspect) {
  const n = target.length;
  const stretch = Math.sqrt(aspect);
  const at = target.map((p) => ({ ...p }));
  const separate = () => {
    const left = (i) => at[i].x - sizes[i].w / 2;
    const order = at.map((_, i) => i).sort((i, j) => left(i) - left(j) || i - j);
    for (let m = 0; m < n; m++) {
      for (let k = m + 1; k < n; k++) {
        let i = order[m];
        let j = order[k];
        if (left(j) >= at[i].x + sizes[i].w / 2) break;
        if (i > j) [i, j] = [j, i];
        const dx = at[j].x - at[i].x;
        const dy = at[j].y - at[i].y;
        const ox = (sizes[i].w + sizes[j].w) / 2 - Math.abs(dx);
        const oy = (sizes[i].h + sizes[j].h) / 2 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        // Which side each is on follows their targets, so order holds.
        const across = ox / stretch < oy * stretch;
        const axis = across ? 'x' : 'y';
        const want = target[j][axis] - target[i][axis];
        const sign = (want || (across ? dx : dy) || 1) > 0 ? 1 : -1;
        const overlap = across ? ox : oy;
        const share = (sizes[i].w * sizes[i].h) / (sizes[i].w * sizes[i].h + sizes[j].w * sizes[j].h);
        at[i][axis] -= sign * overlap * (1 - share);
        at[j][axis] += sign * overlap * share;
      }
    }
  };
  for (let step = 0; step < RELAX_STEPS; step += 1) {
    for (let i = 0; i < n; i++) {
      at[i].x += PULL * (target[i].x - at[i].x) - MIDDLE * at[i].x;
      at[i].y += PULL * (target[i].y - at[i].y) - MIDDLE * at[i].y;
    }
    separate();
  }
  for (let pass = 0; pass < 30; pass += 1) separate();
  // Onto the grid from the middle out, each in the nearest free cell.
  const cx = at.reduce((sum, p) => sum + p.x, 0) / n;
  const cy = at.reduce((sum, p) => sum + p.y, 0) / n;
  const placed = [];
  const out = new Array(n);
  const free = (x, y, w, h) => placed.every((p) => x >= p.x + p.w || p.x >= x + w || y >= p.y + p.h || p.y >= y + h);
  const away = (i) => Math.hypot((at[i].x - cx) / stretch, (at[i].y - cy) * stretch);
  for (const i of at.map((_, k) => k).sort((a, b) => away(a) - away(b) || a - b)) {
    const { w, h } = sizes[i];
    const x = snap(at[i].x - cx - w / 2);
    const y = snap(at[i].y - cy - h / 2);
    const [u, v] = nearCells(stretch).find(([du, dv]) => free(x + du * GRID, y + dv * GRID, w, h)) || [0, 0];
    const slot = { x: x + u * GRID, y: y + v * GRID, w, h };
    placed.push(slot);
    // Back to the design's own slot: the gap was around it.
    out[i] = { x: slot.x, y: slot.y };
  }
  return out;
}

const nearCellsCache = new Map();
/** Grid offsets nearest first, stretched to the desk's shape. */
function nearCells(stretch) {
  if (!nearCellsCache.has(stretch)) {
    const reach = 80;
    const cells = [];
    for (let u = -reach; u <= reach; u++) for (let v = -reach; v <= reach; v++) cells.push([u, v]);
    const d = ([u, v]) => (u / stretch) ** 2 + (v * stretch) ** 2;
    nearCellsCache.set(stretch, cells.sort((a, b) => d(a) - d(b) || a[0] - b[0] || a[1] - b[1]));
  }
  return nearCellsCache.get(stretch);
}
