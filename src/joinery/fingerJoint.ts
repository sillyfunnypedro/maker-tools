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

  const notchesA = [buildProfile(width, thickness, notchSpansA, reliefRadius)];
  const notchesB = [buildProfile(width, thickness, notchSpansB, reliefRadius)];

  const svgA = notchesToSvg(notchesA, width, thickness);
  const svgB = notchesToSvg(notchesB, width, thickness);
  const svgBoth = bothToSvg(notchesA, notchesB, width, thickness);

  return { notchesA, notchesB, reliefRadius, svgA, svgB, svgBoth };
}

/**
 * Build a single notch cutout as a closed profile with an extended base rectangle.
 * The top has the finger comb (notches cut up into the material), and the bottom
 * extends 15mm past each side so you can cut straight across with the router.
 *
 * Shape: a rectangle (width+30mm) × (thickness + extension) with the comb on
 * the top edge. One closed exterior-cut path — the Shaper follows the whole outline.
 */
function buildProfile(
  width: number, thickness: number, notchSpans: Span[], reliefRadius: number,
): Contour {
  const EXT = 15; // mm extension past each side
  const BASE_DEPTH = 10; // mm below the board edge for the straight cut-across

  // The profile is one closed path. Origin: the board's joint edge is at y=0,
  // fingers go up (into the material) to y=thickness. The base extends down to
  // y=-BASE_DEPTH. The sides extend EXT mm past the board width on each side.
  //
  // Wound CCW (exterior cut, material on the right of the path = waste).
  // Start at bottom-left, trace: right along base, up right side, left along
  // top (with notches going up), down left side.

  const points: Vec2[] = [];

  // Bottom-left corner of the extended base
  points.push(vec(-EXT, -BASE_DEPTH));
  // Bottom-right
  points.push(vec(width + EXT, -BASE_DEPTH));
  // Up right side to the board edge
  points.push(vec(width + EXT, 0));
  // Step in to the board width
  points.push(vec(width, 0));

  // Top edge with notches (left to right): walk from right to left in board coords,
  // but we're going left-to-right here. The notches go UP from y=0 to y=thickness.
  // Between notches is the finger (stays at y=0). A notch goes up to y=thickness.
  const sortedNotches = [...notchSpans].sort((a, b) => a[0] - b[0]);
  let cursor = 0;

  for (const [nLeft, nRight] of sortedNotches) {
    // Walk along y=0 to the left edge of this notch
    if (nLeft > cursor + 1e-9) {
      points.push(vec(nLeft, 0));
    }
    // Go up into the notch
    points.push(vec(nLeft, thickness));
    // Across the top of the notch
    points.push(vec(nRight, thickness));
    // Back down
    points.push(vec(nRight, 0));
    cursor = nRight;
  }

  // Finish walking to the right edge (if not already there)
  // Actually we started from the right side... let me rethink the winding.
  // We need CCW. Let me rebuild:
  // Going: bottom-left → bottom-right → up right → across top with notches → down left

  // Clear and redo properly
  points.length = 0;

  // CCW winding for exterior cut:
  // Start bottom-left, go right along base, up right side, LEFT along top (with
  // comb going up), down left side.
  points.push(vec(-EXT, -BASE_DEPTH));       // bottom-left
  points.push(vec(width + EXT, -BASE_DEPTH)); // bottom-right
  points.push(vec(width + EXT, 0));           // top-right of extension
  points.push(vec(width, 0));                 // step in to board width (right end)

  // Now walk right-to-left along the board edge (y=0), going UP for each notch.
  const sortedDesc = [...notchSpans].sort((a, b) => b[0] - a[0]); // right to left
  cursor = width;
  for (const [nLeft, nRight] of sortedDesc) {
    if (cursor > nRight + 1e-9) {
      points.push(vec(nRight, 0));
    }
    // Up into the notch
    points.push(vec(nRight, thickness));
    // Across the notch ceiling (right to left)
    points.push(vec(nLeft, thickness));
    // Back down
    points.push(vec(nLeft, 0));
    cursor = nLeft;
  }

  // Finish to left edge
  if (cursor > 1e-9) {
    points.push(vec(0, 0));
  }

  // Step out to extension and down
  points.push(vec(-EXT, 0));

  // Close back to start (bottom-left) — implicit in the ring

  return relieveRing(points, reliefRadius);
}

/** Wrap notch contours as a Shaper-compatible SVG: exterior cut in mm. */
function notchesToSvg(notches: Contour[], width: number, height: number, _label?: string): string {
  const EXT = 15;
  const BASE_DEPTH = 10;
  const margin = 2;
  const svgW = width + 2 * EXT + 2 * margin;
  const svgH = height + BASE_DEPTH + 2 * margin;
  const paths = notches.map((c) => {
    const d = pathData(c, 1, 4);
    return `    <path fill="rgb(0,0,0)" stroke="none" d="${d}"/>`;
  }).join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNum(svgW)}mm" height="${formatNum(svgH)}mm" ` +
      `viewBox="0 0 ${formatNum(svgW)} ${formatNum(svgH)}">`,
    `  <g transform="translate(${margin + EXT},${margin + height}) scale(1,-1)">`,
    paths,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}

/** Both sets stacked for preview. */
function bothToSvg(notchesA: Contour[], notchesB: Contour[], width: number, height: number): string {
  const EXT = 15;
  const BASE_DEPTH = 10;
  const margin = 2;
  const gap = 8;
  const profileH = height + BASE_DEPTH;
  const svgW = width + 2 * EXT + 2 * margin;
  const svgH = 2 * profileH + gap + 2 * margin;

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
    `  <g transform="translate(${margin + EXT},${margin + height}) scale(1,-1)">`,
    pathsA,
    `  </g>`,
    `  <g transform="translate(${margin + EXT},${margin + profileH + gap + height}) scale(1,-1)">`,
    pathsB,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}
