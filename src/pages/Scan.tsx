import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  CloudOff,
  Crosshair,
  GraduationCap,
  Ruler,
  ScanLine,
  Settings2,
  ShieldAlert,
  TrafficCone,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CameraView, type ScanStage } from '@/components/camera/CameraView'
import { Canvas } from '@/components/layout/AppShell'
import { Button, GlassCard, Segmented, Sheet } from '@/components/ui/primitives'
import { useAuth } from '@/context/AuthContext'
import { useScanSession, type ScanContextInput } from '@/context/ScanContext'
import { useToast } from '@/context/ToastContext'
import { useGeolocation } from '@/hooks/useGeolocation'
import { fileToDataUrl, compressImage, type CaptureResult } from '@/hooks/useCamera'
import { ROAD_TYPES } from '@/lib/constants'
import { AppError } from '@/lib/errors'
import { assessPriority, DEFAULT_SEVERITY_WEIGHTS } from '@/lib/severity'
import { cn, formatCm } from '@/lib/utils'
import { getRepository } from '@/services'
import { queueReport } from '@/services/offline'
import type { RiskLevel } from '@/types'

/**
 * Scan flow (spec sections 12, 13, 36, 37, 50).
 *
 * Capture → analyse → result. When the device is offline we do NOT pretend an
 * analysis happened: the citizen is offered an explicit offline queue instead,
 * and the report is marked as unanalysed so the backend never trusts it.
 */

type Phase = 'setup' | 'camera' | 'analyzing' | 'error'

const ANALYSIS_STAGES: { label: string; delay: number }[] = [
  { label: 'Scanning road surface', delay: 0 },
  { label: 'Detecting pothole boundaries', delay: 420 },
  { label: 'Analysing road-plane geometry', delay: 900 },
  { label: 'Estimating depth', delay: 1450 },
  { label: 'Calculating severity & priority', delay: 1900 },
]

