// Frame Draw: place a printed SketchFrame on the table, load a reference
// image, and the app fits the image into the frame's opening and keeps it
// glued there — via the frame's own live-detected position, not a device
// tilt sensor — as you move the phone freehand. Nudge the placement with
// drag/pinch/rotate, then "Lock" it so those touches don't disturb it while
// you draw. Nothing here is saved; the app is a live tracing aid, not an
// export step.
//
// Unlike AR Trace's tilt-sensor approach (an estimate from gravity, drifting
// and mount-dependent), this reuses the exact same QR+dot frame detector the
// SketchFrame -> SVG tool already relies on for true-millimetre accuracy —
// run continuously on the live video instead of a single photo — so the
// placement is exact and freehand movement is fully compensated for, not
// just approximated.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { detectQrFrame } from "./qrframe/detect";
import { applyH, homography, matMul3, type Mat3, type Pt } from "./qrframe/homography";
import { openingCornersMm, type QrFrameSpec } from "./qrframe/spec";
import { matrix3dFromHomography } from "./qrframe/cssHomography";
import {
  IDENTITY_ADJUST,
  applyFineAdjustMm,
  fitRectMm,
  videoPxToScreenPx,
  type FineAdjust,
} from "./frameDrawGeometry";

type CameraState = "starting" | "ready" | "denied" | "unsupported" | "error";

interface Detection {
  spec: QrFrameSpec;
  /** mm -> full camera-native pixel space (not the cropped on-screen view). */
  Hmm2px: Mat3;
}

// Detection runs on a downscaled copy of the video frame for speed; this is
// its (long-side) width in pixels. detectQrFrame's cost is dominated by a
// flood-fill over every pixel, so this matters a lot more than jsQR's own cost.
const DETECT_WIDTH = 480;
const DETECT_INTERVAL_MS = 200;

