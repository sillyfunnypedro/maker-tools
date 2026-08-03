// Planar geometry: vectors, circular-arc contours, SVG path data.
//
// Y-up frame, millimetres. Winding convention: rings are traversed with
// material on the left (outlines CCW, cutouts CW).

export const EPS = 1e-9;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function vec(x: number, y: number): Vec2 { return { x, y }; }
export function vadd(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
export function vsub(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
export function vneg(a: Vec2): Vec2 { return { x: -a.x, y: -a.y }; }
export function vscale(a: Vec2, s: number): Vec2 { return { x: a.x * s, y: a.y * s }; }
export function vlen(a: Vec2): number { return Math.hypot(a.x, a.y); }
export function vunit(a: Vec2): Vec2 {
  const n = vlen(a);
  if (n < EPS) throw new Error("cannot normalise a zero-length vector");
  return { x: a.x / n, y: a.y / n };
}
export function vperp(a: Vec2): Vec2 { return { x: -a.y, y: a.x }; }
export function vdot(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
export function vcross(a: Vec2, b: Vec2): number { return a.x * b.y - a.y * b.x; }
export function vclose(a: Vec2, b: Vec2, tol = 1e-7): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
}

/** Sweep direction: CCW arc bows to the right of its chord. */
export function arcIsCcw(start: Vec2, end: Vec2, bulge: Vec2): boolean {
  const travel = vunit(vsub(end, start));
  return vcross(travel, bulge) < 0;
}

export interface Seg {
  readonly end: Vec2;
  readonly radius?: number;
  readonly ccw: boolean;
}

export function lineSeg(end: Vec2): Seg { return { end, ccw: true }; }
export function arcSeg(end: Vec2, radius: number, ccw: boolean): Seg { return { end, radius, ccw }; }

export interface Contour {
  readonly start: Vec2;
  readonly segs: readonly Seg[];
}

/** SVG path data for a contour. Coordinates in mm (y-up). */
export function pathData(c: Contour, scale = 1, places = 4): string {
  const n = (v: number) => formatNum(v * scale, places);
  const parts = [`M${n(c.start.x)},${n(c.start.y)}`];
  for (const seg of c.segs) {
    if (seg.radius == null) {
      parts.push(`L${n(seg.end.x)},${n(seg.end.y)}`);
    } else {
      const r = formatNum(seg.radius * scale, places);
      const sweep = seg.ccw ? 1 : 0;
      parts.push(`A${r},${r} 0 0,${sweep} ${n(seg.end.x)},${n(seg.end.y)}`);
    }
  }
  return parts.join(" ") + "z";
}

export function formatNum(value: number, places = 5): string {
  let text = value.toFixed(places);
  if (text.includes(".")) text = text.replace(/0+$/, "").replace(/\.$/, "");
  if (text === "-0" || text === "-") text = "0";
  return text;
}

/** Remove collinear and duplicate vertices from a closed ring. */
export function dedupeCollinear(points: Vec2[], tol = 1e-7): Vec2[] {
  const pts = points.filter((p, i) => !vclose(p, points[(i - 1 + points.length) % points.length], tol));
  if (pts.length < 3) return pts;
  const out: Vec2[] = [];
  const nn = pts.length;
  for (let i = 0; i < nn; i++) {
    const prev = pts[(i - 1 + nn) % nn];
    const cur = pts[i];
    const nxt = pts[(i + 1) % nn];
    const dIn = vsub(cur, prev);
    const dOut = vsub(nxt, cur);
    if (vlen(dIn) < tol || vlen(dOut) < tol) continue;
    if (Math.abs(vcross(vunit(dIn), vunit(dOut))) < tol && vdot(dIn, dOut) > 0) continue;
    out.push(cur);
  }
  return out;
}
