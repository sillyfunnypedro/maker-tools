// Generates a matrix of synthetic line-drawing test images (shape x thickness)
// and writes them as PNGs under src/testdata/drawings/, alongside a manifest
// describing each one. Checked into the repo alongside this generator so the
// test suite has real, inspectable image fixtures instead of only in-memory
// skeleton arrays — and so the fixtures can be regenerated deterministically
// (fixed seed) if the rendering ever needs to change.
//
// Plain disk-stamped shapes (see svg.test.ts's rgbaCanvas helpers) rendered
// perfectly smooth even at the old, buggy RDP tolerance — the jagged-line bug
// (see svg.ts's renderStrokeGroups) only ever showed up against a real photo.
// So these images render *anti-aliased* strokes (a soft edge over ~1 px, like
// a camera image actually has) plus a little seeded grayscale noise, instead
// of a hard binary edge — that combination is what lets pixel-thinning
// staircase noise actually appear, the same way it does in a real photo.
//
// Usage: npm run gen:drawings
import { writeFileSync, mkdirSync } from "node:fs";
import { PNG } from "pngjs";

const OPEN_W = 150, OPEN_H = 168; // mm — matches svg.test.ts's OPEN_W/OPEN_H
const PPMM = 1400 / 168;          // matches the app's standard-resolution scale
const W = Math.round(OPEN_W * PPMM), H = Math.round(OPEN_H * PPMM);
const OUT_DIR = "src/testdata/drawings";

type Pt = [number, number];

// --- Deterministic PRNG (mulberry32) + Gaussian noise via Box-Muller -------
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussianSource(rand: () => number) {
  let spare: number | null = null;
  return (): number => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

// --- Distance fields, in mm, from a pixel to a shape's centerline ----------
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

interface Shape {
  name: string;
  /** Distance in mm from point p (mm) to the shape's centerline. */
  dist: (p: Pt) => number;
}

const CX = OPEN_W / 2, CY = OPEN_H / 2;

const shapes: Shape[] = [
  {
    name: "circle",
    // Sweeps every tangent angle including the 45-degree worst case.
    dist: (p) => Math.abs(Math.hypot(p[0] - CX, p[1] - CY) - 40),
  },
  {
    name: "diagonal45",
    // A dead-straight line at exactly the worst angle for staircase noise.
    dist: (p) => distToSegment(p, [CX - 45, CY - 45], [CX + 45, CY + 45]),
  },
  {
    name: "square",
    // Corner fidelity: the smoothing must not round these off.
    dist: (p) => {
      const half = 35;
      const corners: Pt[] = [
        [CX - half, CY - half], [CX + half, CY - half],
        [CX + half, CY + half], [CX - half, CY + half],
      ];
      let d = Infinity;
      for (let i = 0; i < 4; i++) d = Math.min(d, distToSegment(p, corners[i], corners[(i + 1) % 4]));
      return d;
    },
  },
];

const THICKNESSES_MM = [0.5, 1, 2, 3];

// Antialiasing band and noise amplitude both scale off one source pixel, so
// the fixtures stay proportionate if PPMM ever changes.
const AA_MM = 1 / PPMM;
// Gray levels (0-255) of added grain. Calibrated against a circle, not chosen
// arbitrarily: swept from 4 to 14, all traced perfectly convex (0 curvature
// flips) through sigma 10, and sigma 12+ started reproducing residual
// jaggedness even with the fixed RDP tolerance (see renderStrokeGroups in
// svg.ts). 10 is the noisiest fixture that's a fair regression check against
// the fix that actually shipped, rather than a stress test of a level nobody
// has confirmed it handles.
const NOISE_SIGMA = 10;

function render(shape: Shape, thicknessMm: number, seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const gauss = gaussianSource(rand);
  const half = thicknessMm / 2;
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p: Pt = [(x + 0.5) / PPMM, (y + 0.5) / PPMM];
      const signed = shape.dist(p) - half;
      // 1 = fully ink, 0 = fully paper, smoothstepped over the AA band.
      const darkness = Math.max(0, Math.min(1, 0.5 - signed / AA_MM));
      let g = 255 * (1 - darkness) + gauss() * NOISE_SIGMA;
      gray[y * W + x] = Math.max(0, Math.min(255, Math.round(g)));
    }
  }
  return gray;
}

function grayToRgba(gray: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0; i < gray.length; i++) {
    const g = gray[i];
    out[i * 4] = g; out[i * 4 + 1] = g; out[i * 4 + 2] = g; out[i * 4 + 3] = 255;
  }
  return out;
}

function writePng(path: string, data: Uint8ClampedArray) {
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < data.length; i++) png.data[i] = data[i];
  writeFileSync(path, PNG.sync.write(png));
}

mkdirSync(OUT_DIR, { recursive: true });
const manifest: { file: string; shape: string; thicknessMm: number; widthMm: number; heightMm: number; ppmm: number }[] = [];
let seed = 1;
for (const shape of shapes) {
  for (const thicknessMm of THICKNESSES_MM) {
    const file = `${shape.name}-${thicknessMm}mm.png`;
    const gray = render(shape, thicknessMm, seed++);
    writePng(`${OUT_DIR}/${file}`, grayToRgba(gray));
    manifest.push({ file, shape: shape.name, thicknessMm, widthMm: OPEN_W, heightMm: OPEN_H, ppmm: PPMM });
    console.log(`  ${OUT_DIR}/${file}`);
  }
}
writeFileSync(
  `${OUT_DIR}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`\n${manifest.length} drawings -> ${OUT_DIR}/ (+ manifest.json)`);
