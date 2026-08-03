// Corner relief: semicircular reliefs at inside corners so a round cutter
// can produce sharp joints.
//
// Every inside corner gets a semicircular relief of exactly the cutter radius,
// placed with its diameter along the longer adjacent edge, one endpoint on the
// corner, bulging into the material.

import {
  type Vec2, type Seg, type Contour,
  vadd, vsub, vneg, vscale, vunit, vperp, vlen, vcross, vdot, vclose,
  arcIsCcw, lineSeg, arcSeg, dedupeCollinear, EPS,
} from "./geom";

type Side = "in" | "out";

interface CornerInfo {
  index: number;
  point: Vec2;
  dIn: Vec2;
  dOut: Vec2;
  lenIn: number;
  lenOut: number;
  turn: number; // positive = left (outside), negative = right (inside)
}

function classifyCorners(points: Vec2[]): CornerInfo[] {
  const n = points.length;
  const corners: CornerInfo[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const nxt = points[(i + 1) % n];
    const vIn = vsub(cur, prev);
    const vOut = vsub(nxt, cur);
    const dIn = vunit(vIn);
    const dOut = vunit(vOut);
    corners.push({
      index: i,
      point: cur,
      dIn, dOut,
      lenIn: vlen(vIn),
      lenOut: vlen(vOut),
      turn: Math.atan2(vcross(dIn, dOut), vdot(dIn, dOut)),
    });
  }
  return corners;
}

function reliefSide(c: CornerInfo): Side {
  return c.lenIn >= c.lenOut ? "in" : "out";
}

function reliefVectors(c: CornerInfo, side: Side): { along: Vec2; into: Vec2 } {
  if (side === "in") {
    return { along: vneg(c.dIn), into: vperp(c.dIn) };
  }
  return { along: c.dOut, into: vperp(c.dOut) };
}

/**
 * Turn a polygon ring into a Contour with relieved inside corners.
 * Points must be wound with material on the left (CCW outline, CW cutout).
 * `skipPoints` optionally lists points (by coordinate) that should NOT be
 * relieved even if they are inside corners (e.g. open edges).
 */
export function relieveRing(points: Vec2[], radius: number, skipPoints?: Vec2[]): Contour {
  if (radius <= 0) throw new Error("relief radius must be positive");
  const ring = dedupeCollinear(points);
  const corners = classifyCorners(ring);
  const n = ring.length;

  // Decide which edge carries the relief for each inside corner.
  const plan = new Map<number, Side>();
  for (const c of corners) {
    if (c.turn >= -EPS) continue; // outside corner or straight
    if (skipPoints?.some((sp) => vclose(sp, c.point))) continue; // open edge
    plan.set(c.index, reliefSide(c));
  }

  // Check budget: two reliefs on one edge must fit.
  for (let i = 0; i < n; i++) {
    const cur = corners[i];
    const nxt = corners[(i + 1) % n];
    let used = 0;
    if (plan.get(cur.index) === "out") used += 2 * radius;
    if (plan.get(nxt.index) === "in") used += 2 * radius;
    if (used > cur.lenOut + 1e-9) {
      throw new Error(
        `Relief does not fit: edge ${cur.lenOut.toFixed(3)}mm needs ${used.toFixed(3)}mm. ` +
        `Use a smaller bit or wider fingers (min finger width: ${(4 * radius).toFixed(2)}mm).`
      );
    }
  }

  const segs: Seg[] = [];
  for (let i = 0; i < n; i++) {
    const cur = corners[i];
    const nxt = corners[(i + 1) % n];
    let walkFrom: Vec2;

    // Leading relief: this corner chose "out" — relief on outgoing edge.
    if (plan.get(cur.index) === "out") {
      const { along, into } = reliefVectors(cur, "out");
      const far = vadd(cur.point, vscale(along, 2 * radius));
      segs.push(arcSeg(far, radius, arcIsCcw(cur.point, far, into)));
      walkFrom = far;
    } else {
      walkFrom = cur.point;
    }

    // Trailing relief: next corner chose "in" — relief on incoming edge (this one).
    if (plan.get(nxt.index) === "in") {
      const { along, into } = reliefVectors(nxt, "in");
      const near = vadd(nxt.point, vscale(along, 2 * radius));
      if (!vclose(near, walkFrom)) segs.push(lineSeg(near));
      segs.push(arcSeg(nxt.point, radius, arcIsCcw(near, nxt.point, into)));
    } else {
      if (!vclose(nxt.point, walkFrom)) segs.push(lineSeg(nxt.point));
    }
  }

  return { start: ring[0], segs };
}
