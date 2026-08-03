// Finger joint generator: produces two complementary sets of notch cutouts.
//
// Input: board width (mm), board thickness (mm), number of fingers (odd),
//        bit diameter (mm), clearance (mm, default 0.0254 = 1 thou).
//
// Output: two sets of closed notch profiles — one for each mating board.
// Each notch is a closed rectangle (finger-width × thickness) with semicircular
// corner relief at the inside corners (the bottom two), oriented with the
// notches opening downward (toward the board edge being cut).
//
// For Shaper: place along the board edge, set as interior cuts. The bit follows
// inside each closed notch path, producing the finger voids.

import { type Vec2, type Contour, vec, pathData, formatNum } from "./geom";
import { uniformSpans, complementSpans, type Span } from "./fingers";
import { relieveRing } from "./relief";

export interface FingerJointParams {
  /** Board width along the joint edge (mm). */
  width: number;
  /** Board thickness / material thickness (mm). */
  thickness: number;
  /** Number of fingers (must be odd). */
  fingerCount: number;
  /** Cutter bit diameter (mm). */
  bitDiameter: number;
  /** Extra clearance beyond bit radius (mm). Default: 0.0254 (1 thou). */
  clearance?: number;
}

export interface FingerJointResult {
  /** Notch cutouts for board A (voids between A's fingers). */
  notchesA: Contour[];
  /** Notch cutouts for board B (voids between B's fingers). */
  notchesB: Contour[];
  /** Relief radius used. */
  reliefRadius: number;
  /** SVG markup for board A's notches (all notches in one file). */
  svgA: string;
  /** SVG markup for board B's notches (all notches in one file). */
  svgB: string;
  /** Combined SVG with both sets side by side. */
  svgBoth: string;
}

/**
 * Generate two complementary sets of finger-joint notch cutouts.
 *
 * Board A has fingers (material) at both ends — its notches are the gaps.
 * Board B is the complement.
 * Notches open downward (fingers point down from the board edge).
 */
export function generateFingerJoint(params: FingerJointParams): FingerJointResult {
  const { width, thickness, fingerCount, bitDiameter, clearance = 0.0254 } = params;

  if (width <= 0) throw new Error("width must be positive");
  if (thickness <= 0) throw new Error("thickness must be positive");
  if (fingerCount < 1 || fingerCount % 2 === 0) throw new Error("finger count must be odd and >= 1");
  if (bitDiameter <= 0) throw new Error("bit diameter must be positive");

  const reliefRadius = bitDiameter / 2 + clearance;
  const minFinger = 4 * reliefRadius;
  const fingerWidth = width / fingerCount;
  if (fingerWidth < minFinger) {
    throw new Error(
      `Finger width ${fingerWidth.toFixed(2)}mm is too narrow for a ${bitDiameter}mm bit. ` +
      `Minimum is ${minFinger.toFixed(2)}mm. Use fewer fingers or a smaller bit.`
    );
  }

  // Board A: male at ends (fingers at positions 0,2,4,...) — notches are the gaps
  const spansA = uniformSpans(width, fingerCount, true, 0);
  const notchSpansA = complementSpans(spansA, 0, width);

  // Board B: female at ends — notches are at the ends
  const spansB = uniformSpans(width, fingerCount, false, 0);
  const notchSpansB = complementSpans(spansB, 0, width);

  const notchesA = notchSpansA.map((s) => buildNotch(s, thickness, reliefRadius));
  const notchesB = notchSpansB.map((s) => buildNotch(s, thickness, reliefRadius));

  const svgA = notchesToSvg(notchesA, width, thickness, "Board A");
  const svgB = notchesToSvg(notchesB, width, thickness, "Board B");
  const svgBoth = bothToSvg(notchesA, notchesB, width, thickness);

  return { notchesA, notchesB, reliefRadius, svgA, svgB, svgBoth };
}

/**
 * Build a single notch cutout: a closed rectangle (fingerWidth × thickness)
 * opening downward, with relief at the two inside corners at the top (the
 * closed end of the notch).
 *
 * Wound clockwise (material on the left for an interior cut): the board
 * material is outside this path, the bit cuts inside it.
 *
 * Orientation: the notch opens at y=0 (the board edge) and the closed end
 * is at y=thickness. Fingers point down.
 */
function buildNotch(span: Span, thickness: number, reliefRadius: number): Contour {
  const [left, right] = span;

  // Clockwise winding (for interior cut): start bottom-left, go left along
  // bottom (the open edge), up the left wall, right along the top (closed end),
  // down the right wall. The two inside corners are at the top (where the notch
  // closes into material).
  //
  // But we need to be careful: "material on the left" for CW means material is
  // outside this path. The inside corners (where the cutter can't reach) are the
  // top-left and top-right corners of the notch rectangle.
  const points: Vec2[] = [
    vec(left, 0),        // bottom-left (open edge)
    vec(left, thickness),  // top-left (inside corner)
    vec(right, thickness), // top-right (inside corner)
    vec(right, 0),       // bottom-right (open edge)
  ];

  // This is CW winding — relieve expects material-on-left which is CW for cutouts.
  return relieveRing(points, reliefRadius);
}

/** Wrap notch contours as a Shaper-compatible SVG: interior cuts in mm. */
function notchesToSvg(notches: Contour[], width: number, height: number, _label?: string): string {
  const margin = 2;
  const svgW = width + 2 * margin;
  const svgH = height + 2 * margin;
  const paths = notches.map((c) => {
    const d = pathData(c, 1, 4);
    return `    <path fill="rgb(255,255,255)" stroke="rgb(0,0,0)" stroke-width="0.2" d="${d}"/>`;
  }).join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNum(svgW)}mm" height="${formatNum(svgH)}mm" ` +
      `viewBox="0 0 ${formatNum(svgW)} ${formatNum(svgH)}">`,
    `  <g transform="translate(${margin},${margin}) scale(1,-1) translate(0,${-height})">`,
    paths,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}

/** Both sets side by side for preview. */
function bothToSvg(notchesA: Contour[], notchesB: Contour[], width: number, height: number): string {
  const margin = 2;
  const gap = 8;
  const svgW = 2 * width + gap + 2 * margin;
  const svgH = height + 2 * margin;

  const pathsA = notchesA.map((c) => {
    const d = pathData(c, 1, 4);
    return `    <path fill="rgba(100,160,255,0.15)" stroke="#000" stroke-width="0.2" d="${d}"/>`;
  }).join("\n");

  const pathsB = notchesB.map((c) => {
    const d = pathData(c, 1, 4);
    return `    <path fill="rgba(255,160,100,0.15)" stroke="#000" stroke-width="0.2" d="${d}"/>`;
  }).join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNum(svgW)}mm" height="${formatNum(svgH)}mm" ` +
      `viewBox="0 0 ${formatNum(svgW)} ${formatNum(svgH)}">`,
    `  <g transform="translate(${margin},${margin}) scale(1,-1) translate(0,${-height})">`,
    pathsA,
    `  </g>`,
    `  <g transform="translate(${margin + width + gap},${margin}) scale(1,-1) translate(0,${-height})">`,
    pathsB,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}
