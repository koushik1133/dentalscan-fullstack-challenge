/**
 * Lightweight on-device frame quality checks.
 *
 * We sample a small downscaled region of the video feed inside the oval guide
 * and compute three signals:
 *
 *  - brightness  : mean luminance (0-255)  — rejects black/blown-out frames
 *  - variance    : luminance variance       — rejects flat/blank frames
 *                                              (a closed mouth + lip looks far
 *                                              less textured than visible teeth)
 *  - motion      : mean absolute diff vs
 *                  previous frame           — rejects shaky captures
 *
 * These are heuristics, not ML. They won't detect "teeth" specifically, but
 * they block the most obvious bad frames: too dark, too bright, motion blur,
 * or the lens pointed at a blank wall.
 */

export type QualityMetrics = {
  brightness: number;
  variance: number;
  motion: number;
  ok: boolean;
  reason: "searching" | "adjust" | "stable";
  message: string;
};

export type QualityThresholds = {
  minBrightness: number;
  maxBrightness: number;
  minVariance: number;
  maxMotion: number;
};

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  minBrightness: 55,
  maxBrightness: 225,
  minVariance: 320, // luminance variance — "textured" frame
  maxMotion: 10, // mean abs diff between frames
};

export class FrameQualityAnalyzer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private prev: Uint8ClampedArray | null = null;
  public readonly size: number;

  constructor(size = 64) {
    this.size = size;
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
  }

  /**
   * Sample the centre of the video into a downscaled square and compute the
   * quality metrics. Returns null if the video isn't ready yet.
   */
  analyze(
    video: HTMLVideoElement,
    thresholds: QualityThresholds = DEFAULT_THRESHOLDS
  ): QualityMetrics | null {
    if (!this.ctx) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    // Sample the central oval region (matches the mouth guide mask).
    const sampleW = vw * 0.5;
    const sampleH = vh * 0.4;
    const sx = (vw - sampleW) / 2;
    const sy = (vh - sampleH) / 2;

    this.ctx.drawImage(
      video,
      sx,
      sy,
      sampleW,
      sampleH,
      0,
      0,
      this.size,
      this.size
    );

    const { data } = this.ctx.getImageData(0, 0, this.size, this.size);
    const len = data.length / 4;

    // Compute luminance per pixel, mean, and variance.
    let sum = 0;
    const lum = new Uint8ClampedArray(len);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // Rec. 601 luma
      const y = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      lum[p] = y;
      sum += y;
    }
    const mean = sum / len;

    let varSum = 0;
    let motionSum = 0;
    for (let p = 0; p < len; p++) {
      const d = lum[p] - mean;
      varSum += d * d;
      if (this.prev) motionSum += Math.abs(lum[p] - this.prev[p]);
    }
    const variance = varSum / len;
    const motion = this.prev ? motionSum / len : Number.POSITIVE_INFINITY;

    this.prev = lum;

    // Decide state
    const tooDark = mean < thresholds.minBrightness;
    const tooBright = mean > thresholds.maxBrightness;
    const tooFlat = variance < thresholds.minVariance;
    const tooShaky = motion > thresholds.maxMotion;

    let reason: QualityMetrics["reason"];
    let message: string;
    let ok = false;

    if (tooDark) {
      reason = "searching";
      message = "Too dark — move to better lighting";
    } else if (tooBright) {
      reason = "searching";
      message = "Too bright — reduce glare";
    } else if (tooFlat) {
      reason = "searching";
      message = "Position your mouth inside the oval and open wide";
    } else if (tooShaky) {
      reason = "adjust";
      message = "Hold steady";
    } else {
      reason = "stable";
      message = "Perfect — ready to capture";
      ok = true;
    }

    return { brightness: mean, variance, motion, ok, reason, message };
  }

  reset() {
    this.prev = null;
  }
}