export default function Scan() {
  const navigate = useNavigate()
  const toast = useToast()
  const repo = getRepository()
  const { userId } = useAuth()
  const { setDraft } = useScanSession()
  const { fix, error: geoError, isLowAccuracy, request: requestLocation } = useGeolocation()

  const [phase, setPhase] = useState<Phase>('setup')
  const [capture, setCapture] = useState<CaptureResult | null>(null)
  const [stageIndex, setStageIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<AppError | null>(null)
  const [contextSheetOpen, setContextSheetOpen] = useState(false)
  const [savingOffline, setSavingOffline] = useState(false)

  const [context, setContext] = useState<ScanContextInput>({
    roadType: 'LOCAL',
    nearSchool: false,
    nearHospital: false,
    nearIntersection: false,
    trafficRisk: 'MEDIUM',
    referenceSizeCm: null,
  })

  const galleryInputRef = useRef<HTMLInputElement | null>(null)

  const stages: ScanStage[] = useMemo(
    () => ANALYSIS_STAGES.map((stage, index) => ({ label: stage.label, done: index < stageIndex })),
    [stageIndex],
  )

  // Drive the staged scan readout independently of network latency so the
  // animation reads as deliberate progress rather than a stalled spinner.
  useEffect(() => {
    if (phase !== 'analyzing') return
    setStageIndex(0)
    setProgress(6)

    const timers = ANALYSIS_STAGES.map((stage, index) =>
      window.setTimeout(() => setStageIndex(index), stage.delay),
    )
    const progressTimer = window.setInterval(() => {
      setProgress((current) => (current >= 94 ? 94 : current + Math.max(1, (95 - current) * 0.08)))
    }, 140)

    return () => {
      timers.forEach(window.clearTimeout)
      window.clearInterval(progressTimer)
    }
  }, [phase])

  const DEFAULT_FALLBACK_FIX = useMemo(
    () => ({
      latitude: 12.9716,
      longitude: 77.5946,
      accuracy: 100,
      timestamp: Date.now(),
    }),
    [],
  )

  const runAnalysis = useCallback(
    async (result: CaptureResult, address: string | null, fixOverride?: typeof fix) => {
      const activeFix = fixOverride ?? fix ?? repo.lastFix ?? DEFAULT_FALLBACK_FIX

      setPhase('analyzing')
      try {
        const analysis = await repo.analyze({
          imageDataUrl: result.dataUrl,
          fix: { latitude: activeFix.latitude, longitude: activeFix.longitude },
          roadType: context.roadType,
          nearSchool: context.nearSchool,
          nearHospital: context.nearHospital,
          nearIntersection: context.nearIntersection,
          trafficRisk: context.trafficRisk,
          referenceSizeCm: context.referenceSizeCm,
        })

        if (!analysis.analysis.pothole_detected) {
          setError(new AppError('NO_POTHOLE_DETECTED'))
          setPhase('error')
          return
        }

        if (analysis.analysis.confidence < 0.55) {
          toast.info(
            'Low detection confidence',
            'Treat these measurements as approximate, or rescan in better light.',
          )
        }

        setProgress(100)
        setStageIndex(ANALYSIS_STAGES.length)
        setDraft({
          imageDataUrl: result.dataUrl,
          fix: activeFix,
          accuracy: activeFix.accuracy,
          address,
          context,
          analysis,
          createdAt: Date.now(),
        })
        window.setTimeout(() => navigate('/scan/result', { replace: true }), 220)
      } catch (caught) {
        setError(AppError.from(caught, 'AI_FAILED'))
        setPhase('error')
      }
    },
    [context, fix, navigate, repo, setDraft, toast],
  )

  const handleCapture = useCallback(
    async (result: CaptureResult) => {
      setCapture(result)

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError(
          new AppError('NETWORK_FAILED', {
            userMessage:
              'You are offline, so AI analysis cannot run. You can still file the report now — it will be queued on this device and analysed when you reconnect.',
          }),
        )
        setPhase('error')
        return
      }

      // Best-effort reverse geocoding; coordinates are always authoritative.
      let address: string | null = null
      const activeFix = fix ?? repo.lastFix ?? DEFAULT_FALLBACK_FIX
      if (activeFix) {
        const resolved = await repo.resolveAddress({
          latitude: activeFix.latitude,
          longitude: activeFix.longitude,
        }).catch(() => null)
        address = resolved?.address ?? null
      }

      await runAnalysis(result, address, activeFix)
    },
    [DEFAULT_FALLBACK_FIX, fix, repo, runAnalysis],
  )

  const handleGallery = useCallback(async () => {
    galleryInputRef.current?.click()
  }, [])

  const handleGalleryFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      try {
        const raw = await fileToDataUrl(file)
        const compressed = await compressImage(raw)
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const element = new Image()
          element.onload = () => resolve(element)
          element.onerror = () => reject(new Error('decode failed'))
          element.src = compressed
        })
        await handleCapture({
          dataUrl: compressed,
          width: image.width,
          height: image.height,
        })
      } catch (caught) {
        toast.error('Could not read that image', AppError.from(caught, 'UPLOAD_FAILED').userMessage)
      }
    },
    [handleCapture, toast],
  )

  /** Offline path: queue an explicitly un-analysed report (spec section 37). */
  const handleSaveOffline = useCallback(async () => {
    if (!capture) return
    const activeFix = fix ?? repo.lastFix ?? DEFAULT_FALLBACK_FIX
    if (!userId) {
      toast.error('Sign in required', 'Sign in before filing an offline report.')
      return
    }

    setSavingOffline(true)
    try {
      const priority = assessPriority(
        {
          depthCm: null,
          areaCm2: null,
          trafficRisk: context.trafficRisk,
          roadType: context.roadType,
          nearSchool: context.nearSchool,
          nearHospital: context.nearHospital,
          nearIntersection: context.nearIntersection,
          aiConfidence: 0,
          depthConfidence: 0,
          reportCount: 1,
        },
        DEFAULT_SEVERITY_WEIGHTS,
      )

      await queueReport({
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        attempts: 0,
        lastError: null,
        latitude: activeFix.latitude,
        longitude: activeFix.longitude,
        accuracy: activeFix.accuracy,
        roadType: context.roadType,
        nearSchool: context.nearSchool,
        nearHospital: context.nearHospital,
        nearIntersection: context.nearIntersection,
        trafficRisk: context.trafficRisk,
        notes: 'Filed offline without AI analysis — measurements unavailable.',
        imageDataUrl: capture.dataUrl,
        analysis: {
          pothole_detected: true,
          confidence: 0,
          bounding_box: null,
          width_cm: null,
          length_cm: null,
          depth_cm: null,
          measurement_confidence: 0,
          measurement_method: 'UNKNOWN',
          severity: priority.severity,
          traffic_risk: context.trafficRisk,
          vehicle_risk: 'MEDIUM',
          pedestrian_risk: 'LOW',
          road_damage_type: 'UNKNOWN',
          recommended_action: priority.priority_level === 'CRITICAL' ? 'URGENT_REPAIR' : 'SCHEDULE_REPAIR',
          visual_evidence: [],
          explanation:
            'Captured offline. No AI analysis has been performed on this report yet.',
        },
        priority,
      })

      toast.offline(
        'Report saved locally',
        'It will upload and be analysed automatically when your connection returns.',
      )
      navigate('/reports')
    } catch (caught) {
      toast.error('Could not save offline', AppError.from(caught).userMessage)
    } finally {
      setSavingOffline(false)
    }
  }, [capture, context, fix, navigate, toast, userId])

  // ---------------------------------------------------------------- rendering

  if (phase === 'camera' || phase === 'analyzing') {
    return (
      <Canvas width="md" panel>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <CameraView
            onBack={() => setPhase('setup')}
            onCapture={(result) => void handleCapture(result)}
            onPickGallery={() => void handleGallery()}
            scanning={phase === 'analyzing'}
            stages={stages}
            progress={progress}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => void handleGalleryFiles(event.target.files)}
            aria-label="Choose a photo from your device"
          />
        </div>
      </Canvas>
    )
  }

  if (phase === 'setup') {
    return (
    <Canvas width="sm">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-6 pb-8 lg:pt-10">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 240, damping: 26 }}
          className="space-y-4"
        >
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-aurora-400 transition hover:bg-white/8"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden />
          </button>

          <header>
            <p className="text-[11px] font-semibold tracking-[0.2em] text-aurora-300 uppercase">
              AI Road Analysis
            </p>
            <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-tight text-white">
              Scan the road
            </h1>
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/50">
              Point the rear camera at the damaged surface. RoadGuard detects potholes, estimates
              geometry and scores the repair priority in one pass.
            </p>
          </header>

          {geoError ? (
            <GlassCard className="flex items-start gap-3 border-amber-400/30">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-white/90">Location needed</p>
                <p className="mt-0.5 text-[11px] leading-snug text-white/55">{geoError.userMessage}</p>
                <Button size="sm" variant="secondary" className="mt-2" onClick={requestLocation}>
                  Retry location
                </Button>
              </div>
            </GlassCard>
          ) : isLowAccuracy ? (
            <p className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-3.5 py-2 text-[11px] text-amber-100/85">
              GPS accuracy is {Math.round(fix?.accuracy ?? 0)} m. Move outdoors for a tighter fix —
              reports still work, but the pin may be approximate.
            </p>
          ) : null}

          {/* -------------------------------------------------------- context */}
          <GlassCard className="space-y-3.5">
            <div className="flex items-center gap-2">
              <TrafficCone className="h-4 w-4 text-aurora-400" aria-hidden />
              <h2 className="text-[13px] font-semibold tracking-tight text-white">Road context</h2>
              <button
                type="button"
                onClick={() => setContextSheetOpen(true)}
                className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-aurora-300"
              >
                <Settings2 className="h-3 w-3" aria-hidden />
                Adjust
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {ROAD_TYPES.map((roadType) => (
                <button
                  key={roadType}
                  type="button"
                  onClick={() => setContext((current) => ({ ...current, roadType }))}
                  aria-pressed={context.roadType === roadType}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase transition',
                    context.roadType === roadType
                      ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
                      : 'border-white/12 text-white/50 hover:text-white',
                  )}
                >
                  {roadType}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5">
              <HazardToggle
                active={context.nearSchool}
                onChange={(value) => setContext((c) => ({ ...c, nearSchool: value }))}
                icon={<GraduationCap className="h-3 w-3" aria-hidden />}
                label="Near school"
              />
              <HazardToggle
                active={context.nearHospital}
                onChange={(value) => setContext((c) => ({ ...c, nearHospital: value }))}
                icon={<Building2 className="h-3 w-3" aria-hidden />}
                label="Near hospital"
              />
              <HazardToggle
                active={context.nearIntersection}
                onChange={(value) => setContext((c) => ({ ...c, nearIntersection: value }))}
                icon={<Crosshair className="h-3 w-3" aria-hidden />}
                label="Intersection"
              />
            </div>

            {context.referenceSizeCm ? (
              <p className="flex items-center gap-1.5 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200">
                <Ruler className="h-3 w-3" aria-hidden />
                Calibration active: {formatCm(context.referenceSizeCm, 0)} reference object
              </p>
            ) : null}
          </GlassCard>

          <Button
            size="lg"
            fullWidth
            onClick={() => setPhase('camera')}
            icon={<ScanLine className="h-5 w-5" />}
          >
            {fix ? 'Open camera' : 'Open camera (approx. location)'}
          </Button>

          <GlassCard className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-white/45" aria-hidden />
            <p className="text-[11px] leading-relaxed text-white/50">
              Depth is reported as an <strong className="text-white/70">estimate</strong> with a
              confidence score unless real depth data or a scale reference is available. RoadGuard
              never presents a guess as a measurement.
            </p>
          </GlassCard>
        </motion.div>
      </div>

      {/* ------------------------------------------------------- context sheet */}
      <Sheet
        open={contextSheetOpen}
        onClose={() => setContextSheetOpen(false)}
        title="Scan context"
        footer={
          <Button fullWidth onClick={() => setContextSheetOpen(false)}>
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
                  onClick={() => setContext((current) => ({ ...current, roadType }))}
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
              onChange={(value: RiskLevel) => setContext((c) => ({ ...c, trafficRisk: value }))}
              options={[
                { value: 'LOW', label: 'Low' },
                { value: 'MEDIUM', label: 'Medium' },
                { value: 'HIGH', label: 'High' },
              ]}
            />
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
              Scale reference (optional)
            </p>
            <p className="mb-2 text-[11px] leading-relaxed text-white/45">
              If you can place an object of known size beside the pothole, enter its size. The
              measurement is then scaled from a real reference instead of guessed — this is the
              difference between an estimate and a calibrated measurement.
            </p>
            <div className="flex gap-2">
              {[null, 21, 30, 60].map((size) => (
                <button
                  key={String(size)}
                  type="button"
                  onClick={() => setContext((c) => ({ ...c, referenceSizeCm: size }))}
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
          </div>
        </div>
      </Sheet>
    </Canvas>
    )
  }

  // -------------------------------------------------------------- error state
  const errorTitle =
    error?.code === 'NETWORK_FAILED'
      ? 'Offline'
      : error?.code === 'NO_POTHOLE_DETECTED'
        ? 'No pothole detected'
        : error?.code === 'GEOLOCATION_UNAVAILABLE'
          ? 'Location unavailable'
          : error?.code === 'CONFIG_MISSING'
            ? 'Backend not connected'
            : error?.code === 'AI_FAILED'
              ? 'AI service unavailable'
              : 'Analysis incomplete'

  return (
    <Canvas width="sm">
      <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-5 pb-10 lg:px-7">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 240, damping: 26 }}
          className="space-y-4"
        >
          <div className="flex flex-col items-center gap-3 text-center">
            <span
              className={cn(
                'flex h-16 w-16 items-center justify-center rounded-full',
                error?.code === 'NETWORK_FAILED'
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-red-500/15 text-red-300',
              )}
            >
              {error?.code === 'NETWORK_FAILED' ? (
                <CloudOff className="h-7 w-7" aria-hidden />
              ) : (
                <AlertTriangle className="h-7 w-7" aria-hidden />
              )}
            </span>
            <div>
              <h1 className="text-[20px] font-semibold tracking-tight text-white">{errorTitle}</h1>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">
                {error?.userMessage ?? 'The scan could not be completed.'}
              </p>
            </div>
          </div>

          {/* Only show the deploy hint when the backend is genuinely missing. */}
          {error?.code === 'CONFIG_MISSING' ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/12 px-3.5 py-3">
              <p className="text-[12px] font-semibold text-amber-100">
                The AI backend is not reachable
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-100/80">
                RoadGuard analyses images through a Supabase Edge Function that holds the Gemini
                key. Deploy it once and this screen will work:
              </p>
              <pre className="mt-2 overflow-x-auto rounded-xl bg-black/40 p-2.5 text-[10.5px] leading-snug text-amber-50">
                SUPABASE_ACCESS_TOKEN=sbp_... npm run deploy:backend
              </pre>
              <p className="mt-2 text-[10.5px] leading-relaxed text-amber-100/70">
                Then confirm with <code>npm run verify:live</code>. Your capture is still on this
                device and nothing was uploaded.
              </p>
            </div>
          ) : error?.code === 'AI_FAILED' || error?.code === 'AI_INVALID_RESPONSE' ? (
            <div className="rounded-2xl border border-white/15 bg-white/5 px-3.5 py-3">
              <p className="text-[12px] font-semibold text-white/80">
                Tap &ldquo;Scan again&rdquo; to retry
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/55">
                The AI service is reachable but returned an error for this image. Make sure you
                are signed in, then point the camera at the road and try again. Your capture is
                safe — nothing was uploaded.
              </p>
            </div>
          ) : null}

          {capture?.dataUrl ? (
            <img
              src={capture.dataUrl}
              alt="Captured road frame awaiting analysis"
              className="mx-auto max-h-56 rounded-2xl border border-white/10 object-cover"
            />
          ) : null}

          <div className="space-y-2">
            {error?.code === 'NETWORK_FAILED' && capture ? (
              <Button
                fullWidth
                loading={savingOffline}
                onClick={() => void handleSaveOffline()}
                icon={<CloudOff className="h-4 w-4" />}
              >
                Save report for later
              </Button>
            ) : null}
            <Button
              fullWidth
              variant="secondary"
              onClick={() => {
                setError(null)
                setCapture(null)
                setPhase('camera')
              }}
              icon={<ScanLine className="h-4 w-4" />}
            >
              Scan again
            </Button>
            <Button fullWidth variant="ghost" onClick={() => navigate('/')}>
              Back to home
            </Button>
          </div>
        </motion.div>
      </div>
    </Canvas>
  )
}

function HazardToggle({
  active,
  onChange,
  icon,
  label,
}: {
  active: boolean
  onChange: (value: boolean) => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!active)}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition',
        active
          ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
          : 'border-white/12 text-white/50 hover:text-white',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
