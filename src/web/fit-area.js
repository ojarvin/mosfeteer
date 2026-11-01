/**
 * Where F fits the drawing: the free part of the pane, clear of what floats
 * over it (the tool rail, open windows), that shows the drawing largest.
 * With no window open the drawing stays on the pane's middle line, beside the
 * rail or reaching under it where its ink clears it; with a window open a
 * wide drawing may go under the rail, and goes beside the window. Pure:
 * rectangles in, rectangle out.
 */

/**
 * The free rectangle of a `paneW`×`paneH` pane, clear of every obstacle
 * `{ x0, y0, x1, y1 }` (pane pixels), in which a drawing `rangeW`×`rangeH`
 * fits largest with `margin` pixels on each side. Of the rectangles that fit
 * it equally large, the biggest wins. With no free room at all, the pane.
 */
export function fitArea(paneW, paneH, obstacles, rangeW, rangeH, margin = 0) {
  const pane = { x0: 0, y0: 0, x1: paneW, y1: paneH };
  if (!obstacles.length) return pane;
  // A largest free rectangle has each edge on the pane's edge or against an
  // obstacle's, so these edges are the only ones to try.
  const lefts = [0, ...obstacles.map((o) => o.x1)];
  const rights = [paneW, ...obstacles.map((o) => o.x0)];
  const tops = [0, ...obstacles.map((o) => o.y1)];
  const bottoms = [paneH, ...obstacles.map((o) => o.y0)];
  const w = Math.max(1, rangeW);
  const h = Math.max(1, rangeH);
  let best = null;
  for (const x0 of lefts) {
    for (const x1 of rights) {
      if (x1 - x0 <= margin * 2) continue;
      for (const y0 of tops) {
        for (const y1 of bottoms) {
          if (y1 - y0 <= margin * 2) continue;
          if (obstacles.some((o) => o.x0 < x1 && o.x1 > x0 && o.y0 < y1 && o.y1 > y0)) continue;
          const scale = Math.min((x1 - x0 - margin * 2) / w, (y1 - y0 - margin * 2) / h);
          const area = (x1 - x0) * (y1 - y0);
          if (!best || scale > best.scale * 1.001 || (scale >= best.scale * 0.999 && area > best.area)) {
            best = { x0, y0, x1, y1, scale, area };
          }
        }
      }
    }
  }
  if (!best) return pane;
  const { x0, y0, x1, y1 } = best;
  return { x0, y0, x1, y1 };
}

/**
 * Where to fit a drawing in a `paneW`×`paneH` pane: `bounds` is its extent
 * and `rects` its ink, piece by piece, in world units. The drawing is as
 * large as it can be with its extent `margin` pixels inside the pane and no
 * ink within `margin` of an obstacle, so the rail may float over an empty
 * corner of it; at that size, as near the pane's middle as it can be. Never
 * smaller than the fit in the best free area (`fitArea`), which keeps the
 * whole extent clear and is the answer when nothing larger is.
 * `centred` (no window open, only the rail) keeps the drawing on the pane's
 * middle line: it moves only sideways, reaches under the rail only where its
 * ink clears the rail there, and is never smaller than the fit beside the
 * rail over the full height. Where no full-height room is left (a rail across
 * the top), the rule above.
 * Returns the scale (pixels per unit) and where the extent's centre lands.
 */
