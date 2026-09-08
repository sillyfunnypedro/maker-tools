// Browsable view of the automated test suite's image fixtures, run live through
// the real mask + trace pipeline (the same code path App.tsx uses) so what's
// shown here is what the tests actually check, not a static screenshot that can
// drift out of sync with them.
import { useEffect, useState } from "react";
import { DEFAULT_PARAMS, computeMasks } from "./processing";
import { buildCncStrokedSvg, renderStrokeGroups, strokesToSvg, traceAreaGroups } from "./svg";
import { removeBorderRegions, smoothContour, thresholdMask, traceContours } from "./contour";
import type { Mat3 } from "./qrframe/homography";
import { subpaths, flatten, selfCrossings, bbox, curvatureSignFlips } from "./testUtils/svgGeometry";
import lineManifest from "./testdata/drawings/manifest.json";
import areaManifest from "./testdata/areas/manifest.json";

type LineEntry = (typeof lineManifest)[number];
type AreaEntry = (typeof areaManifest)[number];

// src/testdata/*/​*.png aren't in public/, so they need Vite's asset pipeline
// (import.meta.glob) to get bundled URLs, the same way any other imported
// image would.
const lineUrls = import.meta.glob("./testdata/drawings/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const areaUrls = import.meta.glob("./testdata/areas/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

type Verdict = "loading" | "error" | { svgUrl: string; ok: boolean; detail: string };

async function urlToImageData(url: string): Promise<ImageData> {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Mirrors the checks in src/lineDrawings.test.ts, so this page shows the same
 *  verdict the automated suite would give — see that file for why each check
 *  and threshold was chosen (deadzoneDeg=8 for circles, <0.3mm for the diagonal). */
function checkLineEntry(entry: LineEntry, svg: string): { ok: boolean; detail: string } {
  const subs = subpaths(svg);
  if (subs.length === 0) return { ok: false, detail: "traced nothing" };
  for (const sub of subs) {
    if (selfCrossings(sub) > 0) return { ok: false, detail: "self-crossing trace" };
  }
  const biggest = subs.sort((a, b) => (bbox(b)[2] - bbox(b)[0]) - (bbox(a)[2] - bbox(a)[0]))[0];

  if (entry.shape === "circle") {
    const flips = curvatureSignFlips(biggest, 15, 8);
    if (flips > 0) return { ok: false, detail: `${flips} curvature flip(s)` };
    const [x0, y0, x1, y1] = bbox(biggest);
    const w = x1 - x0, h = y1 - y0;
    if (Math.abs(w - 80) > 8 || Math.abs(h - 80) > 8)
      return { ok: false, detail: `bbox ${w.toFixed(1)}×${h.toFixed(1)}mm, expected ~80×80` };
    return { ok: true, detail: "convex, no self-crossings" };
  }

  if (entry.shape === "diagonal45") {
    const pts = flatten(biggest, 20);
    const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = 0;
    for (const [x, y] of pts) {
      const t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len);
      const px = ax + t * (bx - ax), py = ay + t * (by - ay);
      worst = Math.max(worst, Math.hypot(x - px, y - py));
    }
    return { ok: worst < 0.3, detail: `max deviation from straight: ${worst.toFixed(2)}mm` };
  }

  return { ok: true, detail: "no self-crossings" };
}

function traceLineEntry(entry: LineEntry): Promise<Verdict> {
  const rawUrl = lineUrls[`./testdata/drawings/${entry.file}`];
  return urlToImageData(rawUrl).then((img) => {
    const m = computeMasks(img.data, img.width, img.height, DEFAULT_PARAMS);
    const pxToMm: Mat3 = [[1 / entry.ppmm, 0, 0], [0, 1 / entry.ppmm, 0], [0, 0, 1]];
    const svg = buildCncStrokedSvg(m.skeleton, m.w, m.h, pxToMm, 0, 0, entry.widthMm, entry.heightMm);
    const { ok, detail } = checkLineEntry(entry, svg);
    return { svgUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, ok, detail };
  });
}

/** Mirrors the checks in src/areaDrawings.test.ts. */
function checkAreaEntry(entry: AreaEntry, subs: ReturnType<typeof subpaths>): { ok: boolean; detail: string } {
  for (const sub of subs) {
    if (selfCrossings(sub) > 0) return { ok: false, detail: "self-crossing trace" };
  }

  if (entry.shape === "disk") {
    if (subs.length !== 1) return { ok: false, detail: `${subs.length} region(s), expected 1` };
    const [x0, y0, x1, y1] = bbox(subs[0]);
    const w = x1 - x0, h = y1 - y0, want = entry.param * 2;
    if (Math.abs(w - want) > 8 || Math.abs(h - want) > 8)
      return { ok: false, detail: `bbox ${w.toFixed(1)}×${h.toFixed(1)}mm, expected ~${want}×${want}` };
    return { ok: true, detail: "one clean region" };
  }

  if (entry.shape === "star") {
    if (subs.length !== 1) return { ok: false, detail: `${subs.length} region(s), expected 1` };
    const [x0, y0, x1, y1] = bbox(subs[0]);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let minR = Infinity, maxR = 0;
    for (const [px, py] of flatten(subs[0], 20)) {
      const r = Math.hypot(px - cx, py - cy);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
    if (minR / maxR >= 0.6) return { ok: false, detail: `notches smoothed away (minR/maxR ${(minR / maxR).toFixed(2)})` };
    return { ok: true, detail: `points/notches distinct (minR/maxR ${(minR / maxR).toFixed(2)})` };
  }

  // twoblobs: calibrated in gen-test-areas.ts — 0.3mm+ gaps stay separate,
  // smaller gaps are an expected, documented merge (a real resolution limit).
  const expectSeparate = entry.param >= 0.3;
  const ok = subs.length === (expectSeparate ? 2 : 1);
  const detail = expectSeparate
    ? (ok ? "stayed two separate cells" : `merged into ${subs.length} (expected 2)`)
    : (ok ? "merged as expected (below the resolution limit)" : `${subs.length} region(s), expected the documented merge to 1`);
  return { ok, detail };
}

function traceAreaEntry(entry: AreaEntry): Promise<Verdict> {
  const rawUrl = areaUrls[`./testdata/areas/${entry.file}`];
  return urlToImageData(rawUrl).then((img) => {
    const mask = thresholdMask(img.data, img.width, img.height, DEFAULT_PARAMS.bgThresh);
    removeBorderRegions(mask, img.width, img.height);
    let contours = traceContours(mask, img.width, img.height, DEFAULT_PARAMS.minBlob);
    contours = contours.map((c) => smoothContour(c, 2));
    const pxToMm: Mat3 = [[1 / entry.ppmm, 0, 0], [0, 1 / entry.ppmm, 0], [0, 0, 1]];
    const { groups, mmPerPx } = traceAreaGroups(contours, img.width, img.height, pxToMm, 0, 0);
    const { strokes, viewW, viewH } = renderStrokeGroups(groups, mmPerPx, entry.widthMm, entry.heightMm);
    const svg = strokesToSvg(viewW, viewH, strokes, undefined, { separatePaths: true, filled: true });
    const { ok, detail } = checkAreaEntry(entry, subpaths(svg));
    return { svgUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, ok, detail };
  });
}

const LINE_SHAPE_LABELS: Record<string, string> = {
  circle: "Circle (sweeps every tangent angle)",
  diagonal45: "45° diagonal (worst case for staircase noise)",
  square: "Square (corner fidelity)",
};
const AREA_SHAPE_LABELS: Record<string, string> = {
  disk: "Filled disk, swept by radius",
  star: "Star (concave/convex corner fidelity)",
  twoblobs: "Two disks, swept by gap (separation limit)",
};

function labelFor(entry: LineEntry | AreaEntry): string {
  if ("thicknessMm" in entry) return `${entry.thicknessMm} mm line`;
  if (entry.shape === "disk") return `${entry.param} mm radius`;
  if (entry.shape === "star") return `${entry.param} points`;
  return `${entry.param} mm gap`;
}

export function TestViewerPage() {
  const [lineResults, setLineResults] = useState<Record<string, Verdict>>({});
  const [areaResults, setAreaResults] = useState<Record<string, Verdict>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Sequential, not Promise.all: each trace runs a full pipeline pass on a
      // ~1.75-megapixel image, so running everything at once would stall the
      // main thread instead of letting cards fill in as they finish.
      for (const entry of lineManifest as LineEntry[]) {
        if (cancelled) return;
        setLineResults((r) => ({ ...r, [entry.file]: "loading" }));
        try {
          const v = await traceLineEntry(entry);
          if (!cancelled) setLineResults((r) => ({ ...r, [entry.file]: v }));
        } catch {
          if (!cancelled) setLineResults((r) => ({ ...r, [entry.file]: "error" }));
        }
      }
      for (const entry of areaManifest as AreaEntry[]) {
        if (cancelled) return;
        setAreaResults((r) => ({ ...r, [entry.file]: "loading" }));
        try {
          const v = await traceAreaEntry(entry);
          if (!cancelled) setAreaResults((r) => ({ ...r, [entry.file]: v }));
        } catch {
          if (!cancelled) setAreaResults((r) => ({ ...r, [entry.file]: "error" }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lineShapes = Array.from(new Set((lineManifest as LineEntry[]).map((e) => e.shape)));
  const areaShapes = Array.from(new Set((areaManifest as AreaEntry[]).map((e) => e.shape)));

  return (
    <div className="test-viewer">
      <p className="sub">
        Sample images the automated suite checks the CNC tracer against:
        synthetic photos — anti-aliased edges plus seeded grayscale noise, not a
        hard binary edge — generated by <code>qr-preview/gen-test-drawings.ts</code>{" "}
        and <code>qr-preview/gen-test-areas.ts</code>. Each card below runs the
        same real mask/contour + trace pipeline the app uses and the same
        pass/fail check the test files run, live in your browser.
      </p>

      <h2 className="test-viewer-group">Lines mode — centerline tracing</h2>
      {lineShapes.map((shape) => (
        <section key={shape} className="test-viewer-section">
          <h3>{LINE_SHAPE_LABELS[shape] ?? shape}</h3>
          <div className="test-grid">
            {(lineManifest as LineEntry[])
              .filter((e) => e.shape === shape)
              .map((entry) => {
                const res = lineResults[entry.file];
                const rawUrl = lineUrls[`./testdata/drawings/${entry.file}`];
                return (
                  <div className="test-card" key={entry.file}>
                    <div className="test-card-images">
                      <img src={rawUrl} alt={`${entry.file}, source photo`} />
                      {res && typeof res === "object" && (
                        <img src={res.svgUrl} alt={`${entry.file}, traced`} className="test-card-trace" />
                      )}
                    </div>
                    <div className="test-card-meta">
                      <strong>{labelFor(entry)}</strong>
                      {res === "loading" && <span className="test-status pending">tracing…</span>}
                      {res === "error" && <span className="test-status fail">✗ error tracing</span>}
                      {res && typeof res === "object" && (
                        <span className={`test-status ${res.ok ? "pass" : "fail"}`}>
                          {res.ok ? "✓" : "✗"} {res.detail}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      ))}

      <h2 className="test-viewer-group">Areas mode — filled-region contour tracing</h2>
      {areaShapes.map((shape) => (
        <section key={shape} className="test-viewer-section">
          <h3>{AREA_SHAPE_LABELS[shape] ?? shape}</h3>
          <div className="test-grid">
            {(areaManifest as AreaEntry[])
              .filter((e) => e.shape === shape)
              .map((entry) => {
                const res = areaResults[entry.file];
                const rawUrl = areaUrls[`./testdata/areas/${entry.file}`];
                return (
                  <div className="test-card" key={entry.file}>
                    <div className="test-card-images">
                      <img src={rawUrl} alt={`${entry.file}, source photo`} />
                      {res && typeof res === "object" && (
                        <img src={res.svgUrl} alt={`${entry.file}, traced`} className="test-card-trace" />
                      )}
                    </div>
                    <div className="test-card-meta">
                      <strong>{labelFor(entry)}</strong>
                      {res === "loading" && <span className="test-status pending">tracing…</span>}
                      {res === "error" && <span className="test-status fail">✗ error tracing</span>}
                      {res && typeof res === "object" && (
                        <span className={`test-status ${res.ok ? "pass" : "fail"}`}>
                          {res.ok ? "✓" : "✗"} {res.detail}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      ))}

      <section className="test-viewer-section">
        <h2>Real-photo baseline</h2>
        <p>
          The synthetic fixtures above stand in for a wide range of thicknesses
          and angles, but the fix they check was originally found and calibrated
          against a real photographed circle from the walk-through below — see the
          "real-world jaggedness" test in <code>src/svg.test.ts</code>.
        </p>
        <img
          src="tutorial/2-photo.jpg"
          alt="A printed SketchFrame photographed at an angle, with a drawing inside the opening."
          className="test-real-photo"
          loading="lazy"
        />
      </section>

      <section className="test-viewer-section">
        <h2>Not covered here yet</h2>
        <p>
          Finger Joints and the Stained Glass "cells" output don't have
          checked-in visual fixtures yet. If you'd like to help harden this test
          harness, more drawings — harder angles, thinner/thicker lines, tighter
          cell gaps, real photos in different lighting — or a fixture generator
          for one of these tools would all help.
        </p>
      </section>
    </div>
  );
}
