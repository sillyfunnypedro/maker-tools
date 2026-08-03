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

  const notchesA = [buildProfile(width, thickness, notchSpansA, reliefRadius, false)];
  const notchesB = [buildProfile(width, thickness, notchSpansB, reliefRadius, true)];

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
  edgeNotches: boolean,
): Contour {
  const EXT = 30; // mm extension past each side
  const BASE_HEIGHT = 20; // mm above the board edge (the cut-across zone)

  const points: Vec2[] = [];
  const sortedDesc = [...notchSpans].sort((a, b) => b[0] - a[0]); // right to left

  // CCW winding. Fingers point down (negative y). Base box goes up (positive y).

  // Top of base
  points.push(vec(-EXT, BASE_HEIGHT));
  points.push(vec(width + EXT, BASE_HEIGHT));

  if (edgeNotches && sortedDesc.length > 0) {
    // Board B: notches at both edges. The extension goes straight down to
    // -thickness on both sides — no coming back up at the board edges.

    // Right side: straight down to notch floor level
    points.push(vec(width + EXT, -thickness));

    // First (rightmost) notch touches x=width: its right wall IS the extension.
    // Start from its left edge at notch floor, then come up.
    const first = sortedDesc[0];
    points.push(vec(first[0], -thickness));
    points.push(vec(first[0], 0));

    // Middle notches (not the first or last) — normal up/down
    for (let i = 1; i < sortedDesc.length - 1; i++) {
      const [nLeft, nRight] = sortedDesc[i];
      points.push(vec(nRight, 0));
      points.push(vec(nRight, -thickness));
      points.push(vec(nLeft, -thickness));
      points.push(vec(nLeft, 0));
    }

    // Last (leftmost) notch touches x=0: its left wall IS the extension.
    // Come down from y=0, across its floor, then straight out to the extension.
    if (sortedDesc.length > 1) {
      const last = sortedDesc[sortedDesc.length - 1];
      points.push(vec(last[1], 0));
      points.push(vec(last[1], -thickness));
      points.push(vec(-EXT, -thickness));
    } else {
      // Single notch spanning the full width — already handled above
      points.push(vec(-EXT, -thickness));
    }
  } else {
    // Board A: no edge notches. Step in at y=0 on both sides.
    points.push(vec(width + EXT, 0));
    points.push(vec(width, 0));

    let cursor = width;
    for (const [nLeft, nRight] of sortedDesc) {
      if (cursor > nRight + 1e-9) {
        points.push(vec(nRight, 0));
      }
      points.push(vec(nRight, -thickness));
      points.push(vec(nLeft, -thickness));
      points.push(vec(nLeft, 0));
      cursor = nLeft;
    }

    if (cursor > 1e-9) {
      points.push(vec(0, 0));
    }
    points.push(vec(-EXT, 0));
  }

  // Skip relief at base/extension corners — only interior notch corners need it
  const skipPoints: Vec2[] = [
    vec(-EXT, BASE_HEIGHT), vec(width + EXT, BASE_HEIGHT),
    vec(-EXT, 0), vec(width + EXT, 0),
    vec(-EXT, -thickness), vec(width + EXT, -thickness),
    vec(0, 0), vec(width, 0),
    vec(0, -thickness), vec(width, -thickness),
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
