"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  Camera,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  MoveHorizontal,
  Video,
  RotateCcw,
  Check,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { MouthDetector, interpretDetection } from "@/lib/mouthDetector";

/**
 * ScanningFlow
 * - Mouth Guide overlay with a real on-device face + mouth detector
 *   (MediaPipe Face Landmarker). Shutter only unlocks when:
 *     * a face is detected and reasonably centred & sized
 *     * the mouth is open (inner-lip gap crosses a threshold)
 *     * the user holds still (~0.5s of sustained "ok")
 * - Pre-shot instruction, 3s countdown, review/retake screen.
 * - Full, un-masked video so the user never feels "zoomed out".
 */

type Quality = "searching" | "adjust" | "stable";

export default function ScanningFlow() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<MouthDetector | null>(null);
  const rafRef = useRef<number | null>(null);
  const stableStreakRef = useRef(0);

  const [camReady, setCamReady] = useState(false);
  const [camStarting, setCamStarting] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);

  const [detectorLoading, setDetectorLoading] = useState(true);
  const [detectorError, setDetectorError] = useState<string | null>(null);

  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [quality, setQuality] = useState<Quality>("searching");
  const [qualityMsg, setQualityMsg] = useState<string>("Warming up detector…");
  const [stableLocked, setStableLocked] = useState(false);

  const [countdown, setCountdown] = useState<number | null>(null);
  const [showPreShot, setShowPreShot] = useState(true);

  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);

  const router = useRouter();

  const VIEWS = useMemo(
    () => [
      {
        label: "Front View",
        instruction: "Smile and open your mouth slightly to show your teeth.",
        tip: "Hold phone at arm's length. Teeth must be visible inside the oval.",
      },
      {
        label: "Left View",
        instruction: "Turn your head to the left and keep lips apart.",
        tip: "Keep the phone still — only your head turns.",
      },
      {
        label: "Right View",
        instruction: "Turn your head to the right and keep lips apart.",
        tip: "Stay still for 2 seconds when the ring turns green.",
      },
      {
        label: "Upper Teeth",
        instruction: "Tilt your head back and open wide.",
        tip: "Good lighting helps — face a window or lamp if possible.",
      },
      {
        label: "Lower Teeth",
        instruction: "Tilt your head down and open wide.",
        tip: "Pull your lower lip down slightly for a clear shot.",
      },
    ],
    []
  );

  // --- Camera lifecycle -----------------------------------------------------

  const attachStream = useCallback((stream: MediaStream) => {
    streamRef.current = stream;
    const el = videoRef.current;
    if (!el) return;
    try {
      el.srcObject = stream;
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) {
      console.warn("Failed to attach stream", e);
    }
    setCamReady(true);
  }, []);

  const startCamera = useCallback(async () => {
    setCamError(null);
    setCamStarting(true);

    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError(
        "Your browser doesn't support camera access. Try Chrome, Safari, or Firefox on HTTPS / localhost."
      );
      setCamStarting(false);
      return;
    }
    if (!window.isSecureContext) {
      setCamError(
        "Camera requires HTTPS or localhost. The page is running in an insecure context."
      );
      setCamStarting(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      attachStream(stream);
    } catch (err: any) {
      console.error("Camera access failed", err);
      const name: string = err?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setCamError(
          "Camera permission was denied. Click the camera icon in your browser address bar, allow access, then click 'Enable camera' again."
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          attachStream(stream);
          setCamStarting(false);
          return;
        } catch (err2: any) {
          setCamError(err2?.message || "No camera found on this device.");
        }
      } else if (name === "NotReadableError") {
        setCamError("Another app is using the camera. Close other tabs/apps and try again.");
      } else {
        setCamError(err?.message || "Unable to access camera. Click 'Enable camera' to try again.");
      }
    } finally {
      setCamStarting(false);
    }
  }, [attachStream]);

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      detectorRef.current?.dispose();
      detectorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Detector lifecycle ---------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const det = new MouthDetector();
    detectorRef.current = det;
    det
      .load()
      .then(() => {
        if (cancelled) return;
        if (det.loadError) {
          setDetectorError(det.loadError);
          setQualityMsg("Detector unavailable — use manual framing");
        } else {
          setDetectorError(null);
          setQualityMsg("Center your face in the oval and open your mouth");
        }
        setDetectorLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setDetectorError(String(e));
        setDetectorLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Detection loop -------------------------------------------------------

  useEffect(() => {
    if (!camReady) return;
    if (countdown !== null || pendingImage || submitting) return;
    const det = detectorRef.current;
    if (!det) return;

    let lastAt = 0;
    const SAMPLE_MS = 120;

    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (now - lastAt < SAMPLE_MS) return;
      lastAt = now;
      const video = videoRef.current;
      if (!video) return;

      if (!det.ready) {
        // Fallback while the model is still loading: keep shutter locked.
        setQuality("searching");
        if (!detectorError) setQualityMsg("Warming up detector…");
        stableStreakRef.current = 0;
        setStableLocked(false);
        return;
      }

      if (detectorError) {
        // Model failed — allow capture with a warning after a short delay.
        setQuality("adjust");
        setQualityMsg("Detector unavailable — frame manually and capture");
        stableStreakRef.current = Math.min(10, stableStreakRef.current + 1);
        setStableLocked(stableStreakRef.current >= 4);
        return;
      }

      const detection = det.detect(video, now);
      const { reason, message, ok } = interpretDetection(detection);
      setQuality(reason);
      setQualityMsg(message);
      if (ok) stableStreakRef.current += 1;
      else stableStreakRef.current = 0;
      setStableLocked(stableStreakRef.current >= 4);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [camReady, countdown, pendingImage, submitting, currentStep, detectorError]);

  // --- Step lifecycle -------------------------------------------------------

  useEffect(() => {
    if (currentStep < VIEWS.length) {
      setShowPreShot(true);
      setCountdown(null);
      setPendingImage(null);
      stableStreakRef.current = 0;
      setStableLocked(false);
    }
  }, [currentStep, VIEWS.length]);

  const finalizeScan = useCallback(
    async (images: string[]) => {
      try {
        setSubmitting(true);
        const id = `scan_${Date.now()}`;
        setScanId(id);
        try {
          sessionStorage.setItem(`${id}:images`, JSON.stringify(images));
        } catch {}
        await fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scanId: id,
            status: "completed",
            userId: "clinic-default",
          }),
        });
        router.push(`/result?scanId=${encodeURIComponent(id)}`);
      } catch (e) {
        console.error("Failed to finalize scan", e);
        setSubmitting(false);
      }
    },
    [router]
  );

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    // Final safety gate when the detector is available.
    const det = detectorRef.current;
    if (det?.ready && !detectorError) {
      const d = det.detect(video, performance.now());
      const r = interpretDetection(d);
      if (!r.ok) {
        setQuality(r.reason);
        setQualityMsg(r.message);
        stableStreakRef.current = 0;
        setStableLocked(false);
        return;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setPendingImage(dataUrl);
  }, [detectorError]);

  const confirmPending = useCallback(() => {
    if (!pendingImage) return;
    setCapturedImages((prev) => {
      const next = [...prev, pendingImage];
      const nextStep = currentStep + 1;
      if (nextStep >= VIEWS.length) finalizeScan(next);
      return next;
    });
    setPendingImage(null);
    setCurrentStep((prev) => prev + 1);
  }, [pendingImage, currentStep, VIEWS.length, finalizeScan]);

  const retakePending = useCallback(() => {
    setPendingImage(null);
    stableStreakRef.current = 0;
    setStableLocked(false);
  }, []);

  const handleShutter = useCallback(() => {
    if (countdown !== null || !stableLocked || pendingImage) return;
    setShowPreShot(false);
    setCountdown(3);
  }, [countdown, stableLocked, pendingImage]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      captureFrame();
      setCountdown(null);
      return;
    }
    const id = setTimeout(() => {
      if (!stableLocked) {
        setCountdown(null);
        return;
      }
      setCountdown((c) => (c === null ? null : c - 1));
    }, 900);
    return () => clearTimeout(id);
  }, [countdown, captureFrame, stableLocked]);

  // --- Render helpers -------------------------------------------------------

  const qualityStyle = {
    searching: {
      ring: "stroke-amber-400",
      text: "text-amber-300",
      glow: "shadow-[0_0_80px_rgba(251,191,36,0.35)]",
      dot: "bg-amber-400",
    },
    adjust: {
      ring: "stroke-orange-500",
      text: "text-orange-300",
      glow: "shadow-[0_0_80px_rgba(249,115,22,0.45)]",
      dot: "bg-orange-400",
    },
    stable: {
      ring: "stroke-emerald-400",
      text: "text-emerald-300",
      glow: "shadow-[0_0_100px_rgba(52,211,153,0.55)]",
      dot: "bg-emerald-400",
    },
  }[quality];

  const view = VIEWS[Math.min(currentStep, VIEWS.length - 1)];
  const done = currentStep >= VIEWS.length;

  return (
    <div className="flex flex-col items-center bg-black min-h-screen text-white">
      <div className="p-4 w-full bg-zinc-900/80 backdrop-blur border-b border-zinc-800 flex justify-between items-center">
        <h1 className="font-bold text-blue-400 tracking-tight">DentalScan AI</h1>
        <span className="text-xs text-zinc-400">
          Step {Math.min(currentStep + 1, VIEWS.length)}/{VIEWS.length}
        </span>
      </div>

      <div className="w-full h-1 bg-zinc-900">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-500"
          style={{ width: `${(currentStep / VIEWS.length) * 100}%` }}
        />
      </div>

      <div className="relative w-full max-w-md aspect-[3/4] bg-zinc-950 overflow-hidden flex items-center justify-center">
        {!done ? (
          <>
            {/* Full, un-masked video feed — mirrored so left/right feels natural */}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />

            {/* Blur layer: applies backdrop-filter blur to everything in the
                 viewport, then masks itself away inside the oval so the mouth
                 region remains sharp. Outside the oval: real-time blur + dim. */}
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                backdropFilter: "blur(16px) brightness(0.7)",
                WebkitBackdropFilter: "blur(16px) brightness(0.7)",
                backgroundColor: "rgba(0,0,0,0.15)",
                WebkitMaskImage:
                  "radial-gradient(ellipse 36% 29% at 50% 48%, transparent 62%, black 78%)",
                maskImage:
                  "radial-gradient(ellipse 36% 29% at 50% 48%, transparent 62%, black 78%)",
              }}
            />

            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 300 400"
              preserveAspectRatio="none"
            >
              <defs>
                <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                {/* Big, soft halo used to cast a "studio light" ring around the oval */}
                <filter id="lightHalo" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="10" result="blur1" />
                  <feGaussianBlur in="blur1" stdDeviation="6" result="blur2" />
                  <feMerge>
                    <feMergeNode in="blur2" />
                    <feMergeNode in="blur1" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Outer white light halo — concentrates attention on the face */}
              <ellipse
                cx="150"
                cy="192"
                rx="122"
                ry="130"
                fill="none"
                stroke="white"
                strokeOpacity="0.75"
                strokeWidth="10"
                style={{ filter: "url(#lightHalo)" }}
              />
              {/* Inner crisp white rim on top of the halo */}
              <ellipse
                cx="150"
                cy="192"
                rx="120"
                ry="128"
                fill="none"
                stroke="white"
                strokeOpacity="0.9"
                strokeWidth="2"
              />

              {/* Dashed outer guide */}
              <ellipse
                cx="150"
                cy="192"
                rx="112"
                ry="120"
                fill="none"
                strokeWidth="2"
                strokeDasharray="6 8"
                className="stroke-white/40"
              />
              {/* Inner quality ring */}
              <ellipse
                cx="150"
                cy="192"
                rx="104"
                ry="112"
                fill="none"
                strokeWidth="4"
                className={`${qualityStyle.ring} transition-all duration-300`}
                style={{ filter: "url(#softGlow)" }}
              />
              {/* Crosshair ticks */}
              <line x1="150" y1="62" x2="150" y2="78" className="stroke-white/60" strokeWidth="2" />
              <line x1="150" y1="306" x2="150" y2="322" className="stroke-white/60" strokeWidth="2" />
              <line x1="30" y1="192" x2="46" y2="192" className="stroke-white/60" strokeWidth="2" />
              <line x1="254" y1="192" x2="270" y2="192" className="stroke-white/60" strokeWidth="2" />
            </svg>

            {/* Pre-shot instruction */}
            {camReady && showPreShot && !pendingImage && (
              <div className="absolute inset-x-4 top-4 rounded-2xl bg-black/70 backdrop-blur-md border border-white/10 p-4 text-center">
                <p className="text-[11px] uppercase tracking-widest text-blue-300 mb-1">
                  {view.label} · Before you capture
                </p>
                <p className="text-sm font-semibold">{view.instruction}</p>
                <p className="text-xs text-zinc-300 mt-2 flex items-center justify-center gap-1">
                  <MoveHorizontal size={12} /> {view.tip}
                </p>
              </div>
            )}

            {/* Quality indicator pill */}
            {camReady && !pendingImage && (
              <div
                className={`absolute bottom-28 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-black/70 backdrop-blur border border-white/10 flex items-center gap-2 ${qualityStyle.glow}`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${qualityStyle.dot} ${
                    quality === "stable" ? "" : "animate-pulse"
                  }`}
                />
                <span className={`text-xs ${qualityStyle.text}`}>{qualityMsg}</span>
              </div>
            )}

            {/* Countdown */}
            {countdown !== null && countdown > 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-7xl font-bold text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.8)]">
                  {countdown}
                </div>
              </div>
            )}

            {/* Review screen */}
            {pendingImage && (
              <div className="absolute inset-0 z-30 flex flex-col bg-black/95">
                <div className="flex-1 relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={pendingImage}
                    alt="Captured"
                    className="w-full h-full object-contain"
                    style={{ transform: "scaleX(-1)" }}
                  />
                  <div className="absolute top-3 left-3 text-[11px] bg-black/60 px-2 py-1 rounded-full text-emerald-300 border border-emerald-400/30">
                    {view.label} captured
                  </div>
                </div>
                <div className="flex gap-2 p-4 border-t border-zinc-800 bg-zinc-950">
                  <button
                    onClick={retakePending}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 font-semibold"
                  >
                    <RotateCcw size={16} /> Retake
                  </button>
                  <button
                    onClick={confirmPending}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold"
                  >
                    <Check size={16} /> Use photo
                  </button>
                </div>
              </div>
            )}

            {/* Camera-permission overlay */}
            {!camReady && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center text-center px-6 bg-black/85 backdrop-blur">
                {camStarting ? (
                  <>
                    <Loader2 className="animate-spin text-blue-400 mb-3" size={32} />
                    <p className="text-sm font-semibold">Requesting camera access…</p>
                    <p className="text-xs text-zinc-400 mt-1">
                      Accept the browser prompt to continue.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-full bg-blue-500/20 border border-blue-400/40 flex items-center justify-center mb-3">
                      {camError ? (
                        <AlertTriangle className="text-amber-400" size={22} />
                      ) : (
                        <Video className="text-blue-300" size={22} />
                      )}
                    </div>
                    <p className="text-base font-semibold">
                      {camError ? "Camera access needed" : "Enable your camera"}
                    </p>
                    <p className="text-xs text-zinc-300 mt-2 max-w-xs">
                      {camError ??
                        "We'll use your camera to capture 5 angles of your teeth. Nothing is uploaded without your consent."}
                    </p>
                    <button
                      onClick={startCamera}
                      className="mt-4 px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-sm font-semibold transition"
                    >
                      Enable camera
                    </button>
                    <p className="text-[10px] text-zinc-500 mt-3 max-w-xs">
                      If the browser doesn't prompt, check the camera icon in the address
                      bar and allow access, then click again.
                    </p>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-center p-10">
            {submitting ? (
              <>
                <Loader2 size={48} className="text-blue-400 mx-auto mb-4 animate-spin" />
                <h2 className="text-xl font-bold">Uploading your scan…</h2>
                <p className="text-zinc-400 mt-2">Notifying your clinic</p>
              </>
            ) : (
              <>
                <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold">Scan Complete</h2>
                <p className="text-zinc-400 mt-2">
                  {scanId ? "Redirecting to your results…" : "Finishing up…"}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {!done && !pendingImage && (
        <>
          <div className="px-6 pt-4 text-center">
            <p className="text-sm font-medium">{view.instruction}</p>
            <p className="text-xs text-zinc-500 mt-1">
              {view.label}
              {detectorLoading && " · loading detector…"}
              {detectorError && " · detector offline"}
            </p>
          </div>

          <div className="p-6 w-full flex flex-col items-center gap-2">
            <button
              onClick={handleShutter}
              disabled={countdown !== null || !camReady || !stableLocked}
              className={`w-20 h-20 rounded-full border-4 flex items-center justify-center transition-all active:scale-90 ${
                stableLocked
                  ? "border-emerald-400 shadow-[0_0_40px_rgba(52,211,153,0.5)]"
                  : "border-white/40"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              aria-label={stableLocked ? "Capture photo" : "Waiting for stable frame"}
              title={stableLocked ? "Capture" : qualityMsg}
            >
              <div
                className={`w-16 h-16 rounded-full flex items-center justify-center ${
                  stableLocked ? "bg-emerald-400" : "bg-white/70"
                }`}
              >
                <Camera className="text-black" />
              </div>
            </button>
            {!stableLocked && camReady && (
              <p className="text-[11px] text-zinc-500">Shutter unlocks when conditions are met</p>
            )}
          </div>
        </>
      )}

      <div className="flex gap-2 p-4 overflow-x-auto w-full justify-center">
        {VIEWS.map((v, i) => (
          <div
            key={i}
            className={`w-14 h-20 rounded-md border-2 shrink-0 overflow-hidden relative ${
              i === currentStep
                ? "border-blue-500 bg-blue-500/10"
                : capturedImages[i]
                  ? "border-emerald-500/60"
                  : "border-zinc-800"
            }`}
            title={v.label}
          >
            {capturedImages[i] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={capturedImages[i]}
                alt={v.label}
                className="w-full h-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-600">
                {i + 1}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
