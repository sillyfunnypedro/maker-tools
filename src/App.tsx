import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DEFAULT_PARAMS,
  PROCESS_DIM,
  type Params,
} from "./processing";
import type {
  CncRequest,
  DetectRequest,
  DetectResult,
  PngRequest,
  WorkerResponse,
} from "./worker";
import { rectifyOpening, flattenIllumination, otsuThreshold } from "./rectify";
import { StartScreen, type Tool } from "./StartScreen";
import { FramesPage } from "./FramesPage";
import { TutorialPage } from "./TutorialPage";
import { CookieSplash, cookiePolicyShown } from "./CookieSplash";

/** Decode a File, fix EXIF orientation, downscale to maxDim, and return pixels. */
async function fileToImageData(file: File, maxDim: number): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Local-mean radius for flattening a glass-mode photo, in pixels.
 *
 * It has to be comfortably larger than the drawn line width, or the line's own
 * darkness dominates its local mean and flattening bleaches it away. The frame
 * tool uses ~6 mm against 0.5 mm printed lines (a factor of ~12); marker lines in
 * a hand drawing run ~10 px at this resolution, so a twentieth of the short side
 * (~50 px at 1050 px wide) keeps a similar margin. Measured output was identical
 * anywhere from 21 to 158 px, so this is not a delicate choice.
 */
function glassFlattenRadius(img: ImageData): number {
  return Math.max(8, Math.round(Math.min(img.width, img.height) * 0.05));
}

