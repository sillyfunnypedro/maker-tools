// Converts a planar homography into a CSS `matrix3d()` string, so a browser
// can render an arbitrary perspective warp (skew from viewing a flat frame at
// an angle) for free via GPU compositing, instead of redrawing pixels into a
// canvas on every video frame.
//
// `H` follows this codebase's homography.ts convention (applyH): for a point
// p=(x,y), the mapped point is (x',y') where
//   x' = (H[0][0]*x + H[0][1]*y + H[0][2]) / w
//   y' = (H[1][0]*x + H[1][1]*y + H[1][2]) / w
//   w  =  H[2][0]*x + H[2][1]*y + H[2][2]
//
// CSS's matrix3d(a1,b1,c1,d1, a2,b2,c2,d2, a3,b3,c3,d3, a4,b4,c4,d4) reads its
// 16 arguments as four COLUMNS of the 4x4 matrix (column0 = a1,b1,c1,d1, and
// so on), applied to the homogeneous point (x,y,z,w) as `M * point` and then
// perspective-divided by the resulting w — exactly the same operation
// `applyH` does by hand. We want, for z=0/w=1 points:
//   resultX = H00*x + H01*y + H02
//   resultY = H10*x + H11*y + H12
//   resultZ = z            (untouched — an identity row, so it doesn't
//                            interact with the rest)
//   resultW = H20*x + H21*y + H22
// which as a matrix has row0=[H00,H01,0,H02], row1=[H10,H11,0,H12],
// row2=[0,0,1,0], row3=[H20,H21,0,H22] — so, reading that matrix out by
// COLUMN (per the spec's own ordering) rather than by row:
import type { Mat3 } from "./homography";

export function matrix3dFromHomography(H: Mat3): string {
  const values = [
    H[0][0], H[1][0], 0, H[2][0],
    H[0][1], H[1][1], 0, H[2][1],
    0, 0, 1, 0,
    H[0][2], H[1][2], 0, H[2][2],
  ];
  return `matrix3d(${values.join(",")})`;
}
