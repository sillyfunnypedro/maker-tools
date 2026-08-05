// Finger joint generator page: input board dimensions and bit size,
// preview and download two complementary SVG cut profiles with offset control.

import { useCallback, useEffect, useMemo, useState } from "react";
import { generateFingerJoint, type FingerJointResult } from "./joinery/fingerJoint";
import { type ReliefStyle } from "./joinery/relief";
import { pathData } from "./joinery/geom";

const COOKIE_PREFIX = "fj-";

function getCookie(key: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_PREFIX}${key}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(key: string, value: string) {
  const expires = new Date(Date.now() + 365 * 864e5).toUTCString();
  document.cookie = `${COOKIE_PREFIX}${key}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function getNum(key: string, fallback: number): number {
  const v = getCookie(key);
  return v != null && !isNaN(Number(v)) ? Number(v) : fallback;
}

export function FingerJointPage() {
  const [width, setWidth] = useState(() => getNum("width", 150));
  const [thickness, setThickness] = useState(() => getNum("thickness", 12));
  const [fingerCount, setFingerCount] = useState(() => getNum("fingers", 7));
  const [bitDiameter, setBitDiameter] = useState(() => getNum("bit", 6.35));
  const [reliefStyle, setReliefStyle] = useState<ReliefStyle>(() => (getCookie("relief") as ReliefStyle) || "long");
  const [projectName, setProjectName] = useState(() => getCookie("name") || "");
  const [offsetAX, setOffsetAX] = useState(() => getNum("oax", 0));
  const [offsetAY, setOffsetAY] = useState(() => getNum("oay", 0));
  const [offsetBX, setOffsetBX] = useState(() => getNum("obx", 0));
  const [offsetBY, setOffsetBY] = useState(() => getNum("oby", 0));

  // Persist to cookies
  useEffect(() => { setCookie("width", String(width)); }, [width]);
  useEffect(() => { setCookie("thickness", String(thickness)); }, [thickness]);
  useEffect(() => { setCookie("fingers", String(fingerCount)); }, [fingerCount]);
  useEffect(() => { setCookie("bit", String(bitDiameter)); }, [bitDiameter]);
  useEffect(() => { setCookie("relief", reliefStyle); }, [reliefStyle]);
  useEffect(() => { setCookie("name", projectName); }, [projectName]);
  useEffect(() => { setCookie("oax", String(offsetAX)); }, [offsetAX]);
  useEffect(() => { setCookie("oay", String(offsetAY)); }, [offsetAY]);
  useEffect(() => { setCookie("obx", String(offsetBX)); }, [offsetBX]);
  useEffect(() => { setCookie("oby", String(offsetBY)); }, [offsetBY]);

  const effectiveCount = fingerCount % 2 === 0 ? fingerCount + 1 : fingerCount;

  const result = useMemo((): FingerJointResult | string => {
    try {
      return generateFingerJoint({
        width, thickness, fingerCount: effectiveCount, bitDiameter,
        offsetAX, offsetAY, offsetBX, offsetBY, reliefStyle,
      });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [width, thickness, effectiveCount, bitDiameter, offsetAX, offsetAY, offsetBX, offsetBY, reliefStyle]);

  const download = useCallback((svg: string, filename: string) => {
    const prefix = projectName.trim().replace(/[/\\:*?"<>|]/g, "-");
    const fullName = prefix ? `${prefix}-${filename}` : filename;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fullName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [projectName]);

  const isError = typeof result === "string";
  const joint = isError ? null : result;

  // ViewBox for preview: covers the full geometry range
  const EXT = 30;
  const BASE_HEIGHT = 20;
  const vbX = -EXT - 5;
  const vbY = -BASE_HEIGHT - 5;
  const vbW = width + 2 * EXT + 10;
  const vbH = thickness + BASE_HEIGHT + 10;

  return (
    <div className="finger-joint-page">
      <p className="sub">
        Generate finger-joint cut profiles for a CNC router. Exterior cut with
        corner relief for a round bit. Fingers point down — place along the
        board edge in Shaper.
      </p>

      <div className="fj-controls">
        <label className="fj-field" style={{ gridColumn: "1 / -1" }}>
          <span>Project name</span>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. Systainer"
            style={{ width: 140 }}
          />
        </label>
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
          <select
            value={bitDiameter}
            onChange={(e) => setBitDiameter(Number(e.target.value))}
          >
            <option value={3.175}>1/8"</option>
            <option value={4.7625}>3/16"</option>
            <option value={6.35}>1/4"</option>
          </select>
        </label>
        <label className="fj-field">
          <span>Relief style</span>
          <select
            value={reliefStyle}
            onChange={(e) => setReliefStyle(e.target.value as ReliefStyle)}
          >
            <option value="long">Long side</option>
            <option value="short">Short side</option>
            <option value="diagonal">45° diagonal</option>
          </select>
        </label>
      </div>

      {isError && <p className="error">{result}</p>}

      {joint && (
        <div className="fj-preview">
          <div className="fj-profile">
            <h3>Board A — {effectiveCount - joint.notchCountA} fingers</h3>
            <svg
              viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
              className="fj-svg"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Grid */}
              <line x1={vbX} y1={0} x2={vbX + vbW} y2={0} stroke="#0a0" strokeWidth={0.2} strokeDasharray="2,2" />
              <line x1={0} y1={vbY} x2={0} y2={vbY + vbH} stroke="#0a0" strokeWidth={0.2} strokeDasharray="2,2" />
              <circle cx={0} cy={0} r={1} fill="green" />
              <g transform={`translate(${offsetAX},${offsetAY})`}>
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
              <polygon points="0,0 5,0 0,-10" fill="red" opacity={0.7} />
            </svg>
            <div className="fj-offset-row">
              <label>
                Offset X: <input type="number" step={1} value={offsetAX}
                  onChange={(e) => setOffsetAX(Number(e.target.value))} />
              </label>
              <label>
                Y: <input type="number" step={1} value={offsetAY}
                  onChange={(e) => setOffsetAY(Number(e.target.value))} />
              </label>
            </div>
            <button onClick={() => download(joint.svgA, "finger-joint-A.svg")}>
              Download A
            </button>
          </div>

          <div className="fj-profile">
            <h3>Board B — {effectiveCount - joint.notchCountB} fingers</h3>
            <svg
              viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
              className="fj-svg"
              preserveAspectRatio="xMidYMid meet"
            >
              <line x1={vbX} y1={0} x2={vbX + vbW} y2={0} stroke="#0a0" strokeWidth={0.2} strokeDasharray="2,2" />
              <line x1={0} y1={vbY} x2={0} y2={vbY + vbH} stroke="#0a0" strokeWidth={0.2} strokeDasharray="2,2" />
              <circle cx={0} cy={0} r={1} fill="green" />
              <g transform={`translate(${offsetBX},${offsetBY})`}>
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
              <polygon points="0,0 5,0 0,-10" fill="red" opacity={0.7} />
            </svg>
            <div className="fj-offset-row">
              <label>
                Offset X: <input type="number" step={1} value={offsetBX}
                  onChange={(e) => setOffsetBX(Number(e.target.value))} />
              </label>
              <label>
                Y: <input type="number" step={1} value={offsetBY}
                  onChange={(e) => setOffsetBY(Number(e.target.value))} />
              </label>
            </div>
            <button onClick={() => download(joint.svgB, "finger-joint-B.svg")}>
              Download B
            </button>
          </div>

          <p className="hint">
            Relief radius: {joint.reliefRadius.toFixed(3)} mm ·
            Finger width: {(width / effectiveCount).toFixed(2)} mm ·
            Min finger width: {(4 * joint.reliefRadius).toFixed(2)} mm
          </p>
        </div>
      )}
    </div>
  );
}
