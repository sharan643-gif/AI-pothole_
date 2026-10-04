import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveDepth, runtimeDepthCapability, type DepthEstimate } from '@/lib/depth'
import { AppError } from '@/lib/errors'
import { getRepository } from '@/services'
import type { AnalyzeResponse } from '@/services/types'
import type { GeoFix, RiskLevel } from '@/types'
import type { RoadType } from '@/lib/constants'

/**
 * Real-time AI detection loop (spec sections 3, 6, 17, 18).
 *
 * The camera keeps rendering at full frame rate; this hook samples still
 * frames at a deliberately low cadence and analyses them one at a time. It
 * never overlaps requests, never blocks the video element, backs off
 * exponentially when the AI is unavailable, and ignores stale responses so a
 * stopped session can never mutate state.
 */

export interface LiveDetectionContext {
  roadType: RoadType
  nearSchool: boolean
  nearHospital: boolean
  nearIntersection: boolean
  trafficRisk: RiskLevel
  referenceSizeCm: number | null
}

export interface LiveDetection {
  id: string
  analysis: AnalyzeResponse['analysis']
  priority: AnalyzeResponse['priority']
  detectedAt: number
  latencyMs: number
}

export type LiveStatus = 'idle' | 'running'

export type PipelineState = 'pending' | 'active' | 'done'

export interface PipelineStep {
  key: string
  label: string
  state: PipelineState
}

export interface LiveDetectionOptions {
  /** Produce a still frame from the live video, or null when not ready. */
  capture: () => { dataUrl: string; width: number; height: number } | null
  fix: GeoFix | null
  context: LiveDetectionContext
  enabled: boolean
  /** Analysis cadence in ms (default ~1.4 fps). */
  intervalMs?: number
  /** Depth samples from a sensor-capable pipeline, when one is available. */
  depthSamplesCm?: number[] | null
  depthMethodHint?: string | null
}

const BASE_INTERVAL = 3500
const BASE_BACKOFF = 2000
const MAX_BACKOFF = 15_000
/** Consecutive failures before the AI is declared temporarily unavailable. */
const UNAVAILABLE_AFTER = 3

const DEFAULT_FIX: GeoFix = {
  latitude: 12.9716,
  longitude: 77.5946,
  accuracy: 100,
  timestamp: Date.now(),
}

export interface LiveDetectionState {
  status: LiveStatus
  detection: LiveDetection | null
  error: AppError | null
  aiUnavailable: boolean
  backoffMs: number
  framesAnalyzed: number
  analysisFps: number
  lastLatencyMs: number | null
  depth: DepthEstimate | null
  capability: { kind: string; label: string }
  pipeline: PipelineStep[]
  /** True while a frame is in flight — drives the "AI processing" indicator. */
  analysing: boolean
  start: () => void
  stop: () => void
  /** Run exactly one analysis now and resolve with the result (used to file). */
  analyzeOnce: () => Promise<LiveDetection | null>
}

