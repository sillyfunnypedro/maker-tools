// Finger joint generator: produces two complementary cut profiles.
//
// Input: board width (mm), board thickness (mm), number of fingers (odd),
//        bit diameter (mm), clearance (mm, default 0.0254 = 1 thou).
//
// Output: two Contours — one for each mating board. Each is a rectangle with
// notches cut into one edge, with semicircular corner relief at every inside
// corner so the joint assembles cleanly with a round bit.

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
  /** Profile for board A (male at ends — has fingers at both ends). */
  profileA: Contour;
  /** Profile for board B (female at ends — has notches at both ends). */
  profileB: Contour;
  /** Relief radius used. */
  reliefRadius: number;
  /** SVG markup for profile A. */
  svgA: string;
  /** SVG markup for profile B. */
  svgB: string;
}

/**
 * Generate two complementary finger joint profiles.
 *
 * Board A has fingers (material) at both ends of the joint edge.
 * Board B has notches (voids) at both ends — it's the complement.
 * Both profiles are full rectangles (width × thickness) with notches
 * cut into the top edge.
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

  // Board A: male at ends (fingers at positions 0,2,4,...)
  // The "joint edge" is the top edge. Notches are cut down from the top.
  const spansA = uniformSpans(width, fingerCount, true, 0);  // A's fingers (solid)
  const notchesA = complementSpans(spansA, 0, width);         // A's voids

  // Board B: female at ends (complement)
  const spansB = uniformSpans(width, fingerCount, false, 0);  // B's fingers (solid)
  const notchesB = complementSpans(spansB, 0, width);          // B's voids

  const profileA = buildProfile(width, thickness, notchesA, reliefRadius);
  const profileB = buildProfile(width, thickness, notchesB, reliefRadius);

  const svgA = profileToSvg(profileA, width, thickness);
  const svgB = profileToSvg(profileB, width, thickness);

  return { profileA, profileB, reliefRadius, svgA, svgB };
}

/**
 * Build a board profile: a rectangle with notches cut into the top edge.
 * The ring is wound CCW (material on the left) with the notch bottoms
 * going depth = thickness into the board from the top.
 */
function buildProfile(
  width: number, thickness: number, notches: Span[], reliefRadius: number,
): Contour {
  // Build the outline as a polygon (sharp corners), then relieve it.
  // The board is width × thickness, bottom-left at origin.
  // Top edge has notches cut down to y=0 (depth = thickness).
  const points: Vec2[] = [];

  // Start at bottom-left, go CCW:
  // bottom edge (left to right)
  points.push(vec(0, 0));
  points.push(vec(width, 0));

  // Right edge (bottom to top)
  points.push(vec(width, thickness));

  // Top edge with notches (right to left)
  // Walk from right to left along y = thickness, cutting down for each notch.
  const sortedNotches = [...notches].sort((a, b) => b[0] - a[0]); // right to left
  let cursor = width;

  for (const [nLeft, nRight] of sortedNotches) {
    // Walk to the right edge of this notch
    if (cursor > nRight + 1e-9) {
      // Already at cursor, need to go left to nRight (still on top edge)
      points.push(vec(nRight, thickness));
    }
    // Drop into the notch
    points.push(vec(nRight, 0));
    // Across the notch bottom
    points.push(vec(nLeft, 0));
    // Back up to top
    points.push(vec(nLeft, thickness));
    cursor = nLeft;
  }

  // Finish the top edge back to the left side
  if (cursor > 1e-9) {
    points.push(vec(0, thickness));
  }

  // Relieve inside corners
  return relieveRing(points, reliefRadius);
}

/** Wrap a contour as a standalone SVG document in mm. */
function profileToSvg(contour: Contour, width: number, height: number): string {
  // Flip Y for SVG (y-down): use a transform.
  const d = pathData(contour, 1, 4);
  const margin = 2; // mm around the part
  const svgW = width + 2 * margin;
  const svgH = height + 2 * margin;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNum(svgW)}mm" height="${formatNum(svgH)}mm" ` +
      `viewBox="0 0 ${formatNum(svgW)} ${formatNum(svgH)}">`,
    `  <g transform="translate(${margin},${margin}) scale(1,-1) translate(0,${-height})">`,
    `    <path fill="none" stroke="#000000" stroke-width="0.2" d="${d}"/>`,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}
