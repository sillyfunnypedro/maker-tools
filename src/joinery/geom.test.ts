import { describe, expect, it } from "vitest";
import {
  vec, vadd, vsub, vneg, vscale, vlen, vunit, vperp, vdot, vcross, vclose,
  arcIsCcw, lineSeg, arcSeg, pathData, formatNum, dedupeCollinear,
} from "./geom";

describe("Vec2 operations", () => {
  it("vadd adds components", () => {
    expect(vadd(vec(1, 2), vec(3, 4))).toEqual(vec(4, 6));
  });

  it("vsub subtracts components", () => {
    expect(vsub(vec(5, 7), vec(2, 3))).toEqual(vec(3, 4));
  });

  it("vneg negates", () => {
    expect(vneg(vec(3, -4))).toEqual(vec(-3, 4));
  });

  it("vscale multiplies", () => {
    expect(vscale(vec(2, 3), 4)).toEqual(vec(8, 12));
  });

  it("vlen computes magnitude", () => {
    expect(vlen(vec(3, 4))).toBeCloseTo(5);
  });

  it("vunit normalizes", () => {
    const u = vunit(vec(3, 4));
    expect(vlen(u)).toBeCloseTo(1);
  });

  it("vunit throws on zero vector", () => {
    expect(() => vunit(vec(0, 0))).toThrow("zero-length");
  });

  it("vperp gives left-hand normal", () => {
    const p = vperp(vec(1, 0));
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
    const p2 = vperp(vec(0, 1));
    expect(p2.x).toBeCloseTo(-1);
    expect(p2.y).toBeCloseTo(0);
  });

  it("vdot computes dot product", () => {
    expect(vdot(vec(1, 2), vec(3, 4))).toBe(11);
  });

  it("vcross computes cross product", () => {
    expect(vcross(vec(1, 0), vec(0, 1))).toBe(1);
    expect(vcross(vec(0, 1), vec(1, 0))).toBe(-1);
  });

  it("vclose checks proximity", () => {
    expect(vclose(vec(1, 2), vec(1, 2))).toBe(true);
    expect(vclose(vec(1, 2), vec(1.00000001, 2))).toBe(true);
    expect(vclose(vec(1, 2), vec(2, 2))).toBe(false);
  });
});

describe("arcIsCcw", () => {
  it("returns true when bulge is to the right of chord", () => {
    // Chord goes right (0,0)→(2,0), bulge points down (0,-1) = right side
    expect(arcIsCcw(vec(0, 0), vec(2, 0), vec(0, -1))).toBe(true);
  });

  it("returns false when bulge is to the left of chord", () => {
    // Chord goes right, bulge points up = left side
    expect(arcIsCcw(vec(0, 0), vec(2, 0), vec(0, 1))).toBe(false);
  });
});

describe("pathData", () => {
  it("produces M, L, and z for a line-only contour", () => {
    const c = {
      start: vec(0, 0),
      segs: [lineSeg(vec(10, 0)), lineSeg(vec(10, 5)), lineSeg(vec(0, 0))],
    };
    const d = pathData(c);
    expect(d).toContain("M0,0");
    expect(d).toContain("L10,0");
    expect(d).toContain("L10,5");
    expect(d).toMatch(/z$/);
  });

  it("produces A commands for arcs", () => {
    const c = {
      start: vec(0, 0),
      segs: [arcSeg(vec(5, 5), 3, true), lineSeg(vec(0, 0))],
    };
    const d = pathData(c);
    expect(d).toContain("A3,3 0 0,1");
  });
});

describe("formatNum", () => {
  it("trims trailing zeros", () => {
    expect(formatNum(1.5, 4)).toBe("1.5");
    expect(formatNum(2.0, 4)).toBe("2");
  });

  it("handles -0", () => {
    expect(formatNum(-0, 4)).toBe("0");
  });
});

describe("dedupeCollinear", () => {
  it("removes collinear points", () => {
    const pts = [vec(0, 0), vec(5, 0), vec(10, 0), vec(10, 10), vec(0, 10)];
    const result = dedupeCollinear(pts);
    // (5,0) is collinear between (0,0) and (10,0) — should be removed
    expect(result).toHaveLength(4);
    expect(result).not.toContainEqual(vec(5, 0));
  });

  it("preserves corners", () => {
    const pts = [vec(0, 0), vec(10, 0), vec(10, 10), vec(0, 10)];
    expect(dedupeCollinear(pts)).toHaveLength(4);
  });

  it("removes duplicate adjacent points", () => {
    const pts = [vec(0, 0), vec(0, 0), vec(10, 0), vec(10, 10)];
    const result = dedupeCollinear(pts);
    expect(result.filter((p) => p.x === 0 && p.y === 0)).toHaveLength(1);
  });
});
