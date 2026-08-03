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
 * Build the profile: a closed exterior-cut path.
 * Fingers point DOWN from y=0 (the board edge). The notches between fingers
 * go down to y=-thickness. An extended base rectangle goes UP from y=0
 * (width+60mm wide, 30mm overhang each side, 20mm tall) — the operator cuts
 * straight across this repeatedly and ignores the upper part.
 *
 * Wound CCW (exterior cut for Shaper).
 */
function buildProfile(
  width: number, thickness: number, notchSpans: Span[], reliefRadius: number,
): Contour {
  const EXT = 30; // mm extension past each side
  const BASE_HEIGHT = 20; // mm above the board edge (the cut-across zone)

  const points: Vec2[] = [];

  // CCW winding. Fingers point down (negative y). Base box goes up (positive y).
  // Start top-left of the base, go right along top, down right side, across
  // bottom with comb (fingers pointing down), up left side.

  // Top-left of base
  points.push(vec(-EXT, BASE_HEIGHT));
  // Top-right of base
  points.push(vec(width + EXT, BASE_HEIGHT));
  // Down right side to board edge
  points.push(vec(width + EXT, 0));
  // Step in to board width
  points.push(vec(width, 0));

  // Walk right-to-left along y=0, with notches going DOWN to y=-thickness.
  const sortedDesc = [...notchSpans].sort((a, b) => b[0] - a[0]); // right to left
  let cursor = width;
  for (const [nLeft, nRight] of sortedDesc) {
    if (cursor > nRight + 1e-9) {
      points.push(vec(nRight, 0));
    }
    // Down into the notch
    points.push(vec(nRight, -thickness));
    // Across the notch floor (right to left)
    points.push(vec(nLeft, -thickness));
    // Back up
    points.push(vec(nLeft, 0));
    cursor = nLeft;
  }

  // Finish to left edge
  if (cursor > 1e-9) {
    points.push(vec(0, 0));
  }

  // Step out to extension and up
  points.push(vec(-EXT, 0));

  // Close back to start (top-left) — implicit in the ring

  // Identify corners that should NOT be relieved:
  // - The four corners of the base extension rectangle (the bit handles those fine)
  // - Edge notch corners at (0,0) and (width,0) where the notch opens to the base
  const skipPoints: Vec2[] = [
    vec(-EXT, 0), vec(width + EXT, 0),
    vec(-EXT, BASE_HEIGHT), vec(width + EXT, BASE_HEIGHT),
    vec(0, 0), vec(width, 0),
  ];

  return relieveRing(points, reliefRadius, skipPoints);
}

/** Wrap profile as a Shaper-compatible SVG with anchor triangle. */
function notchesToSvg(notches: Contour[], width: number, height: number, _label?: string): string {
  const EXT = 30;
  const BASE_HEIGHT = 20;
  const margin = 2;
  const svgW = width + 2 * EXT + 2 * margin;
  const svgH = height + BASE_HEIGHT + 2 * margin;

  // Shaper anchor: red right triangle at the origin (0,0 in part coords).
  // Short side along x. The anchor tells Shaper where to place the design.
  const anchorSize = 5; // mm
  const anchor = `    <polygon points="0,0 ${anchorSize},0 0,${anchorSize}" fill="red" stroke="none"/>`;

  const paths = notches.map((c) => {
    const d = pathData(c, 1, 4);
    return `    <path fill="rgb(255,255,255)" stroke="rgb(0,0,0)" stroke-width="0.5" d="${d}"/>`;
  }).join("\n");

  // Y-flip: part coords have y-up, SVG is y-down.
  // Origin in part coords: (0, 0) = left edge of board, board edge line.
  // After flip: translate so that the top of the base (y=BASE_HEIGHT in part) is at
  // the top of the SVG, and the finger tips (y=-thickness) are at the bottom.
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNum(svgW)}mm" height="${formatNum(svgH)}mm" ` +
      `viewBox="0 0 ${formatNum(svgW)} ${formatNum(svgH)}">`,
    `  <g transform="translate(${margin + EXT},${margin + BASE_HEIGHT}) scale(1,-1)">`,
    paths,
    anchor,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}

/** Both sets stacked for preview. */
function bothToSvg(notchesA: Contour[], notchesB: Contour[], width: number, height: number): string {
  const EXT = 30;
  const BASE_HEIGHT = 20;
  const margin = 2;
  const gap = 8;
  const profileH = height + BASE_HEIGHT;
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
    `  <g transform="translate(${margin + EXT},${margin + BASE_HEIGHT}) scale(1,-1)">`,
    pathsA,
    `  </g>`,
    `  <g transform="translate(${margin + EXT},${margin + profileH + gap + BASE_HEIGHT}) scale(1,-1)">`,
    pathsB,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}
