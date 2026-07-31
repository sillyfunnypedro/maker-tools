// SVG vector export: the skeleton graph traced into centerline strokes and
// emitted as true-millimetre Bezier paths for the CNC.
//
// One line in the drawing becomes one line in the file, which is what a CNC
// follows. (The filled-shape exports that also lived here — glass cells, outlined
// lines, piece outlines — were removed at release: the Cricut workflow uses the
// PNG, and frame mode is centerline-only.)

type Pt = [number, number];

// --------------------------------------------------------------------------- //
// Ramer-Douglas-Peucker simplification.
// --------------------------------------------------------------------------- //
function rdp(points: Pt[], eps: number): Pt[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [sx, sy] = points[s];
    const [ex, ey] = points[e];
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.hypot(dx, dy) || 1;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(dx * (points[i][1] - sy) - dy * (points[i][0] - sx)) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * RDP for a closed ring.
 *
 * Plain `rdp` measures every point against the chord from the first point to the
 * last, which is meaningless for a ring: those two points are neighbours. When
 * they coincide exactly the baseline has zero length, every perpendicular
 * distance evaluates to zero, and the whole ring collapses to two points — a
 * closed circle silently disappeared from an export this way. Even when they
 * merely sit a pixel apart, the distances are measured against that pixel-long
 * baseline and mean nothing.
 *
 * Splitting the ring at the point farthest from the start gives two chains that
 * each have a long, well-conditioned baseline.
 */
function rdpClosed(points: Pt[], eps: number): Pt[] {
  const n = points.length;
  if (n < 4) return points;
  let m = 0, far = -1;
  for (let i = 1; i < n; i++) {
    const d = dist(points[0], points[i]);
    if (d > far) { far = d; m = i; }
  }
  if (m < 1) return points;
  const first = rdp(points.slice(0, m + 1), eps);            // p0 .. pm
  const second = rdp(points.slice(m).concat([points[0]]), eps); // pm .. p0
  return first.concat(second.slice(1, -1));
}

// --------------------------------------------------------------------------- //
// Catmull-Rom -> cubic Bezier path strings.
//
// The parameterisation matters. The uniform spline assumes evenly spaced points,
// but RDP guarantees the opposite: it keeps each corner *and* the single-pixel
// staircase steps beside it while deleting everything along the straight runs,
// so a corner ends up as a sub-pixel segment sitting between two very long ones.
// Uniform tangents then reach many times that short segment's own length, the
// curve doubles back, and the export gets a visible loop hanging off the corner
// of an otherwise clean shape. The centripetal parameterisation (knots spaced by
// sqrt(chord)) provably cannot cusp or self-intersect, so we use that instead.
//
// Smoothing is still wrong for a genuine corner, though — centripetal tangents
// scale with chord length, which would round a 90-degree corner between two long
// edges into a wide arc. Turns sharper than CORNER_DEG therefore keep a true
// corner: each side gets the one-sided tangent along its own chord, so the join
// stays sharp and straight edges stay straight.
//
// The corner test has to look *past* its immediate neighbours. On the pixel grid
// a 90-degree corner does not arrive as one 90-degree turn: it arrives as two
// ~45-degree turns separated by a sub-pixel chord (the staircase step at the
// tip). Comparing only adjacent chords, each half reads as a gentle bend, slips
// under the threshold, and gets smoothed with tangents scaled by the 40-90 mm
// edges either side — swinging the curve up to a millimetre wide of the corner
// even though every node is in the right place. Measuring the turn over
// `cornerSpan` of accumulated path length instead makes the split corner read as
// the ~90 degrees it really is.
// --------------------------------------------------------------------------- //
const f = (n: number) => n.toFixed(2);

const CORNER_DEG = 60;

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Per-point centripetal Catmull-Rom tangents. `out[i]` is used by the segment
 *  leaving point i, `in[i]` by the one arriving at it; they differ only where a
 *  corner was detected (and at the ends of an open path).
 *
 *  @param cornerSpan path length over which the turn angle is measured, in the
 *         same units as the points. Should be a few times the point quantisation
 *         (pixel size / simplify tolerance) so a staircase-split corner is seen
 *         whole. Tangent *magnitudes* still come from the immediate neighbours;
 *         only the corner decision uses the window. */
function crTangents(
  pts: Pt[], closed: boolean, cornerSpan: number, forceCorner?: (p: Pt) => boolean,
): { knot: number[]; in: Pt[]; out: Pt[] } {
  const n = pts.length;
  const knot: number[] = new Array(n).fill(0);
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    knot[i] = Math.max(Math.sqrt(dist(a, b)), 1e-6);
  }
  // Chord difference divided by its knot spacing = one-sided derivative.
  const dOut = (i: number): Pt => {
    const a = pts[i], b = pts[(i + 1) % n], k = knot[i];
    return [(b[0] - a[0]) / k, (b[1] - a[1]) / k];
  };
  const dIn = (i: number): Pt => {
    const j = (i - 1 + n) % n, a = pts[j], b = pts[i], k = knot[j];
    return [(b[0] - a[0]) / k, (b[1] - a[1]) / k];
  };

  /** Unit direction arriving at / leaving i, measured back or forward over at
   *  least `cornerSpan` of path (or as far as the path allows). */
  const spanDir = (i: number, forward: boolean): Pt => {
    let acc = 0, j = i;
    for (let steps = 0; steps < n - 1; steps++) {
      const next = forward ? (j + 1) % n : (j - 1 + n) % n;
      if (!closed && (forward ? j === n - 1 : j === 0)) break;
      acc += dist(pts[j], pts[next]);
      j = next;
      if (acc >= cornerSpan) break;
    }
    const from = forward ? pts[i] : pts[j];
    const to = forward ? pts[j] : pts[i];
    const L = dist(from, to) || 1e-9;
    return [(to[0] - from[0]) / L, (to[1] - from[1]) / L];
  };

  const cosLimit = Math.cos((CORNER_DEG * Math.PI) / 180);
  const tIn: Pt[] = new Array(n);
  const tOut: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const hasIn = closed || i > 0;
    const hasOut = closed || i < n - 1;
    if (!hasIn && !hasOut) { tIn[i] = tOut[i] = [0, 0]; continue; }
    if (!hasIn) { tIn[i] = tOut[i] = dOut(i); continue; }
    if (!hasOut) { tIn[i] = tOut[i] = dIn(i); continue; }
    const a = dIn(i), b = dOut(i);
    // A vertex the caller declares a corner (e.g. one the clipper created) is a
    // corner regardless of how gentle the turn looks.
    if (forceCorner?.(pts[i])) {
      tIn[i] = a; tOut[i] = b;
      continue;
    }
    const back = spanDir(i, false), fwd = spanDir(i, true);
    if (back[0] * fwd[0] + back[1] * fwd[1] < cosLimit) {
      tIn[i] = a; tOut[i] = b;            // sharp corner: no smoothing across it
      continue;
    }
    const ki = knot[prev], ko = knot[i], s = ki + ko;
    const m: Pt = [(a[0] * ko + b[0] * ki) / s, (a[1] * ko + b[1] * ki) / s];
    tIn[i] = m; tOut[i] = m;
  }
  return { knot, in: tIn, out: tOut };
}

