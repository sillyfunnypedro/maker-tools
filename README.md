# Maker Tools

**Turn a drawing into something a cutter or a CNC can follow — right in your
browser.**

👉 **Live app: https://sillyfunnypedro.github.io/maker-tools/**

Three tools share one image pipeline:

| Tool | For |
| --- | --- |
| **Stained Glass Processor** | A line drawing → a black PNG of the glass pieces, for a Cricut. |
| **SketchFrame → SVG** | A photo of a drawing inside a printed SketchFrame → a true-millimetre SVG for a CNC. |
| **Printable SketchFrames** | The blank frames to print, draw inside, or cut out. |

Everything runs in your browser; nothing is uploaded.

## Stained Glass Processor

If you have a stained-glass-style pattern or any line drawing (a photo of a
sketch, an exported template, etc.), this app converts it into a clean image in
one of two styles:

- **Glass pieces** — the enclosed cells (the individual "glass pieces") are
  filled **solid black**, while the lines between them and the area outside the
  design are **transparent**.
- **Line drawing** — the smoothed centerlines are drawn as **black lines** on a
  **transparent** background.

That makes it easy to drop into a cutting workflow (e.g. a Cricut) or to use as a
clean stencil/silhouette. When you like the result, save it straight to your
photos.

### How to use it

1. Open the [app](https://sillyfunnypedro.github.io/maker-tools/) and pick
   **Stained Glass Processor**.
2. Tap to choose a photo (or drag an image in).
3. Pick an output style:
   - **Glass pieces** — the enclosed cells are filled solid black; the lines
     between them and the outside are transparent.
   - **Line drawing** — the smoothed centerlines are drawn as black lines on a
     transparent background.
4. Adjust the sliders until it looks right:
   - **Line thickness** — width of the transparent gap between pieces.
   - **Detection sensitivity** — how dark a pixel must be to count as a line.
   - **Smoothing** — rounds off jagged edges.
   - **Spur cleanup** — trims stray little stubs at line junctions.
5. Save it as a **PNG** — a transparent raster image, which is what the Cricut
   workflow uses. On a phone the share sheet lets you *Save Image* to Photos,
   **Mail** it to yourself, or save to Files; on desktop it downloads.

   (Earlier versions also offered SVG exports here. They didn't work in Cricut
   practice and were removed; the CNC vector path lives in the frame tool, which
   emits true-millimetre geometry.)

The PNG output is transparent, so it composites cleanly over any background.

A photo of paper is nowhere near white, so the image is illumination-flattened
and the sensitivity is auto-picked on load; the slider starts somewhere sensible
rather than at a fixed guess.

## SketchFrame → SVG

Print a SketchFrame sheet (see below), draw inside its opening, photograph it,
and this tool finds the frame, deskews the opening, and exports the drawing as a
**true-millimetre SVG** for a CNC. The QR code on the
sheet carries the frame's own dimensions, so the printed page and the detector
share one source of truth. (The rest of the sheet's layout — margins, dot
spacing, the QR's own size — is looked up by the frame's id rather than
encoded, to keep the QR small.)

It traces centerlines — one line in the drawing becomes one line in the file.
Three view controls let you frame the result without re-running anything:

- **Rotate** — straighten a sheet that sits crooked (full 360°).
- **Zoom** — crop in, which is the quickest way to drop specks and shadow marks
  near the edge. It crops rather than scales: sizes stay true and the exported
  page shrinks to the window.
- **Drag** — once zoomed in, drag the drawing to choose which part to keep.

All three transform the finished millimetre coordinates, so the trace is
identical at every setting.

## Printable SketchFrames

Blank frames in eleven sizes, as PDFs at true scale. Print one and draw in the
opening, or cut the opening out and lay the sheet over something you already
have.

**Global (fits Letter or A4 anywhere):**

| Size | Opening | Paper |
| --- | --- | --- |
| `std` | 154×172 mm | Letter |
| `half` | 77×86 mm | Letter |
| `square50` | 50×50 mm | Letter |
| `square100` | 100×100 mm | Letter |

Large prints are each maxed out for one specific paper standard, so they're
split by region — pick the group whose paper you can actually get.

**North America (Tabloid / ANSI C paper):**

| Size | Opening | Paper |
| --- | --- | --- |
| `large` | 221×284 mm | Tabloid (11×17 in) |
| `bigsquare` | 251×251 mm | ANSI C (17×22 in) |
| `tabloid` | 215×365 mm | Tabloid (11×17 in) — uses the sheet's full length |
| `ansiC` | 366×494 mm | ANSI C (17×22 in) |

**Rest of world (A4 / A3 / A2 paper):**

| Size | Opening | Paper |
| --- | --- | --- |
| `a4` | 152×239 mm | A4 — uses the sheet's full length |
| `a3` | 236×355 mm | A3 |
| `a2` | 355×529 mm | A2 |

The border around each opening is trimmed to the minimum that still scans
reliably — every sheet is the same overall size as before, just with less
white space and a bigger drawing area for it.

**Print at 100%** — turn off "Fit to page". Every measurement the app produces
comes from the printed size, so a sheet printed at 96% makes every exported
dimension 4% wrong. After printing, measure the opening against the size listed
on the page. At a copy shop, ask for the paper size in the table above (e.g.
`tabloid` needs **11×17 in / Tabloid**) printed at **actual size / 100%**, not
"fit to page" or "scale to fit."

Regenerate the PDFs with `npm run emit:print` (needs `rsvg-convert` and
Ghostscript). Blank sheets land in `public/frames/` and ship with the build; the
calibration sheets, which carry a reference square and circle for checking the
pipeline's accuracy, stay in `qr-preview/print/` and are not published.

## How it works

`src/processing.ts` is a TypeScript image pipeline:

1. **Line mask** — pixels darker than the threshold are treated as lines.
2. **Despeckle** — drop tiny noise blobs.
3. **Skeletonize** (Zhang-Suen) — reduce strokes to 1px centerlines.
4. **Prune spurs** — trim stray dead-end branches.
5. **Dilate** — regrow lines to a uniform width.
6. **Gaussian smooth** — round off the pixel staircase.
7. **Flood fill from the border** — separate the outside from the enclosed
   cells, then fill the cells black and leave everything else transparent.

`src/worker.ts` runs this in a Web Worker so the UI stays responsive, and
`src/App.tsx` handles upload, the live preview, the sliders, and saving.

## Develop / build

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-checks, then bundles to dist/
npm run preview  # serve the production build locally
```

Pushing to `main` auto-deploys to GitHub Pages via the workflow in
`.github/workflows/deploy.yml`.

## Project status

This is a **personal project, provided as-is.** Pull requests and issues are
disabled — I am not actively maintaining it and may push changes at any time
without notice (e.g. to fix a bug I hit myself). Since it's released under CC0,
you're welcome to clone it, fork it, or adapt it however you like.

## License

Released under [**CC0 1.0 Universal**](./LICENSE) (public domain dedication).
Do whatever you like with it — no permission needed. **Attribution is
appreciated if you feel like it, but not required.**

## Notes

- Large uploads are downscaled to ~1400px on the long edge before processing so
  slider tweaks re-render in about a second.
- EXIF orientation is respected on import.
