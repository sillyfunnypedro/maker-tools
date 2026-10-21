// Confirms the QR codes this generator produces actually scan — the one
// property that matters most for a "QR code generator" and the one the
// structural tests in renderQr.test.ts don't check. Rasterizes the real SVG
// string renderQrSvg() returns with a small purpose-built renderer (just
// enough to handle the <rect>/<circle> shapes this generator ever emits) and
// decodes it with jsQR, so this is a portable, no-external-tools stand-in for
// "open it in a camera app" — not a reimplementation of the QR bit-matrix
// logic, just rendering the exact markup the app would hand a browser.
//
// This exists because of a real, non-obvious bug: the "dots" style's circle
// radius looked fine at 0.45 (a visible but small gap between neighbouring
// dots) and still failed to scan — confirmed against jsQR across a sweep of
// text lengths and error-correction levels. 0.5-0.7 all decoded cleanly;
// 0.75+ started merging dots into blobs and failing again. Nothing about
// that is obvious from reading the SVG, so it needs an actual decode to
// catch a regression (e.g. someone "simplifying" the radius back down).
import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { renderQrSvg, type DotStyle } from "./renderQr";

interface Shape {
  kind: "rect" | "circle";
  x1: number; y1: number; x2: number; y2: number; rx: number; // rect
  cx: number; cy: number; r: number; // circle
  fill: string;
}

function parseShapes(svg: string): { shapes: Shape[]; size: number } {
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBox) throw new Error("no viewBox found");
  const size = Number(viewBox[1]);
  const shapes: Shape[] = [];
  for (const m of svg.matchAll(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"(?: rx="([\d.]+)")? fill="([^"]+)"\/>/g)) {
    const [, x, y, w, h, rx, fill] = m;
    shapes.push({
      kind: "rect", fill,
      x1: Number(x), y1: Number(y), x2: Number(x) + Number(w), y2: Number(y) + Number(h),
      rx: rx ? Number(rx) : 0, cx: 0, cy: 0, r: 0,
    });
  }
  for (const m of svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)" fill="([^"]+)"\/>/g)) {
    const [, cx, cy, r, fill] = m;
    shapes.push({ kind: "circle", cx: Number(cx), cy: Number(cy), r: Number(r), fill, x1: 0, y1: 0, x2: 0, y2: 0, rx: 0 });
  }
  if (shapes.length === 0) throw new Error("no shapes parsed — regex out of sync with renderQr.ts's output?");
  return { shapes, size };
}

function pointInShape(px: number, py: number, s: Shape): boolean {
  if (s.kind === "circle") return Math.hypot(px - s.cx, py - s.cy) <= s.r;
  if (s.rx <= 0) return px >= s.x1 && px <= s.x2 && py >= s.y1 && py <= s.y2;
  // Rounded rect: inside the inset core rect, or within radius of the
  // nearest corner's inset centre — standard point-in-rounded-rect test.
  const cx = Math.min(Math.max(px, s.x1 + s.rx), s.x2 - s.rx);
  const cy = Math.min(Math.max(py, s.y1 + s.rx), s.y2 - s.rx);
  return Math.hypot(px - cx, py - cy) <= s.rx;
}

/** Rasterize at `pxPerUnit` resolution, painter's-algorithm order (later
 *  shapes in the SVG win, matching real SVG paint order) — good enough for
 *  the flat rects/circles this generator ever emits, nothing fancier.
 *
 *  Bucketed by integer unit cell (every shape here is <=7 units across, and
 *  module cells are exactly 1x1) so each pixel only tests the handful of
 *  shapes that could plausibly cover it — a plain "test every shape against
 *  every pixel" scan is quadratic enough to time out once there are a few
 *  thousand modules (a long-text, high-error-correction QR easily has that
 *  many). */
function rasterize(svg: string, pxPerUnit: number): { data: Uint8ClampedArray; width: number; height: number } {
  const { shapes: allShapes, size } = parseShapes(svg);
  const w = Math.round(size * pxPerUnit), h = w;

  // renderQr.ts always emits the full-canvas background rect first; bucketing
  // it like every other shape would add it to every single cell (it's as big
  // as the canvas), right back to the quadratic blow-up this bucketing is
  // meant to avoid. Treat it as the default fill instead.
  const [background, ...shapes] = allShapes;
  const defaultFill = background?.fill ?? "#ffffff";

  const buckets = new Map<string, Shape[]>();
  const addTo = (cx: number, cy: number, s: Shape) => {
    const k = `${cx},${cy}`;
    const list = buckets.get(k);
    if (list) list.push(s);
    else buckets.set(k, [s]);
  };
  for (const s of shapes) {
    const [bx1, by1, bx2, by2] = s.kind === "circle"
      ? [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r]
      : [s.x1, s.y1, s.x2, s.y2];
    for (let cy = Math.floor(by1); cy < Math.ceil(by2); cy++)
      for (let cx = Math.floor(bx1); cx < Math.ceil(bx2); cx++)
        addTo(cx, cy, s);
  }

  const data = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) {
    const uy = (py + 0.5) / pxPerUnit;
    for (let px = 0; px < w; px++) {
      const ux = (px + 0.5) / pxPerUnit;
      const bucket = buckets.get(`${Math.floor(ux)},${Math.floor(uy)}`);
      let fill = defaultFill;
      if (bucket) for (const s of bucket) if (pointInShape(ux, uy, s)) fill = s.fill;
      const v = fill === "#ffffff" || fill.toLowerCase() === "#fff" ? 255 : 0;
      const o = (py * w + px) * 4;
      data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function decodes(text: string, dotStyle: DotStyle, errorCorrectionLevel: "L" | "M" | "Q" | "H" = "M"): string | null {
  const { svg } = renderQrSvg(text, { dotStyle, errorCorrectionLevel });
  const { data, width, height } = rasterize(svg, 10);
  const result = jsQR(data, width, height);
  return result?.data ?? null;
}

describe("renderQrSvg produces codes that actually scan", () => {
  const texts = ["hi", "https://example.com/maker-tools", "A".repeat(200)];

  for (const dotStyle of ["square", "rounded", "dots"] as const) {
    for (const text of texts) {
      it(`${dotStyle}, ${text.length} chars`, () => {
        expect(decodes(text, dotStyle)).toBe(text);
      });
    }
  }

  it("still scans at every error-correction level (dots style — the tightest case)", () => {
    const text = "https://example.com/qr?a=1&b=2";
    for (const ec of ["L", "M", "Q", "H"] as const) {
      expect(decodes(text, "dots", ec), ec).toBe(text);
    }
  });
});