function bezierPath(
  points: Pt[], closed: boolean, cornerSpan: number, forceCorner?: (p: Pt) => boolean,
): string {
  const n = points.length;
  const { knot, in: tIn, out: tOut } = crTangents(points, closed, cornerSpan, forceCorner);
  const d = [`M ${f(points[0][0])},${f(points[0][1])}`];
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const j = (i + 1) % n;
    const p1 = points[i], p2 = points[j], k = knot[i] / 3;
    const c1x = p1[0] + tOut[i][0] * k, c1y = p1[1] + tOut[i][1] * k;
    const c2x = p2[0] - tIn[j][0] * k, c2y = p2[1] - tIn[j][1] * k;
    d.push(`C ${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p2[0])},${f(p2[1])}`);
  }
  if (closed) d.push("Z");
  return d.join(" ");
}

/**
 * Corner-detection window, as a multiple of the point quantisation.
 *
 * It has to clear the whole corner, not just a single staircase step. A printed
 * corner comes back from blur + threshold + thinning as a chamfer several pixels
 * across, so the turn is spread over one short chord that can be half a
 * millimetre long; a window that ends inside that chord measures the same angle
 * as the immediate neighbours and learns nothing. Eight steps spans it.
 *
 * Enlarging it is safe for genuine curves: the window only ever reaches past a
 * node whose adjacent chord is shorter than the window, and on a smooth arc
 * sampled that finely the turn across it stays far below CORNER_DEG. Because the
 * unit is the quantisation, this scales with resolution automatically.
 */
const CORNER_SPAN_STEPS = 8;

function bezierClosed(points: Pt[], quantum: number, forceCorner?: (p: Pt) => boolean): string {
  if (points.length < 3) return "";
  return bezierPath(points, true, quantum * CORNER_SPAN_STEPS, forceCorner);
}

