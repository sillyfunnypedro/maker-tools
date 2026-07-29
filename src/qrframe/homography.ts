// Self-contained planar homography (normalized DLT) for the QR-frame pipeline.
// Kept independent of the legacy dot-frame detector so the QR path can stand on
// its own as we refactor toward it.
export type Mat3 = number[][]; // 3x3
export type Pt = [number, number];

export function matMul3(a: Mat3, b: Mat3): Mat3 {
  const c: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i][k] * b[k][j];
      c[i][j] = s;
    }
  return c;
}

export function matInv3(m: Mat3): Mat3 {
  const a = m[0][0], b = m[0][1], c = m[0][2];
  const d = m[1][0], e = m[1][1], f = m[1][2];
  const g = m[2][0], h = m[2][1], i = m[2][2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const inv = 1 / (a * A + b * B + c * C);
  return [
    [A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

export function applyH(H: Mat3, p: Pt): Pt {
  const x = p[0], y = p[1];
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

function jacobiEigen(Ain: number[][], n: number): { values: number[]; vectors: number[][] } {
  const A = Ain.map((r) => r.slice());
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let iter = 0; iter < 100; iter++) {
    let p = 0, q = 1, max = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = Math.abs(A[i][j]);
        if (a > max) { max = a; p = i; q = j; }
      }
    if (max < 1e-12) break;
    const app = A[p][p], aqq = A[q][q], apq = A[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cs = Math.cos(phi), sn = Math.sin(phi);
    for (let i = 0; i < n; i++) {
      const aip = A[i][p], aiq = A[i][q];
      A[i][p] = cs * aip - sn * aiq;
      A[i][q] = sn * aip + cs * aiq;
    }
    for (let i = 0; i < n; i++) {
      const api = A[p][i], aqi = A[q][i];
      A[p][i] = cs * api - sn * aqi;
      A[q][i] = sn * api + cs * aqi;
    }
    for (let i = 0; i < n; i++) {
      const vip = V[i][p], viq = V[i][q];
      V[i][p] = cs * vip - sn * viq;
      V[i][q] = sn * vip + cs * viq;
    }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

function normalize(pts: Pt[]): { T: Mat3; np: Pt[] } {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  let md = 0;
  for (const [x, y] of pts) md += Math.hypot(x - cx, y - cy);
  md = md / pts.length || 1;
  const s = Math.SQRT2 / md;
  const T: Mat3 = [[s, 0, -s * cx], [0, s, -s * cy], [0, 0, 1]];
  return { T, np: pts.map(([x, y]) => [s * (x - cx), s * (y - cy)] as Pt) };
}

/** Least-squares planar homography src -> dst (>=4 correspondences). */
export function homography(src: Pt[], dst: Pt[]): Mat3 {
  const { T: Ts, np: sp } = normalize(src);
  const { T: Td, np: dp } = normalize(dst);
  const A: number[][] = [];
  for (let i = 0; i < sp.length; i++) {
    const [x, y] = sp[i];
    const [u, v] = dp[i];
    A.push([-x, -y, -1, 0, 0, 0, u * x, u * y, u]);
    A.push([0, 0, 0, -x, -y, -1, v * x, v * y, v]);
  }
  const M: number[][] = Array.from({ length: 9 }, () => new Array(9).fill(0));
  for (const row of A)
    for (let i = 0; i < 9; i++)
      for (let j = 0; j < 9; j++) M[i][j] += row[i] * row[j];
  const { values, vectors } = jacobiEigen(M, 9);
  let mi = 0;
  for (let i = 1; i < 9; i++) if (values[i] < values[mi]) mi = i;
  const h = vectors.map((r) => r[mi]);
  const Hn: Mat3 = [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], h[8]]];
  const H = matMul3(matInv3(Td), matMul3(Hn, Ts));
  const k = H[2][2];
  return H.map((r) => r.map((v) => v / k)) as Mat3;
}
