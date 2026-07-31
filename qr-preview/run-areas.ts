// Offline areas pipeline: takes a source photo (JPEG/PNG), runs the full
// frame-detection + rectification + contour-tracing pipeline, and writes the
// intermediate images to a results directory. Same code paths as the app.
//
// Usage: npm run areas -- <photo> [bgThresh]
//   e.g. npm run areas -- debug-dumps/20260731-085258-image/00-source-upload.jpg 163

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { PNG } from "pngjs";
import { detectQrFrame } from "../src/qrframe/detect";
import { rectifyOpening, flattenIllumination, otsuThreshold } from "../src/rectify";
import { traceContours, thresholdMask, removeBorderRegions, equalizeHistogram } from "../src/contour";
import { computeMasks } from "../src/processing";

// --- Polyfill ImageData for Node (used by rectify.ts) -----------------------
if (typeof globalThis.ImageData === "undefined") {
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(sw: number | Uint8ClampedArray, sh?: number, settings?: number) {
      if (typeof sw === "number") {
        this.width = sw;
        this.height = sh!;
        this.data = new Uint8ClampedArray(sw * sh! * 4);
      } else {
        this.data = sw;
        this.width = sh!;
        this.height = settings ?? (sw.length / 4 / sh!);
      }
    }
  };
}

// --- Helpers ----------------------------------------------------------------

