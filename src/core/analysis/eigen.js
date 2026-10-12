/**
 * Floating-point linear algebra for the numeric small-signal response
 * (numeric-response.js): a real LU solve, the eigenvalues of a real matrix,
 * and the roots of det(A0 + s A1) -- the poles and zeros of a circuit whose
 * MNA matrix is affine in s.
 */

/** X with A X = B (A n x n, B n x m), by LU with partial pivoting; null
 *  when A is singular to working precision. */
export function solveReal(A, B) {
  const n = A.length;
  const a = A.map((row) => [...row]);
  const b = B.map((row) => [...row]);
  const m = b[0]?.length || 0;
  const scale = Math.max(...a.flat().map(Math.abs), 0) || 1;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    if (Math.abs(a[pivot][k]) <= scale * 1e-14) return null;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    [b[k], b[pivot]] = [b[pivot], b[k]];
    for (let i = k + 1; i < n; i++) {
      const f = a[i][k] / a[k][k];
      if (f === 0) continue;
      for (let j = k; j < n; j++) a[i][j] -= f * a[k][j];
      for (let j = 0; j < m; j++) b[i][j] -= f * b[k][j];
    }
  }
  for (let k = n - 1; k >= 0; k--) {
    for (let j = 0; j < m; j++) {
      let sum = b[k][j];
      for (let i = k + 1; i < n; i++) sum -= a[k][i] * b[i][j];
      b[k][j] = sum / a[k][k];
    }
  }
  return b;
}

/** Scale rows and columns alike (a similarity) so their norms are close:
 *  eigenvalues come out as accurately for parameters decades apart. */
function balance(a, n) {
  const RADIX = 2;
  const sqrdx = RADIX * RADIX;
  let done = false;
  while (!done) {
    done = true;
    for (let i = 1; i <= n; i++) {
      let r = 0;
      let c = 0;
      for (let j = 1; j <= n; j++) {
        if (j === i) continue;
        c += Math.abs(a[j][i]);
        r += Math.abs(a[i][j]);
      }
      if (c && r) {
        let g = r / RADIX;
        let f = 1;
        const s = c + r;
        while (c < g) { f *= RADIX; c *= sqrdx; }
        g = r * RADIX;
        while (c > g) { f /= RADIX; c /= sqrdx; }
        if ((c + r) / f < 0.95 * s) {
          done = false;
          g = 1 / f;
          for (let j = 1; j <= n; j++) a[i][j] *= g;
          for (let j = 1; j <= n; j++) a[j][i] *= f;
        }
      }
    }
  }
}

/** Reduce to upper Hessenberg form by stabilized elementary similarities. */
function hessenberg(a, n) {
  for (let m = 2; m < n; m++) {
    let x = 0;
    let i = m;
    for (let j = m; j <= n; j++) {
      if (Math.abs(a[j][m - 1]) > Math.abs(x)) { x = a[j][m - 1]; i = j; }
    }
    if (i !== m) {
      for (let j = m - 1; j <= n; j++) [a[i][j], a[m][j]] = [a[m][j], a[i][j]];
      for (let j = 1; j <= n; j++) [a[j][i], a[j][m]] = [a[j][m], a[j][i]];
    }
    if (x) {
      for (i = m + 1; i <= n; i++) {
        let y = a[i][m - 1];
        if (y) {
          y /= x;
          a[i][m - 1] = y;
          for (let j = m; j <= n; j++) a[i][j] -= y * a[m][j];
          for (let j = 1; j <= n; j++) a[j][m] += y * a[j][i];
        }
      }
    }
  }
  for (let i = 3; i <= n; i++) for (let j = 1; j < i - 1; j++) a[i][j] = 0;
}

const sign = (a, b) => (b >= 0 ? Math.abs(a) : -Math.abs(a));

/** Eigenvalues of an upper Hessenberg matrix by the shifted QR algorithm
 *  (Francis double shift); null if it does not converge. */