function bezierOpen(points: Pt[], quantum: number, forceCorner?: (p: Pt) => boolean): string {
  const n = points.length;
  if (n < 2) return "";
  if (n === 2) return `M ${f(points[0][0])},${f(points[0][1])} L ${f(points[1][0])},${f(points[1][1])}`;
  return bezierPath(points, false, quantum * CORNER_SPAN_STEPS, forceCorner);
}

const isClosed = (poly: Pt[]) =>
  Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) < 1.5;

// --------------------------------------------------------------------------- //
// CNC (mm) export: transform the pixel-space vector paths through the detected
// pixel->mm homography, drop the frame origin so coordinates are relative to the
// opening's top-left, clip to the view, and emit a true-millimetre SVG
// (width/height in mm, viewBox 1:1). This is the shareable CNC file at real size.
// --------------------------------------------------------------------------- //
type Mat3 = number[][];

function pxToMm(H: Mat3, p: Pt, ox: number, oy: number): Pt {
  const x = p[0], y = p[1];
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w - ox, (H[1][0] * x + H[1][1] * y + H[1][2]) / w - oy];
}

/** Millimetres per source pixel, from the pixel->mm transform. A simplify
 *  tolerance finer than this is pointless: it cannot remove the single-pixel
 *  staircase marching squares leaves along a straight edge, so it keeps every
 *  step as its own node. Callers floor their tolerance here. */
function mmPerPx(H: Mat3): number {
  const o = pxToMm(H, [0, 0], 0, 0);
  const x = pxToMm(H, [1, 0], 0, 0);
  const y = pxToMm(H, [0, 1], 0, 0);
  return Math.max(Math.hypot(x[0] - o[0], x[1] - o[1]), Math.hypot(y[0] - o[0], y[1] - o[1]));
}

const isClosedMm = (poly: Pt[]) =>
  poly.length > 2 &&
  Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) < 0.4;

/** Sutherland-Hodgman clip of a closed polygon to the rectangle [0,W]x[0,H]. */
function clipClosed(poly: Pt[], W: number, H: number): Pt[] {
  const ix = (a: Pt, b: Pt, X: number): Pt => {
    const t = (X - a[0]) / ((b[0] - a[0]) || 1e-9);
    return [X, a[1] + t * (b[1] - a[1])];
  };
  const iy = (a: Pt, b: Pt, Y: number): Pt => {
    const t = (Y - a[1]) / ((b[1] - a[1]) || 1e-9);
    return [a[0] + t * (b[0] - a[0]), Y];
  };
  const clip = (pts: Pt[], inside: (p: Pt) => boolean, isect: (a: Pt, b: Pt) => Pt): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
      const ina = inside(a), inb = inside(b);
      if (inb) { if (!ina) out.push(isect(a, b)); out.push(b); }
      else if (ina) out.push(isect(a, b));
    }
    return out;
  };
  let p = poly;
  p = clip(p, (q) => q[0] >= 0, (a, b) => ix(a, b, 0));
  p = clip(p, (q) => q[0] <= W, (a, b) => ix(a, b, W));
  p = clip(p, (q) => q[1] >= 0, (a, b) => iy(a, b, 0));
  p = clip(p, (q) => q[1] <= H, (a, b) => iy(a, b, H));
  return p;
}

/** Liang-Barsky clip of an open polyline to [0,W]x[0,H] -> inside runs. */
function clipOpen(poly: Pt[], W: number, H: number): Pt[][] {
  const runs: Pt[][] = [];
  let cur: Pt[] = [];
  const clipSeg = (a: Pt, b: Pt): [Pt, Pt] | null => {
    let t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const test = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
      return true;
    };
    if (test(-dx, a[0]) && test(dx, W - a[0]) && test(-dy, a[1]) && test(dy, H - a[1]))
      return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
    return null;
  };
  for (let i = 0; i < poly.length - 1; i++) {
    const seg = clipSeg(poly[i], poly[i + 1]);
    if (!seg) { if (cur.length) { runs.push(cur); cur = []; } continue; }
    const [s, e] = seg;
    if (cur.length === 0) cur.push(s, e);
    else if (Math.hypot(cur[cur.length - 1][0] - s[0], cur[cur.length - 1][1] - s[1]) < 1e-6) cur.push(e);
    else { runs.push(cur); cur = [s, e]; }
    if (Math.hypot(e[0] - poly[i + 1][0], e[1] - poly[i + 1][1]) > 1e-6) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function svgDocMm(wmm: number, hmm: number, body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(wmm)}mm" height="${f(hmm)}mm" ` +
    `viewBox="0 0 ${f(wmm)} ${f(hmm)}">\n${body}\n</svg>\n`
  );
}

/** Length of a polyline (adding the closing leg when `closed`). */
function polyLenMm(p: Pt[], closed = false): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += dist(p[i - 1], p[i]);
  if (closed && p.length > 2) L += dist(p[p.length - 1], p[0]);
  return L;
}

