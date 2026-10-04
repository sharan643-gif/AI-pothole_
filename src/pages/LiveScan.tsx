import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Camera as CameraIcon,
  ChevronLeft,
  FileCheck2,
  MapPin,
  RefreshCw,
  ScanLine,
  Settings2,
  SwitchCamera,
  Zap,
  ZapOff,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AiPipelineIndicator,
  DetectionOverlay,
  LiveStatusPills,
} from '@/components/camera/LiveDetectionOverlay'
import { Canvas } from '@/components/layout/AppShell'
import { Button, GlassCard, Segmented, Sheet } from '@/components/ui/primitives'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useCamera } from '@/hooks/useCamera'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useLiveDetection, type LiveDetectionContext } from '@/hooks/useLiveDetection'
import { ROAD_TYPES, STORAGE_BUCKETS } from '@/lib/constants'
import { AppError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { getRepository } from '@/services'
import type { RiskLevel } from '@/types'

/**
 * Live Scan (spec sections 3, 6, 7).
 *
 * A real-time companion to the one-shot scan: the camera renders continuously
 * while frames are sampled to the AI a few times per second. Nothing here is a
 * mock — "File incident" performs a fresh analysis when needed, uploads the
 * frame and creates a real, tracked incident.
 */
export default function LiveScan() {
  const navigate = useNavigate()
  const toast = useToast()
  const repo = getRepository()
  const { userId } = useAuth()
  const { fix, error: geoError, isLowAccuracy, request: requestLocation } = useGeolocation()

  const camera = useCamera()
  const startedRef = useRef(false)
  const [filing, setFiling] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [context, setContext] = useState<LiveDetectionContext>({
    roadType: 'LOCAL',
    nearSchool: false,
    nearHospital: false,
    nearIntersection: false,
    trafficRisk: 'MEDIUM',
    referenceSizeCm: null,
  })

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void camera.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const capture = useCallback(
    () => camera.capture(0.62, 720),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const DEFAULT_FIX = useMemo(
    () => ({
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 100,
      timestamp: Date.now(),
    }),
    [],
  )

  const live = useLiveDetection({
    capture,
    fix: fix ?? DEFAULT_FIX,
    context,
    enabled: camera.ready,
  })

  const { detection, depth } = live

  /** File the incident: analyse if needed, upload the frame, create + dispatch. */
  const handleFile = useCallback(async () => {
    const activeFix = fix ?? repo.lastFix ?? DEFAULT_FIX
    if (!userId) {
      toast.error('Sign in required', 'Sign in to file an incident.')
      return
    }

    setFiling(true)
    try {
      // Freeze the loop, then obtain a positive analysis (reuse the current
      // detection when it already shows a pothole).
      live.stop()
      const result =
        detection?.analysis.pothole_detected === true ? detection : await live.analyzeOnce()

      if (!result || !result.analysis.pothole_detected) {
        toast.info(
          'No pothole confirmed',
          'Aim at the damaged surface and hold steady, then try again.',
        )
        return
      }

      const frame = camera.capture(0.85) ?? null

      let imageUrl: string | null = null
      if (frame) {
        try {
          imageUrl = await repo.uploadImage({
            dataUrl: frame.dataUrl,
            bucket: STORAGE_BUCKETS.potholeImages,
            kind: 'live',
            userId,
          })
        } catch {
          // Storage policy — the report is still filed with the image kept
          // on-device.
          imageUrl = null
        }
      }

      const address = await repo
        .resolveAddress({ latitude: activeFix.latitude, longitude: activeFix.longitude })
        .then((res) => res?.address ?? null)
        .catch(() => null)

      const pothole = await repo.createPothole({
        latitude: activeFix.latitude,
        longitude: activeFix.longitude,
        imageUrl,
        imageDataUrl: frame?.dataUrl ?? null,
        address,
        analysis: { ...result.analysis, severity: result.priority.severity },
        priority: result.priority,
        roadType: context.roadType,
        nearSchool: context.nearSchool,
        nearHospital: context.nearHospital,
        nearIntersection: context.nearIntersection,
        notes: 'Filed from Live Scan (real-time detection).',
      })

      await repo.assignOfficer(pothole.id).catch(() => undefined)

      toast.success(
        'Incident filed',
        `${pothole.incident_code} created and dispatched to the maintenance queue.`,
      )
      navigate(`/reports/${pothole.id}`)
    } catch (caught) {
      toast.error('Could not file incident', AppError.from(caught, 'AI_FAILED').userMessage)
    } finally {
      setFiling(false)
    }
  }, [camera, context, detection, fix, live, navigate, repo, toast, userId])

  const canFile = Boolean(fix) && (detection?.analysis.pothole_detected ?? false)

  return (
    <Canvas width="lg" panel>
      <div className="relative flex min-h-0 flex-1 flex-col bg-black">
        {/* -------------------------------------------------------- preview */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <video
            ref={camera.videoRef}
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
              camera.ready ? 'opacity-100' : 'opacity-0',
            )}
            playsInline
            muted
            aria-label="Live AI camera preview"
          />

          {!camera.ready ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-ink-900 to-ink-950 px-8 text-center">
              {camera.starting ? (
                <>
                  <ScanLine className="h-10 w-10 animate-pulse text-aurora-400" aria-hidden />
                  <p className="text-[13px] text-white/60">Starting live camera…</p>
                </>
              ) : camera.error ? (
                <>
                  <div className="glass-pill flex h-14 w-14 items-center justify-center rounded-full">
                    <CameraIcon className="h-6 w-6 text-white/60" aria-hidden />
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold text-white">Camera unavailable</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-white/55">
                      {camera.error.userMessage}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void camera.start()}>
                      Reconnect
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => navigate('/scan')}>
                      One-shot scan
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <DetectionOverlay detection={detection} depth={depth} />

          {/* top chrome */}
          <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 pt-3 pb-8">
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label="Close live scanner"
              className="glass-pill inline-flex h-9 w-9 items-center justify-center rounded-full text-white"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <div className="glass-pill flex items-center gap-2 rounded-full px-3.5 py-1.5">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  live.status === 'running' ? 'animate-pulse bg-aurora-400' : 'bg-white/40',
                )}
                aria-hidden
              />
              <span className="text-[11px] font-semibold tracking-[0.14em] text-white/90 uppercase">
                Live AI Camera
              </span>
            </div>
            <button
              type="button"
              onClick={() => void camera.toggleTorch()}
              disabled={!camera.torchSupported}
              aria-label={camera.torchOn ? 'Turn flash off' : 'Turn flash on'}
              className="glass-pill inline-flex h-9 w-9 items-center justify-center rounded-full text-white disabled:opacity-35"
            >
              {camera.torchOn ? <Zap className="h-4 w-4" aria-hidden /> : <ZapOff className="h-4 w-4" aria-hidden />}
            </button>
          </div>

          {/* status pills */}
          <div className="absolute inset-x-3 bottom-3 z-20 flex justify-center">
            <LiveStatusPills
              cameraActive={camera.ready}
              aiActive={live.analysing || live.framesAnalyzed > 0}
              aiUnavailable={live.aiUnavailable}
            />
          </div>

          {/* location warning */}
          {geoError ? (
            <div className="absolute inset-x-3 top-20 z-20">
              <GlassCard className="flex items-start gap-2 border-amber-400/30">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-white/90">Location required</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-white/55">
                    Live detection runs without GPS, but filing an incident needs a fix.
                  </p>
                  <Button size="sm" variant="secondary" className="mt-2" onClick={requestLocation}>
                    Enable location
                  </Button>
                </div>
              </GlassCard>
            </div>
          ) : isLowAccuracy ? (
            <div className="absolute inset-x-3 top-20 z-20">
              <p className="rounded-2xl border border-amber-400/25 bg-amber-500/12 px-3.5 py-2 text-[11px] text-amber-100/85">
                GPS accuracy {Math.round(fix?.accuracy ?? 0)} m — the filed pin will be approximate.
              </p>
            </div>
          ) : null}
        </div>

        {/* ------------------------------------------------------ bottom panel */}
        <div className="relative z-30 space-y-3 border-t border-white/10 bg-gradient-to-t from-black/90 to-black/50 px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-2xl">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <AiPipelineIndicator
                pipeline={live.pipeline}
                analysing={live.analysing}
                aiUnavailable={live.aiUnavailable}
                analysisFps={live.analysisFps}
              />
            </div>

            {detection?.analysis.pothole_detected ? (
              <motion.div
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                className="w-40 shrink-0"
              >
                <GlassCard className="space-y-1.5">
                  <p className="text-[10px] font-semibold tracking-wider text-white/45 uppercase">
                    Current detection
                  </p>
                  <p className="text-[13px] font-semibold text-white">
                    {detection.analysis.road_damage_type.replace(/_/g, ' ').toLowerCase()}
                  </p>
                  <p className="text-[11px] text-white/60 tabular-nums">
                    {detection.analysis.width_cm ?? '—'} × {detection.analysis.length_cm ?? '—'} cm
                  </p>
                  <p className="text-[11px] text-white/60">
                    {depth?.depthCm != null
                      ? `${depth.estimated ? '≈ ' : ''}${depth.depthCm} cm ${
                          depth.estimated ? 'estimated' : 'measured'
                        }`
                      : 'Depth unavailable'}
                  </p>
                  <p className="text-[11px] text-white/50">
                    AI confidence {Math.round(detection.analysis.confidence * 100)}%
                  </p>
                </GlassCard>
              </motion.div>
            ) : null}
          </div>

          {live.aiUnavailable ? (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/12 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
              <p className="text-[11px] leading-snug text-amber-100/90">
                <strong className="font-semibold">AI temporarily unavailable.</strong> The camera
                keeps running. Retrying automatically with backoff
                {live.backoffMs > 0 ? ` (~${Math.round(live.backoffMs / 1000)}s)` : ''}.
              </p>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Detection settings"
              className="glass-pill inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white"
            >
              <Settings2 className="h-5 w-5" aria-hidden />
            </button>

            <Button
              fullWidth
              size="lg"
              loading={filing}
              disabled={!canFile || filing}
              onClick={() => void handleFile()}
              icon={<FileCheck2 className="h-5 w-5" />}
            >
              {canFile ? 'File incident' : 'Scanning for potholes…'}
            </Button>

            <button
              type="button"
              onClick={() => void camera.switchCamera()}
              aria-label="Switch camera"
              className="glass-pill inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white"
            >
              <SwitchCamera className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <p className="flex items-center justify-center gap-1.5 text-[10px] font-medium tracking-wider text-white/40 uppercase">
            <RefreshCw className="h-3 w-3" aria-hidden />
            {live.analysing
              ? 'Analysing frame…'
              : `Sampling ~${(1000 / 700).toFixed(1)} frames/sec · last ${live.lastLatencyMs ?? '—'} ms`}
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------------- settings */}
      <DetectionSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        context={context}
        onChange={setContext}
      />
    </Canvas>
  )
}

function DetectionSettingsSheet({
  open,
  onClose,
  context,
  onChange,
}: {
  open: boolean
  onClose: () => void
  context: LiveDetectionContext
  onChange: (next: LiveDetectionContext) => void
}) {
  const riskOptions = useMemo(
    () => [
      { value: 'LOW' as RiskLevel, label: 'Low' },
      { value: 'MEDIUM' as RiskLevel, label: 'Medium' },
      { value: 'HIGH' as RiskLevel, label: 'High' },
    ],
    [],
  )

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Detection settings"
      footer={
        <Button fullWidth onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
            Road classification
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {ROAD_TYPES.map((roadType) => (
              <button
                key={roadType}
                type="button"
                onClick={() => onChange({ ...context, roadType })}
                className={cn(
                  'rounded-xl border px-2 py-2 text-[10px] font-semibold tracking-wide uppercase',
                  context.roadType === roadType
                    ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
                    : 'border-white/12 text-white/50',
                )}
              >
                {roadType}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
            Traffic exposure
          </p>
          <Segmented
            ariaLabel="Traffic risk"
            value={context.trafficRisk}
            onChange={(value) => onChange({ ...context, trafficRisk: value })}
            options={riskOptions}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['nearSchool', 'Near school'],
              ['nearHospital', 'Near hospital'],
              ['nearIntersection', 'Intersection'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={context[key]}
              onClick={() => onChange({ ...context, [key]: !context[key] } as LiveDetectionContext)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[10px] font-semibold transition',
                context[key]
                  ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
                  : 'border-white/12 text-white/50',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
            Scale reference (optional)
          </p>
          <div className="flex gap-2">
            {[null, 21, 30, 60].map((size) => (
              <button
                key={String(size)}
                type="button"
                onClick={() => onChange({ ...context, referenceSizeCm: size })}
                className={cn(
                  'flex-1 rounded-xl border px-2 py-2 text-[11px] font-semibold',
                  context.referenceSizeCm === size
                    ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
                    : 'border-white/12 text-white/55',
                )}
              >
                {size === null ? 'None' : `${size} cm`}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-white/45">
            With a known-size reference in frame, width and length are calibrated. Depth still
            depends on a real depth sensor and is otherwise reported as an estimate.
          </p>
        </div>
      </div>
    </Sheet>
  )
}