export default function App() {
  const [showCookieSplash, setShowCookieSplash] = useState(() => !cookiePolicyShown());
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [busy, setBusy] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Transient "Copied!" / "Copy failed" feedback for the clipboard buttons.
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const flashCopyMsg = useCallback((msg: string) => {
    setCopyMsg(msg);
    setTimeout(() => setCopyMsg((m) => (m === msg ? null : m)), 1800);
  }, []);

  // SketchFrame detection: the registration frame printed around the drawing.
  const [frameResult, setFrameResult] = useState<DetectResult | null>(null);
  const lastDetectId = useRef(0);
  const autoThreshFor = useRef<DetectResult | null>(null);
  // Top-level tool chosen on the start screen; no back-and-forth. "home" shows
  // the chooser; "glass" = Stained Glass Processor; "frame" = Image Frame -> SVG.
  const [mode, setMode] = useState<"home" | "glass" | "frame" | "frames" | "howto">("home");
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const paramsRef = useRef(params);
  paramsRef.current = params;
  const fileRef = useRef<File | null>(null);
  const sourceRef = useRef<ImageData | null>(null);
  // Frame workflow: the cut-out, rectified opening (true-scale) + its px/mm.
  // Reactive state (not a ref) so the reprocess effect re-fires when it's ready.
  const [frameSource, setFrameSource] = useState<ImageData | null>(null);
  // Glass workflow: the photo after illumination flattening. A phone snap of paper
  // is nowhere near white — on one test photo every single pixel was darker than
  // the default threshold, so the whole sheet counted as ink and the output was
  // the medial axis of the page. Flattening (the same step the frame tool uses)
  // makes paper uniformly white so the threshold means something.
  const [glassSource, setGlassSource] = useState<ImageData | null>(null);
  const [framePpmm, setFramePpmm] = useState(0);
  // Frame-only view controls: straighten a crooked sheet, and crop in to cut off
  // noise near the opening's edge. Purely coordinate changes — the preview turns
  // and scales with a CSS transform and the export transforms its millimetre
  // coordinates, so nothing in the image pipeline re-runs.
  const [frameRotate, setFrameRotate] = useState(0);
  const [frameZoom, setFrameZoom] = useState(1);
  // Where the crop window sits, offset from the opening's centre (mm).
  const [framePan, setFramePan] = useState({ x: 0, y: 0 });
  const dragFrom = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0); // latest live-preview (png) request
  const svgIdRef = useRef(0);
  const svgPending = useRef(new Map<number, (svg: string) => void>());

  // Spin up the processing worker once.
  useEffect(() => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.kind === "svg") { // CNC export
        const resolve = svgPending.current.get(msg.id);
        if (resolve) { svgPending.current.delete(msg.id); resolve(msg.svg); }
        return;
      }
      if (msg.kind === "detect") {
        // one-shot per image: newer detect ids supersede older ones
        if (msg.id >= lastDetectId.current) {
          lastDetectId.current = msg.id;
          setFrameResult(msg.result);
        }
        return;
      }
      if (msg.id !== reqIdRef.current) return; // a newer request superseded this one
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = msg.width;
        canvas.height = msg.height;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, msg.width, msg.height);
        ctx.putImageData(
          new ImageData(new Uint8ClampedArray(msg.buffer), msg.width, msg.height),
          0,
          0,
        );
      }
      setHasResult(true);
      setBusy(false);
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const run = useCallback((src: ImageData, p: Params) => {
    const worker = workerRef.current;
    if (!worker) return;
    setBusy(true);
    const id = ++reqIdRef.current;
    // Copy the buffer so the source survives transfer (we reprocess on every tweak).
    const copy = src.data.slice();
    const req: PngRequest = {
      kind: "png",
      id,
      buffer: copy.buffer,
      width: src.width,
      height: src.height,
      params: p,
    };
    worker.postMessage(req, [copy.buffer]);
  }, []);

  // Frame pipeline step 2: when a frame is detected, cut out + rectify the
  // opening to a true-scale image and make it the frame-workflow source.
  useEffect(() => {
    if (!frameResult?.detected || !frameResult.Hmm2px || !frameResult.spec || !sourceRef.current) {
      setFrameSource(null);
      setFramePpmm(0);
      // Frame mode never previews the raw photo, so a failed detection produces no
      // render to clear the spinner. Clear it here or the "no frame found" prompt
      // (which waits for !busy) would never appear.
      if (frameResult && !frameResult.detected) setBusy(false);
      return;
    }
    const spec = frameResult.spec;   // self-describing (from the QR payload)
    const target = PROCESS_DIM.standard;
    const ppmm = target / Math.max(spec.innerW, spec.innerH);
    setFramePpmm(ppmm);
    const crop = rectifyOpening(
      sourceRef.current, frameResult.Hmm2px, spec.marginL, spec.marginT,
      spec.innerW, spec.innerH, ppmm, 2, // 2mm inset trims the frame rim
    );
    // Flatten illumination (grayscale + background normalize) so shadows/uneven
    // light don't survive as false lines, then process that.
    const flat = flattenIllumination(crop, Math.round(6 * ppmm)); // ~6mm background
    setFrameSource(flat);
    // Auto-pick sensitivity from the flattened crop (Otsu ink/paper split), but
    // only for a newly detected frame: re-running it while the user drags the
    // rotate slider would keep overwriting their own sensitivity setting.
    if (autoThreshFor.current !== frameResult) {
      autoThreshFor.current = frameResult;
      const thr = Math.max(150, Math.min(250, Math.round(otsuThreshold(flat))));
      setParams((p) => ({ ...p, bgThresh: thr }));
    }
  }, [frameResult]);

  // Debounced reprocess whenever params, mode, or the rectified crop change.
  // Frame mode processes the cut-out opening; glass mode the full photo.
  useEffect(() => {
    // Each tool previews and exports its own prepared source: the rectified crop
    // in frame mode, the flattened photo in glass mode. Never the raw photo.
    const src = mode === "frame" ? frameSource : glassSource;
    if (!src) return;
    const t = setTimeout(() => run(src, params), 180);
    return () => clearTimeout(t);
  }, [params, run, mode, frameSource, glassSource]);

  // Decode the stored file and kick off processing.
  const decodeAndRun = useCallback(
    async (file: File) => {
      setError(null);
      try {
        setBusy(true);
        const imageData = await fileToImageData(file, PROCESS_DIM.standard);
        sourceRef.current = imageData;
        setGlassSource(null);
        // Frame mode processes the rectified crop, not the raw photo. Rendering a
        // preview now would flash a solid black canvas for a second or so: the
        // default threshold applied to a whole photo makes almost every pixel
        // "line". Wait for detection; the reprocess effect fires when the crop
        // lands.
        if (modeRef.current !== "frame") {
          // Flatten, then let Otsu pick the sensitivity from the result — the same
          // treatment the frame tool gives its crop.
          const flat = flattenIllumination(imageData, glassFlattenRadius(imageData));
          const thr = Math.max(150, Math.min(250, Math.round(otsuThreshold(flat))));
          setGlassSource(flat);
          setParams((p) => ({ ...p, bgThresh: thr }));
          run(flat, { ...paramsRef.current, bgThresh: thr });
        }
        // Frame tool only: kick off a one-shot frame detection on the raw pixels.
        setFrameResult(null);
        const worker = workerRef.current;
        if (worker && modeRef.current === "frame") {
          const did = ++svgIdRef.current;
          const dcopy = imageData.data.slice();
          const dreq: DetectRequest = {
            kind: "detect",
            id: did,
            buffer: dcopy.buffer,
            width: imageData.width,
            height: imageData.height,
            params: paramsRef.current,
          };
          worker.postMessage(dreq, [dcopy.buffer]);
        }
      } catch (err) {
        console.error(err);
        setError("Could not read that image.");
        setBusy(false);
      }
    },
    [run],
  );

  const loadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Please choose an image file.");
        return;
      }
      fileRef.current = file;
      setFileName(file.name);
      await decodeAndRun(file);
    },
    [decodeAndRun],
  );

  // Accept a pasted image (⌘V / Ctrl+V) from anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) {
            e.preventDefault();
            void loadFile(file);
            return;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadFile]);

  const onFileInput = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void loadFile(file);
    e.target.value = "";
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  // User-chosen name for the export files (mobile share targets like Drive won't
  // let you rename after the fact). Falls back to the source file name / default.
  const [name, setName] = useState("");
  const baseName = useMemo(() => {
    const n = name.trim().replace(/[/\\:*?"<>|]/g, "-"); // strip filename-unsafe chars
    return n || fileName?.replace(/\.[^.]+$/, "") || "drawing";
  }, [name, fileName]);

  // Plain download: triggers the browser's own save flow (on Chrome/Android
  // this is the "Save file / Save to Google Drive" chooser). Used by the Save
  // buttons so the destination is up to the OS, not forced into a share sheet.
  const download = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  // Share via the OS share sheet (Mail, Messages, Drive, …). Only the Share
  // button uses this; it falls back to a plain download when sharing isn't
  // available or the share is cancelled without picking a target.
  const share = useCallback(
    async (blob: Blob, filename: string) => {
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare) {
        const file = new File([blob], filename, { type: blob.type });
        if (nav.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: filename });
            return;
          } catch (err) {
            if ((err as DOMException)?.name === "AbortError") return;
            // otherwise fall through to a download
          }
        }
      }
      download(blob, filename);
    },
    [download],
  );

  const savePng = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (blob) download(blob, `${baseName}.png`);
  }, [download, baseName]);

  // Share the preview image via the OS share sheet (email, Messages, Drive, …).
  const shareImage = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (blob) await share(blob, `${baseName}.png`);
  }, [share, baseName]);

  // Copy the preview image to the clipboard as PNG, so it can be pasted straight
  // into another app instead of going through a save/attach step. Only Copy
  // targets actual image data — the Clipboard API has no way to write a PDF, and
  // "copying" the SVG can only ever mean its markup as text, not a pasteable image.
  const copyImage = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      flashCopyMsg("Copy isn't supported in this browser — use Share or Download instead.");
      return;
    }
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      flashCopyMsg("Copied image to clipboard.");
    } catch {
      flashCopyMsg("Couldn't copy — use Share or Download instead.");
    }
  }, [flashCopyMsg]);

  const [svgBusy, setSvgBusy] = useState(false);

  // CNC export: vectorize and scale to true mm using the detected frame's
  // homography, clipped to the opening. Needs a detected frame.
  const requestCncSvg = useCallback(
    () =>
      new Promise<string>((resolve, reject) => {
        const worker = workerRef.current;
        const rsrc = frameSource;   // the rectified opening (true scale)
        const fr = frameResult;
        const ppmm = framePpmm;
        if (!worker || !rsrc || !fr?.detected || !fr.spec || !ppmm) {
          reject(new Error("no frame"));
          return;
        }
        const spec = fr.spec;
        const id = ++svgIdRef.current;
        svgPending.current.set(id, resolve);
        const copy = rsrc.data.slice();
        // The rectified image is already deskewed & true-scale, so px->mm is a
        // pure scale (1/ppmm) with the opening's top-left at the origin.
        const s = 1 / ppmm;
        const req: CncRequest = {
          kind: "cnc",
          id,
          buffer: copy.buffer,
          width: rsrc.width,
          height: rsrc.height,
          params,
          H: [[s, 0, 0], [0, s, 0], [0, 0, 1]],
          ox: 0,
          oy: 0,
          openW: spec.innerW,
          openH: spec.innerH,
          rotateDeg: frameRotate,
          zoom: frameZoom,
          panXMm: framePan.x,
          panYMm: framePan.y,
        };
        worker.postMessage(req, [copy.buffer]);
      }),
    [params, frameResult, frameSource, framePpmm, frameRotate, frameZoom, framePan],
  );

  const saveCncSvg = useCallback(async () => {
    setSvgBusy(true);
    try {
      const svg = await requestCncSvg();
      const blob = new Blob([svg], { type: "image/svg+xml" });
      download(blob, `${baseName}-cnc-mm.svg`);
    } catch {
      setError("Could not create the CNC SVG — detect a frame in the photo first.");
    } finally {
      setSvgBusy(false);
    }
  }, [requestCncSvg, download, baseName]);

  // Copy the CNC SVG's markup as text — pasteable into a code editor, or into
  // vector tools (Illustrator, Figma, Inkscape) that accept SVG on paste. Not an
  // image-data copy; some paste targets (chat apps, docs) will just show raw XML.
  const copySvg = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      flashCopyMsg("Copy isn't supported in this browser — use Download instead.");
      return;
    }
    setSvgBusy(true);
    try {
      const svg = await requestCncSvg();
      await navigator.clipboard.writeText(svg);
      flashCopyMsg("Copied SVG code to clipboard.");
    } catch {
      flashCopyMsg("Couldn't copy — detect a frame in the photo first.");
    } finally {
      setSvgBusy(false);
    }
  }, [requestCncSvg, flashCopyMsg]);



  // The window is (openW/zoom) wide, so its centre can move at most half the
  // leftover either way. At 1x there is no room at all.
  const panLimit = useCallback((zoom: number) => {
    const spec = frameResult?.detected ? frameResult.spec : undefined;
    if (!spec) return { x: 0, y: 0 };
    return {
      x: (spec.innerW * (1 - 1 / zoom)) / 2,
      y: (spec.innerH * (1 - 1 / zoom)) / 2,
    };
  }, [frameResult]);

  const clampPan = useCallback((pan: { x: number; y: number }, zoom: number) => {
    const lim = panLimit(zoom);
    return {
      x: Math.max(-lim.x, Math.min(lim.x, pan.x)),
      y: Math.max(-lim.y, Math.min(lim.y, pan.y)),
    };
  }, [panLimit]);

  // Zooming back out shrinks the room to pan, so the offset has to follow.
  const changeZoom = useCallback((z: number) => {
    setFrameZoom(z);
    setFramePan((pan) => clampPan(pan, z));
  }, [clampPan]);

  // Drag the drawing under the window. Pan lives in the window's frame (it is
  // applied after the rotation), so screen deltas map straight onto it and the
  // drawing follows the finger whatever the angle.
  const onStagePointerDown = (e: ReactPointerEvent) => {
    if (mode !== "frame" || frameZoom === 1) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragFrom.current = { x: e.clientX, y: e.clientY, pan: framePan };
  };
  const onStagePointerMove = (e: ReactPointerEvent) => {
    const from = dragFrom.current;
    const spec = frameResult?.detected ? frameResult.spec : undefined;
    const box = canvasRef.current?.getBoundingClientRect();
    if (!from || !spec || !box?.width) return;
    // Screen px -> mm at the current zoom; dragging right reveals what is left of
    // the window, so the offset moves the other way.
    const perPxX = spec.innerW / (frameZoom * box.width);
    const perPxY = spec.innerH / (frameZoom * box.height);
    setFramePan(clampPan({
      x: from.pan.x - (e.clientX - from.x) * perPxX,
      y: from.pan.y - (e.clientY - from.y) * perPxY,
    }, frameZoom));
  };
  const onStagePointerUp = () => { dragFrom.current = null; };

  const viewIsDefault = frameRotate === 0 && frameZoom === 1 && !framePan.x && !framePan.y;
  const resetView = () => {
    setFrameRotate(0);
    setFrameZoom(1);
    setFramePan({ x: 0, y: 0 });
    setFramePan({ x: 0, y: 0 });
  };

  const set = <K extends keyof Params>(key: K) => (e: ChangeEvent<HTMLInputElement>) =>
    setParams((p) => ({ ...p, [key]: Number(e.target.value) }));

  // Frame mode never shows the cells/lines toggle, so it can't recover from
  // landing on "cells" — keep it pinned to "lines" here too (see pickTool).
  const reset = () => setParams(mode === "frame" ? { ...DEFAULT_PARAMS, mode: "lines" } : DEFAULT_PARAMS);

  const pickTool = (t: Tool) => {
    // Start each tool from its own defaults. The two tools work on different
    // images — the frame tool on a rectified, illumination-flattened crop, the
    // glass tool on a raw photo — and the frame tool auto-tunes the threshold for
    // its crop. Carrying that threshold across produced an empty result.
    // Frame mode also only ever traces centerlines, so it never inherits "cells".
    setParams(t === "frame" ? { ...DEFAULT_PARAMS, mode: "lines" } : DEFAULT_PARAMS);
    setFrameRotate(0);
    setFrameZoom(1);
    setFramePan({ x: 0, y: 0 });
    setMode(t);
  };
  const goHome = () => {
    setMode("home");
    fileRef.current = null;
    sourceRef.current = null;
    setFrameSource(null);
    setFrameResult(null);
    setHasResult(false);
    setFileName(null);
    setParams(DEFAULT_PARAMS);
    setName("");
  };

  // On touch devices saving uses the share sheet; on desktop it downloads.
  const isMobile = useMemo(
    () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches,
    [],
  );
  const pngLabel = isMobile ? "Save / Email PNG" : "Download PNG";

  // Frame mode traces the skeleton, which depends only on the threshold and the
  // spur trim. Line thickness and smoothing feed the filled-cell masks, so they
  // cannot change a centerline export at all — showing them would just be a lie.
  const sliders = useMemo(
    () => [
      ...(mode === "glass"
        ? [{
            key: "lineWidth" as const, label: "Line thickness",
            min: 1, max: 30, step: 1, value: params.lineWidth,
            help: "Width of the gap between pieces. Wider gaps leave room for the "
              + "blade to get around each piece, so the stickers cut out cleanly.",
          }]
        : []),
      {
        key: "bgThresh" as const, label: "Detection sensitivity",
        min: 150, max: 250, step: 1, value: params.bgThresh,
        help: "How dark a pixel has to be before it counts as part of a line. "
          + "Raise it to pick up faint pencil; lower it if shadows or paper "
          + "texture are being traced as lines.",
      },
      ...(mode === "glass"
        ? [{
            key: "smoothSigma" as const, label: "Smoothing",
            min: 0, max: 5, step: 0.5, value: params.smoothSigma,
            help: "Rounds off jagged edges. Too much also rounds off corners you "
              + "meant to keep.",
          }]
        : []),
      {
        key: "pruneLen" as const, label: "Spur cleanup",
        min: 0, max: 40, step: 1, value: params.pruneLen,
        help: "Trims short dead-end stubs — the little whiskers left where lines "
          + "cross, or where a pen paused. Raise it if you see stray tails.",
      },
    ],
    [params, mode],
  );

  return (
    <div className="app">
      {showCookieSplash && <CookieSplash onDismiss={() => setShowCookieSplash(false)} />}
      <header>
        <div className="header-row">
          <h1>
            {mode === "frame"
              ? "SketchFrame → SVG"
              : mode === "glass"
                ? "Stained Glass Processor"
                : mode === "frames"
                  ? "Printable SketchFrames"
                  : mode === "howto"
                    ? "How SketchFrame Works"
                    : "Maker Tools"}
          </h1>
          {mode !== "home" && (
            <button className="tool-home" onClick={goHome}>← Tools</button>
          )}
        </div>
        <p className="sub">
          {mode === "frame"
            ? "Photograph a drawing inside a printed SketchFrame → true-millimeter CNC SVG."
            : mode === "glass"
              ? "Turn a line drawing into cut-ready glass-piece cells or line art."
              : mode === "frames"
                ? "Blank SketchFrame sheets to print at true size."
                : mode === "howto"
                  ? "Drawing on paper to a true-size vector file, in five steps."
                  : "Pick a tool to get started."}
        </p>
      </header>

      {mode === "home" ? (
        <StartScreen onPick={pickTool} />
      ) : mode === "frames" ? (
        <FramesPage />
      ) : mode === "howto" ? (
        <TutorialPage onPick={pickTool} />
      ) : !sourceRef.current && !busy ? (
        <label
          className={`dropzone${dragging ? " dragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input type="file" accept="image/*" onChange={onFileInput} hidden />
          <div className="dz-inner">
            <div className="dz-icon">＋</div>
            <strong>Tap to choose a photo</strong>
            <span>or drag an image here · or paste (⌘V / Ctrl+V)</span>
          </div>
        </label>
      ) : (
        <div className="workspace">
          <div
                className={
                  mode === "frame"
                    ? `stage on-white${frameZoom > 1 ? " draggable" : ""}`
                    : "stage"
                }
                onPointerDown={onStagePointerDown}
                onPointerMove={onStagePointerMove}
                onPointerUp={onStagePointerUp}
                onPointerCancel={onStagePointerUp}
              >
            <div className="checker">
              <div style={{ position: "relative", display: "flex", maxWidth: "100%" }}>
                <canvas
                  ref={canvasRef}
                  className="result"
                  style={
                    mode === "frame" && !viewIsDefault
                      ? {
                          transform:
                            `translate(${(-100 * frameZoom * framePan.x) / (frameResult?.spec?.innerW ?? 1)}%, ` +
                            `${(-100 * frameZoom * framePan.y) / (frameResult?.spec?.innerH ?? 1)}%) ` +
                            `rotate(${frameRotate}deg) scale(${frameZoom})`,
                        }
                      : undefined
                  }
                />
              </div>
            </div>
            {busy && <div className="spinner" aria-label="Processing" />}
          </div>

          <div className="controls">
            <label className="name-field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={baseName}
                spellCheck={false}
              />
            </label>

            {mode === "frame" && (
              <div
                className={`frame-status ${
                  !frameResult ? "pending" : frameResult.detected ? "ok" : "none"
                }`}
              >
                {!frameResult ? (
                  "Detecting registration frame…"
                ) : frameResult.detected ? (
                  <span>
                    Frame detected: <strong>{frameResult.spec?.id}</strong> ·{" "}
                    {frameResult.inliers}/{frameResult.nDots! + 4} points · fit ±
                    {frameResult.reprojErrPx!.toFixed(1)}px
                  </span>
                ) : (
                  <span>
                    No registration frame found.
                    {frameResult.reason ? ` (${frameResult.reason})` : ""}
                  </span>
                )}
              </div>
            )}

            {/* Frame mode traces centerlines only — one line per drawn line, which
                is what a CNC follows. */}
            {mode === "glass" && (
              <div className="modes" role="group" aria-label="Output style">
                <button
                  className={params.mode === "cells" ? "active" : ""}
                  onClick={() => setParams((p) => ({ ...p, mode: "cells" }))}
                >
                  Glass pieces
                </button>
                <button
                  className={params.mode === "lines" ? "active" : ""}
                  onClick={() => setParams((p) => ({ ...p, mode: "lines" }))}
                >
                  Line drawing
                </button>
              </div>
            )}

            {/* View controls first: they're the ones people reach for, and neither
                touches the image pipeline. */}
            {mode === "frame" && (
              <>
                <div className="control">
                  <label>
                    Rotate
                    <span className="val">{frameRotate}°</span>
                  </label>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={0.5}
                    value={frameRotate}
                    onChange={(e) => setFrameRotate(Number(e.target.value))}
                  />
                  <small className="help">
                    Turns the drawing inside the window, for lining up a sheet that
                    sits crooked. Sizes stay true — rotating is rigid — and anything
                    turned outside the window is left out of the export.
                  </small>
                </div>
                <div className="control">
                  <label>
                    Zoom
                    {/* Show the area the export will cover, so it's clear this
                        crops the view rather than scaling the drawing. */}
                    <span className="val">
                      {frameZoom.toFixed(2)}×
                      {frameResult?.spec
                        ? ` · ${(frameResult.spec.innerW / frameZoom).toFixed(0)} × ` +
                          `${(frameResult.spec.innerH / frameZoom).toFixed(0)} mm`
                        : ""}
                    </span>
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.05}
                    value={frameZoom}
                    onChange={(e) => changeZoom(Number(e.target.value))}
                  />
                  <small className="help">
                    Crops in — the quickest way to drop specks and shadow marks near
                    the edge. Only what you can see gets exported, still at true
                    size; the file just covers a smaller area. Once you're zoomed
                    in, <strong>drag the drawing</strong> to choose which part.
                  </small>
                </div>
                {!viewIsDefault && (
                  <button className="link-btn reset-view" onClick={resetView}>
                    Reset view
                  </button>
                )}
              </>
            )}

            {sliders.map((s) => (
              <div className="control" key={s.key}>
                <label>
                  {s.label}
                  <span className="val">{s.value}</span>
                </label>
                <input
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={s.value}
                  onChange={set(s.key)}
                />
                <small className="help">{s.help}</small>
              </div>
            ))}


            <div className="buttons">
              {mode === "frame" ? (
                <>
                  <button
                    className="primary"
                    onClick={saveCncSvg}
                    disabled={!hasResult || busy || svgBusy || !frameResult?.detected}
                  >
                    {svgBusy
                      ? "Working…"
                      : `Download CNC SVG · mm${frameResult?.detected ? ` · ${frameResult.spec?.id}` : ""}`}
                  </button>
                  <button
                    onClick={copySvg}
                    disabled={!hasResult || busy || svgBusy || !frameResult?.detected}
                  >
                    Copy SVG code
                  </button>
                  {(() => {
                    const spec = frameResult?.detected ? frameResult.spec : undefined;
                    return spec ? (
                      <p className="hint">
                        True size{" "}
                        <strong>
                          {(spec.innerW / frameZoom).toFixed(1)} ×{" "}
                          {(spec.innerH / frameZoom).toFixed(1)} mm
                        </strong>
                        , single line, clipped to the view. Scaled from the detected frame
                        {frameZoom !== 1 ? ` (opening is ${spec.innerW} × ${spec.innerH} mm)` : ""}.
                      </p>
                    ) : null;
                  })()}
                </>
              ) : (
                <>
                  <button className="primary" onClick={savePng} disabled={!hasResult || busy}>
                    {pngLabel}
                  </button>
                  <button onClick={copyImage} disabled={!hasResult || busy}>
                    Copy image
                  </button>

                  {isMobile && (
                    <p className="hint">
                      Saving opens the share sheet — pick <strong>Mail</strong> to email it to
                      yourself, or <strong>Save to Files</strong>.
                    </p>
                  )}
                </>
              )}

              <button onClick={shareImage} disabled={!hasResult || busy}>
                Share image (email / text)
              </button>

              <button onClick={reset} disabled={busy}>Reset</button>
              <label className="link-btn">
                New photo
                <input type="file" accept="image/*" onChange={onFileInput} hidden />
              </label>


            </div>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {copyMsg && <p className="hint copy-msg">{copyMsg}</p>}

      <details className="about">
        <summary>About this app</summary>
        <div className="about-body">
          <p>
            Upload, drag, or paste a line drawing and this app turns it into a
            clean image you can save or cut. It finds the drawn lines, reduces
            each one to its centerline, rebuilds them at a uniform width, and
            then either fills the enclosed “glass piece” cells (Glass pieces
            mode) or draws the smoothed centerlines (Line drawing mode) — black
            on a transparent background. You can save a PNG or export an SVG for
            cutting machines like Cricut.
          </p>
          <p>
            Everything runs entirely in your browser — your image is never
            uploaded to a server.
          </p>
          <p className="warn">
            <strong>No guarantees.</strong> Results are provided strictly as-is
            and are <strong>in no way guaranteed</strong> to be accurate, usable,
            or suitable for any purpose. Always check the output yourself before
            cutting, printing, or relying on it.
          </p>
          <p>
            Free and open source under{" "}
            <a
              href="https://creativecommons.org/publicdomain/zero/1.0/"
              target="_blank"
              rel="noreferrer"
            >
              Creative Commons CC0 1.0
            </a>{" "}
            (public domain) — use it however you like; attribution appreciated
            but not required.{" "}
            <a
              href="https://github.com/sillyfunnypedro/maker-tools"
              target="_blank"
              rel="noreferrer"
            >
              View the source on GitHub
            </a>
            .
          </p>
        </div>
      </details>

      {mode === "frame" && frameResult && !frameResult.detected && !busy && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="noframe-title">
          <div className="modal">
            <h2 id="noframe-title">No frame detected</h2>
            <p>
              We couldn't find a registration frame in that photo. Take another
              picture with:
            </p>
            <ul className="modal-tips">
              <li>the whole frame filling the shot, square to the camera</li>
              <li>only white paper (no hands, table, or clutter) around it</li>
              <li>flat and evenly lit, no glare on the dots</li>
            </ul>
            <label className="modal-btn">
              <input type="file" accept="image/*" onChange={onFileInput} hidden />
              Give me a new image
            </label>
          </div>
        </div>
      )}

      <footer className="build">
        build {__BUILD_ID__} · {__BUILD_TIME__} UTC
      </footer>
    </div>
  );
}
