// Free QR code generator: type text or a URL, get a QR code. Everything runs
// client-side — src/qrgen/renderQr.ts never makes a network call, and neither
// does this page, so there's nothing to track and nothing paywalled behind a
// "high-res export" or "no watermark" upsell the way most QR sites work.
import { useMemo, useState } from "react";
import { renderQrSvg, type DotStyle } from "./qrgen/renderQr";

type EcLevel = "L" | "M" | "Q" | "H";

const EC_LEVELS: { level: EcLevel; label: string }[] = [
  { level: "L", label: "L (~7%)" },
  { level: "M", label: "M (~15%)" },
  { level: "Q", label: "Q (~25%)" },
  { level: "H", label: "H (~30%)" },
];

const DOT_STYLES: { style: DotStyle; label: string }[] = [
  { style: "square", label: "Square" },
  { style: "rounded", label: "Rounded" },
  { style: "dots", label: "Dots" },
];

const PNG_SIZES = [256, 512, 1024, 2048];

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rasterise an SVG string to a PNG blob at the given pixel size, client-side. */
function svgToPngBlob(svg: string, sizePx: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = sizePx;
      canvas.height = sizePx;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false; // keep module edges crisp, not blurred
      ctx.drawImage(img, 0, 0, sizePx, sizePx);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))), "image/png");
    };
    img.onerror = () => reject(new Error("could not rasterise SVG"));
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  });
}

export function QrGeneratorPage() {
  const [text, setText] = useState("");
  const [ecLevel, setEcLevel] = useState<EcLevel>("M");
  const [dotStyle, setDotStyle] = useState<DotStyle>("square");
  const [margin, setMargin] = useState(4);
  const [fgColor, setFgColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [pngSize, setPngSize] = useState(1024);

  const result = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return renderQrSvg(text, { errorCorrectionLevel: ecLevel, dotStyle, marginModules: margin, fgColor, bgColor });
    } catch {
      return null;
    }
  }, [text, ecLevel, dotStyle, margin, fgColor, bgColor]);

  const downloadSvg = () => {
    if (!result) return;
    download(new Blob([result.svg], { type: "image/svg+xml" }), "qrcode.svg");
  };

  const downloadPng = async () => {
    if (!result) return;
    const blob = await svgToPngBlob(result.svg, pngSize);
    download(blob, "qrcode.png");
  };

  return (
    <div className="qrgen">
      <p className="sub">
        Fully offline — the code is generated on your device and nothing is
        sent anywhere. No account, no watermark, no "upgrade to download".
      </p>

      <div className="control">
        <label>Text or URL</label>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://example.com or any text"
          className="qrgen-text"
        />
      </div>

      <div className="modes" role="group" aria-label="Dot style">
        {DOT_STYLES.map(({ style, label }) => (
          <button key={style} className={dotStyle === style ? "active" : ""} onClick={() => setDotStyle(style)}>
            {label}
          </button>
        ))}
      </div>

      <div className="qrgen-colors">
        <label className="qrgen-color-field">
          Foreground
          <input type="color" value={fgColor} onChange={(e) => setFgColor(e.target.value)} />
        </label>
        <label className="qrgen-color-field">
          Background
          <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
        </label>
      </div>

      <div className="control">
        <label>
          Quiet-zone margin
          <span className="val">{margin} modules</span>
        </label>
        <input type="range" min={0} max={8} step={1} value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
        <small className="help">
          Blank border around the code. Most scanners need at least 4 modules
          of clear space — go below that only if you know the printed size
          will be large.
        </small>
      </div>

      <div className="control">
        <label>Error correction</label>
        <div className="modes" role="group" aria-label="Error correction level">
          {EC_LEVELS.map(({ level, label }) => (
            <button key={level} className={ecLevel === level ? "active" : ""} onClick={() => setEcLevel(level)}>
              {label}
            </button>
          ))}
        </div>
        <small className="help">
          How much of the code can be damaged or obscured (e.g. by a logo)
          and still scan. Higher levels pack less data per module, so the
          code gets a little denser for the same text.
        </small>
      </div>

      <div className="qrgen-preview-wrap">
        {result ? (
          <div className="qrgen-preview" dangerouslySetInnerHTML={{ __html: result.svg }} />
        ) : (
          <div className="qrgen-preview qrgen-preview-empty">
            <span>Type something above to generate a QR code</span>
          </div>
        )}
      </div>

      <div className="buttons">
        <button className="primary" onClick={downloadSvg} disabled={!result}>
          Download SVG
        </button>
        <div className="qrgen-png-row">
          <select value={pngSize} onChange={(e) => setPngSize(Number(e.target.value))} disabled={!result}>
            {PNG_SIZES.map((s) => (
              <option key={s} value={s}>{s}×{s}px</option>
            ))}
          </select>
          <button onClick={downloadPng} disabled={!result}>Download PNG</button>
        </div>
      </div>
    </div>
  );
}
