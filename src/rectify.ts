// Step 2 of the frame pipeline: cut out the frame's interior.
//
// Using the detected pixel<->mm homography, perspective-warp the opening region
// of the photo into a flat, true-scale image (deskewed, frame/dots/background
// removed). The result is `ppmm` pixels per millimetre, so pixel->mm is a plain
// scale for the rest of the pipeline and the CNC export.
import { applyH, type Mat3 } from "./qrframe/homography";

/**
 * @param src       the full photo
 * @param Hmm2px    frame-mm -> source-pixel homography (from detection)
 * @param originX   opening top-left X in frame mm
 * @param originY   opening top-left Y in frame mm
 * @param innerW    opening width (mm)
 * @param innerH    opening height (mm)
 * @param ppmm      output pixels per mm
 * @param insetMm   blank this much of the opening border to white, so a sliver of
 *                  the frame caught at the opening edge doesn't become a cut line
 *
 * The straightening control does NOT live here. Rotating the sampling grid would
 * re-run this resample, the illumination flatten, and the whole mask pipeline
 * (thinning included) for every nudge of the slider — and it would re-derive the
 * trace itself, so the lines could change subtly as you turn them. Rotation is a
 * coordinate change applied to the finished vector output instead; see
 * `buildCncStrokedSvg`.
 */
export function rectifyOpening(
  src: ImageData,
  Hmm2px: Mat3,
  originX: number,
  originY: number,
  innerW: number,
  innerH: number,
  ppmm: number,
  insetMm = 0,
): ImageData {
  const W = Math.max(1, Math.round(innerW * ppmm));
  const H = Math.max(1, Math.round(innerH * ppmm));
  const out = new ImageData(W, H);
  const s = src.data, sw = src.width, sh = src.height, o = out.data;
  const lo = insetMm, hiX = innerW - insetMm, hiY = innerH - insetMm;

  for (let v = 0; v < H; v++) {
    const oy = v / ppmm;
    for (let u = 0; u < W; u++) {
      const ox = u / ppmm;
      let r = 255, g = 255, b = 255;           // inset border -> white
      if (ox >= lo && oy >= lo && ox < hiX && oy < hiY) {
        const mx = ox + originX, my = oy + originY;
        const [x, y] = applyH(Hmm2px, [mx, my]); // opening-mm -> source px
        if (x >= 0 && x < sw - 1 && y >= 0 && y < sh - 1) {
          const x0 = Math.floor(x), y0 = Math.floor(y);
          const fx = x - x0, fy = y - y0;
          const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          r = s[i00] * w00 + s[i10] * w10 + s[i01] * w01 + s[i11] * w11;
          g = s[i00 + 1] * w00 + s[i10 + 1] * w10 + s[i01 + 1] * w01 + s[i11 + 1] * w11;
          b = s[i00 + 2] * w00 + s[i10 + 2] * w10 + s[i01 + 2] * w01 + s[i11 + 2] * w11;
        }
      }
      const di = (v * W + u) * 4;
      o[di] = r; o[di + 1] = g; o[di + 2] = b; o[di + 3] = 255;
    }
  }
  return out;
}

/** Flatten illumination: convert to grayscale and divide by a large-radius local
 *  mean (a box blur via an integral image), so uneven lighting / shadows are
 *  removed and paper becomes uniformly white — without amplifying flat-region
 *  noise the way global histogram equalization would. Since we only care about
 *  dark-ink-on-light-paper, this makes thresholding robust across the image. */
export function flattenIllumination(img: ImageData, radiusPx: number): ImageData {
  const w = img.width, h = img.height, n = w * h, d = img.data;
  const gray = new Float64Array(n);
  for (let i = 0; i < n; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const iw = w + 1;
  const I = new Float64Array(iw * (h + 1)); // summed-area table
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      I[(y + 1) * iw + (x + 1)] = gray[y * w + x] + I[y * iw + (x + 1)] + I[(y + 1) * iw + x] - I[y * iw + x];
  const r = Math.max(1, radiusPx);
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = I[y1 * iw + x1] - I[y0 * iw + x1] - I[y1 * iw + x0] + I[y0 * iw + x0];
      const bg = s / ((x1 - x0) * (y1 - y0)) + 1e-3;
      const v = Math.max(0, Math.min(255, (gray[y * w + x] / bg) * 255));
      const o = (y * w + x) * 4;
      out.data[o] = v; out.data[o + 1] = v; out.data[o + 2] = v; out.data[o + 3] = 255;
    }
  }
  return out;
}

/** Otsu threshold of an image's luminance — the split between the dark ink and
 *  the (off-white) paper, so the frame workflow can auto-pick a sensitivity. */
export function otsuThreshold(img: ImageData): number {
  const d = img.data, n = img.width * img.height;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    hist[Math.max(0, Math.min(255, Math.round(lum)))]++;
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = -1, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; thr = t; }
  }
  return thr;
}
