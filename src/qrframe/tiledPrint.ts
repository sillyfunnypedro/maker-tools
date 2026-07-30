// Tiled print: split a large frame across multiple Letter-sized pages with
// overlap strips and alignment marks so the user can tape them together.
//
// Each page shows a window onto the full frame artwork, offset so adjacent pages
// overlap. The overlap strip carries alignment crosshairs — but ONLY in areas
// that fall outside the frame's outer boundary (the trim zone). This prevents
// them from being confused with the frame's own registration dots.
//
// Tiles that contain no frame content at all are skipped entirely.

import { frameMarks, type FrameOptions } from "./generate";
import { outerH, outerW, type QrFrameSpec } from "./spec";

/** US Letter in mm. */
const PAGE_W = 215.9;
const PAGE_H = 279.4;

/** Unprintable margin on each edge (conservative for most laser/inkjet). */
const MARGIN = 6;

/** Printable area per page. */
const PRINT_W = PAGE_W - 2 * MARGIN;
const PRINT_H = PAGE_H - 2 * MARGIN;

/** Minimum overlap between adjacent tiles (mm). */
const MIN_OVERLAP = 5;

export interface TilePage {
  svg: string;
  row: number;
  col: number;
  rows: number;
  cols: number;
}

export interface TiledLayout {
  pages: TilePage[];
  rows: number;
  cols: number;
  spec: QrFrameSpec;
}

/**
 * Calculate tile count and step for one axis.
 * Uses the fewest tiles possible while maintaining at least MIN_OVERLAP.
 */
function tileCounts(frameSize: number, printSize: number): { count: number; step: number } {
  if (frameSize <= printSize) return { count: 1, step: 0 };
  const twoOverlap = 2 * printSize - frameSize;
  if (twoOverlap >= MIN_OVERLAP) return { count: 2, step: frameSize - printSize };
  const count = Math.ceil((frameSize - MIN_OVERLAP) / (printSize - MIN_OVERLAP));
  const step = (frameSize - printSize) / Math.max(1, count - 1);
  return { count, step };
}

/** Does a tile at this origin overlap the frame bounding box? */
function tileHasContent(ox: number, oy: number, frameW: number, frameH: number): boolean {
  return ox < frameW && oy < frameH && ox + PRINT_W > 0 && oy + PRINT_H > 0;
}

/**
 * Generate tiled SVG pages for a frame that's too large for a single Letter page.
 * Returns null if the frame already fits on one page (no tiling needed).
 */
export function tiledPrintSvgs(spec: QrFrameSpec, opts: FrameOptions = {}): TiledLayout | null {
  const frameW = outerW(spec);
  const frameH = outerH(spec);

  if (frameW <= PRINT_W && frameH <= PRINT_H) return null;
  if (frameH <= PRINT_W && frameW <= PRINT_H) return null;

  const { count: cols, step: stepX } = tileCounts(frameW, PRINT_W);
  const { count: rows, step: stepY } = tileCounts(frameH, PRINT_H);

  const overlapX = PRINT_W - stepX; // actual horizontal overlap between adjacent tiles
  const overlapY = PRINT_H - stepY; // actual vertical overlap

  const pages: TilePage[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ox = cols === 1 ? 0 : col * stepX;
      const oy = rows === 1 ? 0 : row * stepY;

      if (!tileHasContent(ox, oy, frameW, frameH)) continue;

      const svg = tileSvg(spec, opts, ox, oy, row, col, rows, cols, frameW, frameH, overlapX, overlapY);
      pages.push({ svg, row, col, rows, cols });
    }
  }

  return { pages, rows, cols, spec };
}

/** Is a point (in frame coords) inside the frame's outer boundary? */
function insideFrame(fx: number, fy: number, frameW: number, frameH: number): boolean {
  return fx >= 0 && fx <= frameW && fy >= 0 && fy <= frameH;
}

