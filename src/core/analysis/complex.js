/** Complex numbers as { re, im }: the arithmetic the numeric responses use. */

export const c = (re, im = 0) => ({ re, im });
export const cadd = (a, b) => c(a.re + b.re, a.im + b.im);
export const csub = (a, b) => c(a.re - b.re, a.im - b.im);
export const cmul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cdiv = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
export const cabs = (a) => Math.hypot(a.re, a.im);
