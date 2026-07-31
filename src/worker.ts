// Runs the image pipeline off the main thread so the UI stays responsive.
import { process, computeMasks, type Params } from "./processing";
import { traceStrokeGroups, type StrokeGroup } from "./svg";
import { detectQrFrame, type QrFrameResult } from "./qrframe/detect";

interface BaseRequest {
  id: number;
  buffer: ArrayBuffer; // RGBA pixel data
  width: number;
  height: number;
  params: Params;
}
export interface PngRequest extends BaseRequest {
  kind: "png";
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
    const m = computeMasks(data, req.width, req.height, req.params);
    // Traced view-independent (rotate/zoom/pan applied later, client-side — see
    // renderStrokeGroups): only the source pixels and the tracing params can
    // change these groups, so this only needs to re-run on the same lifecycle as
    // the raster preview, not on every view tweak.
    const { groups, mmPerPx } = traceStrokeGroups(m.skeleton, m.w, m.h, req.H, req.ox, req.oy);
    const res: TraceResponse = { kind: "trace", id: req.id, groups, mmPerPx };
    (self as unknown as Worker).postMessage(res);
    return;
  }

  const result = process(data, req.width, req.height, req.params);
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
