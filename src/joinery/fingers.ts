// Finger layout along a joint edge.
//
// A joint is described as alternating segments. One side is "male at the ends"
// (owns the first and last segment); the other gets the complement.

export type Span = [number, number];

/** Odd segment count whose segment width is closest to targetWidth. */
export function oddCountForWidth(length: number, targetWidth: number): number {
  if (length <= 0) throw new Error("joint length must be positive");
  if (targetWidth <= 0) throw new Error("target finger width must be positive");
  const ideal = length / targetWidth;
  const candidates = new Set([1]);
  for (const base of [Math.floor(ideal), Math.ceil(ideal)]) {
    for (const n of [base - 1, base, base + 1]) {
      if (n >= 1) candidates.add(n % 2 === 0 ? n + 1 : n);
    }
  }
  let best = 1;
  let bestDiff = Infinity;
  for (const n of candidates) {
    const diff = Math.abs(length / n - targetWidth);
    if (diff < bestDiff) { bestDiff = diff; best = n; }
  }
  return best;
}

/** Every other segment of `count` equal divisions of [u0, u0+length]. */
export function uniformSpans(length: number, count: number, atEnds: boolean, u0 = 0): Span[] {
  if (count < 1) throw new Error("segment count must be at least 1");
  if (count % 2 === 0) throw new Error("segment count must be odd");
  const seg = length / count;
  const indices: number[] = [];
  if (atEnds) { for (let i = 0; i < count; i += 2) indices.push(i); }
  else { for (let i = 1; i < count; i += 2) indices.push(i); }
  return indices.map((i) => [u0 + i * seg, u0 + (i + 1) * seg]);
}

/** The gaps between spans within [u0, u1]. */
export function complementSpans(spans: Span[], u0: number, u1: number): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  let cursor = u0;
  for (const [a, b] of sorted) {
    if (a - cursor > 1e-9) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (u1 - cursor > 1e-9) out.push([cursor, u1]);
  return out;
}
