import { describe, expect, it } from "vitest";
import {
  IDENTITY_ADJUST,
  applyFineAdjustMm,
  fitRectMm,
  screenPxToVideoPx,
  videoPxToScreenPx,
} from "./frameDrawGeometry";
import type { Pt } from "./qrframe/homography";

describe("fitRectMm", () => {
  const opening: Pt[] = [[10, 20], [110, 20], [110, 70], [10, 70]]; // 100mm x 50mm

  it("fills the opening exactly when the aspect ratio matches", () => {
    const r = fitRectMm(opening, 100 / 50);
    expect(r).toEqual(opening);
  });

  it("letterboxes a taller-than-opening image (limited by height)", () => {
    const r = fitRectMm(opening, 1); // square image in a 2:1 opening
    const w = r[1][0] - r[0][0], h = r[2][1] - r[1][1];
    expect(w).toBeCloseTo(50, 6);
    expect(h).toBeCloseTo(50, 6);
    // still centred in the opening
    expect((r[0][0] + r[1][0]) / 2).toBeCloseTo(60, 6);
    expect((r[0][1] + r[2][1]) / 2).toBeCloseTo(45, 6);
  });

  it("pillarboxes a wider-than-opening image (limited by width)", () => {
    const r = fitRectMm(opening, 10); // very wide image
    const w = r[1][0] - r[0][0], h = r[2][1] - r[1][1];
    expect(w).toBeCloseTo(100, 6);
    expect(h).toBeCloseTo(10, 6);
  });
});

describe("applyFineAdjustMm", () => {
  const rect: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];

  it("is a no-op at identity", () => {
    expect(applyFineAdjustMm(rect, IDENTITY_ADJUST)).toEqual(rect);
  });

  it("translates without changing size", () => {
    const r = applyFineAdjustMm(rect, { ...IDENTITY_ADJUST, dx: 3, dy: -2 });
    expect(r).toEqual([[3, -2], [13, -2], [13, 8], [3, 8]]);
  });

  it("scales around the rectangle's own centre", () => {
    const r = applyFineAdjustMm(rect, { ...IDENTITY_ADJUST, scale: 2 });
    // centre stays at (5,5); corners move twice as far from it
    expect(r[0]).toEqual([-5, -5]);
    expect(r[2]).toEqual([15, 15]);
  });

  it("rotates 90 degrees around the centre", () => {
    const r = applyFineAdjustMm(rect, { ...IDENTITY_ADJUST, rotateDeg: 90 });
    for (const [x, y] of r) {
      expect(Math.hypot(x - 5, y - 5)).toBeCloseTo(Math.hypot(5, 5), 6);
    }
    // top-left corner (relative -5,-5) rotated 90 CCW (in this y-down,
    // math-positive-angle convention) lands at relative (5,-5) -> (10,0)
    expect(r[0][0]).toBeCloseTo(10, 6);
    expect(r[0][1]).toBeCloseTo(0, 6);
  });
});

describe("videoPxToScreenPx / screenPxToVideoPx (object-fit: cover)", () => {
  it("round-trips an arbitrary point", () => {
    const videoW = 1280, videoH = 720, stageW = 400, stageH = 600;
    const p: Pt = [500, 300];
    const screen = videoPxToScreenPx(p, videoW, videoH, stageW, stageH);
    const back = screenPxToVideoPx(screen, videoW, videoH, stageW, stageH);
    expect(back[0]).toBeCloseTo(p[0], 6);
    expect(back[1]).toBeCloseTo(p[1], 6);
  });

  it("centres the video's own centre point in the stage", () => {
    const videoW = 1280, videoH = 720, stageW = 400, stageH = 600;
    const center: Pt = [videoW / 2, videoH / 2];
    const screen = videoPxToScreenPx(center, videoW, videoH, stageW, stageH);
    expect(screen[0]).toBeCloseTo(stageW / 2, 6);
    expect(screen[1]).toBeCloseTo(stageH / 2, 6);
  });

  it("crops the wider axis when video and stage aspect ratios differ", () => {
    // Wide video (16:9) in a portrait stage (2:3): height is the constraining
    // axis for cover, so the video's full height maps exactly to stage height,
    // while width overflows equally on both sides.
    const videoW = 1280, videoH = 720, stageW = 400, stageH = 600;
    const top = videoPxToScreenPx([0, 0], videoW, videoH, stageW, stageH);
    const bottom = videoPxToScreenPx([videoW, videoH], videoW, videoH, stageW, stageH);
    expect(top[1]).toBeCloseTo(0, 6);
    expect(bottom[1]).toBeCloseTo(stageH, 6);
  });
});
