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

/**
 * Remove (zero out) any foreground regions in the mask that touch the image
 * border. These are invariably frame shadows, table edges, or other artifacts
 * — real drawing content sits inside the opening, not touching its edge.
 *
 * Uses a flood fill from every border pixel that's foreground.
 */
export function removeBorderRegions(mask: Uint8Array, w: number, h: number): void {
  const stack: number[] = [];

  // Seed from all four borders.
  for (let x = 0; x < w; x++) {
    if (mask[x]) stack.push(x);                       // top row
    const bot = (h - 1) * w + x;
    if (mask[bot]) stack.push(bot);                   // bottom row
  }
  for (let y = 1; y < h - 1; y++) {
    if (mask[y * w]) stack.push(y * w);               // left column
    const right = y * w + w - 1;
    if (mask[right]) stack.push(right);               // right column
  }

  // Flood fill (4-connected) — clear every connected foreground pixel.
  while (stack.length) {
    const idx = stack.pop()!;
    if (!mask[idx]) continue;
    mask[idx] = 0;
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0 && mask[idx - 1]) stack.push(idx - 1);
    if (x < w - 1 && mask[idx + 1]) stack.push(idx + 1);
    if (y > 0 && mask[idx - w]) stack.push(idx - w);
    if (y < h - 1 && mask[idx + w]) stack.push(idx + w);
  }
}

/**
 * Histogram equalization on grayscale values extracted from RGBA.
 * Returns a new RGBA image where the luminance channel has been equalized,
 * stretching the contrast so shadows become lighter and ink stays dark.
 * This makes thresholding far more robust against uneven lighting.
 */
export function equalizeHistogram(
  rgba: Uint8ClampedArray, w: number, h: number,
): Uint8ClampedArray {
  const n = w * h;

  // Build grayscale histogram
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const off = i * 4;
    const gray = (rgba[off] * 77 + rgba[off + 1] * 150 + rgba[off + 2] * 29) >> 8;
    hist[gray]++;
  }

  // Build CDF (cumulative distribution function)
  const cdf = new Uint32Array(256);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];

  // Find the minimum non-zero CDF value
  let cdfMin = 0;
  for (let i = 0; i < 256; i++) {
    if (cdf[i] > 0) { cdfMin = cdf[i]; break; }
  }

  // Build lookup table: equalized value for each input gray level
  const lut = new Uint8Array(256);
  const denom = n - cdfMin;
  if (denom > 0) {
    for (let i = 0; i < 256; i++) {
      lut[i] = Math.round(((cdf[i] - cdfMin) / denom) * 255);
    }
  }

  // Apply: convert to gray, equalize, write back as grayscale RGBA
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const off = i * 4;
    const gray = (rgba[off] * 77 + rgba[off + 1] * 150 + rgba[off + 2] * 29) >> 8;
    const eq = lut[gray];
    out[off] = out[off + 1] = out[off + 2] = eq;
    out[off + 3] = 255;
  }
  return out;
}

/**
 * Smooth a closed contour by averaging each point with its neighbours.
 * Iterations controls how many passes (more = smoother). The radius sets
 * how many neighbours on each side contribute to the average.
 *
 * This is a simple moving-average applied on a closed ring, preserving the
 * overall shape while removing pixel-level jitter. Unlike RDP, it doesn't
 * remove points — it repositions them, so there are still enough for the
 * Bezier fitting to produce curves rather than straight segments.
 */
export function smoothContour(
  pts: [number, number][], iterations: number, radius = 2,
): [number, number][] {
  if (pts.length < 5 || iterations <= 0) return pts;
  let cur = pts;
  for (let iter = 0; iter < iterations; iter++) {
    const next: [number, number][] = new Array(cur.length);
    const n = cur.length;
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, count = 0;
      for (let j = -radius; j <= radius; j++) {
        const idx = ((i + j) % n + n) % n;
        sx += cur[idx][0];
        sy += cur[idx][1];
        count++;
      }
      next[i] = [sx / count, sy / count];
    }
    cur = next;
  }
  return cur;
}
