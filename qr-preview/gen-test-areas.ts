// Generates synthetic test images for Areas mode (contour tracing of filled
// regions — see src/contour.ts's traceContours and src/worker.ts's "areas"
// branch), the counterpart to gen-test-drawings.ts's line drawings. Same
// anti-aliased + seeded-noise rendering (see that file for why plain hard
// edges never reproduce real tracing artifacts), but rendering filled shapes
// via a signed distance field instead of a stroked centerline.
//
// Shapes:
//  - disk: one filled circle, swept by radius — the basic smoke test.
//  - star: a concave/convex polygon, swept by point count — corner fidelity
//    for area contours, the way "square" does for line drawings.
//  - twoblobs: two filled disks, swept by the gap between them — the
//    hardest case for area tracing, since a gap that's too narrow relative to
//    the photo noise can bridge and merge two distinct glass cells into one.
//
// Usage: npm run gen:areas
import { mkdirSync, writeFileSync } from "node:fs";
import { distToSegment, gaussianSource, grayToRgba, mulberry32, writePng, type Pt } from "./genFixtureUtils";

const OPEN_W = 150, OPEN_H = 168;
const PPMM = 1400 / 168;
const W = Math.round(OPEN_W * PPMM), H = Math.round(OPEN_H * PPMM);
const OUT_DIR = "src/testdata/areas";
const CX = OPEN_W / 2, CY = OPEN_H / 2;

const AA_MM = 1 / PPMM;
// Same calibration basis as gen-test-drawings.ts's NOISE_SIGMA=10: verified by
// the sweep in that file for stroked lines. Filled regions have a much longer
// boundary-to-area ratio in their favour (a disk's contour doesn't have two
// parallel noisy edges within one AA band the way a thin line does), so the
// same grain level is, if anything, an easier case here — reusing it keeps the
// two fixture sets photographically comparable instead of arbitrarily different.
const NOISE_SIGMA = 10;

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Render one filled shape from its signed distance field: negative = inside (ink). */
function renderFilled(sdf: (p: Pt) => number, seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const gauss = gaussianSource(rand);
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p: Pt = [(x + 0.5) / PPMM, (y + 0.5) / PPMM];
      const darkness = Math.max(0, Math.min(1, 0.5 - sdf(p) / AA_MM));
      gray[y * W + x] = clampByte(255 * (1 - darkness) + gauss() * NOISE_SIGMA);
    }
  }
  return gray;
}

// --- disk --------------------------------------------------------------- //
function diskSdf(radiusMm: number): (p: Pt) => number {
  return (p) => Math.hypot(p[0] - CX, p[1] - CY) - radiusMm;
}

// --- star (point-in-polygon + nearest-edge distance) --------------------- //
function starPolygon(points: number, outerR: number, innerR: number): Pt[] {
  const verts: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? outerR : innerR;
    verts.push([CX + r * Math.cos(angle), CY + r * Math.sin(angle)]);
  }
  return verts;
}
function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polygonSdf(poly: Pt[]): (p: Pt) => number {
  return (p) => {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
    return pointInPolygon(p, poly) ? -d : d;
  };
}

// --- twoblobs (union of two disks) ---------------------------------------- //
function twoBlobsSdf(gapMm: number, radiusMm: number): (p: Pt) => number {
  const dx = radiusMm + gapMm / 2;
  const c1: Pt = [CX - dx, CY], c2: Pt = [CX + dx, CY];
  return (p) => Math.min(Math.hypot(p[0] - c1[0], p[1] - c1[1]) - radiusMm, Math.hypot(p[0] - c2[0], p[1] - c2[1]) - radiusMm);
}

interface ManifestEntry {
  file: string;
  shape: "disk" | "star" | "twoblobs";
  param: number;
  widthMm: number;
  heightMm: number;
  ppmm: number;
}

const RADII_MM = [5, 10, 20, 35];
const STAR_POINTS = [5, 6, 8, 12];
const STAR_OUTER_R = 28, STAR_INNER_R = 12;
// Descending, spanning the actual merge threshold at this noise/resolution
// (empirically between 0.2 and 0.3mm): 4mm and 1mm are comfortably separate,
// 0.3mm is separate but close to the edge, and 0.15mm is expected to merge into
// one region — see src/areaDrawings.test.ts for which gaps must stay separate.
const GAPS_MM = [4, 1, 0.3, 0.15];
const TWO_BLOB_RADIUS_MM = 14;

mkdirSync(OUT_DIR, { recursive: true });
const manifest: ManifestEntry[] = [];
let seed = 1001; // distinct range from gen-test-drawings.ts's seeds

for (const radiusMm of RADII_MM) {
  const file = `disk-${radiusMm}mm.png`;
  writePng(`${OUT_DIR}/${file}`, W, H, grayToRgba(renderFilled(diskSdf(radiusMm), seed++)));
  manifest.push({ file, shape: "disk", param: radiusMm, widthMm: OPEN_W, heightMm: OPEN_H, ppmm: PPMM });
  console.log(`  ${OUT_DIR}/${file}`);
}

for (const points of STAR_POINTS) {
  const file = `star-${points}pt.png`;
  const poly = starPolygon(points, STAR_OUTER_R, STAR_INNER_R);
  writePng(`${OUT_DIR}/${file}`, W, H, grayToRgba(renderFilled(polygonSdf(poly), seed++)));
  manifest.push({ file, shape: "star", param: points, widthMm: OPEN_W, heightMm: OPEN_H, ppmm: PPMM });
  console.log(`  ${OUT_DIR}/${file}`);
}

for (const gapMm of GAPS_MM) {
  const file = `twoblobs-${gapMm}mm-gap.png`;
  writePng(`${OUT_DIR}/${file}`, W, H, grayToRgba(renderFilled(twoBlobsSdf(gapMm, TWO_BLOB_RADIUS_MM), seed++)));
  manifest.push({ file, shape: "twoblobs", param: gapMm, widthMm: OPEN_W, heightMm: OPEN_H, ppmm: PPMM });
  console.log(`  ${OUT_DIR}/${file}`);
}

writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(`\n${manifest.length} area fixtures -> ${OUT_DIR}/ (+ manifest.json)`);
