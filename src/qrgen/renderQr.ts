// Free, offline QR code generator: everything happens in this function,
// client-side — no network calls, no analytics, nothing phoned home. Renders
// styled SVG directly from the QR module matrix (via the `qrcode` package's
// `create()`, which only computes the matrix — it never touches the network)
// rather than drawing plain squares, so a few different dot styles are
// available instead of the one default that every QR library ships with.
import QRCode from "qrcode";

export type DotStyle = "square" | "rounded" | "dots";

export interface QrRenderOptions {
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
  dotStyle?: DotStyle;
  /** Quiet-zone width, in modules. The QR spec requires at least 4. */
  marginModules?: number;
  fgColor?: string;
  bgColor?: string;
}

export interface QrRenderResult {
  svg: string;
  /** Module grid size (not counting the margin), e.g. 25 for a version-2 QR. */
  moduleCount: number;
}

/** The three 7x7 finder (position) patterns always sit at these corners,
 *  regardless of QR version — a fixed structural fact of the QR spec, not
 *  something read out of the `qrcode` package's internals. */
function isFinderModule(x: number, y: number, n: number): boolean {
  const inTL = x < 7 && y < 7;
  const inTR = x >= n - 7 && y < 7;
  const inBL = x < 7 && y >= n - 7;
  return inTL || inTR || inBL;
}

function rect(x: number, y: number, w: number, h: number, fill: string, rx: number): string {
  const rxAttr = rx > 0 ? ` rx="${rx}"` : "";
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rxAttr} fill="${fill}"/>`;
}

function moduleShape(x: number, y: number, style: DotStyle, color: string): string {
  // Radius matters more than it looks: a plausible-looking 0.45 (a small gap
  // between neighbouring dots) actually fails to scan — confirmed against
  // jsQR across a range of text lengths and error-correction levels, likely
  // because the gaps between modules disrupt the timing-pattern-style
  // synchronisation a decoder relies on alongside the three finder squares.
  // 0.5-0.7 all decoded cleanly in that sweep; 0.75+ started merging
  // neighbouring dots into blobs and failing too. 0.6 sits in the middle of
  // the confirmed-safe range on both sides, not pinned to either edge.
  if (style === "dots") return `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.6" fill="${color}"/>`;
  if (style === "rounded") return rect(x + 0.05, y + 0.05, 0.9, 0.9, color, 0.25);
  return rect(x, y, 1, 1, color, 0);
}

/** One finder pattern as three concentric squares (ring + centre), drawn as a
 *  whole rather than module-by-module — the usual "eye" look stylised QR
 *  generators use, with the inner ring punched out by drawing it in the
 *  background colour rather than an even-odd path (safe here since nothing
 *  else is ever drawn under a finder pattern). */
function finderShape(ox: number, oy: number, style: DotStyle, fg: string, bg: string): string {
  if (style === "square") {
    return rect(ox, oy, 7, 7, fg, 0) + rect(ox + 1, oy + 1, 5, 5, bg, 0) + rect(ox + 2, oy + 2, 3, 3, fg, 0);
  }
  const [outerR, innerR, centerR] = style === "dots" ? [3.5, 2.5, 1.5] : [1.8, 1.2, 0.7];
  return (
    rect(ox, oy, 7, 7, fg, outerR) +
    rect(ox + 1, oy + 1, 5, 5, bg, innerR) +
    rect(ox + 2, oy + 2, 3, 3, fg, centerR)
  );
}

export function renderQrSvg(text: string, opts: QrRenderOptions = {}): QrRenderResult {
  const {
    errorCorrectionLevel = "M",
    dotStyle = "square",
    marginModules = 4,
    fgColor = "#000000",
    bgColor = "#ffffff",
  } = opts;
  if (!text) throw new Error("text must not be empty");

  const qr = QRCode.create(text, { errorCorrectionLevel });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const total = n + marginModules * 2;

  const parts: string[] = [rect(0, 0, total, total, bgColor, 0)];

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!data[y * n + x] || isFinderModule(x, y, n)) continue;
      parts.push(moduleShape(marginModules + x, marginModules + y, dotStyle, fgColor));
    }
  }

  for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
    parts.push(finderShape(marginModules + fx, marginModules + fy, dotStyle, fgColor, bgColor));
  }

  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
      `width="${total}" height="${total}">${parts.join("")}</svg>`,
    moduleCount: n,
  };
}
