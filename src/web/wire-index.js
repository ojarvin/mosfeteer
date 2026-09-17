const CELL = 40;

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

const cellKey = (x, y) => `${x},${y}`;
const cell = value => Math.floor(value / CELL);

export function buildWireHitIndex(nets) {
  const buckets = new Map();
  const diagonals = [];
  let order = 0;
  const add = (key, record) => {
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, bucket = []);
    bucket.push(record);
  };
  for (const net of nets) {
    const paths = net.paths();
    for (let branch = 0; branch < paths.length; branch++) {
      const pts = paths[branch];
      for (let seg = 1; seg < pts.length; seg++) {
        const a = pts[seg - 1], b = pts[seg];
        if (a.x === b.x && a.y === b.y) continue;
        const record = { net, branch, seg, pts, a, b, order: order++ };
        if (a.x !== b.x && a.y !== b.y) {
          diagonals.push(record);
        } else if (a.y === b.y) {
          const y = cell(a.y);
          for (let x = cell(Math.min(a.x, b.x)); x <= cell(Math.max(a.x, b.x)); x++) add(cellKey(x, y), record);
        } else {
          const x = cell(a.x);
          for (let y = cell(Math.min(a.y, b.y)); y <= cell(Math.max(a.y, b.y)); y++) add(cellKey(x, y), record);
        }
      }
    }
  }
  return { buckets, diagonals };
}

export function queryWireHitIndex(index, raw, snapped, tolerance) {
  const candidates = new Map();
  const add = record => {
    const key = `${record.net.id}:${record.branch}:${record.seg}`;
    if (!candidates.has(key)) candidates.set(key, record);
  };
  for (const point of [raw, snapped]) {
    const radius = Math.ceil(tolerance / CELL);
    const cx = cell(point.x), cy = cell(point.y);
    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let y = cy - radius; y <= cy + radius; y++) {
        for (const record of index.buckets.get(cellKey(x, y)) || []) add(record);
      }
    }
    for (const record of index.diagonals) add(record);
  }
  const records = [...candidates.values()].sort((a, b) => a.order - b.order);
  const measure = (point) => records.map(record => ({
    net: record.net,
    branch: record.branch,
    seg: record.seg,
    pts: record.pts,
    distance: distanceToSegment(point, record.a, record.b),
  })).filter(candidate => candidate.distance < tolerance);
  // The raw pointer decides between segments that meet at a grid point (for
  // example a bend next to a diagonal). The snapped point is only a fallback
  // when the raw pointer is not near any wire.
  const rawHits = measure(raw);
  return rawHits.length ? rawHits : measure(snapped);
}
