import { describe, expect, it } from "vitest";
import { traceContours, thresholdMask, removeBorderRegions, smoothContour } from "./contour";

/** Create a binary mask with a filled rectangle. */
function filledRect(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      mask[y * w + x] = 1;
  return mask;
}

/** Create RGBA from a binary mask (for future use). */

describe("traceContours", () => {
  it("finds one contour for a filled square", () => {
    const mask = filledRect(30, 30, 5, 5, 25, 25);
    const contours = traceContours(mask, 30, 30, 1);
    expect(contours.length).toBe(1);
  });

  it("contour has reasonable point count for a square", () => {
    const mask = filledRect(30, 30, 5, 5, 25, 25);
    const contours = traceContours(mask, 30, 30, 1);
    // Perimeter of 20x20 square = ~80 pixels
    expect(contours[0].length).toBeGreaterThan(60);
    expect(contours[0].length).toBeLessThan(120);
  });

  it("finds two contours for two separated squares", () => {
    const mask = new Uint8Array(50 * 50);
    // Square 1: top-left
    for (let y = 5; y < 15; y++)
      for (let x = 5; x < 15; x++) mask[y * 50 + x] = 1;
    // Square 2: bottom-right
    for (let y = 30; y < 40; y++)
      for (let x = 30; x < 40; x++) mask[y * 50 + x] = 1;
    const contours = traceContours(mask, 50, 50, 1);
    expect(contours.length).toBe(2);
  });

  it("filters by minArea", () => {
    const small = filledRect(30, 30, 10, 10, 12, 12); // 2x2 = tiny
    const big = filledRect(30, 30, 5, 5, 25, 25);     // 20x20 = big
    expect(traceContours(small, 30, 30, 50)).toHaveLength(0);
    expect(traceContours(big, 30, 30, 50)).toHaveLength(1);
  });

  it("returns empty for all-zero mask", () => {
    const mask = new Uint8Array(20 * 20);
    expect(traceContours(mask, 20, 20, 1)).toHaveLength(0);
  });
});

describe("thresholdMask", () => {
  it("marks dark pixels as foreground", () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    // Pixel (0,0) = black
    rgba[3] = 255;
    // Pixel (1,0) = white
    rgba[4] = rgba[5] = rgba[6] = 255; rgba[7] = 255;
    const mask = thresholdMask(rgba, 4, 1, 128);
    expect(mask[0]).toBe(1); // black is foreground
    expect(mask[1]).toBe(0); // white is background
  });

  it("all-white image produces all-zero mask", () => {
    const w = 10, h = 10;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = 255;
    }
    const mask = thresholdMask(rgba, w, h, 128);
    expect(mask.every((v) => v === 0)).toBe(true);
  });
});

describe("removeBorderRegions", () => {
  it("removes region touching the left border", () => {
    const mask = filledRect(20, 20, 0, 5, 5, 15);
    removeBorderRegions(mask, 20, 20);
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it("preserves interior region", () => {
    const mask = filledRect(20, 20, 5, 5, 15, 15);
    removeBorderRegions(mask, 20, 20);
    const sum = mask.reduce((a, b) => a + b, 0);
    expect(sum).toBe(100); // 10x10 = 100 pixels
  });

  it("removes region touching corner", () => {
    const mask = filledRect(20, 20, 0, 0, 3, 3);
    removeBorderRegions(mask, 20, 20);
    expect(mask.every((v) => v === 0)).toBe(true);
  });

  it("only removes connected border pixels", () => {
    // Two regions: one touching border, one not
    const mask = new Uint8Array(20 * 20);
    // Border-touching: top row
    for (let x = 0; x < 5; x++) mask[x] = 1;
    // Interior: center
    for (let y = 8; y < 12; y++)
      for (let x = 8; x < 12; x++) mask[y * 20 + x] = 1;
    removeBorderRegions(mask, 20, 20);
    // Border region gone, interior preserved
    expect(mask[0]).toBe(0);
    expect(mask[9 * 20 + 9]).toBe(1);
  });
});

describe("smoothContour", () => {
  it("returns unchanged for 0 iterations", () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(smoothContour(pts, 0)).toEqual(pts);
  });

  it("reduces perimeter (smooths outward bumps)", () => {
    // A square with a bump
    const pts: [number, number][] = [
      [0, 0], [5, 0], [5, -3], [10, 0], [10, 10], [0, 10],
    ];
    const smoothed = smoothContour(pts, 5);
    // The bump at (5,-3) should move toward the average
    const bumpY = smoothed[2][1];
    expect(bumpY).toBeGreaterThan(-3); // moved toward 0
  });

  it("preserves point count", () => {
    const pts: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const smoothed = smoothContour(pts, 3);
    expect(smoothed.length).toBe(pts.length);
  });
});
