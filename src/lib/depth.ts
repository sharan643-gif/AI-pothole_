import { clamp, round } from '@/lib/utils'
import type { MeasurementMethod } from '@/types'

/**
 * Depth estimation pipeline (spec section 5).
 *
 * The hard truth this module exists to encode: a single ordinary RGB frame has
 * no absolute scale, so physical depth cannot be *measured* from it. Rather
 * than paper over that, every depth value carries the provider that produced
 * it and whether it is a real measurement or a visual estimate.
 *
 *   CAMERA → DETECTION → DepthProvider → (optional) Gemini validation
 *
 * Providers are ranked by trustworthiness and auto-selected:
 *
 *   LiDAR / AR depth  →  Stereo / model depth  →  Scale reference  →  Monocular
 *
 * Nothing here pretends to more precision than its source warrants.
 */

export type DepthProviderKind = 'LIDAR' | 'STEREO' | 'REFERENCE' | 'MONOCULAR'

export interface DepthInput {
  /** Per-pixel depth samples (cm) from an AR/depth-capable pipeline, if any. */
  depthSamplesCm?: number[] | null
  /** How those samples were produced, if supplied (e.g. AR_DEPTH_SENSOR). */
  depthMethodHint?: string | null
  /** Known size (cm) of a calibration object visible in the frame. */
  referenceSizeCm?: number | null
  /** Depth the vision model proposed (cm) — the monocular estimate. */
  visualDepthCm?: number | null
  /** Confidence the vision model attached to its own estimate (0..1). */
  visualDepthConfidence?: number | null
}

export interface DepthEstimate {
  depthCm: number | null
  method: MeasurementMethod
  confidence: number
  /** True when the value is inferred rather than measured by a sensor. */
  estimated: boolean
  provider: DepthProviderKind
  label: string
  explanation: string
}

export interface DepthProvider {
  kind: DepthProviderKind
  label: string
  isAvailable(input?: DepthInput): boolean
  estimate(input: DepthInput): DepthEstimate
}

/* ------------------------------------------------------------------ *
 * Sample statistics
 * ------------------------------------------------------------------ */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Interquartile range relative to the median — robust to outliers. */
function relativeSpread(values: number[], med: number): number {
  if (med <= 0) return 1
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.25)]
  const q3 = sorted[Math.floor(sorted.length * 0.75)]
  return Math.abs(q3 - q1) / med
}

function cleanSamples(samples: number[] | null | undefined): number[] {
  return (samples ?? []).filter((v) => Number.isFinite(v) && v >= 0)
}

function hintMatches(hint: string | null | undefined, allowed: string[]): boolean {
  const normalised = (hint ?? '').toUpperCase()
  return allowed.some((token) => normalised.includes(token))
}

/** Minimum number of samples before a sensor estimate is trustworthy. */
export const MIN_SENSOR_SAMPLES = 3

/* ------------------------------------------------------------------ *
 * Providers
 * ------------------------------------------------------------------ */

/** ARKit / ARCore / LiDAR depth — the highest reliability available. */
export const lidarDepthProvider: DepthProvider = {
  kind: 'LIDAR',
  label: 'LiDAR / AR depth sensor',
  isAvailable(input) {
    const samples = cleanSamples(input?.depthSamplesCm)
    return (
      samples.length >= MIN_SENSOR_SAMPLES &&
      hintMatches(input?.depthMethodHint, ['AR_DEPTH_SENSOR', 'LIDAR', 'ARCORE', 'ARKIT'])
    )
  },
  estimate(input) {
    const samples = cleanSamples(input.depthSamplesCm)
    const med = median(samples)
    const spread = relativeSpread(samples, med)
    return {
      depthCm: round(med, 1),
      method: 'AR_DEPTH_SENSOR',
      confidence: clamp(0.92 - spread * 1.1, 0.35, 0.95),
      estimated: false,
      provider: 'LIDAR',
      label: 'Measured depth',
      explanation: `Derived from ${samples.length} device depth samples (LiDAR/AR).`,
    }
  },
}

