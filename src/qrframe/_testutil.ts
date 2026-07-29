// Test-only helpers: warp a grayscale/RGBA frame raster into a synthetic photo
// via a chosen quad, returning the RGBA image and the base-px -> photo-px map.
import { homography, applyH, matInv3, type Mat3, type Pt } from "./homography";

export function warpGray(buf: Uint8ClampedArray, W: number, H: number, quad: Pt[], fill = 90) {
  const src: Pt[] = [[0, 0], [W, 0], [W, H], [0, H]];
  const Hbp = homography(src, quad);
  const Hpb = matInv3(Hbp);
  let ox = Infinity, oy = Infinity, ex = -Infinity, ey = -Infinity;
  for (const [x, y] of quad) { ox = Math.min(ox, x); oy = Math.min(oy, y); ex = Math.max(ex, x); ey = Math.max(ey, y); }
  const pad = 40, OW = Math.ceil(ex - ox) + 2 * pad, OH = Math.ceil(ey - oy) + 2 * pad;
  const rgba = new Uint8ClampedArray(OW * OH * 4);
  for (let y = 0; y < OH; y++)
    for (let x = 0; x < OW; x++) {
      const [bx, by] = applyH(Hpb, [x + ox - pad, y + oy - pad]);
      let v = fill;
      if (bx >= 0 && bx < W && by >= 0 && by < H) v = buf[(by | 0) * W + (bx | 0)];
      const o = (y * OW + x) * 4;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = 255;
    }
  const s: Mat3 = [[1, 0, -ox + pad], [0, 1, -oy + pad], [0, 0, 1]];
  const baseToPhoto: Mat3 = [
    [Hbp[0][0] + s[0][2] * Hbp[2][0], Hbp[0][1] + s[0][2] * Hbp[2][1], Hbp[0][2] + s[0][2] * Hbp[2][2]],
    [Hbp[1][0] + s[1][2] * Hbp[2][0], Hbp[1][1] + s[1][2] * Hbp[2][1], Hbp[1][2] + s[1][2] * Hbp[2][2]],
    [Hbp[2][0], Hbp[2][1], Hbp[2][2]],
  ];
  return { rgba, OW, OH, baseToPhoto };
}

/** Photo quads (px) for a base W×H: flat-ish, steep tilt, ~90° rotation. */
export const QUADS: Record<string, (W: number, H: number) => Pt[]> = {
  flat: (W, H) => [[60, 60], [W + 60, 70], [W + 40, H + 60], [50, H + 50]],
  tilt: (W, H) => ([[0.15 * W, 0], [0.85 * W, 0], [W, H], [0, H]] as Pt[]).map(([x, y]) => [x + 80, y + 80] as Pt),
  rot: (W, H) => ([[H, 40], [H, W + 40], [0, W + 40], [0, 40]] as Pt[]).map(([x, y]) => [x + 60, y + 60] as Pt),
};

/** Scatter `count` dark clutter blobs off the frame (outside its bbox + margin). */
export function addClutter(rgba: Uint8ClampedArray, OW: number, OH: number, box: [number, number, number, number], count: number, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const [x0, y0, x1, y1] = box;
  const pad = 0.06 * Math.min(OW, OH);
  let placed = 0, tries = 0;
  while (placed < count && tries < 5000) {
    tries++;
    const cx = rnd() * OW, cy = rnd() * OH;
    if (cx > x0 - pad && cx < x1 + pad && cy > y0 - pad && cy < y1 + pad) continue;
    const r = (0.008 + 0.012 * rnd()) * Math.min(OW, OH);
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x < 0 || x >= OW || y < 0 || y >= OH) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const o = (y * OW + x) * 4;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = 20;
      }
    placed++;
  }
}
