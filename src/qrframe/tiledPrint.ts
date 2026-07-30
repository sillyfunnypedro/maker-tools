// Tiled print: split a large frame across multiple Letter-sized pages with
// overlap strips and alignment marks so the user can tape them together.
//
// Each page shows a window onto the full frame artwork, offset so adjacent pages
// overlap by OVERLAP mm. The overlap strip carries registration crosshairs on
// both pages — line them up when taping. A page label ("Row 1, Col 2 of 2×3")
// and trim lines help the user orient the assembly.
//
// The output is one SVG per tile page; the caller (emit-print.ts) converts each
// to PDF and stitches them into a single multi-page document.

import { frameMarks, type FrameOptions } from "./generate";
import { outerH, outerW, type QrFrameSpec } from "./spec";

/** US Letter in mm — the tile target. */
const PAGE_W = 215.9;
const PAGE_H = 279.4;

/** Unprintable margin on each edge (conservative for most laser/inkjet). */
const MARGIN = 6;

/** Printable area per page. */
const PRINT_W = PAGE_W - 2 * MARGIN;
const PRINT_H = PAGE_H - 2 * MARGIN;

/** Overlap between adjacent tiles (mm). Enough to tape comfortably. */
const OVERLAP = 15;

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
 * Generate tiled SVG pages for a frame that's too large for a single Letter page.
 * Returns null if the frame already fits on one page (no tiling needed).
 */
export function tiledPrintSvgs(spec: QrFrameSpec, opts: FrameOptions = {}): TiledLayout | null {
  const frameW = outerW(spec);
  const frameH = outerH(spec);

  // If it fits on Letter already, no tiling needed.
  if (frameW <= PRINT_W && frameH <= PRINT_H) return null;
  if (frameH <= PRINT_W && frameW <= PRINT_H) return null;

  // Calculate grid: how many tiles needed in each direction.
  // Each tile after the first adds (PRINT_W - OVERLAP) of new coverage.
  const cols = Math.ceil((frameW - OVERLAP) / (PRINT_W - OVERLAP));
  const rows = Math.ceil((frameH - OVERLAP) / (PRINT_H - OVERLAP));

  // Effective step between tile origins.
  const stepX = (frameW - PRINT_W) / Math.max(1, cols - 1);
  const stepY = (frameH - PRINT_H) / Math.max(1, rows - 1);

  const pages: TilePage[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Top-left corner of this tile's window in frame coordinates.
      const ox = cols === 1 ? 0 : col * stepX;
      const oy = rows === 1 ? 0 : row * stepY;

      const svg = tileSvg(spec, opts, ox, oy, row, col, rows, cols);
      pages.push({ svg, row, col, rows, cols });
    }
  }

  return { pages, rows, cols, spec };
}

