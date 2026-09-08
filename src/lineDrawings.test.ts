// Runs the generated line-drawing fixtures (src/testdata/drawings/, made by
// `npm run gen:drawings` — see qr-preview/gen-test-drawings.ts) through the
// real mask + trace pipeline, across a range of line thicknesses.
//
// These are photo-realistic (anti-aliased edge + seeded grayscale noise), not
// the hard-edged disk-stamps svg.test.ts's other fixtures use — that noise is
// what actually exposed the jagged-curve bug (see "real-world jaggedness" in
// svg.test.ts): a perfectly clean synthetic edge never reproduced it, even at
// the old, buggy RDP tolerance. Checked-in PNGs (not just a saved point array
// like real-circle-trace.ts) mean this is regenerable, inspectable, and
// covers a matrix of thicknesses instead of just the one real photo we had.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { buildCncStrokedSvg } from "./svg";
import { DEFAULT_PARAMS, computeMasks } from "./processing";
import type { Mat3 } from "./qrframe/homography";
import { subpaths, flatten, selfCrossings, bbox, curvatureSignFlips } from "./testUtils/svgGeometry";
import manifest from "./testdata/drawings/manifest.json";

const DIR = new URL("./testdata/drawings/", import.meta.url);

function loadDrawing(file: string): { data: Uint8ClampedArray; width: number; height: number } {
  const png = PNG.sync.read(readFileSync(new URL(file, DIR)));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

describe("generated line drawings (shape x thickness matrix)", () => {
  for (const entry of manifest) {
    it(`${entry.file}: traces cleanly (no self-crossings)`, () => {
      const { data, width, height } = loadDrawing(entry.file);
      const m = computeMasks(data, width, height, DEFAULT_PARAMS);
      const pxToMm: Mat3 = [[1 / entry.ppmm, 0, 0], [0, 1 / entry.ppmm, 0], [0, 0, 1]];
      const svg = buildCncStrokedSvg(
        m.skeleton, m.w, m.h, pxToMm, 0, 0, entry.widthMm, entry.heightMm,
      );
      const subs = subpaths(svg);
      expect(subs.length, `${entry.file} traced nothing`).toBeGreaterThan(0);
      for (const sub of subs) expect(selfCrossings(sub), entry.file).toBe(0);
    });

    if (entry.shape === "circle") {
      it(`${entry.file}: stays convex (the jagged-curve regression check)`, () => {
        const { data, width, height } = loadDrawing(entry.file);
        const m = computeMasks(data, width, height, DEFAULT_PARAMS);
        const pxToMm: Mat3 = [[1 / entry.ppmm, 0, 0], [0, 1 / entry.ppmm, 0], [0, 0, 1]];
        const svg = buildCncStrokedSvg(
          m.skeleton, m.w, m.h, pxToMm, 0, 0, entry.widthMm, entry.heightMm,
        );
        const biggest = subpaths(svg).sort((a, b) => (bbox(b)[2] - bbox(b)[0]) - (bbox(a)[2] - bbox(a)[0]))[0];
        // deadzoneDeg=8, not the default 2: each fixture's noise is an independent
        // per-pixel draw, and at 3mm-thick (the widest stroke, so the most independent
        // noisy pixels feed the medial-axis skeleton) that leaves one join around
        // 7 degrees even with the fix applied. The old, buggy tolerance still stands
        // out clearly at this same deadzone (2 flips vs. 0 here, checked by hand), so
        // this isn't hiding the regression — just not demanding the kind of sub-pixel-
        // noise-free perfection the real-photo baseline (svg.test.ts) never needed either.
        expect(curvatureSignFlips(biggest, 15, 8), entry.file).toBe(0);
        // The circle's drawn radius is 40mm -> ~80mm across.
        const [x0, y0, x1, y1] = bbox(biggest);
        expect(x1 - x0, entry.file).toBeCloseTo(80, -1);
        expect(y1 - y0, entry.file).toBeCloseTo(80, -1);
      });
    }

    if (entry.shape === "diagonal45") {
      it(`${entry.file}: comes out straight, not a staircase`, () => {
        const { data, width, height } = loadDrawing(entry.file);
        const m = computeMasks(data, width, height, DEFAULT_PARAMS);
        const pxToMm: Mat3 = [[1 / entry.ppmm, 0, 0], [0, 1 / entry.ppmm, 0], [0, 0, 1]];
        const svg = buildCncStrokedSvg(
          m.skeleton, m.w, m.h, pxToMm, 0, 0, entry.widthMm, entry.heightMm,
        );
        const biggest = subpaths(svg).sort((a, b) => (bbox(b)[2] - bbox(b)[0]) - (bbox(a)[2] - bbox(a)[0]))[0];
        // A straight line's own flattened points should sit close to the ideal
        // chord end to end — jagged staircase noise would push some of them off it.
        const pts = flatten(biggest, 20);
        const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        let worst = 0;
        for (const [x, y] of pts) {
          const t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len);
          const px = ax + t * (bx - ax), py = ay + t * (by - ay);
          worst = Math.max(worst, Math.hypot(x - px, y - py));
        }
        expect(worst, entry.file).toBeLessThan(0.3);
      });
    }
  }
});
