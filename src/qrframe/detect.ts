// QR-frame detector.
//
// 1. jsQR finds the QR, giving orientation + a self-describing payload (the frame
//    spec) + 4 precise corner points -> a COARSE plane homography.
// 2. A small corner QR only constrains its own corner (metres of error at the far
//    side), so we refine: detect the border dots and iteratively refit the
//    homography from the QR corners + every matched dot. This expands outward from
//    the QR (small error near it) to a whole-plane fit good to sub-millimetre.
import jsQR from "jsqr";
import { homography, applyH, matInv3, type Mat3, type Pt } from "./homography";
import { decodePayload, qrCornersMm, dotLayoutMm, outerW, outerH, type QrFrameSpec } from "./spec";

export interface QrFrameResult {
  detected: boolean;
  reason?: string;
  spec?: QrFrameSpec;
  Hmm2px?: Mat3;
  Hpx2mm?: Mat3;
  inliers?: number;
  nDots?: number;
  reprojErrPx?: number;
  qrPx?: Pt[];
}

interface Blob { xy: Pt; area: number; w: number; h: number; }

function toGray(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4)
    g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return g;
}

function otsu(gray: Float32Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[Math.max(0, Math.min(255, gray[i] | 0))]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, max = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; thr = t; }
  }
  return thr;
}

/** Connected dark components (candidate dots). Excludes the QR's own bbox. */
function darkBlobs(gray: Float32Array, w: number, h: number, thr: number, qrBox: [number, number, number, number]): Blob[] {
  const n = w * h;
  const dark = new Uint8Array(n);
  for (let i = 0; i < n; i++) dark[i] = gray[i] < thr ? 1 : 0;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const blobs: Blob[] = [];
  const [qx0, qy0, qx1, qy1] = qrBox;
  for (let s = 0; s < n; s++) {
    if (!dark[s] || seen[s]) continue;
    let sp = 0, area = 0, sx = 0, sy = 0;
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    stack[sp++] = s; seen[s] = 1;
    while (sp > 0) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx; if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (dark[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
        }
      }
    }
    const cx = sx / area, cy = sy / area;
    if (cx >= qx0 && cx <= qx1 && cy >= qy0 && cy <= qy1) continue; // QR interior
    blobs.push({ xy: [cx, cy], area, w: maxx - minx + 1, h: maxy - miny + 1 });
  }
  return blobs;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function detectQrFrame(rgba: Uint8ClampedArray, w: number, h: number): QrFrameResult {
  const qr = jsQR(rgba, w, h);
  if (!qr) return { detected: false, reason: "no QR code found" };
  const spec = decodePayload(qr.data);
  if (!spec) return { detected: false, reason: `unrecognised QR payload: ${qr.data.slice(0, 24)}` };

  const L = qr.location;
  const qrPx: Pt[] = [
    [L.topLeftCorner.x, L.topLeftCorner.y], [L.topRightCorner.x, L.topRightCorner.y],
    [L.bottomRightCorner.x, L.bottomRightCorner.y], [L.bottomLeftCorner.x, L.bottomLeftCorner.y],
  ];
  const qrMm = qrCornersMm(spec);
  let H = homography(qrMm, qrPx);       // coarse mm -> px

  // expected dot diameter + spacing in px (projected near the QR)
  const c: Pt = [spec.qrX, spec.qrY];
  const dotPx = dist(applyH(H, c), applyH(H, [c[0] + spec.dotD, c[1]]));
  const spacingPx = dist(applyH(H, c), applyH(H, [c[0] + spec.dotSpacing, c[1]]));

  const gray = toGray(rgba, w, h);
  const thr = otsu(gray) + 10;          // bias toward catching mid-gray dots
  const qx = qrPx.map((p) => p[0]), qy = qrPx.map((p) => p[1]);
  const qrBox: [number, number, number, number] = [Math.min(...qx), Math.min(...qy), Math.max(...qx), Math.max(...qy)];
  const blobs = darkBlobs(gray, w, h, thr, qrBox).filter((b) => {
    const area = Math.PI * (dotPx / 2) ** 2;
    return b.area > 0.2 * area && b.area < 6 * area &&
      b.w < 2.2 * b.h && b.h < 2.2 * b.w;    // roughly round
  });

  // Radius-limited region-growing refit. The homography is accurate near the QR;
  // extrapolating it to the far side of a big frame is not. So each iteration only
  // matches model dots within a FRONTIER radius of the QR (where the current fit is
  // trustworthy) with a tight tolerance, refits, then grows the radius outward.
  // This reaches the whole frame without ever mis-pairing a far dot.
  const model = dotLayoutMm(spec);
  const qrCenterMm: Pt = [
    (qrMm[0][0] + qrMm[2][0]) / 2, (qrMm[0][1] + qrMm[2][1]) / 2,
  ];
  const frameSpan = Math.hypot(outerW(spec), outerH(spec));
  let radius = 3 * spec.dotSpacing;     // mm
  let inliers = 4, reproj = 0;
  for (let iter = 0; iter < 12; iter++) {
    const src: Pt[] = [...qrMm], dst: Pt[] = [...qrPx];
    const used = new Set<number>();
    const tol = 1.4 * dotPx;
    for (let i = 0; i < model.length; i++) {
      if (dist(model[i], qrCenterMm) > radius) continue;   // outside trusted frontier
      const p = applyH(H, model[i]);
      let bj = -1, bd = tol;
      for (let j = 0; j < blobs.length; j++) {
        if (used.has(j)) continue;
        const d = dist(p, blobs[j].xy);
        if (d < bd) { bd = d; bj = j; }
      }
      if (bj >= 0) { used.add(bj); src.push(model[i]); dst.push(blobs[bj].xy); }
    }
    if (src.length >= 6) {
      H = homography(src, dst);
      inliers = src.length;
      let e = 0;
      for (let i = 0; i < src.length; i++) e += dist(applyH(H, src[i]), dst[i]);
      reproj = e / src.length;
    }
    if (radius > frameSpan) break;
    radius *= 1.7;
  }
  void spacingPx;

  return {
    detected: true, spec, Hmm2px: H, Hpx2mm: matInv3(H),
    inliers, nDots: model.length, reprojErrPx: reproj, qrPx,
  };
}
