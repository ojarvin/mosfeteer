/**
 * The app's one easing family, the same curves as the stylesheet's
 * --ease-* tokens (test/style-tokens.test.js holds them equal):
 *
 * - out: expo out, quick start and a long soft landing. Entrances,
 *   feedback, and the view settling.
 * - in: expo in, its mirror. Exits.
 * - inOut: expo in-out. Something already on screen moving A to B.
 * - spring: out past the end and back. Things that pop.
 */

export const EASE_OUT = [0.16, 1, 0.3, 1];
export const EASE_IN = [0.7, 0, 0.84, 0];
export const EASE_IN_OUT = [0.87, 0, 0.13, 1];
export const EASE_SPRING = [0.34, 1.56, 0.64, 1];

/** The CSS `cubic-bezier()` of a curve, for `Element#animate`. */
export const cssEase = ([x1, y1, x2, y2]) => `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;

/** A curve as a function of progress `t` (clamped to 0..1), as CSS draws it:
 *  the bezier's x solved for `t`, its y at that point. */
export function cubicBezier([x1, y1, x2, y2]) {
  const at = (a, b, s) => ((1 - 3 * b + 3 * a) * s + (3 * b - 6 * a)) * s * s + 3 * a * s;
  const slope = (a, b, s) => 3 * (1 - 3 * b + 3 * a) * s * s + 2 * (3 * b - 6 * a) * s + 3 * a;
  return (t) => {
    const x = Math.min(1, Math.max(0, t));
    if (x === 0 || x === 1) return x;
    let s = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(x1, x2, s);
      if (Math.abs(d) < 1e-6) break;
      s -= (at(x1, x2, s) - x) / d;
    }
    if (!(s >= 0 && s <= 1) || Math.abs(at(x1, x2, s) - x) > 1e-5) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 40; i++) {
        s = (lo + hi) / 2;
        if (at(x1, x2, s) < x) lo = s;
        else hi = s;
      }
    }
    return at(y1, y2, s);
  };
}

export const easeOut = cubicBezier(EASE_OUT);
export const easeIn = cubicBezier(EASE_IN);
export const easeInOut = cubicBezier(EASE_IN_OUT);
export const easeSpring = cubicBezier(EASE_SPRING);
