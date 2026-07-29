// Round-trip through the REAL generator: svgFrame -> rsvg-convert raster -> warp
// -> detectQrFrame -> measure. Exercises the actual printed-sheet output (not the
// hand-rendered unit fixture) for every standard frame size. Skipped if
// rsvg-convert isn't installed.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { applyH, type Pt, type Mat3 } from "./homography";
import { svgFrame, STANDARD_SPECS } from "./generate";
import { samplePointsMm, outerW } from "./spec";
import { detectQrFrame } from "./detect";
import { warpGray, QUADS } from "./_testutil";

function hasRsvg(): boolean {
  try { execFileSync("rsvg-convert", ["--version"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

const dir = mkdtempSync(join(tmpdir(), "qrframe-"));

describe.skipIf(!hasRsvg())("QR frame round-trip (generator -> rsvg -> detect)", () => {
  for (const spec of STANDARD_SPECS) {
    it(`${spec.id}`, () => {
      const ppmm = 6;
      const pxW = Math.round(outerW(spec) * ppmm);
      const svgPath = join(dir, `${spec.id}.svg`), pngPath = join(dir, `${spec.id}.png`);
      writeFileSync(svgPath, svgFrame(spec));
      execFileSync("rsvg-convert", ["-w", String(pxW), "-b", "white", "-o", pngPath, svgPath]);
      const png = PNG.sync.read(readFileSync(pngPath));
      const W = png.width, H = png.height;
      const gray = new Uint8ClampedArray(W * H);
      for (let i = 0, j = 0; i < gray.length; i++, j += 4)
        gray[i] = (png.data[j] + png.data[j + 1] + png.data[j + 2]) / 3;
      const actualPpmm = W / outerW(spec);

      const { rgba, OW, OH, baseToPhoto } = warpGray(gray, W, H, QUADS.tilt(W, H));
      const res = detectQrFrame(rgba, OW, OH);
      expect(res.detected, res.reason).toBe(true);
      expect(res.spec!.id).toBe(spec.id);

      const mmToPhoto = (p: Pt): Pt => applyH(baseToPhoto as Mat3, [p[0] * actualPpmm, p[1] * actualPpmm]);
      const { square, circle } = samplePointsMm(spec);
      const sq = square.map((p) => applyH(res.Hpx2mm!, mmToPhoto(p)));
      const ci = circle.map((p) => applyH(res.Hpx2mm!, mmToPhoto(p)));
      const w = (Math.hypot(sq[1][0] - sq[0][0], sq[1][1] - sq[0][1]) + Math.hypot(sq[2][0] - sq[3][0], sq[2][1] - sq[3][1])) / 2;
      const h = (Math.hypot(sq[3][0] - sq[0][0], sq[3][1] - sq[0][1]) + Math.hypot(sq[2][0] - sq[1][0], sq[2][1] - sq[1][1])) / 2;
      const dia = (Math.hypot(ci[1][0] - ci[0][0], ci[1][1] - ci[0][1]) + Math.hypot(ci[3][0] - ci[2][0], ci[3][1] - ci[2][1])) / 2;
      const s = spec.scaleMm;
      // eslint-disable-next-line no-console
      console.log(`${spec.id}: inliers ${res.inliers}/${res.nDots! + 4} reproj ${res.reprojErrPx!.toFixed(2)}px | sq ${w.toFixed(2)}x${h.toFixed(2)} circ ${dia.toFixed(2)} (${s}/${s / 2})`);
      expect(Math.abs(w - s)).toBeLessThan(1.5);
      expect(Math.abs(h - s)).toBeLessThan(1.5);
      expect(Math.abs(w - h)).toBeLessThan(1.5);
      expect(Math.abs(dia - s / 2)).toBeLessThan(1.5);
    });
  }
});
