/**
 * The E24 preferred-number series, 24 values a decade, as slider steps: the
 * Bode sketch's sliders move through it, fine enough to place a pole by eye,
 * and every value one a designer knows.
 */

const E24 = [1, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2, 2.2, 2.4, 2.7, 3, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
export const PER_DECADE = E24.length;

/** The E24 value `index` steps from 1 (negative steps go below 1). */
export function stepE24(index) {
  const decade = Math.floor(index / PER_DECADE);
  return Number((E24[((index % PER_DECADE) + PER_DECADE) % PER_DECADE] * 10 ** decade).toPrecision(2));
}

/** The step of the E24 value nearest `value` (on a log scale). */
export function indexE24(value) {
  if (!(value > 0)) return 0;
  const decade = Math.floor(Math.log10(value) + 1e-9);
  const mantissa = value / 10 ** decade;
  const distance = (x) => Math.abs(Math.log(x / mantissa));
  let best = 0;
  for (let i = 1; i < PER_DECADE; i++) if (distance(E24[i]) < distance(E24[best])) best = i;
  // 9.6 and up is nearer the next decade's 1.
  return distance(10) < distance(E24[best]) ? (decade + 1) * PER_DECADE : decade * PER_DECADE + best;
}
