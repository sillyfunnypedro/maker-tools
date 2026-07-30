// Download page for the printable blank frames.
//
// Everything shown here is derived from STANDARD_SPECS and the print layout, so
// the sizes and paper advice can't drift from the PDFs that `npm run emit:print`
// actually produced. Only the blank sheets are published; the calibration sheets
// (with the reference square and circle) stay in qr-preview/ for our own testing.
import { STANDARD_SPECS } from "./qrframe/generate";
import { fitPaper } from "./qrframe/printLayout";
import { outerH, outerW } from "./qrframe/spec";

const LABELS: Record<string, string> = {
  std: "Standard",
  half: "Half",
  square100: "100 mm square",
  large: "Large",
  bigsquare: "Big square",
  tabloid: "Tabloid (11×17 in)",
  a4: "A4",
  a3: "A3",
  ansiC: "ANSI C (17×22 in)",
  a2: "A2",
};

/** Files live in public/frames/, and `base: "./"` keeps the paths relative. */
const href = (id: string) => `frames/qrframe-${id}-blank.pdf`;

export function FramesPage() {
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

      <ul className="frame-list">
        {STANDARD_SPECS.map((spec) => {
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
              <a className="frame-dl" href={href(spec.id)} download>
                Download PDF
              </a>
            </li>
          );
        })}
      </ul>

      <p className="hint">
        <a href="frames/qrframes-blank.pdf" download>
          Download all sizes
        </a>{" "}
        as one PDF, one size per page.
      </p>
    </div>
  );
}
