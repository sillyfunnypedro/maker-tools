// Runs the image pipeline off the main thread so the UI stays responsive.
import { process, computeMasks, type Params } from "./processing";
import { traceStrokeGroups, traceAreaGroups, type StrokeGroup } from "./svg";
import { traceContours, thresholdMask, removeBorderRegions, smoothContour } from "./contour";
import { detectQrFrame, type QrFrameResult } from "./qrframe/detect";

/** Render filled silhouettes as black on transparent (areas mode raster preview). */
function processAreas(
  data: Uint8ClampedArray, w: number, h: number, params: Params,
): Uint8ClampedArray {
  const mask = thresholdMask(data, w, h, params.bgThresh);
  removeBorderRegions(mask, w, h);

  // Render the mask directly: foreground pixels are black, background transparent.
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) {
      const off = i * 4;
      out[off] = out[off + 1] = out[off + 2] = 0; // black
      out[off + 3] = 255;
    }
  }
  return out;
}

interface BaseRequest {
  id: number;
  buffer: ArrayBuffer; // RGBA pixel data
  width: number;
  height: number;
  params: Params;
}
export interface PngRequest extends BaseRequest {
  kind: "png";
  /** When set to "areas", render contour outlines instead of skeleton lines. */
  detectMode?: "lines" | "areas";
}
export interface DetectRequest extends BaseRequest {
  kind: "detect";
}
export interface TraceRequest extends BaseRequest {
  kind: "trace";
  /** pixel -> mm homography and opening origin (frame mm). */
  H: number[][];
  ox: number;
  oy: number;
  /** "lines" = centerline tracing; "areas" = contour outlines of filled regions. */
  detectMode: "lines" | "areas";
  /** For areas mode: contour smoothing iterations (0 = raw pixel contour). */
  areaSmoothing?: number;
}
export type WorkerRequest =
  | PngRequest
  | DetectRequest
  | TraceRequest;

export interface PngResponse {
  kind: "png";
  id: number;
  buffer: ArrayBuffer; // RGBA result
  width: number;
  height: number;
}
export interface TraceResponse {
  kind: "trace";
  id: number;
  groups: StrokeGroup[];
  mmPerPx: number;
}
export interface DetectResponse {
  kind: "detect";
  id: number;
  result: QrFrameResult;
}
export type WorkerResponse =
  | PngResponse
  | TraceResponse
  | DetectResponse;

export type DetectResult = QrFrameResult;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const data = new Uint8ClampedArray(req.buffer);

  if (req.kind === "detect") {
    const result = detectQrFrame(data, req.width, req.height);
    const res: DetectResponse = { kind: "detect", id: req.id, result };
    (self as unknown as Worker).postMessage(res);
    return;
  }

  if (req.kind === "trace") {
    let groups: StrokeGroup[];
    let px: number;

    if (req.detectMode === "areas") {
      // Area mode: threshold -> remove border noise -> contour trace -> smooth -> mm conversion.
      const mask = thresholdMask(data, req.width, req.height, req.params.bgThresh);
      removeBorderRegions(mask, req.width, req.height);
      let contours = traceContours(mask, req.width, req.height, req.params.minBlob);
      // Smooth the contours in pixel space before converting to mm.
      // The slider value (0-3mm) maps to iterations: 0mm = 0 iters, 3mm = ~12 iters.
      const iters = Math.round((req.areaSmoothing ?? 0) * 4);
      if (iters > 0) {
        contours = contours.map((c) => smoothContour(c, iters));
      }
      ({ groups, mmPerPx: px } = traceAreaGroups(contours, req.width, req.height, req.H, req.ox, req.oy));
    } else {
      // Lines mode: skeleton -> centerline trace.
      const m = computeMasks(data, req.width, req.height, req.params);
      ({ groups, mmPerPx: px } = traceStrokeGroups(m.skeleton, m.w, m.h, req.H, req.ox, req.oy));
    }

    const res: TraceResponse = { kind: "trace", id: req.id, groups, mmPerPx: px };
    (self as unknown as Worker).postMessage(res);
    return;
  }

  const result = req.detectMode === "areas"
    ? processAreas(data, req.width, req.height, req.params)
    : process(data, req.width, req.height, req.params);
  const out = result.buffer as ArrayBuffer;
  const res: PngResponse = {
    kind: "png",
    id: req.id,
    buffer: out,
    width: req.width,
    height: req.height,
  };
  (self as unknown as Worker).postMessage(res, [out]);
};
