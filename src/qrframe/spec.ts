// QR-frame specification + payload.
//
// The QR carries the frame's own size (opening width/height + scale), so the
// printed sheet and the detector always agree on what they're measuring. The
// rest of the layout — margins, the QR's own position/size, dot spacing/
// diameter — is looked up from STANDARD_SPECS by id rather than encoded, since
// it's already fixed per id and doesn't vary independently of it; that keeps
// the QR payload short (fewer modules, bigger/more reliable module size at the
// same printed footprint) at the cost of a frame `id` needing an entry in
// STANDARD_SPECS to be recognised. All lengths are millimetres in the frame's
// OUTER coordinate system (origin = outer top-left corner).
//
// Layout: the QR lives in a wide top-left margin block so the scanning window
// stays clear; the opening is offset right/down by (marginL, marginT). The right
// and bottom margins are narrow strips that just carry a row of dots.
import type { Pt } from "./homography";

export interface QrFrameSpec {
  id: string;
  innerW: number;    // opening width
  innerH: number;    // opening height
  scaleMm: number;   // sample square side (circle = scaleMm/2 diameter)
  marginL: number;   // left border strip  (wide: holds the QR)
  marginT: number;   // top border strip   (wide: holds the QR)
  marginR: number;   // right border strip (narrow: dots only)
  marginB: number;   // bottom border strip(narrow: dots only)
  qrX: number;       // QR module-area rect (outer-mm coords), in the top-left block
  qrY: number;
  qrSize: number;
  dotSpacing: number; // spacing between edge dots
  dotD: number;       // dot diameter
}

/**
 * The standard frame sizes (mm). Wide top-left margins hold the QR clear of the
 * scanning window; right/bottom are narrow dot strips — sized to
 * `dotD + 4` (a 2mm clearance on each side of the dot, enough to keep it off
 * both the paper edge and the opening's outline), which is the tightest this
 * layout can go without risking dot detection. The wide QR margins are already
 * at their own floor (`qrX + qrSize + 3`) and aren't shrinkable further without
 * touching the QR itself. Every outer sheet size here is unchanged from before
 * this margin trim — the reclaimed space went entirely to the opening, so the
 * paper each size fits on hasn't changed. Also the decode-time registry:
 * `decodePayload` looks up everything but id/innerW/innerH/scaleMm here, keyed
 * by id.
 *
 * A sheet printed today only carries its id + size; it trusts this table for
 * the rest. So an existing entry's layout numbers (margins, qrX/Y/qrSize,
 * dotSpacing, dotD) must never change once a sheet with that id might be in
 * print — a physical sheet has no way to tell the app its numbers changed
 * underneath it. If a size ever needs new numbers, give it a new id instead
 * (or bump PAYLOAD_MAGIC/PAYLOAD_MAGIC_LEGACY and start a new registry).
 */
export const STANDARD_SPECS: QrFrameSpec[] = [
  { id: "std", innerW: 154, innerH: 172, scaleMm: 90, marginL: 34, marginT: 34, marginR: 8, marginB: 8, qrX: 4, qrY: 4, qrSize: 27, dotSpacing: 14, dotD: 4 },
  { id: "half", innerW: 77, innerH: 86, scaleMm: 45, marginL: 26, marginT: 26, marginR: 7, marginB: 7, qrX: 3, qrY: 3, qrSize: 20, dotSpacing: 11, dotD: 3 },
  { id: "square100", innerW: 100, innerH: 100, scaleMm: 60, marginL: 28, marginT: 28, marginR: 7.5, marginB: 7.5, qrX: 3, qrY: 3, qrSize: 22, dotSpacing: 12, dotD: 3.5 },
  { id: "large", innerW: 221, innerH: 284, scaleMm: 150, marginL: 38, marginT: 38, marginR: 9, marginB: 9, qrX: 5, qrY: 5, qrSize: 30, dotSpacing: 16, dotD: 5 },
  { id: "bigsquare", innerW: 251, innerH: 251, scaleMm: 150, marginL: 38, marginT: 38, marginR: 9, marginB: 9, qrX: 5, qrY: 5, qrSize: 30, dotSpacing: 16, dotD: 5 },
  // Sized to use the full length of an 11x17 (Tabloid) sheet, not just fit within
  // it — outer 262x412mm on a 279.4x431.8mm sheet, ~9mm margin all round.
  { id: "tabloid", innerW: 215, innerH: 365, scaleMm: 150, marginL: 38, marginT: 38, marginR: 9, marginB: 9, qrX: 5, qrY: 5, qrSize: 30, dotSpacing: 16, dotD: 5 },
];