/** Largest side of a polyline's bounding box (mm). */
function polySpanMm(p: Pt[]): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return Math.max(x1 - x0, y1 - y0);
}

/**
 * Is this closed path too small to be a deliberate mark?
 *
 * Perimeter alone is a poor test: a speck of dust traces a wiggly little ring
 * whose perimeter adds up past a couple of millimetres while the whole thing
 * spans barely one. Those rings are also where the last self-intersections live,
 * since a 1 mm loop of 4 curves crosses itself easily. Judge them on how much
 * ground they actually cover.
 */
function isSpeck(p: Pt[], minSpanMm: number, minLenMm: number): boolean {
  return polySpanMm(p) < minSpanMm || polyLenMm(p, true) < minLenMm;
}

/**
 * Join open runs whose ends nearly touch, then close the ones that come back to
 * their own start.
 *
 * A single pixel of slack is enough to break a traced curve in two: the skeleton
 * tracer keys endpoints on rounded integer pixels, so ends one pixel apart never
 * match and a complete circle is emitted as two open arcs. CAM tools generally
 * cannot offset an open path as an inside/outside cut, so this matters beyond
 * tidiness.
 */
function stitchRuns(runs: Pt[][], tol: number): { pts: Pt[]; closed: boolean }[] {
  const rev = (p: Pt[]) => p.slice().reverse();
  /** Concatenate, dropping B's leading points that sit on top of A's tail. Two
   *  arcs of the same curve overlap slightly at the break, so a naive join makes
   *  the path double back over a fraction of a millimetre — which a CAM tool
   *  reads as a self-intersection. */
  const join = (A: Pt[], B: Pt[]): Pt[] => {
    let k = 0;
    while (k < B.length - 1 && dist(A[A.length - 1], B[k]) <= tol) k++;
    return A.concat(B.slice(k));
  };

  const open = runs.filter((r) => r.length >= 2).map((r) => r.slice());
  let joined = true;
  while (joined) {
    joined = false;
    search:
    for (let i = 0; i < open.length; i++) {
      for (let j = i + 1; j < open.length; j++) {
        const A = open[i], B = open[j];
        // The four ways two runs can meet, as (gap, first, second).
        const cands: [number, Pt[], Pt[]][] = [
          [dist(A[A.length - 1], B[0]), A, B],
          [dist(A[A.length - 1], B[B.length - 1]), A, rev(B)],
          [dist(A[0], B[B.length - 1]), B, A],
          [dist(A[0], B[0]), rev(B), A],
        ];
        const best = cands.reduce((a, b) => (b[0] < a[0] ? b : a));
        if (best[0] > tol) continue;
        open[i] = join(best[1], best[2]);
        open.splice(j, 1);
        joined = true;
        break search;
      }
    }
  }

  return open.map((pts) => {
    // Trim the same overlap at the closing seam.
    let end = pts.length;
    while (end > 3 && dist(pts[0], pts[end - 1]) <= tol) end--;
    return end < pts.length ? { pts: pts.slice(0, end), closed: true } : { pts, closed: false };
  });
}

/**
 * Centerline strokes (open) in mm, for pen/engrave or single-line cuts.
 *
 * `rotateDeg` straightens a sheet that sat crooked in the frame; `zoom` crops to a
 * smaller window — a way to cut off noise picked up near the opening's edge — and
 * `panXMm`/`panYMm` slide that window around so the crop doesn't have to be
 * centred. All three are applied here, to the finished millimetre coordinates,
 * rather than by transforming the image before tracing: doing it to the raster
 * would re-run the resample, the illumination flatten and the whole mask pipeline
 * (iterative thinning included) on every nudge of a slider, and would re-derive
 * the trace, so the lines could shift as you adjusted them. Transforming
 * coordinates is exact, instant, and leaves the trace identical.
 *
 * Neither changes scale. Rotation is rigid, and zoom *crops* rather than
 * magnifying: the page shrinks to the visible window while the geometry keeps its
 * true millimetre size, so a 60 mm square still measures 60 mm at any zoom. What
 * falls outside the window is clipped, exactly like anything outside the opening.
 */
export interface StrokeGroup { pts: Pt[]; closed: boolean }

