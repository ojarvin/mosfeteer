/**
 * The spectrum of a simulated output (the swing simulation's samples), on
 * the response graph behind the analytic curves: Hann-windowed, and scaled
 * so white quantization error -- variance 1/3, Schreier's levels 2 apart --
 * reads 0 dB, so a quantizer's shaped error lands on its |NTF| curve and the
 * input tone stands up as a peak. With a band, the simulated SNDR and ENOB.
 */

/** An in-place radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/**
 * `samples` (length a power of two). Returns `{ points: [{ f, db }] }` for
 * f/fs from 1/N to 1/2, scaled so white noise of variance `variance` reads
 * 0 dB, and the raw powers for `inBand`.
 */
export function outputSpectrum(samples, { variance = 1 / 3 } = {}) {
  const n = samples.length;
  if (n < 16 || (n & (n - 1))) return null;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let w2 = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    re[i] = samples[i] * w;
    w2 += w * w;
  }
  fft(re, im);
  const power = Array.from({ length: n / 2 + 1 }, (_, k) => re[k] ** 2 + im[k] ** 2);
  const scale = variance * w2;
  let w1 = 0;
  for (let i = 0; i < n; i++) w1 += 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const points = [];
  for (let k = 1; k <= n / 2; k++) points.push({ f: k / n, db: 10 * Math.log10(power[k] / scale || 1e-30) });
  return { points, power, n, w1, w2, variance };
}

/**
 * The spectrum in dBFS per bin: a full-scale sine (amplitude `fullScale`)
 * reads 0 dBFS in its bin -- the window's coherent gain taken out, so white
 * noise reads its power in the window's noise bandwidth (dBFS/NBW).
 */
export function dbfsSpectrum(spectrum, fullScale) {
  const reference = (fullScale * spectrum.w1 / 2) ** 2;
  return spectrum.power.slice(1).map((p, i) => ({ f: (i + 1) / spectrum.n, db: 10 * Math.log10(p / reference || 1e-30) }));
}

/**
 * What a result predicts the spectrum shows, in the same dBFS: a
 * quantizer's error through its NTF is white noise of `variance` shaped by
 * |NTF|^2, per bin; an input's tone at `amplitude` dBFS through its STF sits
 * at amplitude + |STF| dB. Returns the dB offset to add to |H| in dB.
 */
export function dbfsOffset(spectrum, fullScale, { noise, amplitude }) {
  if (!noise) return amplitude;
  return 10 * Math.log10((spectrum.variance * spectrum.w2) / ((fullScale * spectrum.w1 / 2) ** 2));
}

/**
 * The simulated SNDR in band: the tone's bins (the input frequency, a Hann
 * window spreading it over three either side) against every other bin of
 * the band. `band` `{ f0, bw }` as bandEdges reads it; returns `{ sndr, enob }`
 * or null.
 */
export function inBand(spectrum, frequency, edges) {
  if (!spectrum || !edges.length) return null;
  const { power, n } = spectrum;
  const [f1, f2] = edges.length === 2 ? edges : [0, edges[0]];
  const tone = Math.round(frequency * n);
  let signal = 0;
  let noise = 0;
  for (let k = Math.max(1, Math.ceil(f1 * n)); k <= Math.min(n / 2, Math.floor(f2 * n)); k++) {
    if (Math.abs(k - tone) <= 3) signal += power[k];
    // DC and the window's spread of it are not noise.
    else if (k > 2) noise += power[k];
  }
  if (!(signal > 0) || !(noise > 0)) return null;
  const sndr = 10 * Math.log10(signal / noise);
  return { sndr, enob: (sndr - 1.76) / 6.02 };
}

/**
 * A spectrum for a log-frequency plot: averaged into about `bins` bins a
 * plot can draw (the floor reads as its mean), the tone's own bins kept.
 */
export function plotSpectrum(spectrum, frequency, { bins = 600 } = {}) {
  if (!spectrum) return [];
  const { points, n } = spectrum;
  const tone = Math.round(frequency * n);
  const low = Math.log10(points[0].f);
  const high = Math.log10(0.5);
  const out = [];
  let bucket = [];
  let edge = low;
  const flush = () => {
    if (!bucket.length) return;
    const mean = bucket.reduce((sum, p) => sum + 10 ** (p.db / 10), 0) / bucket.length;
    out.push({ f: bucket[Math.floor(bucket.length / 2)].f, db: 10 * Math.log10(mean) });
    bucket = [];
  };
  for (const [index, point] of points.entries()) {
    const k = index + 1;
    if (Math.abs(k - tone) <= 3) { flush(); out.push(point); continue; }
    if (Math.log10(point.f) > edge) { flush(); edge += (high - low) / bins; }
    bucket.push(point);
  }
  flush();
  return out;
}