export function fitPlacement(paneW, paneH, obstacles, bounds, rects, margin = 0, { centred = false } = {}) {
  const w = Math.max(1, bounds.w);
  const h = Math.max(1, bounds.h);
  const bx = bounds.x + bounds.w / 2;
  const by = bounds.y + bounds.h / 2;
  const area = fitArea(paneW, paneH, obstacles, w, h, margin);
  const areaScale = Math.max(1e-9, Math.min((area.x1 - area.x0 - margin * 2) / w, (area.y1 - area.y0 - margin * 2) / h));
  const fallback = {
    scale: areaScale,
    cx: (area.x0 + area.x1) / 2,
    cy: paneCentre(paneH, area.y0, area.y1, h * areaScale, margin),
  };
  const fullScale = Math.min((paneW - margin * 2) / w, (paneH - margin * 2) / h);
  if (!obstacles.length) return fallback;
  const pieces = rects.length ? rects : [bounds];
  // The ink on screen at `scale` with the extent's centre at (cx, cy).
  const screen = (r, scale, cx, cy) => ({
    x0: cx + (r.x - bx) * scale, y0: cy + (r.y - by) * scale,
    x1: cx + (r.x + r.w - bx) * scale, y1: cy + (r.y + r.h - by) * scale,
  });
  const hits = (s, o) => s.x0 < o.x1 + margin && s.x1 > o.x0 - margin && s.y0 < o.y1 + margin && s.y1 > o.y0 - margin;
  const valid = (scale, cx, cy) => {
    if (cx - w * scale / 2 < margin - 0.5 || cx + w * scale / 2 > paneW - margin + 0.5) return false;
    if (cy - h * scale / 2 < margin - 0.5 || cy + h * scale / 2 > paneH - margin + 0.5) return false;
    return pieces.every((r) => { const s = screen(r, scale, cx, cy); return obstacles.every((o) => !hits(s, o)); });
  };
  // From the pane's middle, the least move each way that takes the ink off
  // one obstacle; `sideways` only left and right.
  const moves = (scale, cx, cy, sideways) => {
    const out = [[cx, cy]];
    for (const o of obstacles) {
      const over = pieces.map((r) => screen(r, scale, cx, cy)).filter((s) => hits(s, o));
      if (!over.length) continue;
      out.push([cx + Math.max(...over.map((s) => o.x1 + margin - s.x0)), cy]);
      out.push([cx - Math.max(...over.map((s) => s.x1 - (o.x0 - margin))), cy]);
      if (sideways) continue;
      out.push([cx, cy + Math.max(...over.map((s) => o.y1 + margin - s.y0))]);
      out.push([cx, cy - Math.max(...over.map((s) => s.y1 - (o.y0 - margin)))]);
    }
    return out;
  };
  // Every size from the whole pane's down to `floor`, that one too: at its
  // own size a drawing may still sit nearer the middle than the area.
  const search = (floor, sideways, extra = []) => {
    const scales = [];
    for (let scale = fullScale; scale > floor; scale *= 0.985) scales.push(scale);
    scales.push(floor);
    for (const scale of scales) {
      let best = null;
      for (const [cx, cy] of [...moves(scale, paneW / 2, paneH / 2, sideways), ...extra]) {
        if (!valid(scale, cx, cy)) continue;
        const off = Math.hypot(cx - paneW / 2, cy - paneH / 2);
        if (!best || off < best.off) best = { cx, cy, off };
      }
      if (best) return { scale, cx: best.cx, cy: best.cy };
    }
    return null;
  };
  if (centred) {
    // The room beside the obstacles over the pane's full height.
    const columns = obstacles.map((o) => ({ ...o, y0: 0, y1: paneH }));
    const strip = fitArea(paneW, paneH, columns, w, h, margin);
    if (!columns.some((o) => o.x0 < strip.x1 && o.x1 > strip.x0)) {
      const stripScale = Math.max(1e-9, Math.min((strip.x1 - strip.x0 - margin * 2) / w, (paneH - margin * 2) / h));
      const at = search(stripScale, true, [[(strip.x0 + strip.x1) / 2, paneH / 2]]);
      if (at) return at;
    }
  }
  return search(areaScale, false) || fallback;
}

/**
 * Where along a pane `paneSpan` pixels long to centre a drawing `size`
 * pixels long fitted in the free stretch `lo`..`hi`: the pane's middle, so a
 * drawing under the rail sits where it would with no rail, moved only as far
 * as it takes to stay `margin` clear of the stretch's ends.
 */
export function paneCentre(paneSpan, lo, hi, size, margin = 0) {
  const min = lo + margin + size / 2;
  const max = hi - margin - size / 2;
  if (min > max) return (lo + hi) / 2;
  return Math.min(max, Math.max(min, paneSpan / 2));
}
