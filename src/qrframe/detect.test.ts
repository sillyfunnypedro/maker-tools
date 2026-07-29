// Unit E2E: hand-render a QR frame (QR + dot rows) into a pixel buffer, warp it
// (flat / tilt / 90° rotation), optionally scatter off-frame clutter, detect with
// detectQrFrame, and measure the sample square via the recovered mm homography.
import { describe, it, expect } from "vitest";
import QRCode from "qrcode";
import { applyH, type Pt, type Mat3 } from "./homography";
import { encodePayload, dotLayoutMm, samplePointsMm, outerW, outerH, type QrFrameSpec } from "./spec";
import { detectQrFrame } from "./detect";
import { warpGray, QUADS, addClutter } from "./_testutil";

const PPMM = 6;
const SPEC: QrFrameSpec = {
  id: "std", innerW: 150, innerH: 168, scaleMm: 90,
  marginL: 34, marginT: 34, marginR: 12, marginB: 12,
  qrX: 4, qrY: 4, qrSize: 27, dotSpacing: 14, dotD: 4,
};

function renderBase(spec: QrFrameSpec) {
  const W = Math.round(outerW(spec) * PPMM), H = Math.round(outerH(spec) * PPMM);
  const buf = new Uint8ClampedArray(W * H).fill(255);
  const qr = QRCode.create(encodePayload(spec), { errorCorrectionLevel: "M" });
  const N = qr.modules.size, data = qr.modules.data, mod = spec.qrSize / N;
  for (let my = 0; my < N; my++)
    for (let mx = 0; mx < N; mx++) {
      if (!data[my * N + mx]) continue;
      const x0 = Math.round((spec.qrX + mx * mod) * PPMM), x1 = Math.round((spec.qrX + (mx + 1) * mod) * PPMM);
      const y0 = Math.round((spec.qrY + my * mod) * PPMM), y1 = Math.round((spec.qrY + (my + 1) * mod) * PPMM);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) buf[y * W + x] = 0;
    }
  const r = (spec.dotD / 2) * PPMM;
  for (const [mx, my] of dotLayoutMm(spec)) {
    const cx = mx * PPMM, cy = my * PPMM;
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if (x >= 0 && x < W && y >= 0 && y < H && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) buf[y * W + x] = 0;
  }
  return { buf, W, H };
}

function measure(res: ReturnType<typeof detectQrFrame>, baseToPhoto: Mat3) {
  const mmToPhoto = (p: Pt): Pt => applyH(baseToPhoto, [p[0] * PPMM, p[1] * PPMM]);
  const { square, circle } = samplePointsMm(SPEC);
  const sq = square.map((p) => applyH(res.Hpx2mm!, mmToPhoto(p)));
  const ci = circle.map((p) => applyH(res.Hpx2mm!, mmToPhoto(p)));
  const w = (Math.hypot(sq[1][0] - sq[0][0], sq[1][1] - sq[0][1]) + Math.hypot(sq[2][0] - sq[3][0], sq[2][1] - sq[3][1])) / 2;
  const h = (Math.hypot(sq[3][0] - sq[0][0], sq[3][1] - sq[0][1]) + Math.hypot(sq[2][0] - sq[1][0], sq[2][1] - sq[1][1])) / 2;
  const dia = (Math.hypot(ci[1][0] - ci[0][0], ci[1][1] - ci[0][1]) + Math.hypot(ci[3][0] - ci[2][0], ci[3][1] - ci[2][1])) / 2;
  return { w, h, dia };
}

describe("QR frame detect + measure", () => {
  const base = renderBase(SPEC);
  for (const name of Object.keys(QUADS)) {
    it(`${name}`, () => {
      const { rgba, OW, OH, baseToPhoto } = warpGray(base.buf, base.W, base.H, QUADS[name](base.W, base.H));
      const res = detectQrFrame(rgba, OW, OH);
      expect(res.detected, res.reason).toBe(true);
      const { w, h, dia } = measure(res, baseToPhoto);
      expect(Math.abs(w - 90)).toBeLessThan(1.0);
      expect(Math.abs(h - 90)).toBeLessThan(1.0);
      expect(Math.abs(w - h)).toBeLessThan(1.0);
      expect(Math.abs(dia - 45)).toBeLessThan(1.0);
    });
  }

  // jsQR needs a findable QR; a handful of stray marks off-frame is fine (the dot
  // refit ignores them). Heavy clutter is handled by the "keep white around the
  // frame" retake guidance, not tested here.
  for (const clutter of [8, 15]) {
    it(`tilt + ${clutter} clutter blobs`, () => {
      const q = QUADS.tilt(base.W, base.H);
      const { rgba, OW, OH, baseToPhoto } = warpGray(base.buf, base.W, base.H, q);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of q) { x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); }
      addClutter(rgba, OW, OH, [x0 + 80, y0 + 80, x1 + 80, y1 + 80], clutter, clutter);
      const res = detectQrFrame(rgba, OW, OH);
      expect(res.detected, res.reason).toBe(true);
      const { w, h, dia } = measure(res, baseToPhoto);
      expect(Math.abs(w - 90)).toBeLessThan(1.0);
      expect(Math.abs(w - h)).toBeLessThan(1.0);
      expect(Math.abs(dia - 45)).toBeLessThan(1.0);
    });
  }
});
