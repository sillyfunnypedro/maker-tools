/// <reference types="vite/client" />
// Debug dump: collects the source photo plus every pipeline intermediate and the
// exported SVG, so a bad export can be diagnosed from the actual bytes rather
// than from a screenshot. Two ways out:
//
//  - `dumpDebugBundle` POSTs to the dev server, which writes the files straight
//    to `debug-dumps/<session>/`. Best on the machine running the server.
//  - `buildDebugZip` packs the same files into one .zip for the OS share sheet
//    (Mail, AirDrop, Drive…), which is the only way off a phone.
import type { Masks } from "./processing";
import { zipStore, type ZipEntry } from "./zip";

/** Only ever true under `vite dev`; the production bundle drops this branch. */
export const DEBUG_DUMP = import.meta.env.DEV;

const ENDPOINT = "/__debug/dump";

/** `20260728-101530` — sortable, and safe as a directory name. */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Strip anything the server's filename check would reject. */
const slug = (s: string) => (s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "x");

function imageDataToPng(img: ImageData): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
}

function canvasToPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
}

/** Binary mask -> viewable PNG, ink black on white like the source drawing. */
function maskToImageData(mask: Uint8Array, w: number, h: number): ImageData {
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] ? 0 : 255;
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    img.data[o + 3] = 255;
  }
  return img;
}

export interface DumpInput {
  /** Used in the session directory name. */
  baseName: string;
  /** The untouched upload, EXIF and all. */
  photoFile: File | null;
  /** Decoded photo as the pipeline sees it. */
  photo: ImageData | null;
  /** Opening after perspective-warp, before illumination flattening. */
  rectifiedRaw: ImageData | null;
  /** …and after, which is what actually gets thresholded. */
  rectifiedFlat: ImageData | null;
  /** Skeleton / interior / lineCore for the image the pipeline ran on. */
  masks: Masks | null;
  /** On-screen preview. */
  previewCanvas: HTMLCanvasElement | null;
  /** Final export, exactly as it would be downloaded. */
  cncSvg: string | null;
  /** Params, detection result, scale, build id — see App.tsx. */
  meta: unknown;
}

async function put(session: string, name: string, body: Blob): Promise<void> {
  const r = await fetch(`${ENDPOINT}?session=${encodeURIComponent(session)}&name=${encodeURIComponent(name)}`,
    { method: "POST", body });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${await r.text()}`);
}

interface Collected {
  session: string;
  files: { name: string; blob: Blob }[];
}

/**
 * Encode everything available into blobs, numbered in pipeline order. Files that
 * aren't available (no frame detected, no export yet) are simply skipped.
 */
async function collect(input: DumpInput): Promise<Collected> {
  const session = `${stamp()}-${slug(input.baseName)}`;
  const files: { name: string; blob: Blob }[] = [];

  if (input.photoFile) {
    const ext = (input.photoFile.name.match(/\.[A-Za-z0-9]+$/)?.[0] ?? ".bin").toLowerCase();
    files.push({ name: `00-source-upload${ext}`, blob: input.photoFile });
  }
  if (input.photo) files.push({ name: "01-photo-decoded.png", blob: await imageDataToPng(input.photo) });
  if (input.rectifiedRaw) files.push({ name: "02-rectified-raw.png", blob: await imageDataToPng(input.rectifiedRaw) });
  if (input.rectifiedFlat) files.push({ name: "03-rectified-flattened.png", blob: await imageDataToPng(input.rectifiedFlat) });
  if (input.masks) {
    const { w, h, skeleton, interior, lineCore } = input.masks;
    files.push({ name: "04-mask-skeleton.png", blob: await imageDataToPng(maskToImageData(skeleton, w, h)) });
    files.push({ name: "05-mask-interior.png", blob: await imageDataToPng(maskToImageData(interior, w, h)) });
    files.push({ name: "06-mask-linecore.png", blob: await imageDataToPng(maskToImageData(lineCore, w, h)) });
  }
  if (input.previewCanvas) files.push({ name: "07-preview.png", blob: await canvasToPng(input.previewCanvas) });
  if (input.cncSvg) files.push({ name: "08-export-cnc-mm.svg", blob: new Blob([input.cncSvg], { type: "image/svg+xml" }) });
  files.push({
    name: "09-meta.json",
    blob: new Blob([JSON.stringify(input.meta, null, 2)], { type: "application/json" }),
  });

  return { session, files };
}

/** Upload to the dev server. Returns the session directory it wrote to. */
export async function dumpDebugBundle(input: DumpInput): Promise<string> {
  const { session, files } = await collect(input);
  for (const { name, blob } of files) await put(session, name, blob);
  return session;
}

/**
 * Pack the same bundle into a single .zip, entries nested under the session name
 * so it unpacks tidily. Hand the result to the OS share sheet or a download.
 */
export async function buildDebugZip(input: DumpInput): Promise<{ filename: string; blob: Blob }> {
  const { session, files } = await collect(input);
  const entries: ZipEntry[] = [];
  for (const { name, blob } of files) {
    entries.push({ name: `${session}/${name}`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  return { filename: `debug-${session}.zip`, blob: zipStore(entries) };
}