/**
 * Pixel-space skeleton -> mm-space stroke groups (closed loops + joined-up open
 * runs) — the same "one drawn line" units `buildCncStrokedSvg` traces, but *before*
 * rotate/zoom/pan are applied, so a group's index is stable across all three.
 *
 * That stability isn't incidental: stitching runs together only ever compares
 * Euclidean distances between endpoints, and rotation + translation both preserve
 * distances exactly, so which runs join to which is identical whichever order you
 * apply them in. (Zoom never touches these coordinates at all — it only changes the
 * clip window later.) That means a caller can trace once per (image, params) —
 * exactly the lifecycle the raster preview already has — and re-derive the view for
 * any rotate/zoom/pan from the cached groups with `renderStrokeGroups`, with no
 * retrace and no risk of a group's identity drifting out from under it. An
 * interactive line editor needs exactly that: "exclude group 5" has to keep meaning
 * the same drawn line no matter how the view is nudged afterward.
 */
export function traceStrokeGroups(
  skeleton: Uint8Array, w: number, h: number, H: Mat3, ox: number, oy: number,
): { groups: StrokeGroup[]; mmPerPx: number } {
  const polylines = chainStrokes(mergePolylines(traceSkeleton(skeleton, w, h), 12, 12, 16));
  const px = mmPerPx(H);
  // A few pixels of slack: enough to bridge the one-pixel breaks the tracer
  // leaves, far below any real gap in a drawing.
  const stitchTol = Math.max(3 * px, 0.25);

  // Split into already-closed loops and open runs; only the open ones need
  // stitching back together.
  const loops: StrokeGroup[] = [];
  const runs: Pt[][] = [];
  for (const pl of polylines) {
    const mm = pl.map((p) => pxToMm(H, p, ox, oy));
    if (isClosedMm(mm)) loops.push({ pts: mm.slice(0, -1), closed: true });
    else runs.push(mm);
  }

  return { groups: [...loops, ...stitchRuns(runs, stitchTol)], mmPerPx: px };
}

/**
 * Render view-independent stroke groups (from `traceStrokeGroups`) into the current
 * view: straighten, crop to a 1/zoom window, pan, clip to it, simplify and smooth.
 * One entry per input group, at the same index, holding the 0+ finished path `d`
 * strings that group produced there — usually one, occasionally more if clipping
 * split it, none if it fell entirely outside the window. Keeping the per-group
 * breakdown (rather than one flattened list) is what lets a caller line up "this
 * path is part of group i" for highlighting/exclusion; export just flattens it.
 *
 * `rotateDeg` straightens a sheet that sat crooked in the frame; `zoom` crops to a
 * smaller window — a way to cut off noise picked up near the opening's edge — and
 * `panXMm`/`panYMm` slide that window around so the crop doesn't have to be
 * centred. All three are applied here, to the finished millimetre coordinates,
 * rather than by transforming the image before tracing: doing it to the raster
 * would re-run the resample, the illumination flatten and the whole mask pipeline
 * (iterative thinning included) on every nudge of a slider, and would re-derive
 * the trace, so the lines could shift as you adjusted them. Transforming
 * coordinates is exact, instant, and leaves the trace identical — cheap enough to
 * run on every slider tick without a worker round-trip.
 *
 * Neither changes scale. Rotation is rigid, and zoom *crops* rather than
 * magnifying: the page shrinks to the visible window while the geometry keeps its
 * true millimetre size, so a 60 mm square still measures 60 mm at any zoom. What
 * falls outside the window is clipped, exactly like anything outside the opening.
 */
export function renderStrokeGroups(
  groups: StrokeGroup[], mmPerPxHint: number, openW: number, openH: number,
  simplifyMm = 0.1, minLenMm = 2, minSpanMm = 1.5,
  rotateDeg = 0, zoom = 1, panXMm = 0, panYMm = 0,
): { strokes: string[][]; viewW: number; viewH: number } {
  const tol = Math.max(simplifyMm, mmPerPxHint);

  // Straightening turns about the centre of the opening; zoom keeps a 1/zoom
  // window, and the pan offset says where that window sits. The exported page is
  // the window, not the opening.
  //
  // Pan is applied *after* the rotation, i.e. in the window's own frame, so that
  // dragging matches what the eye expects: content follows the finger across the
  // screen no matter how far the drawing has been turned.
  const z = Math.max(1, zoom);
  const viewW = openW / z, viewH = openH / z;
  const cx = openW / 2, cy = openH / 2;
  const offX = cx + panXMm - viewW / 2, offY = cy + panYMm - viewH / 2;
  const rot = (rotateDeg * Math.PI) / 180;
  const rc = Math.cos(rot), rs = Math.sin(rot);
  const toView = (p: Pt): Pt => {
    let x = p[0], y = p[1];
    if (rotateDeg !== 0) {
      const dx = x - cx, dy = y - cy;
      x = cx + dx * rc - dy * rs;
      y = cy + dx * rs + dy * rc;
    }
    return [x - offX, y - offY];
  };

  // Clipping to the window introduces vertices that lie exactly on its edge. They
  // are cut corners, not part of the drawn curve, and smoothing through them bows
  // the path outward — several millimetres past the edge once straightening pushes
  // a lot of geometry into the boundary. Keep them sharp.
  const EDGE_EPS = 0.02;
  const onWindowEdge = (p: Pt) =>
    p[0] <= EDGE_EPS || p[0] >= viewW - EDGE_EPS ||
    p[1] <= EDGE_EPS || p[1] >= viewH - EDGE_EPS;

  const strokes: string[][] = groups.map(() => []);
  groups.forEach((g, i) => {
    const pts = g.pts.map(toView);
    if (g.closed) {
      let p = clipClosed(pts, viewW, viewH);
      if (p.length < 3) return;
      p = rdpClosed(p, tol);
      if (p.length < 3 || isSpeck(p, minSpanMm, minLenMm)) return;
      strokes[i].push(bezierClosed(p, tol, onWindowEdge));
    } else {
      for (let seg of clipOpen(pts, viewW, viewH)) {
        seg = rdp(seg, tol);
        if (seg.length < 2 || polyLenMm(seg) < minLenMm) continue;
        strokes[i].push(bezierOpen(seg, tol, onWindowEdge));
      }
    }
  });
  return { strokes, viewW, viewH };
}

