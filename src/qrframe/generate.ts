// QR-frame generator: emits the printable frame as an SVG at true millimetre
// size (black marks on white paper). The QR carries the self-describing spec, so
// the printed sheet and the detector share one source of truth.
import QRCode from "qrcode";
import {
  encodePayload, dotLayoutMm, outerW, outerH, STANDARD_SPECS, type QrFrameSpec,
} from "./spec";

export { STANDARD_SPECS };

function qrRects(spec: QrFrameSpec): string {
  const qr = QRCode.create(encodePayload(spec), { errorCorrectionLevel: "M" });
  const N = qr.modules.size, data = qr.modules.data, mod = spec.qrSize / N;
  const parts: string[] = [];
  for (let my = 0; my < N; my++)
    for (let mx = 0; mx < N; mx++)
      if (data[my * N + mx])
        parts.push(`M${(spec.qrX + mx * mod).toFixed(3)} ${(spec.qrY + my * mod).toFixed(3)}h${mod.toFixed(3)}v${mod.toFixed(3)}h${(-mod).toFixed(3)}z`);
  return `<path d="${parts.join("")}" fill="black" stroke="none"/>`;
}

/**
 * The frame's marks in millimetre user units, origin at the frame's outer
 * top-left — no document wrapper and no page background.
 *
 * Split out from `svgFrame` so a print layout can place the frame on a paper-size
 * page with a plain `translate`. Nesting an `<svg width="196mm">` inside another
 * SVG would not work: inside a viewBox coordinate system, mm resolves through the
 * CSS pixel conversion rather than user units, which silently rescales the art —
 * fatal for a frame whose whole purpose is to be measured.
 */
export interface FrameOptions {
  /**
   * Draw the reference square + circle inside the opening.
   *
   * On a *test* sheet they're the whole point: known dimensions to photograph and
   * measure the pipeline against. On a *blank* sheet they'd be in the way — the
   * opening has to be empty so it can be drawn in, or cut out and laid over
   * something else. Detection is unaffected either way; it reads only the QR and
   * the registration dots, all of which live in the margins.
   */
  sample?: boolean;
  /**
   * Text printed in the page's blank margin above the frame — e.g. a name and/or
   * a URL. Ignored here: it's positioned relative to the *page*, not the frame
   * artwork, so only `printPageSvg` (which knows the page size) renders it.
   */
  label?: string;
}

export function frameMarks(spec: QrFrameSpec, opts: FrameOptions = {}): string {
  const { sample = true } = opts;
  const ox = spec.marginL, oy = spec.marginT;
  const p: string[] = [];
  // opening outline — the scan window, and the line to cut along to make a
  // physical frame. Offset right/down of the QR block.
  p.push(`<rect x="${ox}" y="${oy}" width="${spec.innerW}" height="${spec.innerH}" fill="none" stroke="black" stroke-width="0.3"/>`);
  // registration dots
  for (const [x, y] of dotLayoutMm(spec))
    p.push(`<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${(spec.dotD / 2).toFixed(3)}" fill="black" stroke="none"/>`);
  // QR (id + orientation + spec)
  p.push(qrRects(spec));
  if (sample) {
    const cx = ox + spec.innerW / 2, cy = oy + spec.innerH / 2, q = spec.scaleMm;
    p.push(`<rect x="${(cx - q / 2).toFixed(2)}" y="${(cy - q / 2).toFixed(2)}" width="${q}" height="${q}" fill="none" stroke="black" stroke-width="0.5"/>`);
    p.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(q / 4).toFixed(2)}" fill="none" stroke="black" stroke-width="0.5"/>`);
  }
  return p.join("\n  ");
}

/** Printable frame SVG (true mm). Black on white; opening outlined; reference
 *  square + half-diameter circle inside unless `sample: false`. */
export function svgFrame(spec: QrFrameSpec, opts: FrameOptions = {}): string {
  const W = outerW(spec), H = outerH(spec);
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n` +
    `  <rect x="0" y="0" width="${W}" height="${H}" fill="white"/>\n  ${frameMarks(spec, opts)}\n</svg>\n`;
}