export function useLiveDetection(options: LiveDetectionOptions): LiveDetectionState {
  const { enabled, intervalMs = BASE_INTERVAL, depthSamplesCm = null, depthMethodHint = null } = options

  const [status, setStatus] = useState<LiveStatus>('idle')
  const [detection, setDetection] = useState<LiveDetection | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [aiUnavailable, setAiUnavailable] = useState(false)
  const [backoffMs, setBackoffMs] = useState(0)
  const [framesAnalyzed, setFramesAnalyzed] = useState(0)
  const [analysisFps, setAnalysisFps] = useState(0)
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null)
  const [analysing, setAnalysing] = useState(false)

  // Refs so the scheduler never captures stale state.
  const timerRef = useRef<number | null>(null)
  const tickRef = useRef<() => void>(() => undefined)
  const runningRef = useRef(false)
  const inFlightRef = useRef(false)
  const failuresRef = useRef(0)
  const runIdRef = useRef(0)
  const framesRef = useRef(0)
  const lastAnalysisAtRef = useRef(0)
  const backoffRef = useRef(0)
  const optionsRef = useRef(options)

  // Keep the latest options without writing a ref during render.
  useEffect(() => {
    optionsRef.current = options
  })

  const repo = useMemo(() => getRepository(), [])
  const capability = useMemo(() => runtimeDepthCapability(), [])

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const schedule = useCallback(
    (delay: number) => {
      clearTimer()
      timerRef.current = window.setTimeout(() => tickRef.current(), delay)
    },
    [clearTimer],
  )

  /** One analysis pass. Returns the detection on success, or null. */
  const runOnce = useCallback(async (): Promise<LiveDetection | null> => {
    const current = optionsRef.current
    const activeFix = current.fix ?? DEFAULT_FIX

    const frame = current.capture()
    if (!frame) return null

    const runId = runIdRef.current
    inFlightRef.current = true
    setAnalysing(true)
    const startedAt = performance.now()

    try {
      const response = await repo.analyze({
        imageDataUrl: frame.dataUrl,
        fix: { latitude: activeFix.latitude, longitude: activeFix.longitude },
        roadType: current.context.roadType,
        nearSchool: current.context.nearSchool,
        nearHospital: current.context.nearHospital,
        nearIntersection: current.context.nearIntersection,
        trafficRisk: current.context.trafficRisk,
        referenceSizeCm: current.context.referenceSizeCm,
        depthSamplesCm: current.depthSamplesCm ?? null,
        depthMethodHint: current.depthMethodHint ?? null,
      })

      // Session was stopped/restarted while we were waiting — discard.
      if (runId !== runIdRef.current) return null

      const next: LiveDetection = {
        id: crypto.randomUUID(),
        analysis: response.analysis,
        priority: response.priority,
        detectedAt: Date.now(),
        latencyMs: Math.round(performance.now() - startedAt),
      }

      setDetection(next)
      setError(null)
      setAiUnavailable(false)
      failuresRef.current = 0
      backoffRef.current = 0
      setBackoffMs(0)
      framesRef.current += 1
      setFramesAnalyzed(framesRef.current)
      setLastLatencyMs(next.latencyMs)

      // Exponential moving average keeps the displayed rate readable.
      const now = Date.now()
      const previous = lastAnalysisAtRef.current
      lastAnalysisAtRef.current = now
      if (previous > 0) {
        const instantaneous = 1000 / Math.max(now - previous, 1)
        setAnalysisFps((current) => (current === 0 ? instantaneous : current * 0.6 + instantaneous * 0.4))
      }
      return next
    } catch (caught) {
      if (runId !== runIdRef.current) return null
      const appError = AppError.from(caught, 'AI_FAILED')
      failuresRef.current += 1
      setError(appError)
      if (failuresRef.current >= UNAVAILABLE_AFTER) setAiUnavailable(true)
      const next = Math.min(BASE_BACKOFF * 2 ** (failuresRef.current - 1), MAX_BACKOFF)
      backoffRef.current = next
      setBackoffMs(next)
      return null
    } finally {
      inFlightRef.current = false
      if (runId === runIdRef.current) setAnalysing(false)
    }
  }, [repo])

  const tick = useCallback(async () => {
    if (!runningRef.current) return

    // If a frame is already in flight, wait and retry.
    if (inFlightRef.current) {
      schedule(1000)
      return
    }

    await runOnce()
    if (!runningRef.current) return
    schedule(failuresRef.current > 0 ? backoffRef.current : intervalMs)
  }, [runOnce, schedule, intervalMs])

  // Wire the scheduler to the latest tick without a circular dependency.
  useEffect(() => {
    tickRef.current = () => void tick()
  }, [tick])

  const start = useCallback(() => {
    if (runningRef.current) return
    runningRef.current = true
    runIdRef.current += 1
    failuresRef.current = 0
    framesRef.current = 0
    lastAnalysisAtRef.current = 0
    backoffRef.current = 0
    setFramesAnalyzed(0)
    setAnalysisFps(0)
    setStatus('running')
    setError(null)
    setAiUnavailable(false)
    setBackoffMs(0)
    schedule(200)
  }, [schedule])

  const stop = useCallback(() => {
    runningRef.current = false
    runIdRef.current += 1
    clearTimer()
    setStatus('idle')
    setAnalysing(false)
  }, [clearTimer])

  const analyzeOnce = useCallback(async () => runOnce(), [runOnce])

  // Auto start/stop with `enabled`.
  useEffect(() => {
    if (enabled) start()
    else stop()
    return () => stop()
  }, [enabled, start, stop])

  // Depth labelling is derived from the latest analysis + whatever sensor
  // samples were available, so the UI can distinguish measured from estimated.
  const depth = useMemo<DepthEstimate | null>(() => {
    if (!detection) return null
    return resolveDepth({
      depthSamplesCm,
      depthMethodHint,
      referenceSizeCm: options.context.referenceSizeCm,
      visualDepthCm: detection.analysis.depth_cm,
      visualDepthConfidence: detection.analysis.measurement_confidence,
    })
  }, [detection, depthSamplesCm, depthMethodHint, options.context.referenceSizeCm])

  const pipeline = useMemo<PipelineStep[]>(() => {
    const detected = detection?.analysis.pothole_detected === true
    return [
      { key: 'camera', label: 'Camera active', state: status === 'running' ? 'done' : 'pending' },
      {
        key: 'frame',
        label: 'Frame captured',
        state: analysing ? 'active' : framesAnalyzed > 0 ? 'done' : 'pending',
      },
      {
        key: 'ai',
        label: 'AI processing',
        state: analysing ? 'active' : aiUnavailable ? 'pending' : framesAnalyzed > 0 ? 'done' : 'pending',
      },
      { key: 'pothole', label: 'Pothole detected', state: detected ? 'done' : 'pending' },
      { key: 'depth', label: 'Depth estimated', state: depth ? 'done' : 'pending' },
    ]
  }, [status, analysing, framesAnalyzed, aiUnavailable, detection, depth])

  return {
    status,
    detection,
    error,
    aiUnavailable,
    backoffMs,
    framesAnalyzed,
    analysisFps,
    lastLatencyMs,
    depth,
    capability,
    pipeline,
    analysing,
    start,
    stop,
    analyzeOnce,
  }
}