/** Flatten a (typically already-filtered) per-group stroke list into one SVG doc. */
export function strokesToSvg(
  viewW: number, viewH: number, strokes: string[][], strokeMm = 0.3,
): string {
  return svgDocMm(viewW, viewH,
    `  <path fill="none" stroke="#000000" stroke-width="${strokeMm}" ` +
    `stroke-linecap="round" stroke-linejoin="round" d="${strokes.flat().join(" ")}"/>`);
}

/**
 * Centerline strokes (open) in mm, for pen/engrave or single-line cuts.
 *
 * Convenience wrapper composing `traceStrokeGroups` + `renderStrokeGroups` +
 * `strokesToSvg` for the common one-shot case (a plain export with nothing
 * excluded). An interactive caller that needs per-group identity — a line editor,
 * or anything re-deriving the view live as rotate/zoom/pan change — should call
 * those three directly instead; see their docs for why the split exists.
 */
export function buildCncStrokedSvg(
  skeleton: Uint8Array, w: number, h: number,
  H: Mat3, ox: number, oy: number, openW: number, openH: number,
  strokeMm = 0.3, simplifyMm = 0.1, minLenMm = 2, minSpanMm = 1.5,
  rotateDeg = 0, zoom = 1, panXMm = 0, panYMm = 0,
): string {
  const { groups, mmPerPx } = traceStrokeGroups(skeleton, w, h, H, ox, oy);
  const { strokes, viewW, viewH } = renderStrokeGroups(
    groups, mmPerPx, openW, openH, simplifyMm, minLenMm, minSpanMm,
    rotateDeg, zoom, panXMm, panYMm,
  );
  return strokesToSvg(viewW, viewH, strokes, strokeMm);
}

/** Stitch the raw skeleton trace back into continuous strokes. The trace splits
 *  the drawing at every junction, and junction clusters leave a swarm of tiny
 *  stubs. We (1) stitch 2-way meetings into longer lines, (2) contract short
 *  bridges between junctions (collapsing each cluster to a point), and (3) drop
 *  short dangling spurs. */
