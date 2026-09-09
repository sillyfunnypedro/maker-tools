// Runs the finger-joint parameter matrix (testMatrix.ts) through the real
// generator and checks the resulting toolpaths are geometrically sound.
//
// Unlike the line/area fixtures, there's no photo noise involved here — finger
// joints are pure parametric geometry, so "hardening the test harness" means
// sweeping the real combinations the UI offers (every bit size and relief
// style, insert mode, mismatched board thickness, both ends of the finger-
// count range) rather than generating synthetic images. What existing tests
// in fingerJoint.test.ts never checked: whether the *actual toolpath*, after
// relief rounding, comes out as a simple closed curve — a self-intersecting
// path is a real defect (the router would gouge material it shouldn't).
import { describe, expect, it } from "vitest";
import { generateFingerJoint } from "./fingerJoint";
import { flattenContour, type Contour } from "./geom";
import { pointsSelfCrossings, type Pt } from "../testUtils/svgGeometry";
import { FIXTURE_MATRIX } from "./testMatrix";

function flat(c: Contour): Pt[] {
  return flattenContour(c).map((v) => [v.x, v.y] as Pt);
}

describe("finger joint fixture matrix", () => {
  for (const { label, params } of FIXTURE_MATRIX) {
    it(`${label}: both boards' toolpaths are simple closed curves`, () => {
      const r = generateFingerJoint(params);
      const flatA = flat(r.notchesA[0]);
      const flatB = flat(r.notchesB[0]);
      expect(pointsSelfCrossings(flatA), `${label}, board A`).toBe(0);
      expect(pointsSelfCrossings(flatB), `${label}, board B`).toBe(0);
    });

    it(`${label}: notch depth matches the mating board's thickness`, () => {
      const r = generateFingerJoint(params);
      const maxYA = Math.max(...flat(r.notchesA[0]).map(([, y]) => y));
      const maxYB = Math.max(...flat(r.notchesB[0]).map(([, y]) => y));
      expect(maxYA, `${label}, board A depth`).toBeCloseTo(params.thicknessB);
      expect(maxYB, `${label}, board B depth`).toBeCloseTo(params.thicknessA);
    });
  }
});

describe("finger joint 'too narrow' boundary, across bit sizes", () => {
  // Mirrors fingerJoint.test.ts's single boundary check (1/4" bit), but sweeps
  // every bit size the UI offers, at the exact finger count one step past
  // where each one stops fitting — confirming the boundary itself, not just
  // that some sufficiently-extreme count eventually throws.
  const width = 150;
  const cases: { bit: number; maxValidCount: number }[] = [
    { bit: 3.175, maxValidCount: 23 },  // 1/8": fingerWidth 6.52mm vs. min 6.45mm
    { bit: 4.7625, maxValidCount: 15 }, // 3/16": fingerWidth 10.0mm vs. min 9.68mm
    { bit: 6.35, maxValidCount: 11 },   // 1/4": fingerWidth 13.64mm vs. min 12.80mm
  ];

  for (const { bit, maxValidCount } of cases) {
    it(`${maxValidCount} fingers fits a ${bit}mm bit`, () => {
      expect(() =>
        generateFingerJoint({ width, thicknessA: 12, thicknessB: 12, fingerCount: maxValidCount, bitDiameter: bit }),
      ).not.toThrow();
    });
    it(`${maxValidCount + 2} fingers is one step too many for a ${bit}mm bit`, () => {
      expect(() =>
        generateFingerJoint({ width, thicknessA: 12, thicknessB: 12, fingerCount: maxValidCount + 2, bitDiameter: bit }),
      ).toThrow("too narrow");
    });
  }
});
