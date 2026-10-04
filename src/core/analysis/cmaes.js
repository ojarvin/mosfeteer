/**
 * CMA-ES (Hansen's covariance matrix adaptation evolution strategy), the
 * black-box minimizer behind the coefficient optimizer (optimize.js): each
 * generation samples a population from a multivariate normal, ranks it,
 * and moves the mean, the step size, and the covariance toward the better
 * half. It needs only the ranking of the samples, never a gradient, so a
 * score with cliffs (a loop that goes unstable) is no obstacle. After
 * Hansen's tutorial (purecma), with the full covariance: the problems are
 * a few dozen coefficients at most.
 */

/** A seeded uniform generator (mulberry32): the same seed, the same run. */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal samples from a uniform generator (Box-Muller). */
function normalSampler(random) {
  let spare = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0;
    while (u <= Number.MIN_VALUE) u = random();
    const r = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * random();
    spare = r * Math.sin(angle);
    return r * Math.cos(angle);
  };
}

/** Eigenvalues and eigenvectors of a symmetric matrix (cyclic Jacobi):
 *  `{ values, vectors }`, vectors[i][k] the i-th entry of the k-th. */
export function symmetricEigen(matrix) {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v };
}

/**
 * A CMA-ES run from `mean` with step size `sigma`: `ask()` gives a
 * generation's points, `tell(points, scores)` (lower is better) updates
 * the distribution, `stopReason()` is null while the run is worth going on.
 * `lambda` the population (default 4 + 3 ln n), `random` a uniform
 * generator (seededRandom).
 */
export function createCmaes({ mean, sigma = 0.3, lambda, random = seededRandom(1) }) {
  const n = mean.length;
  const normal = normalSampler(random);
  const popsize = Math.max(4, lambda || 4 + Math.floor(3 * Math.log(n)));
  const mu = Math.floor(popsize / 2);
  const raw = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const total = raw.reduce((s, w) => s + w, 0);
  const weights = raw.map((w) => w / total);
  const mueff = 1 / weights.reduce((s, w) => s + w * w, 0);
  const cc = (4 + mueff / n) / (n + 4 + (2 * mueff) / n);
  const cs = (mueff + 2) / (n + mueff + 5);
  const c1 = 2 / ((n + 1.3) ** 2 + mueff);
  const cmu = Math.min(1 - c1, (2 * (mueff - 2 + 1 / mueff)) / ((n + 2) ** 2 + mueff));
  const damps = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));

  const m = [...mean];
  let step = sigma;
  const pc = new Array(n).fill(0);
  const ps = new Array(n).fill(0);
  let C = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  let B = C.map((row) => [...row]);
  let D = new Array(n).fill(1);
  let invsqrtC = C.map((row) => [...row]);
  let evaluations = 0;
  let eigenAt = 0;
  let generation = 0;
  const history = []; // each generation's best score
  let stopped = null;

  const updateEigen = () => {
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) C[i][j] = C[j][i];
    const { values, vectors } = symmetricEigen(C);
    D = values.map((v) => Math.sqrt(Math.max(v, 1e-300)));
    B = vectors;
    invsqrtC = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += (B[i][k] * B[j][k]) / D[k];
      return sum;
    }));
    eigenAt = evaluations;
  };

  const ask = () => Array.from({ length: popsize }, () => {
    const z = Array.from({ length: n }, () => normal());
    const y = B.map((row) => row.reduce((sum, b, k) => sum + b * D[k] * z[k], 0));
    return m.map((v, i) => v + step * y[i]);
  });

  const tell = (points, scores) => {
    const order = scores.map((score, i) => [score, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    evaluations += points.length;
    generation += 1;
    history.push(scores[order[0]]);
    const old = [...m];
    for (let i = 0; i < n; i++) m[i] = weights.reduce((sum, w, k) => sum + w * points[order[k]][i], 0);
    const shift = m.map((v, i) => (v - old[i]) / step);
    const whitened = invsqrtC.map((row) => row.reduce((sum, c, k) => sum + c * shift[k], 0));
    const kps = Math.sqrt(cs * (2 - cs) * mueff);
    for (let i = 0; i < n; i++) ps[i] = (1 - cs) * ps[i] + kps * whitened[i];
    const psNorm = Math.hypot(...ps);
    const hsig = psNorm / Math.sqrt(1 - (1 - cs) ** ((2 * evaluations) / popsize)) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    const kpc = hsig * Math.sqrt(cc * (2 - cc) * mueff);
    for (let i = 0; i < n; i++) pc[i] = (1 - cc) * pc[i] + kpc * shift[i];
    const steps = order.slice(0, mu).map((index) => points[index].map((v, i) => (v - old[i]) / step));
    const keep = 1 - c1 - cmu;
    const lost = (1 - hsig) * cc * (2 - cc);
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        let rankMu = 0;
        for (let k = 0; k < mu; k++) rankMu += weights[k] * steps[k][i] * steps[k][j];
        C[i][j] = keep * C[i][j] + c1 * (pc[i] * pc[j] + lost * C[i][j]) + cmu * rankMu;
      }
    }
    step *= Math.exp(Math.min(1, (cs / damps) * (psNorm / chiN - 1)));
    if (evaluations - eigenAt > popsize / (c1 + cmu) / n / 10) updateEigen();

    // Worth going on? Hansen's usual tests, loosely.
    const spread = step * Math.max(...D);
    const flat = scores.every((s) => s === scores[0]) && generation > 1;
    const window = 10 + Math.ceil((30 * n) / popsize);
    const recent = history.slice(-window);
    if (!Number.isFinite(step) || !(spread > 1e-9)) stopped = 'converged';
    else if (spread > 1e8) stopped = 'diverged';
    else if (flat) stopped = 'flat';
    else if (history.length > window && Math.max(...recent) - Math.min(...recent) < 1e-9 * (1 + Math.abs(recent[0]))) stopped = 'stagnant';
    else if (Math.max(...D) > 1e7 * Math.min(...D)) stopped = 'ill-conditioned';
  };

  return {
    ask,
    tell,
    stopReason: () => stopped,
    get mean() { return [...m]; },
    get sigma() { return step; },
    get lambda() { return popsize; },
    get generation() { return generation; },
    get evaluations() { return evaluations; },
  };
}
