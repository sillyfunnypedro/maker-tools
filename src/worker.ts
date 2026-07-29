// Runs the image pipeline off the main thread so the UI stays responsive.
import { process, computeMasks, type Params } from "./processing";
import { buildCncStrokedSvg } from "./svg";
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
export interface CncRequest extends BaseRequest {
  kind: "cnc";
  /** pixel -> mm homography, opening origin (frame mm), and opening size (mm). */
  H: number[][];
  ox: number;
  oy: number;
  openW: number;
  openH: number;
  /** Straighten the finished geometry by this much (degrees). */
  rotateDeg: number;
  /** Crop to a 1/zoom window of the opening (>= 1). */
  zoom: number;
  /** Where that window sits, as an offset from the opening's centre (mm). */
  panXMm: number;
  panYMm: number;
}
export type WorkerRequest =
  | PngRequest
  | DetectRequest
  | CncRequest;

export interface PngResponse {
  kind: "png";
  id: number;
  buffer: ArrayBuffer; // RGBA result
  width: number;
  height: number;
}
export interface SvgResponse {
  kind: "svg";
  id: number;
  svg: string;
}
export interface DetectResponse {
  kind: "detect";
  id: number;
  result: QrFrameResult;
}
export type WorkerResponse =
  | PngResponse
  | SvgResponse
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

  if (req.kind === "cnc") {
    const m = computeMasks(data, req.width, req.height, req.params);
    const svg = buildCncStrokedSvg(
      m.skeleton, m.w, m.h, req.H, req.ox, req.oy, req.openW, req.openH,
      undefined, undefined, undefined, undefined,
      req.rotateDeg, req.zoom, req.panXMm, req.panYMm);
    const res: SvgResponse = { kind: "svg", id: req.id, svg };
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
