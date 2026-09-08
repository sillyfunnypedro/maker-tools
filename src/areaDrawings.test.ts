// Runs the generated Areas-mode fixtures (src/testdata/areas/, made by
// `npm run gen:areas` — see qr-preview/gen-test-areas.ts) through the real
// threshold + contour-trace pipeline (the "areas" branch of src/worker.ts),
// across filled disks, a star (corner fidelity), and pairs of disks at a range
// of separations (the hardest case: two glass cells close enough that noise
// could bridge them into one traced region).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { removeBorderRegions, smoothContour, thresholdMask, traceContours } from "./contour";
import { renderStrokeGroups, strokesToSvg, traceAreaGroups } from "./svg";
import { DEFAULT_PARAMS } from "./processing";
import type { Mat3 } from "./qrframe/homography";
import { bbox, flatten, selfCrossings, subpaths } from "./testUtils/svgGeometry";
import manifest from "./testdata/areas/manifest.json";

type Entry = (typeof manifest)[number];

const DIR = new URL("./testdata/areas/", import.meta.url);

function loadPng(file: string): { data: Uint8ClampedArray; width: number; height: number } {
  const png = PNG.sync.read(readFileSync(new URL(file, DIR)));
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

/** Mirrors the worker's "areas" branch (src/worker.ts) with the app's default
 *  smoothing (0.5mm -> 2 iterations, see App.tsx's areaSmoothing default). */
function traceEntry(entry: Entry) {
  const { data, width, height } = loadPng(entry.file);
  const mask = thresholdMask(data, width, height, DEFAULT_PARAMS.bgThresh);
  removeBorderRegions(mask, width, height);
  let contours = traceContours(mask, width, height, DEFAULT_PARAMS.minBlob);
  contours = contours.map((c) => smoothContour(c, 2));
  const pxToMm: Mat3 = [[1 / entry.ppmm, 0, 0], [0, 1 / entry.ppmm, 0], [0, 0, 1]];
  const { groups, mmPerPx } = traceAreaGroups(contours, width, height, pxToMm, 0, 0);
  const { strokes, viewW, viewH } = renderStrokeGroups(groups, mmPerPx, entry.widthMm, entry.heightMm);
  const svg = strokesToSvg(viewW, viewH, strokes, undefined, { separatePaths: true, filled: true });
  return subpaths(svg);
}

describe("generated area drawings (disk / star / twoblobs)", () => {
  for (const entry of manifest as Entry[]) {
    if (entry.shape === "disk") {
      it(`${entry.file}: traces as one clean region ~${entry.param * 2}mm across`, () => {
        const subs = traceEntry(entry);
        expect(subs.length, entry.file).toBe(1);
        expect(selfCrossings(subs[0]), entry.file).toBe(0);
        const [x0, y0, x1, y1] = bbox(subs[0]);
        expect(x1 - x0, entry.file).toBeCloseTo(entry.param * 2, -1);
        expect(y1 - y0, entry.file).toBeCloseTo(entry.param * 2, -1);
      });
    }

    if (entry.shape === "star") {
      it(`${entry.file}: keeps concave notches distinct from the outer points`, () => {
        const subs = traceEntry(entry);
        expect(subs.length, entry.file).toBe(1);
        expect(selfCrossings(subs[0]), entry.file).toBe(0);
        const [x0, y0, x1, y1] = bbox(subs[0]);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        // A star that got smoothed into a circle would have every point at
        // nearly the same radius; the real fixture was drawn with points at
        // 28mm and notches at 12mm, so the min/max radius around the traced
        // outline should still land far apart from each other.
        let minR = Infinity, maxR = 0;
        for (const [px, py] of flatten(subs[0], 20)) {
          const r = Math.hypot(px - cx, py - cy);
          minR = Math.min(minR, r);
          maxR = Math.max(maxR, r);
        }
        expect(minR / maxR, entry.file).toBeLessThan(0.6);
        expect(maxR, entry.file).toBeGreaterThan(20);
      });
    }

    if (entry.shape === "twoblobs") {
      // Calibrated empirically at this noise level (see gen-test-areas.ts): a
      // gap of 0.3mm or more traces as two distinct cells; a 0.15mm gap is
      // narrower than the fixture's own antialiasing band and is expected to
      // bridge into one — that's a real resolution limit, not a bug, and this
      // documents exactly where it falls rather than silently ignoring it.
      const expectSeparate = entry.param >= 0.3;
      it(`${entry.file}: ${expectSeparate ? "stays two separate cells" : "merges (documented resolution limit)"}`, () => {
        const subs = traceEntry(entry);
        for (const sub of subs) expect(selfCrossings(sub), entry.file).toBe(0);
        expect(subs.length, entry.file).toBe(expectSeparate ? 2 : 1);
      });
    }
  }
});
