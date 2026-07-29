// Print layout: place a frame on a standard paper page at true millimetre scale.
//
// The frame is a measuring instrument — every exported dimension comes from its
// printed size, so a print scaled by 2% makes every cut wrong by 2%. Two choices
// here protect that:
//
//  1. The page is a standard paper size, not the size of the artwork. A print
//     dialog left on "Fit to page" then scales by 1.0, instead of blowing a
//     196 mm frame up to fill the sheet. (Print at 100% / "Actual size" anyway —
//     this just makes the usual mistake harmless.)
//  2. The artwork is centred with a plain `translate` in millimetre user units.
//     Nesting an `<svg width="196mm">` inside another SVG would NOT be safe:
//     inside a viewBox coordinate system mm resolves through the CSS pixel
//     conversion rather than user units, silently rescaling the art.
import { frameMarks, type FrameOptions } from "./generate";
import { outerH, outerW, type QrFrameSpec } from "./spec";

export interface Paper {
  name: string;
  w: number;
  h: number;
}

/** Papers we auto-fit to, smallest first. */
export const PAPERS: Paper[] = [
  { name: "Letter", w: 215.9, h: 279.4 },
  { name: "Legal", w: 215.9, h: 355.6 },
  { name: "Tabloid", w: 279.4, h: 431.8 },
];

export interface Fit {
  paper: Paper;
  pageW: number;
  pageH: number;
  orientation: "portrait" | "landscape";
}

/** Smallest paper the artwork fits on, portrait or landscape; null if none does. */
export function fitPaper(w: number, h: number): Fit | null {
  for (const paper of PAPERS) {
    if (w <= paper.w && h <= paper.h)
      return { paper, pageW: paper.w, pageH: paper.h, orientation: "portrait" };
    if (w <= paper.h && h <= paper.w)
      return { paper, pageW: paper.h, pageH: paper.w, orientation: "landscape" };
  }
  return null;
}

export interface PageLayout {
  svg: string;
  pageW: number;
  pageH: number;
  /** null when no standard paper fits and the page is the artwork's own size. */
  fit: Fit | null;
  /** Offset of the frame's outer top-left corner on the page (mm). */
  dx: number;
  dy: number;
  /** Smallest white border around the artwork (mm). */
  marginMm: number;
}

export function printPageSvg(spec: QrFrameSpec, opts: FrameOptions = {}): PageLayout {
  const w = outerW(spec), h = outerH(spec);
  const fit = fitPaper(w, h);
  // No standard paper fits: use a page exactly the size of the artwork. Still
  // true-scale, but needs large-format printing (or tiling).
  const pageW = fit ? fit.pageW : w;
  const pageH = fit ? fit.pageH : h;
  const dx = (pageW - w) / 2, dy = (pageH - h) / 2;
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
    `width="${pageW}mm" height="${pageH}mm" viewBox="0 0 ${pageW} ${pageH}">\n` +
    `  <rect x="0" y="0" width="${pageW}" height="${pageH}" fill="white"/>\n` +
    `  <g transform="translate(${dx.toFixed(3)},${dy.toFixed(3)})">\n` +
    `    ${frameMarks(spec, opts)}\n` +
    `  </g>\n</svg>\n`;
  return { svg, pageW, pageH, fit, dx, dy, marginMm: Math.min(dx, dy) };
}

/** One-line human summary for the emitter's console output. */
export function layoutNote(l: PageLayout): string {
  if (!l.fit) {
    return `NO STANDARD PAPER FITS — page is ${l.pageW}×${l.pageH} mm, needs large-format printing`;
  }
  const tight = l.marginMm < 7 ? " (tight — check your printer's unprintable edge)" : "";
  return `${l.fit.paper.name} ${l.fit.orientation} · ${l.marginMm.toFixed(1)} mm margin${tight}`;
}
