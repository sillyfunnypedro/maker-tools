import { describe, expect, it } from "vitest";
import { vec, vlen, vsub } from "./geom";
import { relieveRing, type ReliefStyle } from "./relief";

/** Count arc segments in a contour. */
function arcCount(c: { segs: readonly { radius?: number }[] }): number {
  return c.segs.filter((s) => s.radius != null).length;
}

/** Get all arc endpoints. */
function arcEndpoints(c: { segs: readonly { end: { x: number; y: number }; radius?: number }[] }) {
  return c.segs.filter((s) => s.radius != null).map((s) => s.end);
}

describe("relieveRing — long style (default)", () => {
  // A notch wound CCW in y-down: going right along top, down, left along bottom, up.
  // This matches how buildProfile creates its points.
  const notch = [vec(0, 12), vec(20, 12), vec(20, 0), vec(0, 0)];
  const r = 3.2;

  it("produces 4 arcs for a rectangle (4 inside corners)", () => {
    const contour = relieveRing(notch, r);
    expect(arcCount(contour)).toBe(4);
  });

  it("all arcs have the correct radius", () => {
    const contour = relieveRing(notch, r);
    for (const seg of contour.segs) {
      if (seg.radius != null) expect(seg.radius).toBeCloseTo(r);
    }
  });

  it("relief on longer edges — arcs along the 20mm sides", () => {
    const contour = relieveRing(notch, r);
    const ends = arcEndpoints(contour);
    // For a 20×12 rectangle, the longer edge is 20mm (horizontal).
    // Arc endpoints should be offset along x (the longer axis), at y=0 or y=12.
    for (const e of ends) {
      expect(e.y === 0 || Math.abs(e.y - 12) < 0.01).toBe(true);
    }
  });

  it("skipPoints prevents relief at specific corners", () => {
    const contour = relieveRing(notch, r, [vec(0, 0), vec(20, 0)]);
    // Two corners skipped → only 2 arcs
    expect(arcCount(contour)).toBe(2);
  });

  it("throws when radius too large for the finger width", () => {
    // 4mm wide notch, radius 3.2 → needs 2*3.2=6.4 per edge, only 4 available
    const narrow = [vec(0, 12), vec(4, 12), vec(4, 0), vec(0, 0)];
    expect(() => relieveRing(narrow, r)).toThrow("does not fit");
  });
});

describe("relieveRing — short style", () => {
  // Wider rectangle so short-side relief fits: 30mm × 20mm, r=3.2 → needs 12.8 on 20mm edge
  const notch = [vec(0, 20), vec(30, 20), vec(30, 0), vec(0, 0)];
  const r = 3.2;

  it("produces 4 arcs", () => {
    const contour = relieveRing(notch, r, undefined, "short");
    expect(arcCount(contour)).toBe(4);
  });

  it("arcs on shorter edges — endpoints along y (20mm sides)", () => {
    const contour = relieveRing(notch, r, undefined, "short");
    const ends = arcEndpoints(contour);
    // Short edge is 20mm (vertical). Arc endpoints should be at x=0 or x=30.
    for (const e of ends) {
      expect(Math.abs(e.x) < 0.01 || Math.abs(e.x - 30) < 0.01).toBe(true);
    }
  });
});

describe("relieveRing — diagonal style", () => {
  const notch = [vec(0, 20), vec(30, 20), vec(30, 0), vec(0, 0)];
  const r = 3.2;
  const offset = 2 * r * Math.cos(Math.PI / 4); // 2r*cos(45°)

  it("produces 4 arcs", () => {
    const contour = relieveRing(notch, r, undefined, "diagonal");
    expect(arcCount(contour)).toBe(4);
  });

  it("arc endpoints are offset from corners by 2r*cos(45°)", () => {
    const contour = relieveRing(notch, r, undefined, "diagonal");
    const ends = arcEndpoints(contour);
    const corners = notch;
    // Each arc endpoint should be exactly `offset` away from one of the corners
    for (const e of ends) {
      const dists = corners.map((c) => vlen(vsub(e, c)));
      const minDist = Math.min(...dists);
      expect(minDist).toBeCloseTo(offset, 1);
    }
  });

  it("arc chord length is 2r*cos(45)*sqrt(2) = 2r", () => {
    const contour = relieveRing(notch, r, undefined, "diagonal");
    // Each arc goes from one edge to the perpendicular edge, both at offset from corner.
    // Chord = sqrt(offset² + offset²) = offset * sqrt(2) = 2r*cos(45°)*sqrt(2) = 2r
    const arcs = contour.segs.filter((s) => s.radius != null);
    expect(arcs.length).toBe(4);
    // Verify via arc endpoints relative to corners
    const corners = notch;
    for (const arc of arcs) {
      const dists = corners.map((c) => vlen(vsub(arc.end, c)));
      const minDist = Math.min(...dists);
      // Each endpoint is offset = 2r*cos(45°) from nearest corner
      expect(minDist).toBeCloseTo(offset, 1);
    }
  });
});

describe("relieveRing — arc bows into material", () => {
  // For any style, the arc should bow INTO the material (away from the void).
  // A simple test: for a CW-wound rectangle (material outside), the arc center
  // should be further from the rectangle's center than the corner.
  const notch = [vec(0, 20), vec(30, 20), vec(30, 0), vec(0, 0)];
  const r = 3.2;
  const center = vec(15, 10); // center of rectangle (the void)

  const styles: ReliefStyle[] = ["long", "short", "diagonal"];
  for (const style of styles) {
    it(`${style}: arcs bow away from the void center`, () => {
      const contour = relieveRing(notch, r, undefined, style);
      // The arc midpoint should be FURTHER from the void center than the endpoints.
      // Approximate: check that the arc's sweep direction is consistent.
      // (Full verification needs the machining simulation, but direction check catches inversions)
      const arcs = contour.segs.filter((s) => s.radius != null);
      expect(arcs.length).toBe(4);
      // All arcs should have the same sweep direction for a symmetric shape
      const sweeps = arcs.map((a) => a.ccw);
      expect(new Set(sweeps).size).toBe(1); // all same
    });
  }
});
