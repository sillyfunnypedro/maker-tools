// Browsable view of the automated test suite's image fixtures, run live through
// the real mask + trace pipeline (the same code path App.tsx uses) so what's
// shown here is what the tests actually check, not a static screenshot that can
// drift out of sync with them.
import { useEffect, useState } from "react";
import { DEFAULT_PARAMS, computeMasks } from "./processing";
import { buildCncStrokedSvg } from "./svg";
import type { Mat3 } from "./qrframe/homography";
import { subpaths, flatten, selfCrossings, bbox, curvatureSignFlips } from "./testUtils/svgGeometry";
import manifest from "./testdata/drawings/manifest.json";

type Entry = (typeof manifest)[number];

// src/testdata/drawings/*.png aren't in public/, so they need Vite's asset
// pipeline (import.meta.glob) to get bundled URLs, the same way any other
// imported image would.
const drawingUrls = import.meta.glob("./testdata/drawings/*.png", {
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
function checkEntry(entry: Entry, svg: string): { ok: boolean; detail: string } {
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

function traceEntry(entry: Entry): Promise<Verdict> {
  const rawUrl = drawingUrls[`./testdata/drawings/${entry.file}`];
  return urlToImageData(rawUrl).then((img) => {
    const m = computeMasks(img.data, img.width, img.height, DEFAULT_PARAMS);
    const pxToMm: Mat3 = [[1 / entry.ppmm, 0, 0], [0, 1 / entry.ppmm, 0], [0, 0, 1]];
    const svg = buildCncStrokedSvg(m.skeleton, m.w, m.h, pxToMm, 0, 0, entry.widthMm, entry.heightMm);
    const { ok, detail } = checkEntry(entry, svg);
    return { svgUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, ok, detail };
  });
}

const SHAPE_LABELS: Record<string, string> = {
  circle: "Circle (sweeps every tangent angle)",
  diagonal45: "45° diagonal (worst case for staircase noise)",
  square: "Square (corner fidelity)",
};

export function TestViewerPage() {
  const [results, setResults] = useState<Record<string, Verdict>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Sequential, not Promise.all: each trace runs the full skeletonize/prune
      // pipeline on a ~1.75-megapixel image, so running all 12 at once would
      // stall the main thread instead of letting cards fill in as they finish.
      for (const entry of manifest as Entry[]) {
        if (cancelled) return;
        setResults((r) => ({ ...r, [entry.file]: "loading" }));
        try {
          const v = await traceEntry(entry);
          if (!cancelled) setResults((r) => ({ ...r, [entry.file]: v }));
        } catch {
          if (!cancelled) setResults((r) => ({ ...r, [entry.file]: "error" }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const shapes = Array.from(new Set((manifest as Entry[]).map((e) => e.shape)));

  return (
    <div className="test-viewer">
      <p className="sub">
        Sample images the automated suite (<code>src/lineDrawings.test.ts</code>)
        checks the CNC line tracer against: synthetic photos — anti-aliased edges
        plus seeded grayscale noise, not a hard binary edge — at a range of stroke
        thicknesses, generated by <code>qr-preview/gen-test-drawings.ts</code>.
        Each card below runs the same real mask + trace pipeline the app uses and
        the same pass/fail check the test file runs, live in your browser.
      </p>

      {shapes.map((shape) => (
        <section key={shape} className="test-viewer-section">
          <h2>{SHAPE_LABELS[shape] ?? shape}</h2>
          <div className="test-grid">
            {(manifest as Entry[])
              .filter((e) => e.shape === shape)
              .map((entry) => {
                const res = results[entry.file];
                const rawUrl = drawingUrls[`./testdata/drawings/${entry.file}`];
                return (
                  <div className="test-card" key={entry.file}>
                    <div className="test-card-images">
                      <img src={rawUrl} alt={`${entry.file}, source photo`} />
                      {res && typeof res === "object" && (
                        <img src={res.svgUrl} alt={`${entry.file}, traced`} className="test-card-trace" />
                      )}
                    </div>
                    <div className="test-card-meta">
                      <strong>{entry.thicknessMm} mm line</strong>
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
          Finger Joints, Areas mode (filled-region tracing), and the Stained Glass
          "cells" output don't have checked-in visual fixtures yet. If you'd like
          to help harden this test harness, more line drawings — harder angles,
          thinner or thicker lines, real photos in different lighting — or a
          fixture generator for one of these tools would all help.
        </p>
      </section>
    </div>
  );
}
