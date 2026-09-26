// Turns a reference image into a black-and-white line drawing (Sobel edge
// detection, thresholded), for AR Trace's "line detection" toggle — a photo
// or shaded picture is much easier to trace by hand once it's reduced to
// clean outlines than in its original color/tone.

const GX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const GY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

/**
 * Draws `img` to an offscreen canvas (downscaled to `maxDim` on its long side,
 * for consistent performance regardless of the source photo's resolution),
 * runs a Sobel gradient over its grayscale values, and returns a same-size PNG
 * data URL: black where the gradient magnitude exceeds `threshold`, white
 * elsewhere.
 */
export function detectLines(img: HTMLImageElement, threshold: number, maxDim = 1200): string {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const src = ctx.getImageData(0, 0, w, h).data;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    gray[i] = src[o] * 0.299 + src[o + 1] * 0.587 + src[o + 2] * 0.114;
  }

  const at = (x: number, y: number) => gray[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];

  const out = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let gx = 0, gy = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = at(x + dx, y + dy);
          gx += v * GX[k];
          gy += v * GY[k];
          k++;
        }
      }
      const isLine = Math.hypot(gx, gy) > threshold;
      const o = (y * w + x) * 4;
      const v = isLine ? 0 : 255;
      out.data[o] = v;
      out.data[o + 1] = v;
      out.data[o + 2] = v;
      out.data[o + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL("image/png");
}
