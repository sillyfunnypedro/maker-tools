// Start screen: pick a tool. The two tools are separate workflows that share the
// backend processing modules (processing / svg / frameDetect / rectify / worker).

export type Tool = "glass" | "frame" | "frames" | "howto";

export function StartScreen({ onPick }: { onPick: (t: Tool) => void }) {
  return (
    <div className="start-screen">
      <button className="start-card" onClick={() => onPick("glass")}>
        <span className="start-emoji" aria-hidden>🪟</span>
        <strong>Stained Glass Processor</strong>
        <small>
          Turn a line drawing into clean, cut-ready glass-piece cells or line art,
          as a PNG for a cutting machine.
        </small>
      </button>
      <button className="start-card" onClick={() => onPick("frame")}>
        <span className="start-emoji" aria-hidden>🖼️</span>
        <strong>SketchFrame → SVG</strong>
        <small>
          Photograph a drawing inside a printed SketchFrame; the frame is detected,
          the interior cut out, and exported as a true-millimeter CNC SVG.
        </small>
      </button>
      <button className="start-card" onClick={() => onPick("howto")}>
        <span className="start-emoji" aria-hidden>📖</span>
        <strong>How SketchFrame Works</strong>
        <small>
          The five steps, start to finish, shown with a real photo and the real
          output at each stage.
        </small>
      </button>
      <button className="start-card" onClick={() => onPick("frames")}>
        <span className="start-emoji" aria-hidden>🖨️</span>
        <strong>Printable SketchFrames</strong>
        <small>
          Blank frames to print at true size — draw inside the opening, or cut it
          out and use the sheet as a frame.
        </small>
      </button>
    </div>
  );
}
