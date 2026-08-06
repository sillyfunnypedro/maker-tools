import { describe, expect, it } from "vitest";
import { generateFingerJoint } from "./fingerJoint";

describe("generateFingerJoint", () => {
  const base = { width: 150, thicknessA: 12, thicknessB: 12, fingerCount: 7, bitDiameter: 6.35 };

  it("produces one contour per board (normal mode)", () => {
    const r = generateFingerJoint(base);
    expect(r.notchesA).toHaveLength(1);
    expect(r.notchesB).toHaveLength(1);
  });

  it("notch counts are correct for 7 fingers", () => {
    const r = generateFingerJoint(base);
    // 7 fingers: A is male at ends (4 fingers at 0,2,4,6) → 3 notches (1,3,5)
    // B is female at ends → 4 notches (0,2,4,6)
    expect(r.notchCountA).toBe(3);
    expect(r.notchCountB).toBe(4);
  });

  it("notch counts for 3 fingers", () => {
    const r = generateFingerJoint({ ...base, fingerCount: 3 });
    expect(r.notchCountA).toBe(1);
    expect(r.notchCountB).toBe(2);
  });

  it("relief radius = bitDiameter/2 + clearance", () => {
    const r = generateFingerJoint(base);
    expect(r.reliefRadius).toBeCloseTo(6.35 / 2 + 0.0254, 3);
  });

  it("different thicknesses: A notches are thicknessB deep", () => {
    const r = generateFingerJoint({ ...base, thicknessA: 12, thicknessB: 18 });
    // Board A's contour should reach y=18 (thicknessB)
    const maxY = Math.max(...r.notchesA[0].segs.map((s) => s.end.y));
    expect(maxY).toBeCloseTo(18);
  });

  it("different thicknesses: B notches are thicknessA deep", () => {
    const r = generateFingerJoint({ ...base, thicknessA: 12, thicknessB: 18 });
    const maxY = Math.max(...r.notchesB[0].segs.map((s) => s.end.y));
    expect(maxY).toBeCloseTo(12);
  });

  it("throws for finger count too narrow for the bit", () => {
    expect(() => generateFingerJoint({ ...base, fingerCount: 31 })).toThrow("too narrow");
  });

  it("throws for even finger count", () => {
    expect(() => generateFingerJoint({ ...base, fingerCount: 4 })).toThrow("odd");
  });

  it("insert mode: profile extends at depth on both sides", () => {
    const r = generateFingerJoint({ ...base, fingerCount: 3, insertB: true });
    const contour = r.notchesA[0];
    // In insert mode, the left side extends to -EXT at y=thickness
    const leftAtDepth = contour.segs.some(
      (s) => s.end.x <= -25 && Math.abs(s.end.y - 12) < 0.1
    );
    expect(leftAtDepth).toBe(true);
    // Right side too
    const rightAtDepth = contour.segs.some(
      (s) => s.end.x >= 155 && Math.abs(s.end.y - 12) < 0.1
    );
    expect(rightAtDepth).toBe(true);
  });

  it("normal mode: Board B edges go straight across at depth", () => {
    const r = generateFingerJoint(base);
    const contour = r.notchesB[0];
    // B's edge notches: extension goes straight to thickness on both sides
    const rightAtDepth = contour.segs.some(
      (s) => s.end.x >= 155 && Math.abs(s.end.y - 12) < 0.1
    );
    expect(rightAtDepth).toBe(true);
  });

  it("SVG export contains path data", () => {
    const r = generateFingerJoint(base);
    expect(r.svgA).toContain("<path");
    expect(r.svgA).toContain('fill="rgb(0,0,0)"'); // exterior cut
    expect(r.svgB).toContain("<path");
  });

  it("SVG export contains anchor triangle", () => {
    const r = generateFingerJoint(base);
    expect(r.svgA).toContain("<polygon");
    expect(r.svgA).toContain('fill="red"');
  });

  it("relief style is passed through", () => {
    const rLong = generateFingerJoint({ ...base, reliefStyle: "long" });
    const rDiag = generateFingerJoint({ ...base, reliefStyle: "diagonal" });
    // Different styles produce different path data
    expect(rLong.svgA).not.toEqual(rDiag.svgA);
  });
});
