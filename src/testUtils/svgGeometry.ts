// Shared geometry helpers for tests that need to inspect an emitted CNC SVG's
// actual curve shape rather than just its path-string text. Pulled out of
// svg.test.ts so other test files (e.g. the generated line-drawing fixtures)
// can reuse the same, already-verified measurements instead of redefining them.

export type Pt = [number, number];
export type Cubic = [Pt, Pt, Pt, Pt];

/** Pull every cubic out of an emitted SVG, grouped by subpath. */
export function subpaths(svg: string): Cubic[][] {
  const out: Cubic[][] = [];
  for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
    const toks = m[1].match(/[MCLZ]|-?\d+(?:\.\d+)?/g) ?? [];
    let pen: Pt = [0, 0];
    let cur: Cubic[] | null = null;
    for (let i = 0; i < toks.length; ) {
      const t = toks[i];
      if (t === "M") { pen = [+toks[i + 1], +toks[i + 2]]; cur = []; out.push(cur); i += 3; }
      else if (t === "L") { const p: Pt = [+toks[i + 1], +toks[i + 2]]; cur!.push([pen, pen, p, p]); pen = p; i += 3; }
      else if (t === "C") {
        const p: Pt = [+toks[i + 5], +toks[i + 6]];
        cur!.push([pen, [+toks[i + 1], +toks[i + 2]], [+toks[i + 3], +toks[i + 4]], p]);
        pen = p; i += 7;
      } else i += 1;
    }
  }
  return out.filter((s) => s.length > 0);
}

export const at = ([p0, c1, c2, p3]: Cubic, t: number): Pt => {
  const u = 1 - t;
  return [0, 1].map((k) =>
    u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p3[k]) as Pt;
};

export const flatten = (segs: Cubic[], per = 12): Pt[] => {
  const pts: Pt[] = [];
  for (const s of segs) for (let i = 0; i < per; i++) pts.push(at(s, i / per));
  pts.push(segs[segs.length - 1][3]);
  return pts;
};

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function properlyCrosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Count places where a subpath's own curve crosses itself. */
export function selfCrossings(segs: Cubic[]): number {
  const p = flatten(segs);
  let hits = 0;
  for (let i = 0; i < p.length - 1; i++)
    for (let j = i + 2; j < p.length - 1; j++)
      if (properlyCrosses(p[i], p[i + 1], p[j], p[j + 1])) hits++;
  return hits;
}

export function bbox(segs: Cubic[]): [number, number, number, number] {
  const p = flatten(segs);
  return [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])),
    Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
}

/**
 * How many times the curve's turn direction (sign of the cross product of
 * consecutive tangents) flips. A genuinely convex arc — like a hand-drawn
 * circle really is — should never flip; a "jag" is exactly a brief, spurious
 * reversal of curvature sign that a real corner would never produce either
 * (a corner turns once, hard, and stays turned).
 */
export function curvatureSignFlips(segs: Cubic[], per = 15, deadzoneDeg = 2): number {
  const pts = flatten(segs, per);
  const n = pts.length;
  const signs: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    const crossP = ux * vy - uy * vx;
    const mag = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1e-9;
    const sinDeg = (Math.asin(Math.max(-1, Math.min(1, crossP / mag))) * 180) / Math.PI;
    signs.push(Math.abs(sinDeg) < deadzoneDeg ? 0 : Math.sign(sinDeg));
  }
  let flips = 0, last = 0;
  for (const s of signs) {
    if (s === 0) continue;
    if (last !== 0 && s !== last) flips++;
    last = s;
  }
  return flips;
}