/** Stereo rigs and model-based depth (e.g. an on-device monocular depth net). */
export const stereoDepthProvider: DepthProvider = {
  kind: 'STEREO',
  label: 'Stereo / model depth',
  isAvailable(input) {
    const samples = cleanSamples(input?.depthSamplesCm)
    return (
      samples.length >= MIN_SENSOR_SAMPLES &&
      hintMatches(input?.depthMethodHint, ['STEREO', 'MONOCULAR_DEPTH_ESTIMATION', 'CV_GEOMETRY', 'DEPTH_MODEL'])
    )
  },
  estimate(input) {
    const samples = cleanSamples(input.depthSamplesCm)
    const med = median(samples)
    const spread = relativeSpread(samples, med)
    return {
      depthCm: round(med, 1),
      method: 'CV_GEOMETRY',
      confidence: clamp(0.82 - spread * 1.2, 0.3, 0.88),
      estimated: false,
      provider: 'STEREO',
      label: 'Computed depth',
      explanation: `Derived from ${samples.length} stereo/geometry depth samples.`,
    }
  },
}

/** A known-size object in frame calibrates scale, but not depth directly. */
export const referenceDepthProvider: DepthProvider = {
  kind: 'REFERENCE',
  label: 'Scale reference',
  isAvailable(input) {
    return Number(input?.referenceSizeCm ?? 0) > 0
  },
  estimate(input) {
    return {
      depthCm: input.visualDepthCm ?? null,
      method: 'REFERENCE_OBJECT',
      confidence: clamp(input.visualDepthConfidence ?? 0.5, 0.35, 0.7),
      estimated: true,
      provider: 'REFERENCE',
      label: 'Calibrated estimate',
      explanation:
        'A known-size reference in frame calibrates surface scale, so width/length are calibrated — depth remains a visual estimate.',
    }
  },
}

/** Ordinary webcam fallback: honest visual estimation only. */
export const monocularDepthProvider: DepthProvider = {
  kind: 'MONOCULAR',
  label: 'Monocular estimate',
  isAvailable() {
    return true
  },
  estimate(input) {
    const depth = input.visualDepthCm ?? null
    return {
      depthCm: depth == null ? null : round(depth, 1),
      method: 'VISION_ESTIMATE',
      confidence: depth == null ? 0 : clamp(input.visualDepthConfidence ?? 0.4, 0, 0.55),
      estimated: true,
      provider: 'MONOCULAR',
      label: 'Approximate depth',
      explanation:
        depth == null
          ? 'No depth signal was available for this frame.'
          : 'Inferred from visual cues in a single RGB frame. No depth sensor was available, so treat this as approximate.',
    }
  },
}

/** Ranked most→least trustworthy. */
export const DEPTH_PROVIDERS: DepthProvider[] = [
  lidarDepthProvider,
  stereoDepthProvider,
  referenceDepthProvider,
  monocularDepthProvider,
]

/** Pick the best provider the current capture can actually support. */
export function selectDepthProvider(input: DepthInput = {}): DepthProvider {
  return DEPTH_PROVIDERS.find((provider) => provider.isAvailable(input)) ?? monocularDepthProvider
}

/** Run the best available provider in one call. */
export function resolveDepth(input: DepthInput = {}): DepthEstimate {
  return selectDepthProvider(input).estimate(input)
}

/**
 * Which depth hardware the *browser* can offer, independent of a given frame.
 * Web APIs cannot reach LiDAR/ARCore depth directly, so unless a native shell
 * feeds samples in, this is honest that only monocular estimation is possible.
 */
export function runtimeDepthCapability(): { kind: DepthProviderKind; label: string } {
  if (typeof navigator !== 'undefined') {
    const nav = navigator as Navigator & { xr?: { isSessionSupported?: (mode: string) => Promise<boolean> } }
    if (nav.xr?.isSessionSupported) {
      return { kind: 'LIDAR', label: 'WebXR/AR depth may be available' }
    }
  }
  return { kind: 'MONOCULAR', label: 'Monocular estimation (no depth sensor detected)' }
}