/** Current format: `magic;id;innerW;innerH;scaleMm`, layout looked up by id. */
export const PAYLOAD_MAGIC = "SGF2";
/** Original format: `magic;id;innerW;innerH;scaleMm;marginL;marginT;marginR;
 *  marginB;qrX;qrY;qrSize;dotSpacing;dotD` — fully self-describing, no lookup.
 *  Kept decodable so sheets printed before the SGF2 switch still scan. */
const PAYLOAD_MAGIC_LEGACY = "SGF1";

export function encodePayload(s: QrFrameSpec): string {
  return [PAYLOAD_MAGIC, s.id, s.innerW, s.innerH, s.scaleMm].join(";");
}

export function decodePayload(text: string): QrFrameSpec | null {
  const p = text.split(";");
  if (p[0] === PAYLOAD_MAGIC_LEGACY && p.length >= 14) {
    const n = (i: number) => Number(p[i]);
    return {
      id: p[1], innerW: n(2), innerH: n(3), scaleMm: n(4),
      marginL: n(5), marginT: n(6), marginR: n(7), marginB: n(8),
      qrX: n(9), qrY: n(10), qrSize: n(11), dotSpacing: n(12), dotD: n(13),
    };
  }
  if (p[0] !== PAYLOAD_MAGIC || p.length < 5) return null;
  const layout = STANDARD_SPECS.find((spec) => spec.id === p[1]);
  if (!layout) return null;
  return { ...layout, id: p[1], innerW: Number(p[2]), innerH: Number(p[3]), scaleMm: Number(p[4]) };
}

export const outerW = (s: QrFrameSpec) => s.marginL + s.innerW + s.marginR;
export const outerH = (s: QrFrameSpec) => s.marginT + s.innerH + s.marginB;

/** QR module-area corners in mm (TL, TR, BR, BL). */
export function qrCornersMm(s: QrFrameSpec): Pt[] {
  return [[s.qrX, s.qrY], [s.qrX + s.qrSize, s.qrY],
    [s.qrX + s.qrSize, s.qrY + s.qrSize], [s.qrX, s.qrY + s.qrSize]];
}

/** Opening (inner window) corners in mm (TL, TR, BR, BL). */
export function openingCornersMm(s: QrFrameSpec): Pt[] {
  const x = s.marginL, y = s.marginT;
  return [[x, y], [x + s.innerW, y], [x + s.innerW, y + s.innerH], [x, y + s.innerH]];
}

/** Sample square + circle diameter endpoints (mm), centred in the opening. */
export function samplePointsMm(s: QrFrameSpec): { square: Pt[]; circle: Pt[] } {
  const cx = s.marginL + s.innerW / 2, cy = s.marginT + s.innerH / 2, q = s.scaleMm;
  return {
    square: [[cx - q / 2, cy - q / 2], [cx + q / 2, cy - q / 2], [cx + q / 2, cy + q / 2], [cx - q / 2, cy + q / 2]],
    circle: [[cx - q / 4, cy], [cx + q / 4, cy], [cx, cy - q / 4], [cx, cy + q / 4]],
  };
}

/**
 * Registration dots: one row along each edge, on that side's margin centreline,
 * at ~dotSpacing intervals, excluding any within the QR rect (plus a quiet-zone
 * margin). Deterministic, so the detector regenerates the identical set.
 */
export function dotLayoutMm(s: QrFrameSpec): Pt[] {
  const ow = outerW(s), oh = outerH(s);
  const clear = s.qrSize * 0.6; // keep dots off the QR + its quiet zone
  const inQr = (x: number, y: number) =>
    x > s.qrX - clear && x < s.qrX + s.qrSize + clear &&
    y > s.qrY - clear && y < s.qrY + s.qrSize + clear;

  const line = (from: number, to: number, fixed: number, horiz: boolean): Pt[] => {
    const span = to - from;
    const n = Math.max(1, Math.round(span / s.dotSpacing));
    const step = span / n;
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = from + i * step;
      const p: Pt = horiz ? [t, fixed] : [fixed, t];
      if (!inQr(p[0], p[1])) pts.push(p);
    }
    return pts;
  };

  const seen = new Set<string>();
  const acc: Pt[] = [];
  const add = (arr: Pt[]) => {
    for (const p of arr) {
      const k = `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
      if (!seen.has(k)) { seen.add(k); acc.push(p); }
    }
  };
  const cT = s.marginT / 2, cB = oh - s.marginB / 2, cL = s.marginL / 2, cR = ow - s.marginR / 2;
  add(line(cL, ow - s.marginR / 2, cT, true));   // top
  add(line(cL, ow - s.marginR / 2, cB, true));   // bottom
  add(line(cT, oh - s.marginB / 2, cL, false));  // left
  add(line(cT, oh - s.marginB / 2, cR, false));  // right
  return acc;
}