function mergePolylines(lines: Pt[][], minSpur: number, minBridge: number, minLoop: number): Pt[][] {
  const snap = (p: Pt) => `${Math.round(p[0])},${Math.round(p[1])}`;
  let cur = lines.filter((l) => l.length >= 2);

  const buildEnds = () => {
    const ends = new Map<string, number[]>();
    cur.forEach((l, i) => {
      const a = snap(l[0]);
      const b = snap(l[l.length - 1]);
      (ends.get(a) ?? ends.set(a, []).get(a)!).push(i);
      (ends.get(b) ?? ends.set(b, []).get(b)!).push(i);
    });
    return ends;
  };
  const len = (l: Pt[]) => {
    let s = 0;
    for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    return s;
  };

  // (1) Stitch every clean 2-way meeting until none remain.
  const stitch = (): boolean => {
    let any = false;
    let changed = true;
    while (changed) {
      changed = false;
      const ends = buildEnds();
      const dead = new Set<number>();
      const touched = new Set<number>();
      for (const [k, idxs] of ends) {
        const alive = idxs.filter((i) => !dead.has(i));
        if (alive.length !== 2) continue;
        const [i, j] = alive;
        if (i === j || touched.has(i) || touched.has(j)) continue;
        const A = cur[i];
        const B = cur[j];
        const Aor = snap(A[A.length - 1]) === k ? A : A.slice().reverse();
        const Bor = snap(B[0]) === k ? B : B.slice().reverse();
        cur[i] = Aor.concat(Bor.slice(1));
        dead.add(j);
        touched.add(i);
        touched.add(j);
        changed = true;
        any = true;
      }
      if (dead.size) cur = cur.filter((_, i) => !dead.has(i));
    }
    return any;
  };

  // (2) Collapse one short junction-to-junction bridge by snapping its far end
  // onto its near end across all lines, then removing it.
  const contractOneBridge = (): boolean => {
    const ends = buildEnds();
    for (let i = 0; i < cur.length; i++) {
      const l = cur[i];
      if (isClosed(l) || len(l) >= minBridge) continue;
      const a = snap(l[0]);
      const b = snap(l[l.length - 1]);
      if (a === b) continue;
      if ((ends.get(a)?.length ?? 0) < 2 || (ends.get(b)?.length ?? 0) < 2) continue;
      const target = l[0];
      for (let m = 0; m < cur.length; m++) {
        if (m === i) continue;
        const L = cur[m];
        if (snap(L[0]) === b) L[0] = target.slice() as Pt;
        if (snap(L[L.length - 1]) === b) L[L.length - 1] = target.slice() as Pt;
      }
      cur.splice(i, 1);
      return true;
    }
    return false;
  };

  let go = true;
  while (go) {
    const s = stitch();
    const c = contractOneBridge();
    go = s || c;
  }

  // (3) Drop leftover noise: tiny closed loops, and short open lines with a
  // free (dangling) endpoint (spurs).
  const ends = buildEnds();
  return cur.filter((l) => {
    if (isClosed(l)) return len(l) >= minLoop;
    const free = (ends.get(snap(l[0]))?.length ?? 0) <= 1 || (ends.get(snap(l[l.length - 1]))?.length ?? 0) <= 1;
    return !free || len(l) >= minSpur;
  });
}

