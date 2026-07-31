// Contour tracing: find the boundary outlines of thresholded black regions.
//
// Given a binary mask (1 = foreground/ink, 0 = background), this traces the
// outer boundary of each connected foreground region as an ordered sequence of
// pixel coordinates. The result is a set of closed polylines — one per region
// (or hole) — which can then be simplified (RDP) and smoothed into Bezier paths
// just like the centerline strokes.
//
// Uses the Suzuki-Abe border-following algorithm (the same one OpenCV uses for
// findContours), simplified to just track outer boundaries. Each boundary pixel
// is visited once, so the whole image is O(w*h).

type Pt = [number, number];

/** 8-connected neighbour offsets, starting East and going clockwise. */
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Trace all outer contours of foreground regions in a binary mask.
 *
 * @param mask - Uint8Array, 1 = foreground, 0 = background
 * @param w - image width
 * @param h - image height
 * @param minArea - ignore regions smaller than this many pixels
 * @returns array of closed polylines (each point appears once; the path
 *          implicitly closes back to the first point)
 */
export function traceContours(
  mask: Uint8Array, w: number, h: number, minArea = 10,
): Pt[][] {
  // Work on a padded copy so we never have to bounds-check during tracing.
  const pw = w + 2;
  const ph = h + 2;
  const padded = new Uint8Array(pw * ph); // zero-padded border
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) padded[(y + 1) * pw + (x + 1)] = 1;
    }
  }

  // Label array — marks pixels already assigned to a contour so we don't
  // double-trace. 0 = unvisited, -1 = visited-background, >0 = contour id.
  const label = new Int32Array(pw * ph);
  const contours: Pt[][] = [];
  let nextLabel = 1;

  for (let y = 1; y < ph - 1; y++) {
    for (let x = 1; x < pw - 1; x++) {
      const idx = y * pw + x;
      if (padded[idx] !== 1) continue;
      if (label[idx] !== 0) continue;

      // Is this pixel on an outer border? (left neighbour is background)
      const leftIdx = y * pw + (x - 1);
      if (padded[leftIdx] !== 0 && label[leftIdx] !== -1) continue;

      // Follow the outer border.
      const border = followBorder(padded, pw, ph, x, y, label, nextLabel);
      nextLabel++;

      if (border.length >= 3) {
        // Check area: count filled pixels inside the bounding box that belong
        // to this connected region. As a fast proxy, use border length as a
        // minimum perimeter check — a region with perimeter < sqrt(minArea)*4
        // can't have the area.
        if (border.length * border.length / 16 >= minArea || estimateArea(border) >= minArea) {
          // Convert from padded coords back to original image coords.
          contours.push(border.map(([bx, by]) => [bx - 1, by - 1] as Pt));
        }
      }
    }
  }

  return contours;
}

/**
 * Follow the outer border of a region starting at (startX, startY).
 * Uses Moore boundary tracing (8-connected).
 */
function followBorder(
  padded: Uint8Array, pw: number, _ph: number,
  startX: number, startY: number,
  label: Int32Array, labelId: number,
): Pt[] {
  const border: Pt[] = [];

  // Find the first background neighbour (start direction for the trace).
  // Since we enter from the left, start scanning from direction 7 (NW) going CW.
  let dir = 7; // start looking from where we came (left = west, so start NW)

  let cx = startX;
  let cy = startY;
  let firstStep = true;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    border.push([cx, cy]);
    label[cy * pw + cx] = labelId;

    // Find the next border pixel: scan neighbours starting from (dir+1)%8
    // going clockwise until we find a foreground pixel.
    let found = false;
    const startDir = (dir + 5) % 8; // start from 2 positions before entry direction (ensures we check outside first)
    for (let i = 0; i < 8; i++) {
      const d = (startDir + i) % 8;
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      const nIdx = ny * pw + nx;
      if (padded[nIdx] === 1) {
        dir = d;
        cx = nx;
        cy = ny;
        found = true;
        break;
      } else {
        // Mark background pixels we pass as visited-background.
        label[nIdx] = -1;
      }
    }

    if (!found) break; // isolated single pixel
    if (cx === startX && cy === startY && !firstStep) break; // back to start
    firstStep = false;

    // Safety: if the contour is unreasonably long, bail.
    if (border.length > pw * _ph) break;
  }

  return border;
}

/** Estimate area enclosed by a polygon using the shoelace formula. */
function estimateArea(pts: Pt[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(area) / 2;
}

/**
 * Build a binary mask from RGBA pixel data using the same threshold as the
 * line-detection pipeline: pixels darker than bgThresh are foreground.
 */
export function thresholdMask(
  rgba: Uint8ClampedArray, w: number, h: number, bgThresh: number,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const off = i * 4;
    const gray = (rgba[off] * 77 + rgba[off + 1] * 150 + rgba[off + 2] * 29) >> 8;
    if (gray < bgThresh) mask[i] = 1;
  }
  return mask;
}
