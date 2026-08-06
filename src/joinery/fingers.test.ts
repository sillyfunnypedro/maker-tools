import { describe, expect, it } from "vitest";
import { oddCountForWidth, uniformSpans, complementSpans } from "./fingers";

describe("oddCountForWidth", () => {
  it("returns 1 for a length equal to target", () => {
    expect(oddCountForWidth(20, 20)).toBe(1);
  });

  it("returns an odd number", () => {
    const n = oddCountForWidth(100, 15);
    expect(n % 2).toBe(1);
  });

  it("picks the count closest to target width", () => {
    // 150mm / 7 = 21.4mm per finger, closest to 20mm target
    expect(oddCountForWidth(150, 20)).toBe(7);
  });

  it("returns 1 for very wide target", () => {
    expect(oddCountForWidth(50, 100)).toBe(1);
  });

  it("throws for non-positive length", () => {
    expect(() => oddCountForWidth(0, 10)).toThrow("positive");
    expect(() => oddCountForWidth(-5, 10)).toThrow("positive");
  });

  it("throws for non-positive target", () => {
    expect(() => oddCountForWidth(100, 0)).toThrow("positive");
  });
});

describe("uniformSpans", () => {
  it("returns spans at ends when atEnds=true", () => {
    const spans = uniformSpans(150, 3, true, 0);
    // 3 segments: positions 0, 1, 2. atEnds picks 0, 2.
    expect(spans).toHaveLength(2);
    expect(spans[0]).toEqual([0, 50]);
    expect(spans[1]).toEqual([100, 150]);
  });

  it("returns spans in middle when atEnds=false", () => {
    const spans = uniformSpans(150, 3, false, 0);
    // Picks position 1 only.
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual([50, 100]);
  });

  it("respects u0 offset", () => {
    const spans = uniformSpans(100, 3, true, 10);
    expect(spans[0][0]).toBeCloseTo(10);
    expect(spans[1][1]).toBeCloseTo(110);
  });

  it("throws for even count", () => {
    expect(() => uniformSpans(100, 4, true)).toThrow("odd");
  });

  it("single span (count=1, atEnds=true) covers full length", () => {
    const spans = uniformSpans(100, 1, true, 0);
    expect(spans).toEqual([[0, 100]]);
  });
});

describe("complementSpans", () => {
  it("fills gaps between spans", () => {
    const spans = complementSpans([[20, 40], [60, 80]], 0, 100);
    expect(spans).toEqual([[0, 20], [40, 60], [80, 100]]);
  });

  it("returns empty when spans cover full range", () => {
    const spans = complementSpans([[0, 50], [50, 100]], 0, 100);
    expect(spans).toEqual([]);
  });

  it("returns full range when no spans", () => {
    const spans = complementSpans([], 0, 100);
    expect(spans).toEqual([[0, 100]]);
  });

  it("handles unsorted input", () => {
    const spans = complementSpans([[60, 80], [20, 40]], 0, 100);
    expect(spans).toEqual([[0, 20], [40, 60], [80, 100]]);
  });
});
