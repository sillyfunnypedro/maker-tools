// Vector-export geometry tests.
//
// The exported path has to be something a CNC can actually cut: it must not
// double back on itself, and it must stay on the shape it traced. Both were
// broken by uniform Catmull-Rom tangents — a corner left as a sub-pixel segment
// between two long ones grew control arms many times its own length, so the
// curve looped and swung a millimetre wide of its own nodes.
import { describe, expect, it } from "vitest";
import { buildCncStrokedSvg, traceStrokeGroups, renderStrokeGroups, strokesToSvg } from "./svg";
import { DEFAULT_PARAMS, computeMasks } from "./processing";
import type { Mat3 } from "./qrframe/homography";

const PPMM = 1400 / 168; // the app's standard-resolution scale: ~8.33 px/mm
const pxToMm: Mat3 = [[1 / PPMM, 0, 0], [0, 1 / PPMM, 0], [0, 0, 1]];

type Pt = [number, number];
type Cubic = [Pt, Pt, Pt, Pt];

/** Pull every cubic out of an emitted SVG, grouped by subpath. */
function subpaths(svg: string): Cubic[][] {
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

const at = ([p0, c1, c2, p3]: Cubic, t: number): Pt => {
  const u = 1 - t;
  return [0, 1].map((k) =>
    u * u * u * p0[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * p3[k]) as Pt;
};

const flatten = (segs: Cubic[], per = 12): Pt[] => {
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
function selfCrossings(segs: Cubic[]): number {
  const p = flatten(segs);
  let hits = 0;
  for (let i = 0; i < p.length - 1; i++)
    for (let j = i + 2; j < p.length - 1; j++)
      if (properlyCrosses(p[i], p[i + 1], p[j], p[j + 1])) hits++;
  return hits;
}

function bbox(segs: Cubic[]): [number, number, number, number] {
  const p = flatten(segs);
  return [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])),
    Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
}

// --------------------------------------------------------------------------- //
// Raster helpers: paint mm-space shapes into a pixel mask at PPMM.
// --------------------------------------------------------------------------- //
const OPEN_W = 150, OPEN_H = 168;
const W = Math.round(OPEN_W * PPMM), H = Math.round(OPEN_H * PPMM);

function blank(): Uint8Array {
  return new Uint8Array(W * H);
}

/** One-pixel-wide square ring, as the skeletonizer would hand over a drawn box. */
function squareOutlineSkeleton(side: number, deg = 0, atX = OPEN_W / 2, atY = OPEN_H / 2): Uint8Array {
  const m = blank();
  const cx = atX, cy = atY, r = (deg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r), half = side / 2;
  const put = (mx: number, my: number) => {
    const x = Math.round((cx + mx * cos - my * sin) * PPMM);
    const y = Math.round((cy + mx * sin + my * cos) * PPMM);
    if (x >= 0 && x < W && y >= 0 && y < H) m[y * W + x] = 1;
  };
  const step = 1 / (PPMM * 3); // oversample so the ring stays 8-connected
  for (let t = -half; t <= half; t += step) {
    put(t, -half); put(t, half); put(-half, t); put(half, t);
  }
  return m;
}

/**
 * Guaranteed-thin 8-connected ring (midpoint circle). Plotting a circle by
 * rounding sampled angles instead leaves 2-pixel-wide spots, which is a
 * different bug's input, not a skeleton.
 */
function thinRing(radiusMm: number, dropPx = 0): Uint8Array {
  const m = blank();
  const cx = Math.round((OPEN_W / 2) * PPMM), cy = Math.round((OPEN_H / 2) * PPMM);
  const r = Math.round(radiusMm * PPMM);
  const pts: [number, number][] = [];
  let x = r, y = 0, err = 0;
  while (x >= y) {
    for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]] as const)
      pts.push([cx + px, cy + py]);
    y++;
    err += 1 + 2 * y;
    if (2 * (err - x) + 1 > 0) { x--; err += 1 - 2 * x; }
  }
  for (const [px, py] of pts) if (px >= 0 && py >= 0 && px < W && py < H) m[py * W + px] = 1;
  // Punch a break at the ring's rightmost point.
  for (let k = 0; k < dropPx; k++) m[(cy + k - (dropPx >> 1)) * W + (cx + r)] = 0;
  return m;
}

