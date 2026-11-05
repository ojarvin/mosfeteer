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
 * `samples` (length a power of two), Welch-averaged: Hann-windowed
 * segments of `segment` samples (a power of two, the whole record by
 * default) overlapping by half, their powers averaged, so the floor reads
 * steady. Returns `{ points: [{ f, db }] }` for f/fs from 1/segment to 1/2,
 * scaled so white noise of variance `variance` reads 0 dB, and the raw
 * (averaged) powers for `inBand`; `n` is the segment, `averages` how many.
 */
export function outputSpectrum(samples, { variance = 1 / 3, segment = samples.length } = {}) {
  const n = Math.min(segment, samples.length);
  if (n < 16 || (n & (n - 1))) return null;
  const window = Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
  const w1 = window.reduce((sum, w) => sum + w, 0);
  const w2 = window.reduce((sum, w) => sum + w * w, 0);
  const power = new Array(n / 2 + 1).fill(0);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let averages = 0;
  for (let start = 0; start + n <= samples.length; start += n / 2) {
    for (let i = 0; i < n; i++) { re[i] = samples[start + i] * window[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= n / 2; k++) power[k] += re[k] ** 2 + im[k] ** 2;
    averages += 1;
  }
  for (let k = 0; k <= n / 2; k++) power[k] /= averages;
  const scale = variance * w2;
  const points = [];
  for (let k = 1; k <= n / 2; k++) points.push({ f: k / n, db: 10 * Math.log10(power[k] / scale || 1e-30) });
  return { points, power, n, w1, w2, variance, averages };
}

/** Where a sampled sine of `frequency` (f/fs, any) shows: its alias, 0 to 0.5. */
export function aliasedFrequency(frequency) {
  const r = frequency - Math.floor(frequency);
  return Math.min(r, 1 - r);
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
 * The simulated SNDR in band: the tone's bins (the input frequency's alias, a Hann
 * window spreading it over three either side) against every other bin of
 * the band (a tone at DC, f/fs 0, its power the DC's square). `band`
 * `{ f0, bw }` as bandEdges reads it; returns `{ sndr, enob, noiseDb }`
 * (`noiseDb` the band's noise, the tone left out, in dBFS of a sine of
 * amplitude `fullScale`; `sndr` null with no tone), or null.
 */
export function inBand(spectrum, frequency, edges, { fullScale = 1 } = {}) {
  if (!spectrum || !edges.length) return null;
  const { power, n, w2 } = spectrum;
  const [f1, f2] = edges.length === 2 ? edges : [0, edges[0]];
  const tone = Math.round(aliasedFrequency(frequency) * n);
  let signal = 0;
  let noise = 0;
  for (let k = Math.max(tone ? 1 : 0, Math.ceil(f1 * n)); k <= Math.min(n / 2, Math.floor(f2 * n)); k++) {
    // A tone at DC: its bins either side counted twice, the mirrored half,
    // so its power is the DC's square as a sine's is half its amplitude's.
    if (Math.abs(k - tone) <= 3) signal += tone || !k ? power[k] : 2 * power[k];
    // DC and the window's spread of it are not noise.
    else if (k > 2) noise += power[k];
  }
  if (!(noise > 0)) return null;
  // The noise's power against a full-scale sine's (the one-sided bins of
  // white noise sum to n w2 sigma^2 / 2, of a sine n w2 A^2 / 4).
  const noiseDb = 10 * Math.log10((4 * noise) / (n * w2 * fullScale ** 2));
  if (!(signal > 0)) return { sndr: null, enob: null, noiseDb };
  const sndr = 10 * Math.log10(tone ? signal / noise : signal / (2 * noise));
  return { sndr, enob: (sndr - 1.76) / 6.02, noiseDb };
}

/**
 * A spectrum for a log-frequency plot: averaged into about `bins` bins a
 * plot can draw (the floor reads as its mean), the tone's own bins kept,
 * and so are a line's -- a bin 10 dB over its bin's median, with the
 * window's spread of it -- so a spur stays one narrow peak however many
 * samples the run has.
 */
export function plotSpectrum(spectrum, frequency, { bins = 600 } = {}) {
  if (!spectrum) return [];
  const { points, n } = spectrum;
  const tone = Math.round(aliasedFrequency(frequency) * n);
  const low = Math.log10(points[0].f);
  const high = Math.log10(0.5);
  const out = [];
  let bucket = [];
  let edge = low;
  const power = (p) => 10 ** (p.db / 10);
  const flush = () => {
    if (!bucket.length) return;
    const sorted = bucket.map(power).sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)];
    // A line's bins (each over the median by 10 dB, and three either side) drawn as they are.
    const line = new Set();
    if (bucket.length > 3) {
      bucket.forEach((p, i) => {
        if (power(p) > 10 * median) for (let j = Math.max(0, i - 3); j <= Math.min(bucket.length - 1, i + 3); j++) line.add(j);
      });
    }
    const floor = bucket.filter((_, i) => !line.has(i));
    if (floor.length) out.push({ f: floor[Math.floor(floor.length / 2)].f, db: 10 * Math.log10(floor.reduce((sum, p) => sum + power(p), 0) / floor.length) });
    for (const i of [...line].sort((x, y) => x - y)) out.push(bucket[i]);
    if (line.size) out.sort((x, y) => x.f - y.f);
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