// Chain connected polylines into the longest continuous strokes to minimise the
// number of separate cuts (pen-ups / re-plunges) on a CNC/plotter. mergePolylines
// already stitches clean 2-way meetings; this also runs *through* 3+ way junctions,
// picking the straightest continuation, until no unused edge remains at the end.
function chainStrokes(lines: Pt[][]): Pt[][] {
  const key = (p: Pt) => `${Math.round(p[0])},${Math.round(p[1])}`;
  const edges = lines.filter((l) => l.length >= 2).map((l) => ({ pts: l, used: false }));
  const adj = new Map<string, number[]>();
  edges.forEach((e, i) => {
    for (const p of [e.pts[0], e.pts[e.pts.length - 1]]) {
      const k = key(p);
      (adj.get(k) ?? adj.set(k, []).get(k)!).push(i);
    }
  });
  const startsAt = (i: number, node: string) => key(edges[i].pts[0]) === node;
  const oriented = (i: number, node: string) =>
    startsAt(i, node) ? edges[i].pts : edges[i].pts.slice().reverse();
  const otherEnd = (i: number, node: string) =>
    startsAt(i, node) ? key(edges[i].pts[edges[i].pts.length - 1]) : key(edges[i].pts[0]);
  const unit = (a: Pt, b: Pt): Pt => { const dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; };

  const pickStart = (): { i: number; node: string } | null => {
    // Prefer a free endpoint (degree-1 node) so open strokes run end-to-end.
    for (const [k, idxs] of adj) {
      const live = idxs.filter((i) => !edges[i].used);
      if (live.length === 1) return { i: live[0], node: k };
    }
    for (let i = 0; i < edges.length; i++) if (!edges[i].used) return { i, node: key(edges[i].pts[0]) };
    return null;
  };

  const out: Pt[][] = [];
  let s: { i: number; node: string } | null;
  while ((s = pickStart())) {
    let chain = oriented(s.i, s.node).slice();
    edges[s.i].used = true;
    let cur = otherEnd(s.i, s.node);
    while (true) {
      const cand = (adj.get(cur) ?? []).filter((j) => !edges[j].used);
      if (cand.length === 0) break;
      const into = unit(chain[chain.length - 2], chain[chain.length - 1]);
      let best = cand[0], bestDot = -Infinity;
      for (const j of cand) {
        const seg = oriented(j, cur);
        const outDir = unit(seg[0], seg[1]);
        const dot = into[0] * outDir[0] + into[1] * outDir[1]; // straightest continuation
        if (dot > bestDot) { bestDot = dot; best = j; }
      }
      chain = chain.concat(oriented(best, cur).slice(1));
      edges[best].used = true;
      cur = otherEnd(best, cur);
    }
    out.push(chain);
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Skeleton graph tracing -> centerline polylines.
// --------------------------------------------------------------------------- //
function traceSkeleton(skel: Uint8Array, w: number, h: number): Pt[][] {
  const idxN = (x: number, y: number) => y * w + x;
  const neighbors = (p: number): number[] => {
    const x = p % w;
    const y = (p / w) | 0;
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const q = idxN(nx, ny);
        if (skel[q]) out.push(q);
      }
    }
    return out;
  };

  // Classify pixels by *connectivity number* — the count of distinct
  // 8-connected neighbour groups around the ring: 1 = endpoint, 2 = through
  // pixel, >=3 = real junction. This is robust to thick / staircase skeleton
  // pixels that have extra raw neighbours but still lie along a single line;
  // using the raw neighbour count instead mis-flags those as junctions and
  // shatters every line into thousands of 2px fragments.
  const ring = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
  const isNode = new Uint8Array(w * h);
  const pixels: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (!skel[p]) continue;
    pixels.push(p);
    const x = p % w;
    const y = (p / w) | 0;
    let groups = 0;
    for (let i = 0; i < 8; i++) {
      const [dx, dy] = ring[i];
      const [px, py] = ring[(i + 7) % 8];
      const cx = x + dx, cy = y + dy;
      const ox = x + px, oy = y + py;
      const cOn = cx >= 0 && cx < w && cy >= 0 && cy < h && skel[cy * w + cx];
      const oOn = ox >= 0 && ox < w && oy >= 0 && oy < h && skel[oy * w + ox];
      if (cOn && !oOn) groups++;
    }
    if (groups !== 2) isNode[p] = 1;
  }

  const pt = (p: number): Pt => [(p % w) + 0.5, ((p / w) | 0) + 0.5];
  const edgeUsed = new Set<string>();
  const ekey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const adjacent = (a: number, b: number) =>
    Math.abs((a % w) - (b % w)) <= 1 && Math.abs(((a / w) | 0) - ((b / w) | 0)) <= 1;
  const polylines: Pt[][] = [];

  // Walk from `start` toward `first`, continuing through through-pixels until a
  // node (endpoint/junction) or a dead end.
  const walk = (start: number, first: number): number[] => {
    const path = [start];
    let prev = start;
    let cur = first;
    while (true) {
      path.push(cur);
      edgeUsed.add(ekey(prev, cur));
      if (isNode[cur]) break;
      const cand = neighbors(cur).filter((q) => q !== prev && !edgeUsed.has(ekey(cur, q)));
      if (cand.length === 0) break;
      // Prefer a neighbour not touching `prev` (forward along the line) over a
      // parallel thickness pixel, to avoid zig-zagging.
      const next = cand.find((q) => !adjacent(q, prev)) ?? cand[0];
      prev = cur;
      cur = next;
    }
    return path;
  };

  // 1. Chains between nodes (endpoints / junctions).
  for (const p of pixels) {
    if (!isNode[p]) continue;
    for (const nb of neighbors(p)) {
      if (edgeUsed.has(ekey(p, nb))) continue;
      polylines.push(walk(p, nb).map(pt));
    }
  }

  // 2. Pure loops (no nodes, e.g. an isolated ring).
  for (const p of pixels) {
    if (isNode[p]) continue;
    const nb = neighbors(p).filter((q) => !edgeUsed.has(ekey(p, q)));
    if (nb.length === 0) continue;
    const path = walk(p, nb[0]).map(pt);
    if (path.length >= 3) polylines.push(path);
  }

  return polylines;
}

// --------------------------------------------------------------------------- //
// Area mode: contour outlines of filled black regions.
// --------------------------------------------------------------------------- //

/**
 * Contour polylines (pixel coords) -> mm-space stroke groups, all closed.
 *
 * The contours come from `traceContours` in contour.ts — one closed polyline per
 * foreground region boundary. This converts them to millimetre coordinates using
 * the same homography the centerline path uses, so `renderStrokeGroups` can
 * handle them identically from here on (simplify, smooth, clip, rotate/zoom/pan).
 */
export function traceAreaGroups(
  contours: Pt[][], _w: number, _h: number, H: Mat3, ox: number, oy: number,
): { groups: StrokeGroup[]; mmPerPx: number } {
  const px = mmPerPx(H);
  const groups: StrokeGroup[] = [];

  for (const contour of contours) {
    if (contour.length < 3) continue;
    const mm = contour.map((p) => pxToMm(H, p, ox, oy));
    groups.push({ pts: mm, closed: true });
  }

  return { groups, mmPerPx: px };
}
