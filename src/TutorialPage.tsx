// Walk-through for SketchFrame.
//
// Every picture here is a real run of the pipeline, taken from a debug dump —
// the actual photo that went in and the actual stages that came out — rather than
// a mock-up, so what people see is what the tool really does.
import type { Tool } from "./StartScreen";

interface Step {
  title: string;
  img: string;
  alt: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    title: "Print a frame",
    img: "tutorial/1-print.jpg",
    alt: "A blank registration frame: dotted border, QR code in the top-left, empty opening.",
    body: (
      <>
        Grab a blank sheet from <strong>Printable SketchFrames</strong> and print it{" "}
        <strong>at 100%</strong> — no “Fit to page”. The QR code carries the
        frame's own dimensions, so the sheet tells the app how big it is. Measure
        the opening once to confirm your printer isn't scaling: the standard sheet
        should read 150 × 168 mm.
      </>
    ),
  },
  {
    title: "Draw in the opening",
    img: "tutorial/2-photo.jpg",
    alt: "The printed frame photographed at an angle on a cutting mat, with the drawing inside the opening.",
    body: (
      <>
        Draw inside the opening, or cut the opening out and lay the frame over
        something you already have. Then photograph it. It does not need to be
        square-on — this shot is noticeably tilted and off-centre, which is fine:
        the frame tells the app where it is and the perspective is undone for you.
        Keep all four edges of the frame in shot and the lighting even.
      </>
    ),
  },
  {
    title: "The app finds the frame",
    img: "tutorial/3-opening.jpg",
    alt: "The opening cut out of the photo, deskewed flat, with even lighting.",
    body: (
      <>
        The QR code and the dots around the border give the app the sheet's exact
        position, so it cuts out just the opening, flattens the perspective, and
        evens out the lighting. What you see here is true scale — every millimetre
        of it — and the frame itself is gone.
      </>
    ),
  },
  {
    title: "Check the trace",
    img: "tutorial/4-traced.png",
    alt: "The drawing reduced to single black centerlines on white.",
    body: (
      <>
        Each drawn line becomes one line, which is what a CNC follows. If you see
        specks or stray marks, nudge <strong>Detection sensitivity</strong> down;
        if faint pencil is being missed, nudge it up. <strong>Rotate</strong>{" "}
        straightens a crooked sheet, and <strong>Zoom</strong> crops in — the
        quickest way to drop marks near the edge. Once zoomed, drag the drawing to
        choose which part to keep.
      </>
    ),
  },
  {
    title: "Download the SVG",
    img: "tutorial/5-export.png",
    alt: "The exported vector file: black outlines on white at true millimetre size.",
    body: (
      <>
        The export is a true-millimetre SVG — open it in your CNC software,
        Fusion, Illustrator, or anything that reads SVG, and it will already be
        the right size. No scaling, no calibration step. Rotating and cropping
        never change
        that: they move the window, not the drawing.
      </>
    ),
  },
];

export function TutorialPage({ onPick }: { onPick: (t: Tool) => void }) {
  return (
    <div className="tutorial">
      <p className="sub">
        Photograph a drawing inside a printed SketchFrame and get a vector file that is
        already the right size. Five steps, shown with a real run.
      </p>

      <ol className="tutorial-steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <div className="step-head">
              <span className="step-num">{i + 1}</span>
              <strong>{s.title}</strong>
            </div>
            <img src={s.img} alt={s.alt} loading="lazy" />
            <p>{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="notice">
        The example above uses one of our calibration sheets, which has a square
        and a circle printed in the opening — that's why the result is a tidy
        square and circle. Your own drawing goes in exactly the same place.
      </div>

      <div className="buttons">
        <button className="primary" onClick={() => onPick("frames")}>
          Get a printable frame
        </button>
        <button onClick={() => onPick("frame")}>Open the frame tool</button>
      </div>
    </div>
  );
}