function tileSvg(
  spec: QrFrameSpec, opts: FrameOptions,
  ox: number, oy: number,
  row: number, col: number,
  rows: number, cols: number,
  frameW: number, frameH: number,
  overlapX: number, overlapY: number,
): string {
  const parts: string[] = [];

  parts.push(
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
    `width="${PAGE_W}mm" height="${PAGE_H}mm" viewBox="0 0 ${PAGE_W} ${PAGE_H}">`,
    `  <rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="white"/>`,
  );

  // Clip to printable area and show the frame artwork for this tile's window.
  parts.push(
    `  <defs><clipPath id="tile"><rect x="${MARGIN}" y="${MARGIN}" width="${PRINT_W}" height="${PRINT_H}"/></clipPath></defs>`,
    `  <g clip-path="url(#tile)">`,
    `    <g transform="translate(${(MARGIN - ox).toFixed(3)},${(MARGIN - oy).toFixed(3)})">`,
    `      ${frameMarks(spec, opts)}`,
    `    </g>`,
    `  </g>`,
  );

  // Trim lines (dashed grey) — cut here after taping.
  parts.push(`  <g stroke="#999" stroke-width="0.2" stroke-dasharray="2,2" fill="none">`);
  if (col > 0) {
    const x = MARGIN + overlapX / 2;
    parts.push(`    <line x1="${x.toFixed(2)}" y1="${MARGIN}" x2="${x.toFixed(2)}" y2="${PAGE_H - MARGIN}"/>`);
  }
  if (col < cols - 1) {
    const x = PAGE_W - MARGIN - overlapX / 2;
    parts.push(`    <line x1="${x.toFixed(2)}" y1="${MARGIN}" x2="${x.toFixed(2)}" y2="${PAGE_H - MARGIN}"/>`);
  }
  if (row > 0) {
    const y = MARGIN + overlapY / 2;
    parts.push(`    <line x1="${MARGIN}" y1="${y.toFixed(2)}" x2="${PAGE_W - MARGIN}" y2="${y.toFixed(2)}"/>`);
  }
  if (row < rows - 1) {
    const y = PAGE_H - MARGIN - overlapY / 2;
    parts.push(`    <line x1="${MARGIN}" y1="${y.toFixed(2)}" x2="${PAGE_W - MARGIN}" y2="${y.toFixed(2)}"/>`);
  }
  parts.push(`  </g>`);

  // Alignment crosshairs — ONLY placed outside the frame's outer boundary.
  parts.push(`  <g stroke="black" stroke-width="0.25" fill="none">`);
  const CROSS = 3;
  const SPACING = 40;

  for (const edge of ["left", "right"] as const) {
    if (edge === "left" && col === 0) continue;
    if (edge === "right" && col === cols - 1) continue;
    const cx = edge === "left" ? MARGIN + overlapX / 2 : PAGE_W - MARGIN - overlapX / 2;
    const count = Math.max(2, Math.floor(PRINT_H / SPACING));
    const step = PRINT_H / (count + 1);
    for (let i = 1; i <= count; i++) {
      const cy = MARGIN + i * step;
      const fx = cx - MARGIN + ox;
      const fy = cy - MARGIN + oy;
      if (insideFrame(fx, fy, frameW, frameH)) continue;
      parts.push(`    <line x1="${(cx - CROSS).toFixed(2)}" y1="${cy.toFixed(2)}" x2="${(cx + CROSS).toFixed(2)}" y2="${cy.toFixed(2)}"/>`);
      parts.push(`    <line x1="${cx.toFixed(2)}" y1="${(cy - CROSS).toFixed(2)}" x2="${cx.toFixed(2)}" y2="${(cy + CROSS).toFixed(2)}"/>`);
    }
  }

  for (const edge of ["top", "bottom"] as const) {
    if (edge === "top" && row === 0) continue;
    if (edge === "bottom" && row === rows - 1) continue;
    const cy = edge === "top" ? MARGIN + overlapY / 2 : PAGE_H - MARGIN - overlapY / 2;
    const count = Math.max(2, Math.floor(PRINT_W / SPACING));
    const step = PRINT_W / (count + 1);
    for (let i = 1; i <= count; i++) {
      const cx = MARGIN + i * step;
      const fx = cx - MARGIN + ox;
      const fy = cy - MARGIN + oy;
      if (insideFrame(fx, fy, frameW, frameH)) continue;
      parts.push(`    <line x1="${(cx - CROSS).toFixed(2)}" y1="${cy.toFixed(2)}" x2="${(cx + CROSS).toFixed(2)}" y2="${cy.toFixed(2)}"/>`);
      parts.push(`    <line x1="${cx.toFixed(2)}" y1="${(cy - CROSS).toFixed(2)}" x2="${cx.toFixed(2)}" y2="${(cy + CROSS).toFixed(2)}"/>`);
    }
  }
  parts.push(`  </g>`);

  // Page label.
  const stepXLocal = cols === 1 ? 0 : (frameW - PRINT_W) / (cols - 1);
  const stepYLocal = rows === 1 ? 0 : (frameH - PRINT_H) / (rows - 1);
  const total = countPages(rows, cols, stepXLocal, stepYLocal, frameW, frameH);
  const num = pageNumber(row, col, rows, cols, stepXLocal, stepYLocal, frameW, frameH);
  const label = `Page ${num} of ${total}  (row ${row + 1}/${rows}, col ${col + 1}/${cols})`;
  parts.push(
    `  <text x="${PAGE_W - MARGIN - 1}" y="${MARGIN - 1.5}" ` +
    `font-family="sans-serif" font-size="2.5" text-anchor="end" fill="#666">${label}</text>`,
  );

  // Assembly diagram.
  const diagramX = MARGIN + 2;
  const diagramY = MARGIN - 8;
  const cellSize = 3.5;
  parts.push(`  <g fill="none" stroke="#999" stroke-width="0.15">`);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tox = cols === 1 ? 0 : c * stepXLocal;
      const toy = rows === 1 ? 0 : r * stepYLocal;
      const has = tileHasContent(tox, toy, frameW, frameH);
      let fill = "none";
      if (r === row && c === col) fill = "#4f9dff";
      else if (!has) fill = "#eee";
      parts.push(
        `    <rect x="${(diagramX + c * cellSize).toFixed(1)}" y="${(diagramY + r * cellSize).toFixed(1)}" ` +
        `width="${cellSize}" height="${cellSize}" fill="${fill}"/>`,
      );
    }
  }
  parts.push(`  </g>`);

  parts.push(`</svg>`);
  return parts.join("\n");
}

function countPages(rows: number, cols: number, stepX: number, stepY: number, frameW: number, frameH: number): number {
  let n = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const ox = cols === 1 ? 0 : c * stepX;
      const oy = rows === 1 ? 0 : r * stepY;
      if (tileHasContent(ox, oy, frameW, frameH)) n++;
    }
  return n;
}

function pageNumber(row: number, col: number, rows: number, cols: number, stepX: number, stepY: number, frameW: number, frameH: number): number {
  let n = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const ox = cols === 1 ? 0 : c * stepX;
      const oy = rows === 1 ? 0 : r * stepY;
      if (tileHasContent(ox, oy, frameW, frameH)) {
        n++;
        if (r === row && c === col) return n;
      }
    }
  return n;
}
