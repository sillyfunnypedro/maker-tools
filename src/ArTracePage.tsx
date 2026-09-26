// AR Trace: load a reference image, then point the camera at a sheet of paper
// on the table. The image is drawn on top of the live camera feed with an
// adjustable opacity, like laying tracing paper over a picture on a light
// table — drag/pinch/rotate the image to line it up with the paper, then trace
// it by hand while watching the screen. Everything here is on-screen only:
// there is no capture/export step, since the point is the paper drawing, not
// a digital file.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { detectLines } from "./lineDetect";

interface Transform {
  x: number;
  y: number;
  scale: number;
  rotateDeg: number;
}

const IDENTITY: Transform = { x: 0, y: 0, scale: 1, rotateDeg: 0 };

type CameraState = "starting" | "ready" | "denied" | "unsupported" | "error";

interface Tilt {
  beta: number;  // front-back tilt, degrees
  gamma: number; // left-right tilt, degrees
}

type TiltState = "idle" | "unsupported" | "denied" | "active";

// iOS gates DeviceOrientationEvent behind an explicit permission prompt (has
// to be triggered from a user gesture); no other browser has this method.
type DeviceOrientationEventCtor = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function ArTracePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [restartToken, setRestartToken] = useState(0);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.5);
  const [transform, setTransform] = useState<Transform>(IDENTITY);

  const [lineDetectOn, setLineDetectOn] = useState(false);
  const [lineThreshold, setLineThreshold] = useState(120);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);

  const [tiltState, setTiltState] = useState<TiltState>("idle");
  const [tilt, setTilt] = useState<Tilt | null>(null);
  const [tiltBaseline, setTiltBaseline] = useState<Tilt | null>(null);
  const [autoSkew, setAutoSkew] = useState(true);

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

  // --- Keep the screen awake ------------------------------------------------
  // The phone sits mounted above the paper for the whole drawing session, not
  // handheld, so there's no touch/motion to reset the OS's screen-lock timer —
  // without this the display sleeps mid-trace and takes the camera feed with
  // it. Re-acquired on visibility change, since the OS releases the lock
  // whenever the tab is hidden (e.g. the phone still auto-locks if the user
  // switches away and back).
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
        // Not fatal — e.g. the OS declined it. The tool still works, it just
        // won't stop the screen from sleeping.
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

  // --- Tilt sensor: skew the image to match a camera held at an angle -------
  // Holding the phone tilted (rather than straight down) shows more of the
  // paper, but foreshortens it into a trapezoid — the flat reference image
  // needs the same keystone skew to still line up. The first reading after
  // enabling becomes the "level" baseline (whatever angle the phone happens
  // to be at when you turn this on); skew tracks the *change* from there, not
  // an absolute flat-table reading, since there's no way to know the mount's
  // resting angle in advance. Recalibrate resets that baseline to the current
  // angle if the mount gets bumped or repositioned.
  const enableTilt = useCallback(async () => {
    if (typeof DeviceOrientationEvent === "undefined") {
      setTiltState("unsupported");
      return;
    }
    const ctor = DeviceOrientationEvent as DeviceOrientationEventCtor;
    if (typeof ctor.requestPermission === "function") {
      try {
        if ((await ctor.requestPermission()) !== "granted") {
          setTiltState("denied");
          return;
        }
      } catch {
        setTiltState("denied");
        return;
      }
    }
    setTiltBaseline(null);
    setTiltState("active");
  }, []);

  useEffect(() => {
    if (tiltState !== "active") return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      const next = { beta: e.beta, gamma: e.gamma };
      setTilt(next);
      setTiltBaseline((b) => b ?? next);
    };
    window.addEventListener("deviceorientation", onOrientation);
    return () => window.removeEventListener("deviceorientation", onOrientation);
  }, [tiltState]);

  const recalibrateTilt = useCallback(() => setTiltBaseline(tilt), [tilt]);

  const relBeta = tilt && tiltBaseline ? clamp(tilt.beta - tiltBaseline.beta, -45, 45) : 0;
  const relGamma = tilt && tiltBaseline ? clamp(tilt.gamma - tiltBaseline.gamma, -45, 45) : 0;
  const skewActive = autoSkew && tiltState === "active" && tiltBaseline != null;

  // --- Load a reference image ---------------------------------------------
  const onPickImage = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setTransform(IDENTITY);
    setProcessedUrl(null);
  }, []);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Line detection: reduce the image to black-and-white outlines --------
  // Recomputed (debounced) whenever the toggle, the slider, or the image
  // itself changes; skipped entirely while off, so plain tracing never pays
  // for it.
  useEffect(() => {
    if (!lineDetectOn || !imageUrl) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        setProcessedUrl(detectLines(img, lineThreshold));
      };
      img.src = imageUrl;
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lineDetectOn, imageUrl, lineThreshold]);

  const displayImageUrl = lineDetectOn && processedUrl ? processedUrl : imageUrl;

  // --- Drag / pinch-zoom / rotate the overlaid image ----------------------
  // One finger pans; two fingers scale + rotate together, pivoting on their
  // midpoint so the point you're pinching stays under your fingers.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const pinchStart = useRef<{
    dist: number; angle: number; scale: number; rotateDeg: number; midX: number; midY: number; tx: number; ty: number;
  } | null>(null);

  const onOverlayPointerDown = (e: ReactPointerEvent) => {
    if (!imageUrl) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = {
        dist: Math.hypot(b.x - a.x, b.y - a.y),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        scale: transform.scale,
        rotateDeg: transform.rotateDeg,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        tx: transform.x,
        ty: transform.y,
      };
      dragStart.current = null;
    } else if (pointers.current.size === 1) {
      dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
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
      setTransform({
        scale: Math.max(0.2, Math.min(6, g.scale * (dist / g.dist))),
        rotateDeg: g.rotateDeg + ((angle - g.angle) * 180) / Math.PI,
        x: g.tx + (midX - g.midX),
        y: g.ty + (midY - g.midY),
      });
    } else if (pointers.current.size === 1 && dragStart.current) {
      const from = dragStart.current;
      setTransform((t) => ({ ...t, x: from.tx + (e.clientX - from.x), y: from.ty + (e.clientY - from.y) }));
    }
  };

  const endPointer = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    pinchStart.current = null;
    if (pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      dragStart.current = { x: p.x, y: p.y, tx: transform.x, ty: transform.y };
    } else {
      dragStart.current = null;
    }
  };

  return (
    <div className="artrace">
      <div className="artrace-stage">
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

        {imageUrl && (
          <div
            className="artrace-overlay"
            onPointerDown={onOverlayPointerDown}
            onPointerMove={onOverlayPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            <img
              src={displayImageUrl ?? imageUrl}
              alt="Reference to trace"
              className="artrace-image"
              style={{
                opacity,
                transform:
                  (skewActive ? `perspective(900px) rotateX(${relBeta}deg) rotateY(${-relGamma}deg) ` : "") +
                  `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) ` +
                  `rotate(${transform.rotateDeg}deg) scale(${transform.scale})`,
              }}
              draggable={false}
            />
          </div>
        )}

        {!imageUrl && (
          <div className="artrace-empty-hint">
            <span>Load an image to trace, then point the camera at your paper.</span>
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

            <button
              className={lineDetectOn ? "primary" : undefined}
              onClick={() => setLineDetectOn((v) => !v)}
            >
              {lineDetectOn ? "Line detection: On" : "Line detection: Off"}
            </button>
            {lineDetectOn && (
              <div className="control">
                <label>
                  Line sensitivity
                  <span className="val">{lineThreshold}</span>
                </label>
                <input
                  type="range"
                  min={20}
                  max={400}
                  step={5}
                  value={lineThreshold}
                  onChange={(e) => setLineThreshold(Number(e.target.value))}
                />
                <small className="help">
                  Lower shows more/fainter lines (and more noise); higher keeps
                  only the strongest edges.
                </small>
              </div>
            )}

            <div className="artrace-tilt-block">
              {tiltState === "idle" && (
                <button onClick={enableTilt}>Enable tilt sensor</button>
              )}
              {tiltState === "unsupported" && (
                <small className="help">This browser doesn't expose a tilt sensor.</small>
              )}
              {tiltState === "denied" && (
                <>
                  <small className="help">Tilt sensor access was denied.</small>
                  <button onClick={enableTilt}>Try again</button>
                </>
              )}
              {tiltState === "active" && (
                <div className="artrace-tilt-row">
                  <div className="artrace-level" aria-hidden>
                    <div
                      className="artrace-level-dot"
                      style={{ transform: `translate(${(clamp(relGamma, -30, 30) / 30) * 20}px, ${(clamp(relBeta, -30, 30) / 30) * 20}px)` }}
                    />
                  </div>
                  <div className="artrace-tilt-info">
                    <span>
                      Tilt: {relBeta >= 0 ? "+" : ""}{relBeta.toFixed(0)}° / {relGamma >= 0 ? "+" : ""}{relGamma.toFixed(0)}°
                    </span>
                    <button
                      className={autoSkew ? "primary" : undefined}
                      onClick={() => setAutoSkew((v) => !v)}
                    >
                      {autoSkew ? "Auto-skew: On" : "Auto-skew: Off"}
                    </button>
                    <button className="link-btn" onClick={recalibrateTilt}>
                      Recalibrate level
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button className="link-btn" onClick={() => setTransform(IDENTITY)}>
              Reset position
            </button>
          </>
        )}
      </div>

      <p className="hint">
        Drag with one finger to move the image, pinch with two fingers to
        resize and rotate it. Enable the tilt sensor to auto-skew the image
        when the camera is held at an angle instead of straight down, so it
        still lines up with the paper. Nothing here is saved — this is a live
        aid for tracing onto real paper.
      </p>
    </div>
  );
}
