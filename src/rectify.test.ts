// Rectification tests.
//
// The frame's rim is dark, and it sits immediately outside the opening. If any of
// it survives into the crop it becomes a cut line in the export, so the inset
// border must come back as paper white.
//
// (Straightening is not tested here: it is a coordinate change on the finished
// vector output, not a resample — see the rotation tests in svg.test.ts.)
import { describe, expect, it } from "vitest";
import { rectifyOpening } from "./rectify";
import type { Mat3 } from "./qrframe/homography";

// `rectifyOpening` builds an ImageData, which only exists in the browser — which
// is why this module had no unit tests. The pipeline only ever touches
// width/height/data, so a stand-in is enough to test it here.
if (typeof globalThis.ImageData === "undefined") {
  class NodeImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    readonly colorSpace = "srgb" as const;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      this.data = new Uint8ClampedArray(w * h * 4);
    }
  }
  (globalThis as unknown as { ImageData: unknown }).ImageData = NodeImageData;
}

const MARGIN = 20, INNER = 100, PPMM = 4;
const OUTER = MARGIN + INNER + MARGIN;
const SRC = OUTER * PPMM;
/** frame-mm -> source-px is a plain scale here, so the geometry is easy to reason about. */
const Hmm2px: Mat3 = [[PPMM, 0, 0], [0, PPMM, 0], [0, 0, 1]];

// The rim is RED on purpose. A grey rim can't be told apart from the circle's
// own anti-aliased edge: once rotated, bilinear sampling blends black into white
// and produces every intermediate grey. Black-and-white content always keeps
// R == G == B, so any pixel where red and green differ can only have come from
// the rim.
const RIM_R = 200, RIM_G = 0;
const CIRCLE_R = 30; // mm, centred in the opening: rotation-invariant by construction

/** A synthetic frame photo: red rim outside the opening, white paper inside it,
 *  with one black circle drawn on the paper. */
function framePhoto(): ImageData {
  const img = new ImageData(SRC, SRC);
  const cx = MARGIN + INNER / 2, cy = MARGIN + INNER / 2;
  for (let y = 0; y < SRC; y++) {
    for (let x = 0; x < SRC; x++) {
      const mx = x / PPMM, my = y / PPMM;
      const inside = mx >= MARGIN && mx <= MARGIN + INNER && my >= MARGIN && my <= MARGIN + INNER;
      const o = (y * SRC + x) * 4;
      if (!inside) {
        img.data[o] = RIM_R; img.data[o + 1] = RIM_G; img.data[o + 2] = RIM_G;
      } else {
        const v = Math.hypot(mx - cx, my - cy) <= CIRCLE_R ? 0 : 255;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      }
      img.data[o + 3] = 255;
    }
  }
  return img;
}

function stats(img: ImageData) {
  let rimish = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, dark = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const v = img.data[i];
      if (Math.abs(v - img.data[i + 1]) > 10) rimish++; // only the red rim can do this
      if (v < 128) {
        dark++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { rimish, dark, w: x1 - x0, h: y1 - y0 };
}

const rectify = (insetMm: number) =>
  rectifyOpening(framePhoto(), Hmm2px, MARGIN, MARGIN, INNER, INNER, PPMM, insetMm);

describe("rectifyOpening", () => {
  it("keeps the frame rim out of the crop", () => {
    for (const inset of [0, 1, 2]) {
      expect(stats(rectify(inset)).rimish, `inset ${inset}mm leaked rim pixels`).toBe(0);
    }
  });

  it("blanks the inset border to white", () => {
    const img = rectify(2);
    const at = (x: number, y: number) => img.data[(y * img.width + x) * 4];
    const edge = Math.round(1 * PPMM); // 1mm in, inside a 2mm inset
    for (const [x, y] of [[edge, edge], [img.width - 1 - edge, edge],
      [edge, img.height - 1 - edge]] as const) {
      expect(at(x, y)).toBe(255);
    }
  });

  it("gives a true-scale crop of the opening", () => {
    const img = rectify(1);
    expect(img.width).toBe(INNER * PPMM);
    expect(img.height).toBe(INNER * PPMM);
    const s = stats(img);
    expect(s.w).toBeCloseTo(2 * CIRCLE_R * PPMM, -1);
    expect(s.h).toBeCloseTo(2 * CIRCLE_R * PPMM, -1);
  });
});
