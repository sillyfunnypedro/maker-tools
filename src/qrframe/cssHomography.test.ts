import { describe, expect, it } from "vitest";
import { homography, applyH, type Pt } from "./homography";
import { matrix3dFromHomography } from "./cssHomography";

/** Replicates what a browser does with `transform: matrix3d(...)` applied to
 *  a (x, y, 0, 1) point: read the 16 values as a column-major 4x4 matrix,
 *  multiply, then perspective-divide by the resulting w. Independent of
 *  matrix3dFromHomography's own implementation, so this actually checks the
 *  CSS semantics rather than just echoing the same code back. */
function applyMatrix3d(css: string, p: Pt): Pt {
  const nums = css.match(/matrix3d\(([^)]+)\)/)![1].split(",").map(Number);
  expect(nums).toHaveLength(16);
  const col = (i: number) => [nums[i * 4], nums[i * 4 + 1], nums[i * 4 + 2], nums[i * 4 + 3]];
  const [c0, c1, c2, c3] = [col(0), col(1), col(2), col(3)];
  const [x, y, z, w] = [p[0], p[1], 0, 1];
  const row = (r: number) => c0[r] * x + c1[r] * y + c2[r] * z + c3[r] * w;
  const [rx, ry, , rw] = [row(0), row(1), row(2), row(3)];
  return [rx / rw, ry / rw];
}

describe("matrix3dFromHomography", () => {
  it("reproduces a genuinely skewed quad mapping at its four corners", () => {
    const src: Pt[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    // An arbitrary, non-affine (proper keystone) target quad — no two sides
    // parallel, so an affine-only transform could never reproduce this.
    const dst: Pt[] = [[12, 30], [240, 10], [200, 220], [-10, 190]];
    const H = homography(src, dst);
    const css = matrix3dFromHomography(H);
    for (let i = 0; i < 4; i++) {
      const [x, y] = applyMatrix3d(css, src[i]);
      expect(x, `corner ${i} x`).toBeCloseTo(dst[i][0], 3);
      expect(y, `corner ${i} y`).toBeCloseTo(dst[i][1], 3);
    }
  });

  it("matches applyH at interior (non-correspondence) points too", () => {
    const src: Pt[] = [[0, 0], [200, 0], [200, 150], [0, 150]];
    const dst: Pt[] = [[20, 40], [300, 5], [280, 300], [5, 260]];
    const H = homography(src, dst);
    const css = matrix3dFromHomography(H);
    for (const p of [[50, 50], [150, 100], [10, 140], [199, 1]] as Pt[]) {
      const viaCss = applyMatrix3d(css, p);
      const viaApplyH = applyH(H, p);
      expect(viaCss[0]).toBeCloseTo(viaApplyH[0], 6);
      expect(viaCss[1]).toBeCloseTo(viaApplyH[1], 6);
    }
  });

  it("reduces to a plain 2D affine transform for a non-perspective mapping", () => {
    // A pure translate+rotate+scale (no keystone) should produce w=1 always,
    // i.e. the bottom row is (0, 0, 0, 1) — sanity check the embedding doesn't
    // introduce spurious perspective for an ordinary rigid-ish transform.
    const src: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const dst: Pt[] = [[5, 5], [15, 5], [15, 15], [5, 15]]; // pure translate
    const H = homography(src, dst);
    expect(H[2][0]).toBeCloseTo(0, 6);
    expect(H[2][1]).toBeCloseTo(0, 6);
    expect(H[2][2]).toBeCloseTo(1, 6);
  });
});