function decodePng(path: string): { width: number; height: number; data: Uint8ClampedArray } {
  const png = PNG.sync.read(readFileSync(path));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

function decodeImage(path: string): { width: number; height: number; data: Uint8ClampedArray } {
  // Convert any format to PNG via sips (macOS built-in), then decode.
  if (path.match(/\.(jpg|jpeg|heic|heif|tiff?)$/i)) {
    const tmp = "/tmp/_run-areas-input.png";
    execFileSync("sips", ["-s", "format", "png", path, "--out", tmp], { stdio: "pipe" });
    return decodePng(tmp);
  }
  return decodePng(path);
}

function writePng(path: string, width: number, height: number, data: Uint8ClampedArray | Uint8Array) {
  const png = new PNG({ width, height });
  for (let i = 0; i < data.length; i++) png.data[i] = data[i];
  writeFileSync(path, PNG.sync.write(png));
}

function grayscaleToRgba(gray: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = gray[i] ? 0 : 255; // 1=foreground -> black, 0=background -> white
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function imageDataToRgba(img: { width: number; height: number; data: Uint8ClampedArray }) {
  return img.data;
}

// Simple ImageData-like struct for rectify functions
function makeImageData(data: Uint8ClampedArray, width: number, height: number) {
  return { data, width, height } as unknown as ImageData;
}

// --- Main -------------------------------------------------------------------

const PROCESS_DIM = 1400;

const photoPath = process.argv[2];
if (!photoPath) {
  console.error("Usage: npm run areas -- <photo> [bgThresh]");
  process.exit(1);
}

const bgThresh = Number(process.argv[3]) || 0; // 0 = auto (Otsu)

const outDir = `qr-preview/areas-result`;
mkdirSync(outDir, { recursive: true });

console.log(`\nInput: ${photoPath}`);
console.log(`Output: ${outDir}/\n`);

// 1. Decode the source photo
const src = decodeImage(photoPath);
console.log(`01 Decoded: ${src.width}×${src.height}`);

// Downscale to pipeline resolution
const scale = Math.min(1, PROCESS_DIM / Math.max(src.width, src.height));
let photo = src;
if (scale < 1) {
  // Use sips to downscale
  const sw = Math.round(src.width * scale);
  const sh = Math.round(src.height * scale);
  const tmp = "/tmp/_run-areas-scaled.png";
  writePng("/tmp/_run-areas-full.png", src.width, src.height, src.data);
  execFileSync("sips", ["-z", String(sh), String(sw), "/tmp/_run-areas-full.png", "--out", tmp], { stdio: "pipe" });
  photo = decodePng(tmp);
  console.log(`   Scaled to ${photo.width}×${photo.height}`);
}
writePng(join(outDir, "01-photo.png"), photo.width, photo.height, photo.data);

// 2. Detect the QR frame
console.log(`02 Detecting frame...`);
const frameResult = detectQrFrame(photo.data, photo.width, photo.height);
if (!frameResult.detected) {
  console.error(`   FAILED: ${frameResult.reason || "no frame found"}`);
  console.log("   Continuing without frame (processing whole image)...\n");

  // Process the whole image without rectification
  const thresh = bgThresh || Math.round(otsuThreshold(makeImageData(photo.data, photo.width, photo.height)));
  console.log(`03 Threshold: ${thresh}`);
  const mask = thresholdMask(photo.data, photo.width, photo.height, thresh);
  writePng(join(outDir, "03-mask.png"), photo.width, photo.height, grayscaleToRgba(mask, photo.width, photo.height));

  const contours = traceContours(mask, photo.width, photo.height, 20);
  console.log(`04 Contours: ${contours.length}`);

  // Render contours
  const contourImg = new Uint8ClampedArray(photo.width * photo.height * 4);
  for (let i = 0; i < photo.width * photo.height; i++) {
    contourImg[i * 4] = contourImg[i * 4 + 1] = contourImg[i * 4 + 2] = 255;
    contourImg[i * 4 + 3] = 255;
  }
  for (const c of contours) {
    for (const [x, y] of c) {
      if (x >= 0 && x < photo.width && y >= 0 && y < photo.height) {
        const off = (y * photo.width + x) * 4;
        contourImg[off] = contourImg[off + 1] = contourImg[off + 2] = 0;
      }
    }
  }
  writePng(join(outDir, "04-contours.png"), photo.width, photo.height, contourImg);
  console.log(`\nDone. See ${outDir}/`);
  process.exit(0);
}

const spec = frameResult.spec!;
const Hmm2px = frameResult.Hmm2px!;
console.log(`   Found: "${spec.id}" ${spec.innerW}×${spec.innerH}mm, ` +
  `${frameResult.inliers}/${frameResult.nDots! + 4} points`);

// 3. Rectify the opening
const ppmm = PROCESS_DIM / Math.max(spec.innerW, spec.innerH);
console.log(`03 Rectifying at ${ppmm.toFixed(1)} px/mm...`);
const crop = rectifyOpening(
  makeImageData(photo.data, photo.width, photo.height),
  Hmm2px, spec.marginL, spec.marginT,
  spec.innerW, spec.innerH, ppmm, 3,
);
writePng(join(outDir, "03-rectified-raw.png"), crop.width, crop.height, crop.data);
console.log(`   Crop: ${crop.width}×${crop.height}`);

// 4. For areas mode: NO flattening. For comparison, also produce the flattened version.
const flat = flattenIllumination(crop, Math.round(6 * ppmm));
writePng(join(outDir, "04-rectified-flattened.png"), flat.width, flat.height, flat.data);

// 5. Areas pipeline: flatten with a LARGE radius (bigger than any shape, so it
// estimates paper brightness without being influenced by the fills), then threshold.
const largeRadius = Math.round(30 * ppmm); // ~30mm — larger than any shape in the drawing
console.log(`05 Large-radius flattening (r=${largeRadius}px, ~30mm)...`);
const flatLarge = flattenIllumination(crop, largeRadius);
writePng(join(outDir, "05-flat-large.png"), flatLarge.width, flatLarge.height, flatLarge.data);

const thresh = bgThresh || Math.max(150, Math.min(250, Math.round(otsuThreshold(flatLarge))));
console.log(`06 Threshold: ${thresh} (${bgThresh ? "user" : "Otsu on flattened"})`);

// Threshold the large-radius flattened image
const mask = thresholdMask(flatLarge.data, flatLarge.width, flatLarge.height, thresh);

// Remove any foreground region that touches the image border
removeBorderRegions(mask, crop.width, crop.height);

writePng(join(outDir, "06-mask-areas.png"), crop.width, crop.height, grayscaleToRgba(mask, crop.width, crop.height));

// 7. Contour trace
const contours = traceContours(mask, crop.width, crop.height, 20);
console.log(`07 Contours found: ${contours.length}`);
for (let i = 0; i < Math.min(contours.length, 20); i++) {
  console.log(`     #${i}: ${contours[i].length} pts`);
}

// 8. Render contours on white
const cw = crop.width, ch = crop.height;
const contourImg = new Uint8ClampedArray(cw * ch * 4);
for (let i = 0; i < cw * ch; i++) {
  contourImg[i * 4] = contourImg[i * 4 + 1] = contourImg[i * 4 + 2] = 255;
  contourImg[i * 4 + 3] = 255;
}
for (const c of contours) {
  for (const [x, y] of c) {
    if (x >= 0 && x < cw && y >= 0 && y < ch) {
      const off = (y * cw + x) * 4;
      contourImg[off] = contourImg[off + 1] = contourImg[off + 2] = 0;
    }
  }
}
writePng(join(outDir, "08-contours.png"), cw, ch, contourImg);

// 9. Also run the lines pipeline on the flattened image for comparison
const masks = computeMasks(flat.data, flat.width, flat.height, {
  mode: "lines", bgThresh: thresh, lineWidth: 8, smoothSigma: 2, pruneLen: 15, minBlob: 20,
});
writePng(join(outDir, "09-skeleton-lines.png"), masks.w, masks.h, grayscaleToRgba(masks.skeleton, masks.w, masks.h));

console.log(`\nDone. Results in ${outDir}/`);