/** Paint into a white RGBA image, for tests that run the real mask pipeline. */
function rgbaCanvas(paint: (set: (x: number, y: number) => void) => void): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4).fill(255);
  paint((x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = 0;
  });
  return d;
}

const stroked = (skel: Uint8Array) =>
  buildCncStrokedSvg(skel, W, H, pxToMm, 0, 0, OPEN_W, OPEN_H);

/** Largest distance from the drawn curve to the polygon through its own nodes. */
function curveBulge(segs: Cubic[], closed: boolean): number {
  const nodes: Pt[] = [segs[0][0], ...segs.map((s) => s[3])];
  if (closed) nodes.pop();
  let worst = 0;
  for (const p of flatten(segs, 16)) {
    let best = Infinity;
    for (let i = 0; i < nodes.length - (closed ? 0 : 1); i++) {
      const a = nodes[i], b = nodes[(i + 1) % nodes.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
      let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

const isClosedPath = (segs: Cubic[]) =>
  Math.hypot(segs[0][0][0] - segs[segs.length - 1][3][0],
    segs[0][0][1] - segs[segs.length - 1][3][1]) < 1e-6;

const biggest = (subs: Cubic[][]) =>
  subs.slice().sort((a, b) => (bbox(b)[2] - bbox(b)[0]) - (bbox(a)[2] - bbox(a)[0]))[0];

describe("closed-ring simplification", () => {
  // Plain RDP measures every point against the first->last chord, which for a
  // ring is degenerate: a traced circle whose ends met exactly collapsed to two
  // points and vanished from the export entirely.
  it("keeps a traced circle instead of collapsing it", () => {
    const ring = biggest(subpaths(stroked(thinRing(20))));
    expect(ring.length).toBeGreaterThan(8); // not degenerated to a stub
    const [x0, y0, x1, y1] = bbox(ring);
    expect(x1 - x0).toBeCloseTo(40, 0);
    expect(y1 - y0).toBeCloseTo(40, 0);
    expect(selfCrossings(ring)).toBe(0);
    expect(isClosedPath(ring)).toBe(true);
  });
});

describe("stroke stitching", () => {
  it("bridges a one-pixel break into a single closed path", () => {
    // One pixel is the tracer's own rounding, not a gap in the drawing.
    const subs = subpaths(stroked(thinRing(20, 1)));
    const big = subs.filter((s) => bbox(s)[2] - bbox(s)[0] > 30);
    expect(big).toHaveLength(1);
    expect(isClosedPath(big[0])).toBe(true);
    expect(selfCrossings(big[0])).toBe(0);
  });

  it("refuses to invent geometry across a real gap", () => {
    // ~4 mm of missing ink (faint line, shadow) is real. Closing it would
    // fabricate a cut line that is not in the drawing.
    const subs = subpaths(stroked(thinRing(20, Math.round(4 * PPMM))));
    const big = subs.filter((s) => bbox(s)[2] - bbox(s)[0] > 30);
    expect(big).toHaveLength(1);
    expect(isClosedPath(big[0])).toBe(false);
  });
});

describe("staircase thinning (full mask pipeline)", () => {
  // Zhang-Suen leaves 2px-wide steps on diagonals; those read as junctions and
  // shatter one curve into arcs plus duplicate stubs.
  it("traces a drawn circle as a single closed path", () => {
    const r = 20 * PPMM;
    const cx = (OPEN_W / 2) * PPMM, cy = (OPEN_H / 2) * PPMM;
    const rgba = rgbaCanvas((set) => {
      for (let a = 0; a < 2 * Math.PI; a += 1 / (4 * r))
        for (let t = -1.5; t <= 1.5; t += 0.5)   // a drawn line has width
          set(Math.round(cx + (r + t) * Math.cos(a)), Math.round(cy + (r + t) * Math.sin(a)));
    });
    const m = computeMasks(rgba, W, H, { ...DEFAULT_PARAMS, bgThresh: 200 });
    const subs = subpaths(stroked(m.skeleton));
    const big = subs.filter((s) => bbox(s)[2] - bbox(s)[0] > 30);
    expect(big).toHaveLength(1);
    expect(isClosedPath(big[0])).toBe(true);
    expect(selfCrossings(big[0])).toBe(0);
    const [x0, y0, x1, y1] = bbox(big[0]);
    expect(x1 - x0).toBeCloseTo(40, 0);
    expect(y1 - y0).toBeCloseTo(40, 0);
  });
});

describe("speck rejection", () => {
  it("drops sub-millimetre dust but keeps the drawing", () => {
    const skel = squareOutlineSkeleton(60);
    for (const [mx, my] of [[20, 20], [25, 30], [30, 25]] as const) {
      const x = Math.round(mx * PPMM), y = Math.round(my * PPMM);
      skel[y * W + x] = 1;
      skel[y * W + x + 1] = 1;
      skel[(y + 1) * W + x] = 1;
    }
    const subs = subpaths(stroked(skel));
    for (const s of subs) {
      const [x0, y0, x1, y1] = bbox(s);
      expect(Math.max(x1 - x0, y1 - y0)).toBeGreaterThan(1.5);
    }
    expect(subs.some((s) => bbox(s)[2] - bbox(s)[0] > 55)).toBe(true);
  });
});

describe("corner fidelity", () => {
  it("does not swing wide where a corner arrives as two shallow turns", () => {
    // Judged on immediate neighbours, each half of a staircase-split 90 degree
    // corner looks smooth, and the curve then bulges ~1 mm outside its own nodes.
    for (const deg of [0, 2, 7, 15, 33, 45]) {
      for (const sub of subpaths(stroked(squareOutlineSkeleton(60, deg)))) {
        if (bbox(sub)[2] - bbox(sub)[0] < 55) continue; // only the square itself
        expect(curveBulge(sub, isClosedPath(sub)), `square rotated ${deg}deg`)
          .toBeLessThan(0.25);
      }
    }
  });

  it("still lets a real curve curve", () => {
    // The corner rule must not facet a circle into a polygon.
    const ring = biggest(subpaths(stroked(thinRing(20))));
    for (const [x, y] of flatten(ring, 16))
      expect(Math.abs(Math.hypot(x - OPEN_W / 2, y - OPEN_H / 2) - 20)).toBeLessThan(0.4);
  });
});

describe("straightening (rotateDeg)", () => {
  const rotated = (deg: number) =>
    buildCncStrokedSvg(squareOutlineSkeleton(60), W, H, pxToMm, 0, 0, OPEN_W, OPEN_H,
      undefined, undefined, undefined, undefined, deg);

  /** Area and perimeter of a closed path — both independent of orientation, so
   *  they're the honest test of "rotation didn't change the size". */
  function areaAndPerimeter(segs: Cubic[]) {
    const p = flatten(segs, 12);
    let a = 0, per = 0;
    for (let i = 0; i < p.length; i++) {
      const u = p[i], v = p[(i + 1) % p.length];
      a += u[0] * v[1] - v[0] * u[1];
      per += Math.hypot(v[0] - u[0], v[1] - u[1]);
    }
    return { area: Math.abs(a) / 2, per };
  }

  it("is rigid: a square keeps its size at every angle", () => {
    const base = areaAndPerimeter(biggest(subpaths(rotated(0))));
    for (const deg of [0.5, 5, 20, -12, 45]) {
      const m = areaAndPerimeter(biggest(subpaths(rotated(deg))));
      expect(Math.sqrt(m.area), `${deg}deg by area`).toBeCloseTo(Math.sqrt(base.area), 1);
      expect(m.per / 4, `${deg}deg by perimeter`).toBeCloseTo(base.per / 4, 1);
    }
  });

  it("actually turns the geometry", () => {
    // The axis-aligned bounding box of a rotated square grows predictably; if it
    // didn't change, the angle would be being ignored.
    const [x0, y0, x1, y1] = bbox(biggest(subpaths(rotated(20))));
    const side = Math.sqrt(areaAndPerimeter(biggest(subpaths(rotated(0)))).area);
    const want = side * (Math.cos((20 * Math.PI) / 180) + Math.sin((20 * Math.PI) / 180));
    expect(x1 - x0).toBeCloseTo(want, 0);
    expect(y1 - y0).toBeCloseTo(want, 0);
  });

  it("turns about the centre of the opening", () => {
    // A shape centred in the opening must stay centred, whatever the angle.
    for (const deg of [7, 33, -21]) {
      const [x0, y0, x1, y1] = bbox(biggest(subpaths(rotated(deg))));
      expect((x0 + x1) / 2, `${deg}deg cx`).toBeCloseTo(OPEN_W / 2, 0);
      expect((y0 + y1) / 2, `${deg}deg cy`).toBeCloseTo(OPEN_H / 2, 0);
    }
  });

  it("emits no self-crossings and keeps the page size", () => {
    for (const deg of [3, 20, 45]) {
      const svg = rotated(deg);
      expect(svg).toContain(`width="${OPEN_W.toFixed(2)}mm" height="${OPEN_H.toFixed(2)}mm"`);
      for (const sub of subpaths(svg)) expect(selfCrossings(sub), `${deg}deg`).toBe(0);
    }
  });

  it("clips whatever swings outside the opening", () => {
    // A shape nearly as wide as the opening loses its corners when turned. The
    // clipper cuts the polyline, but smoothing used to bow the curve back out
    // through the cut — 5.4 mm past the edge at 45 degrees — so this checks the
    // emitted curve, not just its nodes.
    const wide = squareOutlineSkeleton(Math.min(OPEN_W, OPEN_H) - 4);
    const svg = buildCncStrokedSvg(wide, W, H, pxToMm, 0, 0, OPEN_W, OPEN_H,
      undefined, undefined, undefined, undefined, 30);
    for (const sub of subpaths(svg)) {
      for (const [x, y] of flatten(sub, 12)) {
        expect(x).toBeGreaterThanOrEqual(-0.01);
        expect(y).toBeGreaterThanOrEqual(-0.01);
        expect(x).toBeLessThanOrEqual(OPEN_W + 0.01);
        expect(y).toBeLessThanOrEqual(OPEN_H + 0.01);
      }
    }
  });

  it("leaves the export untouched at 0 degrees", () => {
    const plain = buildCncStrokedSvg(squareOutlineSkeleton(60), W, H, pxToMm, 0, 0, OPEN_W, OPEN_H);
    expect(rotated(0)).toBe(plain);
  });
});

describe("zoom (crop to the view)", () => {
  const zoomed = (z: number, side = 60, deg = 0) =>
    buildCncStrokedSvg(squareOutlineSkeleton(side), W, H, pxToMm, 0, 0, OPEN_W, OPEN_H,
      undefined, undefined, undefined, undefined, deg, z);

  const pageOf = (svg: string) => {
    const m = svg.match(/width="([\d.]+)mm" height="([\d.]+)mm"/)!;
    return [Number(m[1]), Number(m[2])] as const;
  };

  it("shrinks the page to the visible window", () => {
    for (const z of [1, 1.5, 2, 3]) {
      const [w, h] = pageOf(zoomed(z));
      expect(w, `${z}x width`).toBeCloseTo(OPEN_W / z, 2);
      expect(h, `${z}x height`).toBeCloseTo(OPEN_H / z, 2);
    }
  });

  it("crops rather than magnifying: a 60 mm square stays 60 mm", () => {
    // This is the whole point — zoom selects a region, it does not scale geometry.
    // If it magnified, the square would measure 120 mm at 2x and every cut would
    // be twice the size it should be.
    for (const z of [1, 1.25, 2]) {
      const [x0, y0, x1, y1] = bbox(biggest(subpaths(zoomed(z))));
      expect(x1 - x0, `${z}x`).toBeCloseTo(60, 0);
      expect(y1 - y0, `${z}x`).toBeCloseTo(60, 0);
    }
  });

  it("keeps the shape centred in the smaller page", () => {
    for (const z of [1.5, 2]) {
      const [w, h] = pageOf(zoomed(z));
      const [x0, y0, x1, y1] = bbox(biggest(subpaths(zoomed(z))));
      expect((x0 + x1) / 2, `${z}x cx`).toBeCloseTo(w / 2, 0);
      expect((y0 + y1) / 2, `${z}x cy`).toBeCloseTo(h / 2, 0);
    }
  });

  it("drops what falls outside the view — the point of the control", () => {
    // A 120 mm square inside a 150 mm opening survives whole at 1x, and must be
    // cut down once the window is smaller than it.
    const wide = subpaths(zoomed(1, 120));
    expect(bbox(biggest(wide))[2] - bbox(biggest(wide))[0]).toBeCloseTo(120, 0);
    const [w, h] = pageOf(zoomed(2, 120));
    for (const sub of subpaths(zoomed(2, 120))) {
      for (const [x, y] of flatten(sub, 12)) {
        expect(x).toBeGreaterThanOrEqual(-0.01);
        expect(y).toBeGreaterThanOrEqual(-0.01);
        expect(x).toBeLessThanOrEqual(w + 0.01);
        expect(y).toBeLessThanOrEqual(h + 0.01);
      }
    }
  });

  it("stays inside the page when rotating and zooming together", () => {
    for (const [deg, z] of [[20, 1.5], [45, 2], [-135, 1.2], [180, 3]] as const) {
      const svg = zoomed(z, 100, deg);
      const [w, h] = pageOf(svg);
      for (const sub of subpaths(svg)) {
        expect(selfCrossings(sub), `${deg}deg ${z}x`).toBe(0);
        for (const [x, y] of flatten(sub, 12)) {
          expect(x, `${deg}deg ${z}x`).toBeGreaterThanOrEqual(-0.02);
          expect(y, `${deg}deg ${z}x`).toBeGreaterThanOrEqual(-0.02);
          expect(x, `${deg}deg ${z}x`).toBeLessThanOrEqual(w + 0.02);
          expect(y, `${deg}deg ${z}x`).toBeLessThanOrEqual(h + 0.02);
        }
      }
    }
  });

  it("leaves the export untouched at 1x", () => {
    const plain = buildCncStrokedSvg(squareOutlineSkeleton(60), W, H, pxToMm, 0, 0, OPEN_W, OPEN_H);
    expect(zoomed(1)).toBe(plain);
  });
});

describe("pan (moving the crop window)", () => {
  const build = (z: number, pan: [number, number], at: [number, number], side = 20) =>
    buildCncStrokedSvg(squareOutlineSkeleton(side, 0, at[0], at[1]), W, H, pxToMm, 0, 0,
      OPEN_W, OPEN_H, undefined, undefined, undefined, undefined, 0, z, pan[0], pan[1]);

  const pageOf = (svg: string) => {
    const m = svg.match(/width="([\d.]+)mm" height="([\d.]+)mm"/)!;
    return [Number(m[1]), Number(m[2])] as const;
  };

  // A 20mm mark up in the top-left corner of the opening. At 2x the centred
  // window spans x 37.5..112.5, so the mark (x 10..30) is entirely outside it.
  const MARK: [number, number] = [20, 20];
  // The furthest the UI lets you pan at 2x: half the leftover, so the window
  // becomes the top-left quadrant (x 0..75, y 0..84) — which contains the mark.
  const CORNER: [number, number] = [-OPEN_W / 4, -OPEN_H / 4];

  it("reaches a mark the centred crop cannot see", () => {
    expect(subpaths(build(2, [0, 0], MARK)), "centred 2x should miss it").toHaveLength(0);
    const subs = subpaths(build(2, CORNER, MARK));
    expect(subs, "panned 2x should find it").toHaveLength(1);
    const [x0, y0, x1, y1] = bbox(subs[0]);
    expect(x1 - x0).toBeCloseTo(20, 0);   // whole, not clipped
    expect(y1 - y0).toBeCloseTo(20, 0);
    const [w, h] = pageOf(build(2, CORNER, MARK));
    expect(x1).toBeLessThanOrEqual(w);
    expect(y1).toBeLessThanOrEqual(h);
  });

  it("moves the window, so the mark shifts by the same amount", () => {
    // Pan by 10mm and the mark's position in the exported page moves 10mm the
    // other way — nothing else about it changes.
    const centre: [number, number] = [OPEN_W / 2, OPEN_H / 2];
    const a = bbox(biggest(subpaths(build(1.5, [0, 0], centre))));
    const b = bbox(biggest(subpaths(build(1.5, [10, -8], centre))));
    expect(b[0] - a[0]).toBeCloseTo(-10, 0);
    expect(b[1] - a[1]).toBeCloseTo(8, 0);
  });

  it("does not change the size of what it moves", () => {
    // A centred mark stays wholly inside the window for every pan the UI allows,
    // so any size change here would be real.
    const centre: [number, number] = [OPEN_W / 2, OPEN_H / 2];
    for (const pan of [[0, 0], [10, 0], [-20, 15], [25, -28]] as [number, number][]) {
      const [x0, y0, x1, y1] = bbox(biggest(subpaths(build(1.5, pan, centre))));
      expect(x1 - x0, `pan ${pan}`).toBeCloseTo(20, 0);
      expect(y1 - y0, `pan ${pan}`).toBeCloseTo(20, 0);
    }
  });

  it("keeps the page size — pan moves the window, it doesn't resize it", () => {
    for (const pan of [[0, 0], [15, -12], CORNER] as [number, number][]) {
      const [w, h] = pageOf(build(2, pan, MARK));
      expect(w).toBeCloseTo(OPEN_W / 2, 2);
      expect(h).toBeCloseTo(OPEN_H / 2, 2);
    }
  });

  it("stays inside the page when panning, rotating and zooming together", () => {
    for (const [deg, z, px, py] of [[20, 1.5, 10, -8], [-140, 2, -18, 12], [45, 2.5, 5, 5]] as const) {
      const svg = buildCncStrokedSvg(squareOutlineSkeleton(100), W, H, pxToMm, 0, 0,
        OPEN_W, OPEN_H, undefined, undefined, undefined, undefined, deg, z, px, py);
      const [w, h] = pageOf(svg);
      for (const sub of subpaths(svg)) {
        expect(selfCrossings(sub), `${deg}deg ${z}x pan ${px},${py}`).toBe(0);
        for (const [x, y] of flatten(sub, 12)) {
          expect(x).toBeGreaterThanOrEqual(-0.02);
          expect(y).toBeGreaterThanOrEqual(-0.02);
          expect(x).toBeLessThanOrEqual(w + 0.02);
          expect(y).toBeLessThanOrEqual(h + 0.02);
        }
      }
    }
  });

  it("leaves the export untouched at zero pan", () => {
    const plain = buildCncStrokedSvg(squareOutlineSkeleton(60), W, H, pxToMm, 0, 0, OPEN_W, OPEN_H);
    expect(build(1, [0, 0], [OPEN_W / 2, OPEN_H / 2], 60)).toBe(plain);
  });
});

describe("stroke groups (interactive line editor)", () => {
  // Two well-separated squares trace as two independent groups.
  function twoSquares(): Uint8Array {
    const a = squareOutlineSkeleton(20, 0, 40, 40);
    const b = squareOutlineSkeleton(20, 0, 120, 120);
    const m = blank();
    for (let i = 0; i < m.length; i++) m[i] = a[i] || b[i];
    return m;
  }
  const center = (segs: Cubic[]): Pt => {
    const [x0, y0, x1, y1] = bbox(segs);
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  };
  const near = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 3;

  it("traces one group per drawn shape, independent of view", () => {
    const { groups, mmPerPx } = traceStrokeGroups(twoSquares(), W, H, pxToMm, 0, 0);
    expect(groups.length).toBe(2);
    const plain = renderStrokeGroups(groups, mmPerPx, OPEN_W, OPEN_H);
    expect(plain.strokes.length).toBe(2);
    expect(plain.strokes.every((s) => s.length === 1)).toBe(true); // each is one closed loop
  });

  it("keeps the same group index across rotate/zoom/pan", () => {
    const { groups, mmPerPx } = traceStrokeGroups(twoSquares(), W, H, pxToMm, 0, 0);
    // Rotation alone can't push either square outside the (full, zoom=1) window:
    // it preserves distance from the pivot, and even the farthest corner sits
    // well inside every edge. The zoomed/panned cases keep enough margin for the
    // same reason — this test is about index stability, not clipping, which has
    // its own coverage elsewhere.
    const views: [number, number, number, number][] = [
      [0, 1, 0, 0], [17, 1, 0, 0], [0, 1.1, 2, -2], [25, 1.2, 3, -3],
    ];
    for (const [rot, zoom, panX, panY] of views) {
      // Both shapes stay inside the (possibly cropped) view in every case here,
      // so both groups should still produce exactly one path each, at the same
      // indices — the property an interactive editor's exclusion set relies on.
      const r = renderStrokeGroups(groups, mmPerPx, OPEN_W, OPEN_H, undefined, undefined, undefined, rot, zoom, panX, panY);
      expect(r.strokes.map((s) => s.length)).toEqual([1, 1]);
    }
  });

  it("excluding a group's index removes exactly that shape from the flattened export", () => {
    const { groups, mmPerPx } = traceStrokeGroups(twoSquares(), W, H, pxToMm, 0, 0);
    const { strokes, viewW, viewH } = renderStrokeGroups(groups, mmPerPx, OPEN_W, OPEN_H);
    const full = subpaths(strokesToSvg(viewW, viewH, strokes));
    expect(full.length).toBe(2);
    // Whichever index corresponds to the (120,120) square, excluding it should
    // leave only the (40,40) one behind.
    const targetIdx = center(full[0])[0] > 80 ? 0 : 1;
    const kept = subpaths(strokesToSvg(viewW, viewH, strokes.filter((_, i) => i !== targetIdx)));
    expect(kept.length).toBe(1);
    expect(near(center(kept[0]), [40, 40])).toBe(true);
  });

  it("buildCncStrokedSvg composes the same three steps", () => {
    const skel = twoSquares();
    const direct = buildCncStrokedSvg(
      skel, W, H, pxToMm, 0, 0, OPEN_W, OPEN_H, 0.3, 0.1, 2, 1.5, 11, 1.3, 4, -2);
    const { groups, mmPerPx } = traceStrokeGroups(skel, W, H, pxToMm, 0, 0);
    const { strokes, viewW, viewH } = renderStrokeGroups(
      groups, mmPerPx, OPEN_W, OPEN_H, 0.1, 2, 1.5, 11, 1.3, 4, -2);
    expect(strokesToSvg(viewW, viewH, strokes, 0.3)).toBe(direct);
  });
});

describe("CNC centerline export", () => {
  it("emits no self-crossings for a drawn box", () => {
    for (const deg of [0, 3, 12]) {
      const svg = buildCncStrokedSvg(
        squareOutlineSkeleton(60, deg), W, H, pxToMm, 0, 0, OPEN_W, OPEN_H);
      const subs = subpaths(svg);
      expect(subs.length).toBeGreaterThan(0);
      for (const sub of subs) expect(selfCrossings(sub), `box rotated ${deg}deg`).toBe(0);
    }
  });

  it("traces a box at its true size", () => {
    const svg = buildCncStrokedSvg(squareOutlineSkeleton(60), W, H, pxToMm, 0, 0, OPEN_W, OPEN_H);
    const all = subpaths(svg).flatMap((s) => flatten(s));
    const w = Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0]));
    const h = Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1]));
    expect(w).toBeCloseTo(60, 0);
    expect(h).toBeCloseTo(60, 0);
  });
});
