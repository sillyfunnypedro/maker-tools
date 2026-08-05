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
import { relieveRing, type ReliefStyle } from "./relief";

export interface FingerJointParams {
  /** Board width along the joint edge (mm). */
  width: number;
  /** Thickness of Board A (mm). Board B's notches are this deep. */
  thicknessA: number;
  /** Thickness of Board B (mm). Board A's notches are this deep. */
  thicknessB: number;
  /** Number of fingers (must be odd). */
  fingerCount: number;
  /** Cutter bit diameter (mm). */
  bitDiameter: number;
  /** Extra clearance beyond bit radius (mm). Default: 0.0254 (1 thou). */
  clearance?: number;
  /** X offset for Board A's geometry relative to anchor (mm). */
  offsetAX?: number;
  /** Y offset for Board A's geometry relative to anchor (mm). */
  offsetAY?: number;
  /** X offset for Board B's geometry relative to anchor (mm). */
  offsetBX?: number;
  /** Y offset for Board B's geometry relative to anchor (mm). */
  offsetBY?: number;
  /** Board A insert mode: fingers insert into middle of other board (not at edge). */
  insertA?: boolean;
  /** Board B insert mode: fingers insert into middle of other board (not at edge). */
  insertB?: boolean;
  /** Relief style: "long" (default), "short", or "diagonal". */
  reliefStyle?: ReliefStyle;
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
  /** Number of notches in board A. */
  notchCountA: number;
  /** Number of notches in board B. */
  notchCountB: number;
}

/**
 * Generate two complementary sets of finger-joint notch cutouts.
 *
 * Board A has fingers (material) at both ends — its notches are the gaps.
 * Board B is the complement.
 * Notches open downward (fingers point down from the board edge).
 */
export function generateFingerJoint(params: FingerJointParams): FingerJointResult {
  const { width, thicknessA, thicknessB, fingerCount, bitDiameter, clearance = 0.0254,
    offsetAX = 0, offsetAY = 0, offsetBX = 0, offsetBY = 0,
    insertA = false, insertB = false, reliefStyle = "long" } = params;

  if (width <= 0) throw new Error("width must be positive");
  if (thicknessA <= 0 || thicknessB <= 0) throw new Error("thickness must be positive");
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

  // Board A: male at ends (fingers at edges) — notches are always internal.
  // Board B: female at ends (notches at edges) — unless insert mode, where
  // the notches are also internal (the fingers insert into the middle of A).
  const edgeNotchesA = false; // A never has edge notches
  const edgeNotchesB = true;  // B always has edge notches (straight across) — insertB only affects A

  const notchesA = [buildProfile(width, thicknessB, notchSpansA, reliefRadius, edgeNotchesA, reliefStyle, insertB)];
  const notchesB = [buildProfile(width, thicknessA, notchSpansB, reliefRadius, edgeNotchesB, reliefStyle)];

  // When B inserts into A, the profile already extends at depth — no separate slots needed.

  // When A inserts into B, add mortise slots to B at A's finger positions.
  if (insertA) {
    for (const [left, right] of spansA) {
      const slotPoints: Vec2[] = [
        vec(left, 0),
        vec(right, 0),
        vec(right, thicknessA),
        vec(left, thicknessA),
      ];
      notchesB.push(relieveRing(slotPoints, reliefRadius, undefined, reliefStyle));
    }
  }

  const svgA = notchesToSvg(notchesA, width, thicknessB, offsetAX, offsetAY);
  const svgB = notchesToSvg(notchesB, width, thicknessA, offsetBX, offsetBY);
  const svgBoth = bothToSvg(notchesA, notchesB, width, Math.max(thicknessA, thicknessB));

  return { notchesA, notchesB, reliefRadius, svgA, svgB, svgBoth, notchCountA: notchSpansA.length, notchCountB: notchSpansB.length };
}

/**
 * Build the profile: a closed exterior-cut path in SVG y-down coordinates.
 * Base extends UP (negative y), fingers point DOWN (positive y), board edge at y=0.
 * No transforms needed — path data renders correctly as-is.
 */
