/**
 * MouthDetector — real face + mouth-openness detection using MediaPipe
 * Face Landmarker. Runs on device in WebAssembly.
 *
 * The model + WASM files are loaded lazily from Google's CDN the first time
 * the detector is constructed.
 */

import type { FaceLandmarker } from "@mediapipe/tasks-vision";

export type MouthDetection = {
  faceDetected: boolean;
  /** 0..1 — fraction of frame area occupied by the face bounding box */
  faceSizeRatio: number;
  /** distance between inner-lip landmarks, normalised by face height */
  mouthOpenRatio: number;
  /** true when mouthOpenRatio crosses the open threshold */
  mouthOpen: boolean;
  /** horizontal deviation of face centre from frame centre (0 = centred) */
  horizontalOffset: number;
  /** vertical deviation of face centre from frame centre */
  verticalOffset: number;
};

const OPEN_THRESHOLD = 0.035; // inner-lip gap / face height
const MIN_FACE_SIZE = 0.12; // face bbox must occupy at least this fraction of frame height
const MAX_FACE_SIZE = 0.9;

export class MouthDetector {
  private landmarker: FaceLandmarker | null = null;
  private loadingPromise: Promise<void> | null = null;
  public ready = false;
  public loadError: string | null = null;

  async load() {
    if (this.ready || this.loadingPromise) return this.loadingPromise ?? undefined;
    this.loadingPromise = (async () => {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const { FilesetResolver, FaceLandmarker } = vision;
        const fileset = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });
        this.ready = true;
      } catch (e: any) {
        console.warn("MouthDetector failed to load", e);
        this.loadError = e?.message ?? String(e);
        this.ready = false;
      }
    })();
    return this.loadingPromise;
  }

  detect(video: HTMLVideoElement, nowMs: number): MouthDetection | null {
    if (!this.ready || !this.landmarker) return null;
    if (!video.videoWidth || !video.videoHeight) return null;

    let result;
    try {
      result = this.landmarker.detectForVideo(video, nowMs);
    } catch (e) {
      return null;
    }

    const faces = result?.faceLandmarks ?? [];
    if (faces.length === 0) {
      return {
        faceDetected: false,
        faceSizeRatio: 0,
        mouthOpenRatio: 0,
        mouthOpen: false,
        horizontalOffset: 0,
        verticalOffset: 0,
      };
    }

    const lm = faces[0];

    // Face bounding box (normalised coords 0..1)
    let minX = 1,
      minY = 1,
      maxX = 0,
      maxY = 0;
    for (const p of lm) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const faceWidth = Math.max(0.0001, maxX - minX);
    const faceHeight = Math.max(0.0001, maxY - minY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // Mouth: inner lips are ~13 (upper) and 14 (lower) in the canonical mesh.
    const upper = lm[13];
    const lower = lm[14];
    const lipGap = Math.abs(lower.y - upper.y);
    const mouthOpenRatio = lipGap / faceHeight;

    const mouthOpen = mouthOpenRatio > OPEN_THRESHOLD;
    const faceSizeRatio = faceHeight;

    return {
      faceDetected: true,
      faceSizeRatio,
      mouthOpenRatio,
      mouthOpen,
      horizontalOffset: cx - 0.5,
      verticalOffset: cy - 0.5,
    };
  }

  dispose() {
    this.landmarker?.close?.();
    this.landmarker = null;
    this.ready = false;
  }
}

export function interpretDetection(det: MouthDetection | null): {
  reason: "searching" | "adjust" | "stable";
  message: string;
  ok: boolean;
} {
  if (!det) {
    return {
      reason: "searching",
      message: "Warming up detector…",
      ok: false,
    };
  }
  if (!det.faceDetected) {
    return {
      reason: "searching",
      message: "No face detected — center yourself in the oval",
      ok: false,
    };
  }
  if (det.faceSizeRatio < MIN_FACE_SIZE) {
    return {
      reason: "adjust",
      message: "Move closer to the camera",
      ok: false,
    };
  }
  if (det.faceSizeRatio > MAX_FACE_SIZE) {
    return {
      reason: "adjust",
      message: "Move a little further back",
      ok: false,
    };
  }
  if (Math.abs(det.horizontalOffset) > 0.18 || Math.abs(det.verticalOffset) > 0.18) {
    return {
      reason: "adjust",
      message: "Center your face in the oval",
      ok: false,
    };
  }
  if (!det.mouthOpen) {
    return {
      reason: "searching",
      message: "Open your mouth so your teeth are visible",
      ok: false,
    };
  }
  return {
    reason: "stable",
    message: "Great — hold steady",
    ok: true,
  };
}