export function FrameDrawPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [restartToken, setRestartToken] = useState(0);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [opacity, setOpacity] = useState(0.6);

  const [detection, setDetection] = useState<Detection | null>(null);
  const [everDetected, setEverDetected] = useState(false);
  const lastGood = useRef<Detection | null>(null);

  const [fineAdjust, setFineAdjust] = useState<FineAdjust>(IDENTITY_ADJUST);
  const [locked, setLocked] = useState(false);

  // --- Camera lifecycle ---------------------------------------------------
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    setCameraState("starting");
    setCameraError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        setCameraState("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "PermissionDeniedError")) {
          setCameraState("denied");
        } else {
          setCameraState("error");
          setCameraError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [restartToken]);

  // --- Keep the screen awake (same reasoning as AR Trace) -------------------
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let cancelled = false;
    let sentinel: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        // Not fatal.
      }
    };
    void acquire();
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinel) void acquire();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release();
    };
  }, []);

  // --- Load a reference image ---------------------------------------------
  const onPickImage = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImageSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = url;
    setImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setFineAdjust(IDENTITY_ADJUST);
    setLocked(false);
  }, []);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Continuous frame detection -------------------------------------------
  // Runs on the main thread at a modest, fixed cadence (not every animation
  // frame) — detectQrFrame on a downscaled frame is a handful of milliseconds,
  // infrequent enough at 5Hz not to visibly stall the video/UI.
  useEffect(() => {
    if (cameraState !== "ready") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && video.videoWidth > 0) {
        const scale = DETECT_WIDTH / video.videoWidth;
        const w = DETECT_WIDTH, h = Math.max(1, Math.round(video.videoHeight * scale));
        // Setting width/height clears the canvas *and* resets all context
        // state (including imageSmoothingEnabled) back to its default, so
        // this has to be set again every tick, after the resize — setting it
        // once outside this loop silently stopped taking effect from the
        // second tick onward. Smoothing blurs a downscale this large enough
        // to wipe out the QR code's fine modules entirely (confirmed against
        // a rendered frame: jsQR found nothing at all with it left on);
        // nearest-neighbor keeps edges crisp enough for both jsQR and the dot
        // threshold.
        canvas.width = w;
        canvas.height = h;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(video, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const result = detectQrFrame(new Uint8ClampedArray(data), w, h);
        if (result.detected && result.spec && result.Hmm2px) {
          // Detection ran on a uniformly downscaled frame; rescale its
          // mm->px homography up to the camera's actual native resolution
          // (plain uniform scale, no crop, since drawImage above resized
          // without cropping).
          const inv = 1 / scale;
          const scaleUp: Mat3 = [[inv, 0, 0], [0, inv, 0], [0, 0, 1]];
          const next: Detection = { spec: result.spec, Hmm2px: matMul3(scaleUp, result.Hmm2px) };
          lastGood.current = next;
          setDetection(next);
          setEverDetected(true);
        } else {
          setDetection(null);
        }
      }
      if (!stopped) timer = setTimeout(tick, DETECT_INTERVAL_MS);
    };
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [cameraState]);

  // --- Compute the image's on-screen transform ------------------------------
  const active = detection ?? lastGood.current;
  let imageTransform: string | null = null;
  if (active && imageUrl && imageSize) {
    const openingMm = openingCornersMm(active.spec);
    const fitMm = fitRectMm(openingMm, imageSize.w / imageSize.h);
    const targetMm = applyFineAdjustMm(fitMm, fineAdjust);
    const videoPxCorners = targetMm.map((p) => applyH(active.Hmm2px, p));
    const stageBox = stageRef.current?.getBoundingClientRect();
    const video = videoRef.current;
    if (stageBox && video && video.videoWidth > 0) {
      const screenCorners = videoPxCorners.map((p) =>
        videoPxToScreenPx(p, video.videoWidth, video.videoHeight, stageBox.width, stageBox.height));
      const srcRect: Pt[] = [[0, 0], [imageSize.w, 0], [imageSize.w, imageSize.h], [0, imageSize.h]];
      const H = homography(srcRect, screenCorners);
      imageTransform = matrix3dFromHomography(H);
    }
  }

  // --- Drag / pinch-zoom / rotate the fine-adjust offset --------------------
  // Composed in the frame's own mm space (see frameDrawGeometry.ts), so it
  // stays anchored to the frame regardless of camera pose — but the gesture
  // itself happens in screen pixels, so drag distance is converted to mm
  // using the tracked quad's current on-screen size. That conversion (and the
  // 1:1 screen-angle -> mm-angle mapping for pinch-rotate) is only exact when
  // viewing roughly straight-on; held at a sharp angle, the feel is
  // approximate, not exact — a known simplification, not a bug.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragStart = useRef<{ x: number; y: number; adjust: FineAdjust; mmPerPx: number } | null>(null);
  const pinchStart = useRef<{
    dist: number; angle: number; adjust: FineAdjust; midX: number; midY: number; mmPerPx: number;
  } | null>(null);

  const currentMmPerScreenPx = (): number => {
    if (!active || !imageUrl || !imageSize) return 1;
    const openingMm = openingCornersMm(active.spec);
    const fitMm = fitRectMm(openingMm, imageSize.w / imageSize.h);
    const widthMm = fitMm[1][0] - fitMm[0][0];
    const videoPxCorners = fitMm.map((p) => applyH(active.Hmm2px, p));
    const stageBox = stageRef.current?.getBoundingClientRect();
    const video = videoRef.current;
    if (!stageBox || !video || !video.videoWidth) return 1;
    const a = videoPxToScreenPx(videoPxCorners[0], video.videoWidth, video.videoHeight, stageBox.width, stageBox.height);
    const b = videoPxToScreenPx(videoPxCorners[1], video.videoWidth, video.videoHeight, stageBox.width, stageBox.height);
    const widthPx = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return widthMm / widthPx;
  };

  const onOverlayPointerDown = (e: ReactPointerEvent) => {
    if (locked || !imageUrl) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const mmPerPx = currentMmPerScreenPx();
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = {
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        adjust: fineAdjust,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        mmPerPx,
      };
      dragStart.current = null;
    } else if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY, adjust: fineAdjust, mmPerPx };
    }
  };

  const onOverlayPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const g = pinchStart.current;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      setFineAdjust({
        scale: Math.max(0.2, Math.min(6, g.adjust.scale * (dist / g.dist))),
        rotateDeg: g.adjust.rotateDeg + ((angle - g.angle) * 180) / Math.PI,
        dx: g.adjust.dx + (midX - g.midX) * g.mmPerPx,
        dy: g.adjust.dy + (midY - g.midY) * g.mmPerPx,
      });
    } else if (pointers.current.size === 1 && dragStart.current) {
      const from = dragStart.current;
      setFineAdjust((t) => ({
        ...t,
        dx: from.adjust.dx + (e.clientX - from.x) * from.mmPerPx,
        dy: from.adjust.dy + (e.clientY - from.y) * from.mmPerPx,
      }));
    }
  };

  const endPointer = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinchStart.current = null;
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      dragStart.current = { x: p.x, y: p.y, adjust: fineAdjust, mmPerPx: currentMmPerScreenPx() };
    } else {
      dragStart.current = null;
    }
  };

  const frameStatus: "searching" | "tracking" | "lost" =
    detection ? "tracking" : everDetected ? "lost" : "searching";

  return (
    <div className="artrace framedraw">
      <div className="artrace-stage" ref={stageRef}>
        <video ref={videoRef} className="artrace-video" autoPlay playsInline muted />

        {cameraState !== "ready" && (
          <div className="artrace-camera-status">
            {cameraState === "starting" && <span>Starting camera…</span>}
            {cameraState === "denied" && (
              <>
                <span>Camera access was denied.</span>
                <button onClick={() => setRestartToken((n) => n + 1)}>Try again</button>
              </>
            )}
            {cameraState === "unsupported" && <span>This browser doesn't support camera access.</span>}
            {cameraState === "error" && <span>Camera error{cameraError ? `: ${cameraError}` : "."}</span>}
          </div>
        )}

        {cameraState === "ready" && imageUrl && imageTransform && (
          <div
            className="artrace-overlay"
            onPointerDown={onOverlayPointerDown}
            onPointerMove={onOverlayPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            <img
              src={imageUrl}
              alt="Reference to trace"
              className="framedraw-image"
              style={{
                width: imageSize?.w,
                height: imageSize?.h,
                opacity: frameStatus === "lost" ? opacity * 0.5 : opacity,
                transform: imageTransform,
              }}
              draggable={false}
            />
          </div>
        )}

        {cameraState === "ready" && imageUrl && (
          <div className={`framedraw-status framedraw-status-${frameStatus}`}>
            {frameStatus === "searching" && "Point the camera at a printed frame…"}
            {frameStatus === "tracking" && "Frame tracking"}
            {frameStatus === "lost" && "Frame lost — frozen"}
          </div>
        )}

        {cameraState === "ready" && !imageUrl && (
          <div className="artrace-empty-hint">
            <span>Load an image, then point the camera at a printed frame on the table.</span>
          </div>
        )}
      </div>

      <div className="artrace-controls">
        <label className="artrace-load link-btn">
          {imageUrl ? "Change image" : "Load image"}
          <input type="file" accept="image/*" onChange={onPickImage} hidden />
        </label>

        {imageUrl && (
          <>
            <div className="control artrace-opacity">
              <label>
                Image opacity
                <span className="val">{Math.round(opacity * 100)}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </div>

            <button className={locked ? "primary" : undefined} onClick={() => setLocked((v) => !v)}>
              {locked ? "Locked — tap to unlock" : "Lock placement"}
            </button>
            <button className="link-btn" onClick={() => setFineAdjust(IDENTITY_ADJUST)}>
              Reset placement
            </button>
          </>
        )}
      </div>

      <p className="hint">
        Place a printed SketchFrame on the table. Drag/pinch to nudge the
        image within the frame's opening, then lock it so touches while
        drawing don't move it — the frame itself, tracked live, keeps the
        image in place as you move the phone freehand. Nothing here is
        saved.
      </p>
    </div>
  );
}
