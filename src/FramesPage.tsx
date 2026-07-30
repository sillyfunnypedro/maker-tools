// Download page for the printable blank frames.
//
// Everything shown here is derived from STANDARD_SPECS and the print layout, so
// the sizes and paper advice can't drift from the PDFs that `npm run emit:print`
// actually produced. Only the blank sheets are published; the calibration sheets
// (with the reference square and circle) stay in qr-preview/ for our own testing.
import { useState } from "react";
import { STANDARD_SPECS } from "./qrframe/generate";
import { fitPaper, printPageSvg } from "./qrframe/printLayout";
import { outerH, outerW, type QrFrameSpec } from "./qrframe/spec";
import { tiledPrintSvgs } from "./qrframe/tiledPrint";

const LABELS: Record<string, string> = {
  std: "Standard",
  half: "Half",
  square50: "50 mm square",
  square100: "100 mm square",
  large: "Large",
  bigsquare: "Big square",
  tabloid: "Tabloid (11×17 in)",
  a4: "A4",
  a3: "A3",
  ansiC: "ANSI C (17×22 in)",
  a2: "A2",
};

/**
 * The large-format sizes are each maxed out for one specific paper standard,
 * so a NA reader and an ISO-paper reader want different halves of the list.
 * The regular sizes fit comfortably on either Letter or A4, so they're global.
 */
const GROUPS: { heading: string; ids: string[] }[] = [
  { heading: "Global (fits Letter or A4 anywhere)", ids: ["std", "half", "square50", "square100"] },
  { heading: "Large prints — North America (Tabloid / ANSI C paper)", ids: ["large", "bigsquare", "tabloid", "ansiC"] },
  { heading: "Large prints — rest of world (A4 / A3 / A2 paper)", ids: ["a4", "a3", "a2"] },
];

/** Files live in public/frames/, and `base: "./"` keeps the paths relative. */
const href = (id: string) => `./frames/qrframe-${id}-blank.pdf`;
const tiledHref = (id: string) => `./frames/qrframe-${id}-tiled.pdf`;

/** Pre-compute which specs have tiled versions (too large for Letter). */
const TILED_INFO: Record<string, { rows: number; cols: number; pages: number }> = {};
for (const spec of STANDARD_SPECS) {
  const tiled = tiledPrintSvgs(spec, { sample: false });
  if (tiled) TILED_INFO[spec.id] = { rows: tiled.rows, cols: tiled.cols, pages: tiled.pages.length };
}

/**
 * Opens a new tab holding just the labelled page SVG and prints it — no PDF
 * step, since `printPageSvg`'s output already declares its true mm size, and
 * that's exactly what a browser print dialog (at 100%, no "fit to page")
 * honours. Kept separate from the pre-built PDF links below: those stay
 * byte-identical to what `emit:print` shipped, since a label is per-user and
 * can't be baked into a static file.
 */
function printLabeled(spec: QrFrameSpec, label: string) {
  const layout = printPageSvg(spec, { sample: false, label });
  const win = window.open("", "_blank");
  if (!win) return; // popup blocked — nothing sensible to fall back to here
  win.document.write(
    `<!doctype html><html><head><title>${spec.id}</title><style>` +
    `@page { size: ${layout.pageW}mm ${layout.pageH}mm; margin: 0; }` +
    `html, body { margin: 0; padding: 0; }` +
    `</style></head><body>${layout.svg}</body></html>`,
  );
  win.document.close();
  win.focus();
  win.print();
}

export function FramesPage() {
  const [label, setLabel] = useState("");

  return (
    <div className="frames-page">
      <p className="sub">
        Print one of these, draw inside the opening, then photograph it with the{" "}
        <strong>SketchFrame → SVG</strong> tool. Or cut the opening out along its
        outline and use the sheet as a frame over something you already have.
      </p>

      <div className="notice">
        <strong>Print at 100%.</strong> Turn off “Fit to page” / “Scale to fit”.
        Every measurement the app produces comes from the printed size, so a sheet
        printed at 96% makes every exported dimension 4% wrong. After printing,
        measure the opening against the size listed below — if it matches, you're
        good.
      </div>

      <label className="frame-label-input">
        Your name (optional) — adds a <strong>Print with label</strong> button
        below that prints your name and this app's address at the top of the sheet.
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Jamie's Room"
        />
      </label>

      <div className="notice">
        <strong>No large-format printer?</strong> The bigger frames also come as
        "Letter pages" — the same frame split across multiple US Letter sheets
        with overlap and alignment marks. Print them all, line up the crosshairs,
        and tape together.
      </div>

      {GROUPS.map((group) => (
        <section key={group.heading}>
          <h3 className="frame-group-heading">{group.heading}</h3>
          <ul className="frame-list">
            {group.ids.map((id) => {
              const spec = STANDARD_SPECS.find((s) => s.id === id);
              if (!spec) return null;
              const w = outerW(spec), h = outerH(spec);
              const fit = fitPaper(w, h);
              return (
                <li key={spec.id}>
                  <div className="frame-meta">
                    <strong>{LABELS[spec.id] ?? spec.id}</strong>
                    <span className="frame-size">
                      opening {spec.innerW} × {spec.innerH} mm
                    </span>
                    <small>
                      sheet {w} × {h} mm ·{" "}
                      {fit
                        ? `fits ${fit.paper.name} ${fit.orientation}`
                        : "needs a large-format printer"}
                    </small>
                  </div>
                  <div className="frame-actions">
                    <a className="frame-dl" href={href(spec.id)} download>
                      Download PDF
                    </a>
                    {TILED_INFO[spec.id] && (
                      <a className="frame-dl frame-dl-tiled" href={tiledHref(spec.id)} download>
                        Letter pages ({TILED_INFO[spec.id].pages} sheets)
                      </a>
                    )}
                    {label.trim() && (
                      <button
                        type="button"
                        className="frame-dl"
                        onClick={() => printLabeled(spec, `${label.trim()} · ${window.location.host}`)}
                      >
                        Print with label
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="hint">
        <a href="./frames/qrframes-blank.pdf" download>
          Download all sizes
        </a>{" "}
        as one PDF, one size per page.
      </p>
    </div>
  );
}
