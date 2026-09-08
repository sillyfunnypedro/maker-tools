// Shared building blocks for the synthetic test-fixture generators
// (gen-test-drawings.ts, gen-test-areas.ts): a seeded PRNG + Gaussian noise
// source so fixtures are reproducible, and the plain PNG read/write glue. Pulled
// out once a second generator needed the exact same noise model — see
// gen-test-drawings.ts for why the noise has to be there at all (a clean,
// hard-edged synthetic image never reproduces the jagged-line bug; only a real
// photo, or one with comparable grain, does).
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";

export type Pt = [number, number];

/** Deterministic PRNG (mulberry32), seeded so fixtures regenerate identically. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal samples via Box-Muller, drawn from a uniform PRNG. */
export function gaussianSource(rand: () => number): () => number {
  let spare: number | null = null;
  return (): number => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

/** Distance in mm from point p to the segment a-b. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function grayToRgba(gray: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0; i < gray.length; i++) {
    const g = gray[i];
    out[i * 4] = g;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function writePng(path: string, width: number, height: number, data: Uint8ClampedArray): void {
  const png = new PNG({ width, height });
  for (let i = 0; i < data.length; i++) png.data[i] = data[i];
  writeFileSync(path, PNG.sync.write(png));
}