function hessenbergEigenvalues(a, n) {
  const wr = new Array(n + 1).fill(0);
  const wi = new Array(n + 1).fill(0);
  let anorm = 0;
  for (let i = 1; i <= n; i++) for (let j = Math.max(i - 1, 1); j <= n; j++) anorm += Math.abs(a[i][j]);
  let nn = n;
  let t = 0;
  let p = 0, q = 0, r = 0, s = 0, w = 0, x = 0, y = 0, z = 0;
  while (nn >= 1) {
    let its = 0;
    let l;
    do {
      for (l = nn; l >= 2; l--) {
        s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]);
        if (s === 0) s = anorm;
        if (Math.abs(a[l][l - 1]) + s === s) {
          a[l][l - 1] = 0;
          break;
        }
      }
      x = a[nn][nn];
      if (l === nn) {
        wr[nn] = x + t;
        wi[nn--] = 0;
      } else {
        y = a[nn - 1][nn - 1];
        w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          p = 0.5 * (y - x);
          q = p * p + w;
          z = Math.sqrt(Math.abs(q));
          x += t;
          if (q >= 0) {
            z = p + sign(z, p);
            wr[nn - 1] = wr[nn] = x + z;
            if (z) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn - 1] = -(wi[nn] = z);
          }
          nn -= 2;
        } else {
          if (its === 60) return null;
          if (its === 10 || its === 20 || its === 40) {
            t += x;
            for (let i = 1; i <= nn; i++) a[i][i] -= x;
            s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            y = x = 0.75 * s;
            w = -0.4375 * s * s;
          }
          ++its;
          let m;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m];
            r = x - z;
            s = y - z;
            p = (r * s - w) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s;
            r = a[m + 2][m + 1];
            s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s;
            q /= s;
            r /= s;
            if (m === l) break;
            const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            const v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u + v === v) break;
          }
          for (let i = m + 2; i <= nn; i++) {
            a[i][i - 2] = 0;
            if (i !== m + 2) a[i][i - 3] = 0;
          }
          for (let k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k][k - 1];
              q = a[k + 1][k - 1];
              r = 0;
              if (k !== nn - 1) r = a[k + 2][k - 1];
              if ((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0) {
                p /= x;
                q /= x;
                r /= x;
              }
            }
            if ((s = sign(Math.sqrt(p * p + q * q + r * r), p)) !== 0) {
              if (k === m) {
                if (l !== m) a[k][k - 1] = -a[k][k - 1];
              } else {
                a[k][k - 1] = -s * x;
              }
              p += s;
              x = p / s;
              y = q / s;
              z = r / s;
              q /= p;
              r /= p;
              for (let j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k !== nn - 1) {
                  p += r * a[k + 2][j];
                  a[k + 2][j] -= p * z;
                }
                a[k + 1][j] -= p * y;
                a[k][j] -= p * x;
              }
              const mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = x * a[i][k] + y * a[i][k + 1];
                if (k !== nn - 1) {
                  p += z * a[i][k + 2];
                  a[i][k + 2] -= p * r;
                }
                a[i][k + 1] -= p * q;
                a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  return Array.from({ length: n }, (_, i) => ({ re: wr[i + 1], im: wi[i + 1] }));
}

/** Every eigenvalue {re, im} of a real square matrix; null if the QR
 *  iteration does not converge. */
export function eigenvalues(matrix) {
  const n = matrix.length;
  if (!n) return [];
  // One-based, as the algorithms are written.
  const a = [new Array(n + 1).fill(0), ...matrix.map((row) => [0, ...row])];
  balance(a, n);
  hessenberg(a, n);
  return hessenbergEigenvalues(a, n);
}

const norm = (matrix) => Math.max(0, ...matrix.map((row) => row.reduce((sum, value) => sum + Math.abs(value), 0)));

/**
 * The finite roots {re, im} of det(A0 + s A1) for square real A0, A1: with
 * A(σ) = A0 + σ A1 invertible at a real σ, det(A(s)) = det(A(σ)) det(I + (s -
 * σ) M), M = A(σ)^-1 A1, so each nonzero eigenvalue λ of M is a root s = σ
 * - 1/λ; λ = 0 is a root at infinity (A1 is singular for any resistive
 * node). σ is a positive real a few times off the matrices' own scale,
 * clear of the left-half plane where poles live; another is tried if A(σ)
 * is singular. Null when det(A(s)) vanishes for every s tried, or the
 * eigenvalues do not converge.
 */
export function pencilRoots(A0, A1) {
  const n = A0.length;
  if (!n) return [];
  const scale = norm(A1) ? norm(A0) / norm(A1) || 1 : 1;
  for (const k of [0.618034, 1.732051, 0.276393, 4.236068]) {
    const sigma = k * scale;
    const A = A0.map((row, i) => row.map((value, j) => value + sigma * A1[i][j]));
    const M = solveReal(A, A1);
    if (!M) continue;
    const lambdas = eigenvalues(M);
    if (!lambdas) return null;
    const largest = Math.max(0, ...lambdas.map((l) => Math.hypot(l.re, l.im)));
    const roots = [];
    for (const { re, im } of lambdas) {
      const size = Math.hypot(re, im);
      if (size <= largest * 1e-11 || size === 0) continue;
      // s = σ - 1/λ
      const d = re * re + im * im;
      const root = { re: sigma - re / d, im: im / d };
      // A conjugate pair's imaginary dust on a real root is noise.
      if (Math.abs(root.im) <= 1e-9 * Math.max(Math.abs(root.re), 1e-300)) root.im = 0;
      roots.push(root);
    }
    return roots;
  }
  return null;
}