function buildProfile(
  width: number, thickness: number, notchSpans: Span[], reliefRadius: number,
  edgeNotches: boolean, reliefStyle: ReliefStyle, insertMode = false,
): Contour {
  const EXT = 30; // mm extension past each side
  const BASE_HEIGHT = 20; // mm above the board edge (negative y = SVG up)

  const points: Vec2[] = [];
  const sortedDesc = [...notchSpans].sort((a, b) => b[0] - a[0]); // right to left

  // Y-down: base at -BASE_HEIGHT (top), board edge at 0, fingers at +thickness (bottom).

  // Top of base (SVG top = negative y)
  points.push(vec(-EXT, -BASE_HEIGHT));
  points.push(vec(width + EXT, -BASE_HEIGHT));

  if (edgeNotches && sortedDesc.length > 0) {
    // Board B: extension goes straight to finger depth on both sides.
    points.push(vec(width + EXT, thickness));

    const first = sortedDesc[0];
    points.push(vec(first[0], thickness));
    points.push(vec(first[0], 0));

    for (let i = 1; i < sortedDesc.length - 1; i++) {
      const [nLeft, nRight] = sortedDesc[i];
      points.push(vec(nRight, 0));
      points.push(vec(nRight, thickness));
      points.push(vec(nLeft, thickness));
      points.push(vec(nLeft, 0));
    }

    if (sortedDesc.length > 1) {
      const last = sortedDesc[sortedDesc.length - 1];
      points.push(vec(last[1], 0));
      points.push(vec(last[1], thickness));
      points.push(vec(-EXT, thickness));
    } else {
      points.push(vec(-EXT, thickness));
    }
  } else if (insertMode) {
    // Insert mode: both sides extend out at finger depth.
    // Right: extension at depth → up to board edge → comb → down at left edge → extension at depth
    points.push(vec(width + EXT, thickness)); // right extension at depth
    points.push(vec(width, thickness));        // right edge at depth
    points.push(vec(width, 0));                // up to board edge (relief corner here)

    let cursor = width;
    for (const [nLeft, nRight] of sortedDesc) {
      if (cursor > nRight + 1e-9) {
        points.push(vec(nRight, 0));
      }
      points.push(vec(nRight, thickness));
      points.push(vec(nLeft, thickness));
      points.push(vec(nLeft, 0));
      cursor = nLeft;
    }

    // At the left edge: descend to finger depth, then extend out
    if (cursor > 1e-9) {
      points.push(vec(0, 0));
    }
    points.push(vec(0, thickness));     // down to finger depth at x=0 (relief corner here)
    points.push(vec(-EXT, thickness));  // across to extension at depth
  } else {
    // Normal Board A: step in at y=0 on both sides.
    points.push(vec(width + EXT, 0));
    points.push(vec(width, 0));

    let cursor = width;
    for (const [nLeft, nRight] of sortedDesc) {
      if (cursor > nRight + 1e-9) {
        points.push(vec(nRight, 0));
      }
      points.push(vec(nRight, thickness));
      points.push(vec(nLeft, thickness));
      points.push(vec(nLeft, 0));
      cursor = nLeft;
    }

    if (cursor > 1e-9) {
      points.push(vec(0, 0));
    }
    points.push(vec(-EXT, 0));
  }

  // Skip relief at base/extension corners.
  // When edgeNotches=true (Board B, not insert), also skip the board-edge corners.
  // When edgeNotches=false (Board A, or insert mode), those are real inside corners.
  const skipPoints: Vec2[] = [
    vec(-EXT, -BASE_HEIGHT), vec(width + EXT, -BASE_HEIGHT),
    vec(-EXT, 0), vec(width + EXT, 0),
    vec(-EXT, thickness), vec(width + EXT, thickness),
  ];
  if (edgeNotches) {
    // Open edges — no relief needed at board boundary corners
    skipPoints.push(vec(0, 0), vec(width, 0));
    skipPoints.push(vec(0, thickness), vec(width, thickness));
  }

  return relieveRing(points, reliefRadius, skipPoints, reliefStyle);
}

/** Wrap profile as a Shaper-compatible SVG with anchor triangle.
 *  offsetX/offsetY shift the geometry relative to the anchor (anchor stays at 0,0). */
function notchesToSvg(
  notches: Contour[], width: number, height: number,
  offsetX = 0, offsetY = 0,
): string {
  const EXT = 30;
  const BASE_HEIGHT = 20;
  const margin = 2;
  const svgW = width + 2 * EXT + 2 * margin;
  const svgH = height + BASE_HEIGHT + 2 * margin;

  // Shaper anchor: red right triangle at origin, pointing up (-y), 2:1 aspect.
  const ax = 5; // short side (x)
  const ay = 10; // long side (y), pointing up
  const anchor = `    <polygon points="0,${height} ${ax},${height} 0,${height - ay}" fill="red" stroke="none"/>`;

  const paths = notches.map((c, i) => {
    const d = pathData(c, 1, 4);
    // First contour is the comb profile (exterior cut = black fill).
    // Additional contours are mortise slots (interior cut = white fill + black stroke).
    if (i === 0) {
      return `    <path fill="rgb(0,0,0)" stroke="none" d="${d}"/>`;
    }
    return `    <path fill="rgb(255,255,255)" stroke="rgb(0,0,0)" stroke-width="0.3" d="${d}"/>`;
  }).join("\n");

  // Anchor at SVG origin. Geometry offset by (offsetX, offsetY) relative to anchor.
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${formatNum(svgW)}mm" height="${formatNum(svgH)}mm" ` +
      `viewBox="0 0 ${formatNum(svgW)} ${formatNum(svgH)}">`,
    `  <g transform="translate(${margin + EXT},${margin + BASE_HEIGHT})">`,
    `    <g transform="translate(${offsetX},${offsetY})">`,
    paths,
    `    </g>`,
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
    `  <g transform="translate(${margin + EXT},${margin + BASE_HEIGHT})">`,
    pathsA,
    `  </g>`,
    `  <g transform="translate(${margin + EXT},${margin + profileH + gap + BASE_HEIGHT})">`,
    pathsB,
    `  </g>`,
    `</svg>`,
  ].join("\n");
}
