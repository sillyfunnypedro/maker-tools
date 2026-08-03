// Finger joint generator page: input board dimensions and bit size,
// preview and download two complementary SVG notch cutout files.

import { useCallback, useMemo, useState } from "react";
import { generateFingerJoint, type FingerJointResult } from "./joinery/fingerJoint";
import { pathData } from "./joinery/geom";

export function FingerJointPage() {
  const [width, setWidth] = useState(150);
  const [thickness, setThickness] = useState(12);
  const [fingerCount, setFingerCount] = useState(7);
  const [bitDiameter, setBitDiameter] = useState(6.35); // 1/4"

  const result = useMemo((): FingerJointResult | string => {
    try {
      const count = fingerCount % 2 === 0 ? fingerCount + 1 : fingerCount;
      return generateFingerJoint({ width, thickness, fingerCount: count, bitDiameter });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [width, thickness, fingerCount, bitDiameter]);

  const download = useCallback((svg: string, filename: string) => {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const isError = typeof result === "string";
  const joint = isError ? null : result;
  const effectiveCount = fingerCount % 2 === 0 ? fingerCount + 1 : fingerCount;

  return (
    <div className="finger-joint-page">
      <p className="sub">
        Generate finger-joint notch cutouts for a CNC router. Each notch is a
        closed interior-cut path with corner relief for a round bit. Fingers
        point down — place along the board edge in Shaper.
      </p>

      <div className="fj-controls">
        <label className="fj-field">
          <span>Board width</span>
          <input
            type="number" min={10} step={1} value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <span className="fj-unit">mm</span>
        </label>
        <label className="fj-field">
          <span>Thickness</span>
          <input
            type="number" min={1} step={0.5} value={thickness}
            onChange={(e) => setThickness(Number(e.target.value))}
          />
          <span className="fj-unit">mm</span>
        </label>
        <label className="fj-field">
          <span>Fingers</span>
          <input
            type="number" min={1} step={2} value={effectiveCount}
            onChange={(e) => setFingerCount(Number(e.target.value))}
          />
          <span className="fj-unit">odd</span>
        </label>
        <label className="fj-field">
          <span>Bit diameter</span>
          <input
            type="number" min={0.5} step={0.01} value={bitDiameter}
            onChange={(e) => setBitDiameter(Number(e.target.value))}
          />
          <span className="fj-unit">mm</span>
        </label>
      </div>

      {isError && <p className="error">{result}</p>}

      {joint && (
        <div className="fj-preview">
          <div className="fj-profile">
            <h3>Board A — {joint.notchesA.length} notch{joint.notchesA.length !== 1 ? "es" : ""}</h3>
            <svg
              viewBox={`-17 -12 ${width + 34} ${thickness + 14}`}
              className="fj-svg"
              preserveAspectRatio="xMidYMid meet"
            >
              <g transform={`scale(1,-1) translate(0,0)`}>
                {joint.notchesA.map((c, i) => (
                  <path
                    key={i}
                    fill="rgba(100,160,255,0.2)"
                    stroke="#1a5cff"
                    strokeWidth={0.3}
                    d={pathData(c)}
                  />
                ))}
              </g>
            </svg>
            <button onClick={() => download(joint.svgA, "finger-joint-A.svg")}>
              Download A
            </button>
          </div>
          <div className="fj-profile">
            <h3>Board B — {joint.notchesB.length} notch{joint.notchesB.length !== 1 ? "es" : ""}</h3>
            <svg
              viewBox={`-17 -12 ${width + 34} ${thickness + 14}`}
              className="fj-svg"
              preserveAspectRatio="xMidYMid meet"
            >
              <g transform={`scale(1,-1) translate(0,0)`}>
                {joint.notchesB.map((c, i) => (
                  <path
                    key={i}
                    fill="rgba(255,160,100,0.2)"
                    stroke="#cc5500"
                    strokeWidth={0.3}
                    d={pathData(c)}
                  />
                ))}
              </g>
            </svg>
            <button onClick={() => download(joint.svgB, "finger-joint-B.svg")}>
              Download B
            </button>
          </div>

          <p className="hint">
            Relief radius: {joint.reliefRadius.toFixed(3)} mm ·
            Finger width: {(width / effectiveCount).toFixed(2)} mm ·
            Min finger width for this bit: {(4 * joint.reliefRadius).toFixed(2)} mm
          </p>
        </div>
      )}
    </div>
  );
}
