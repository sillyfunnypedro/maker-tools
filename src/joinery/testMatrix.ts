// A representative matrix of finger-joint parameter combinations, used by
// fingerJointFixtures.test.ts and the in-app Test Fixtures viewer. Unlike the
// line/area fixtures, finger joints are pure parametric geometry — no noisy
// photo stands in for anything — so the "fixture" here is just a curated set
// of real-world parameter combinations (every bit size and relief style the
// UI offers, insert mode, mismatched board thicknesses, and both ends of the
// finger-count range) rather than an image file.
import type { FingerJointParams } from "./fingerJoint";

export interface MatrixEntry {
  label: string;
  params: FingerJointParams;
}

const BIT_EIGHTH = 3.175;   // 1/8"
const BIT_3_16 = 4.7625;    // 3/16"
const BIT_QUARTER = 6.35;   // 1/4" — the UI's default

const base: FingerJointParams = {
  width: 150, thicknessA: 12, thicknessB: 12, fingerCount: 7, bitDiameter: BIT_QUARTER,
};

export const FIXTURE_MATRIX: MatrixEntry[] = [
  { label: "default (1/4\" bit, long relief)", params: { ...base } },
  { label: "1/8\" bit", params: { ...base, bitDiameter: BIT_EIGHTH } },
  { label: "3/16\" bit", params: { ...base, bitDiameter: BIT_3_16 } },
  { label: "short-side relief", params: { ...base, reliefStyle: "short" } },
  { label: "diagonal relief", params: { ...base, reliefStyle: "diagonal" } },
  { label: "1/8\" bit + diagonal relief", params: { ...base, bitDiameter: BIT_EIGHTH, reliefStyle: "diagonal" } },
  { label: "insert mode", params: { ...base, insertB: true } },
  { label: "insert mode, 1/8\" bit + diagonal", params: { ...base, bitDiameter: BIT_EIGHTH, reliefStyle: "diagonal", insertB: true } },
  { label: "asymmetric thickness (8mm / 18mm)", params: { ...base, thicknessA: 8, thicknessB: 18 } },
  { label: "minimum fingers (3)", params: { ...base, fingerCount: 3 } },
  // Both of these sit close to the narrowest finger width their bit allows
  // (fingerWidth just above 4x the relief radius) — the hardest case for
  // relief.ts's "does the relief budget fit on this edge" check.
  { label: "many fingers near the 1/4\" bit's limit (11)", params: { ...base, fingerCount: 11 } },
  { label: "many fingers near the 1/8\" bit's limit (23)", params: { ...base, bitDiameter: BIT_EIGHTH, fingerCount: 23 } },
];
