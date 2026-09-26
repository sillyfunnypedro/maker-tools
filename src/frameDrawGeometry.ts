// Pure geometry for Frame Draw: fitting the reference image inside the
// detected frame's opening, letting the user nudge that placement, and
// converting between the camera's native pixel space and the on-screen
// (object-fit: cover) display space. Kept independent of React/DOM so it's
// directly unit-testable.
import type { Pt } from "./qrframe/homography";

export interface FineAdjust {
  dx: number;
  dy: number;
  scale: number;
  rotateDeg: number;
}

export const IDENTITY_ADJUST: FineAdjust = { dx: 0, dy: 0, scale: 1, rotateDeg: 0 };

const centerOf = (pts: Pt[]): Pt => [
  pts.reduce((s, p) => s + p[0], 0) / pts.length,
  pts.reduce((s, p) => s + p[1], 0) / pts.length,
];

/**
 * The largest centred rectangle of the given aspect ratio (width/height) that
 * fits inside `openingCorners` (mm, axis-aligned [TL, TR, BR, BL] — as
 * returned by qrframe/spec.ts's openingCornersMm) — i.e. "object-fit:
 * contain" sizing for the reference image within the frame's opening.
 */
export function fitRectMm(openingCorners: Pt[], aspectWH: number): Pt[] {
  const [tl, tr, , bl] = openingCorners;
  const openW = tr[0] - tl[0];
  const openH = bl[1] - tl[1];
  const [cx, cy] = centerOf(openingCorners);
  let w = openW, h = openW / aspectWH;
  if (h > openH) {
    h = openH;
    w = openH * aspectWH;
  }
  return [
    [cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2],
  ];
}

/**
 * Nudge a rectangle's corners by a translate/scale/rotate, pivoting on the
 * rectangle's own centre — composed here, in the frame's own mm space,
 * *before* projecting through the current camera pose, so the adjustment
 * stays anchored to the frame (not the screen) regardless of how the camera
 * moves. Composing this in screen space after projection instead would make
 * the adjustment visibly drift as the camera's distance/angle changed.
 */
export function applyFineAdjustMm(rectCorners: Pt[], adjust: FineAdjust): Pt[] {
  const [cx, cy] = centerOf(rectCorners);
  const rad = (adjust.rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  return rectCorners.map(([x, y]): Pt => {
    const lx = (x - cx) * adjust.scale;
    const ly = (y - cy) * adjust.scale;
    const rx = lx * cos - ly * sin;
    const ry = lx * sin + ly * cos;
    return [cx + rx + adjust.dx, cy + ry + adjust.dy];
  });
}

/**
 * Map a point in the camera's native pixel space to on-screen (stage) pixel
 * space, given the video is displayed with CSS `object-fit: cover` inside a
 * `stageW` x `stageH` box — i.e. uniformly scaled up to cover the box, with
 * the overflow on one axis centred and cropped off.
 */
export function videoPxToScreenPx(
  p: Pt, videoW: number, videoH: number, stageW: number, stageH: number,
): Pt {
  const scale = Math.max(stageW / videoW, stageH / videoH);
  const cropX = (videoW * scale - stageW) / 2;
  const cropY = (videoH * scale - stageH) / 2;
  return [p[0] * scale - cropX, p[1] * scale - cropY];
}

/** Inverse of videoPxToScreenPx. */
export function screenPxToVideoPx(
  p: Pt, videoW: number, videoH: number, stageW: number, stageH: number,
): Pt {
  const scale = Math.max(stageW / videoW, stageH / videoH);
  const cropX = (videoW * scale - stageW) / 2;
  const cropY = (videoH * scale - stageH) / 2;
  return [(p[0] + cropX) / scale, (p[1] + cropY) / scale];
}