function tileSvg(
  spec: QrFrameSpec, opts: FrameOptions,
  ox: number, oy: number,
  row: number, col: number,
  rows: number, cols: number,
): string {
  const parts: string[] = [];

  // SVG header — Letter page, mm units.
  parts.push(
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
    `width="${PAGE_W}mm" height="${PAGE_H}mm" viewBox="0 0 ${PAGE_W} ${PAGE_H}">`,
    `  <rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="white"/>`,
  );

  // Clip to printable area, then translate so the frame artwork appears at the
  // correct offset for this tile.
  parts.push(
    `  <defs><clipPath id="tile"><rect x="${MARGIN}" y="${MARGIN}" width="${PRINT_W}" height="${PRINT_H}"/></clipPath></defs>`,
    `  <g clip-path="url(#tile)">`,
    `    <g transform="translate(${(MARGIN - ox).toFixed(3)},${(MARGIN - oy).toFixed(3)})">`,
    `      ${frameMarks(spec, opts)}`,
    `    </g>`,
    `  </g>`,
  );

  // Trim lines at the edges (dashed grey) showing where to cut/fold for assembly.
  parts.push(`  <g stroke="#999" stroke-width="0.2" stroke-dasharray="2,2" fill="none">`);
  // Left trim (if not first column)
  if (col > 0) {
    const x = MARGIN + OVERLAP / 2;
    parts.push(`    <line x1="${x.toFixed(2)}" y1="${MARGIN}" x2="${x.toFixed(2)}" y2="${PAGE_H - MARGIN}"/>`);
  }
  // Right trim (if not last column)
  if (col < cols - 1) {
    const x = PAGE_W - MARGIN - OVERLAP / 2;
    parts.push(`    <line x1="${x.toFixed(2)}" y1="${MARGIN}" x2="${x.toFixed(2)}" y2="${PAGE_H - MARGIN}"/>`);
  }
  // Top trim (if not first row)
  if (row > 0) {
    const y = MARGIN + OVERLAP / 2;
    parts.push(`    <line x1="${MARGIN}" y1="${y.toFixed(2)}" x2="${PAGE_W - MARGIN}" y2="${y.toFixed(2)}"/>`);
  }
  // Bottom trim (if not last row)
  if (row < rows - 1) {
    const y = PAGE_H - MARGIN - OVERLAP / 2;
    parts.push(`    <line x1="${MARGIN}" y1="${y.toFixed(2)}" x2="${PAGE_W - MARGIN}" y2="${y.toFixed(2)}"/>`);
  }
  parts.push(`  </g>`);

  // Alignment crosshairs in overlap zones — small + marks every ~40mm along
  // each overlap strip.
  parts.push(`  <g stroke="black" stroke-width="0.25" fill="none">`);
  const CROSS = 3; // half-size of each crosshair arm
  const SPACING = 40; // spacing between crosshairs along an edge

  // Vertical overlap strips (left and right edges of this tile).
  for (const edge of ["left", "right"] as const) {
    if (edge === "left" && col === 0) continue;
    if (edge === "right" && col === cols - 1) continue;
    const cx = edge === "left" ? MARGIN + OVERLAP / 2 : PAGE_W - MARGIN - OVERLAP / 2;
    const count = Math.max(2, Math.floor(PRINT_H / SPACING));
    const step = PRINT_H / (count + 1);
    for (let i = 1; i <= count; i++) {
      const cy = MARGIN + i * step;
      parts.push(`    <line x1="${(cx - CROSS).toFixed(2)}" y1="${cy.toFixed(2)}" x2="${(cx + CROSS).toFixed(2)}" y2="${cy.toFixed(2)}"/>`);
      parts.push(`    <line x1="${cx.toFixed(2)}" y1="${(cy - CROSS).toFixed(2)}" x2="${cx.toFixed(2)}" y2="${(cy + CROSS).toFixed(2)}"/>`);
    }
  }

  // Horizontal overlap strips (top and bottom edges of this tile).
  for (const edge of ["top", "bottom"] as const) {
    if (edge === "top" && row === 0) continue;
    if (edge === "bottom" && row === rows - 1) continue;
    const cy = edge === "top" ? MARGIN + OVERLAP / 2 : PAGE_H - MARGIN - OVERLAP / 2;
    const count = Math.max(2, Math.floor(PRINT_W / SPACING));
    const step = PRINT_W / (count + 1);
    for (let i = 1; i <= count; i++) {
      const cx = MARGIN + i * step;
      parts.push(`    <line x1="${(cx - CROSS).toFixed(2)}" y1="${cy.toFixed(2)}" x2="${(cx + CROSS).toFixed(2)}" y2="${cy.toFixed(2)}"/>`);
      parts.push(`    <line x1="${cx.toFixed(2)}" y1="${(cy - CROSS).toFixed(2)}" x2="${cx.toFixed(2)}" y2="${(cy + CROSS).toFixed(2)}"/>`);
    }
  }
  parts.push(`  </g>`);

  // Page label (top-right corner, small text).
  const label = `Page ${row * cols + col + 1} of ${rows * cols}  (row ${row + 1}/${rows}, col ${col + 1}/${cols})`;
  parts.push(
    `  <text x="${PAGE_W - MARGIN - 1}" y="${MARGIN - 1.5}" ` +
    `font-family="sans-serif" font-size="2.5" text-anchor="end" fill="#666">${label}</text>`,
  );

  // Assembly diagram — a small grid showing which tile this is.
  const diagramX = MARGIN + 2;
  const diagramY = MARGIN - 8;
  const cellSize = 3.5;
  parts.push(`  <g fill="none" stroke="#999" stroke-width="0.15">`);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const fill = r === row && c === col ? "#4f9dff" : "none";
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
