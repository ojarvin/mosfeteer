/**
 * A math label's measured box from its rendered lines: plain geometry, so
 * it can be checked without a page (main.js measures the lines).
 */

/**
 * The union of a label's line rectangles (client pixels), widened by the
 * label's padding (`{ left, top, right, bottom }` in world units, each
 * `scale.x`/`scale.y` pixels on screen). Each line is measured on its own:
 * a wrapper around several lines is as wide as the box it was given, which
 * would feed the last measurement back into the next. Null without lines.
 */
export function paddedLineBounds(rects, padding, scale) {
  const lines = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  if (!lines.length) return null;
  const left = Math.min(...lines.map((rect) => rect.left)) - padding.left * scale.x;
  const top = Math.min(...lines.map((rect) => rect.top)) - padding.top * scale.y;
  const right = Math.max(...lines.map((rect) => rect.right)) + padding.right * scale.x;
  const bottom = Math.max(...lines.map((rect) => rect.bottom)) + padding.bottom * scale.y;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}
