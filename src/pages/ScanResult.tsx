import { motion } from 'framer-motion'
import {
  Brain,
  CheckCircle2,
  CloudOff,
  Crosshair,
  Eye,
  Info,
  MapPin,
  RefreshCw,
  Send,
  TriangleAlert,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen, TopBar } from '@/components/layout/AppShell'
import {
  AiReasoningPanel,
  DepthConfidencePanel,
  MeasurementGrid,
  PriorityBadge,
  RiskPanel,
  SeverityBadge,
} from '@/components/pothole/PotholeComponents'
import { Button, Chip, GlassCard, SectionTitle } from '@/components/ui/primitives'
import { useAuth } from '@/context/AuthContext'
import { useScanSession } from '@/context/ScanContext'
import { useToast } from '@/context/ToastContext'
import { compressImage } from '@/hooks/useCamera'
import { SEVERITY_META, STORAGE_BUCKETS } from '@/lib/constants'
import { AppError } from '@/lib/errors'
import { formatArea, formatCm, formatPercent, round } from '@/lib/utils'
import { getRepository } from '@/services'
import { queueReport } from '@/services/offline'

/**
 * AI scan result (spec sections 17, 42, 56).
 * Presents every number as an estimate with its provenance and confidence, and
 * reports the issue through the real backend when the user confirms.
 */
export default function ScanResult() {
  const navigate = useNavigate()
  const toast = useToast()
  const repo = getRepository()
  const { userId } = useAuth()
  const { draft, clearDraft, setFiledPotholeId, toCreateInput } = useScanSession()

  const [filing, setFiling] = useState(false)
  const [showEvidence, setShowEvidence] = useState(false)

  const assignment = useMemo(() => {
    if (!draft) return null
    const { analysis } = draft.analysis
    return {
      depth: analysis.depth,
      confidence: analysis.confidence,
      severity: draft.analysis.priority.severity,
      priority: draft.analysis.priority,
      width: analysis.width_cm,
      length: analysis.length_cm,
      area: analysis.area_cm2,
      method: analysis.measurement_method,
      evidence: analysis.visual_evidence,
      explanation: analysis.explanation,
      damageType: analysis.road_damage_type,
      recommendedAction: analysis.recommended_action,
      trafficRisk: analysis.traffic_risk,
      vehicleRisk: analysis.vehicle_risk,
      pedestrianRisk: analysis.pedestrian_risk,
      validated: draft.analysis.validation,
    }
  }, [draft])

  if (!draft || !assignment) {
    return (
      <>
        <TopBar title="Scan result" back />
        <Screen>
          <GlassCard className="space-y-3 text-center">
            <CloudOff className="mx-auto h-6 w-6 text-white/40" aria-hidden />
            <p className="text-[14px] font-semibold text-white">This scan has expired</p>
            <p className="text-[12px] text-white/50">
              Scan results are held in memory only. Run a new scan to analyse a road surface.
            </p>
            <Button onClick={() => navigate('/scan')} icon={<Crosshair className="h-4 w-4" />}>
              Open scanner
            </Button>
          </GlassCard>
        </Screen>
      </>
    )
  }

  const estimated = assignment.depth.source !== 'sensor_samples'

  /** Upload the capture when storage is available; otherwise keep it local. */
  const uploadOrNull = async (): Promise<string | null> => {
    if (!userId) return null
    try {
      const compressed = await compressImage(draft.imageDataUrl)
      return await repo.uploadImage({
        dataUrl: compressed,
        bucket: STORAGE_BUCKETS.potholeImages,
        kind: 'scan',
        userId,
      })
    } catch (error) {
      // Storage-policy failures must not block the report.
      if (error instanceof AppError && error.code === 'CONFIG_MISSING') return null
      console.warn('[scan-result] image upload failed:', error)
      toast.info(
        'Image kept on device',
        'The photo could not be uploaded, so the report will reference the on-device capture.',
      )
      return null
    }
  }

  const handleReport = async () => {
    setFiling(true)
    try {
      const imageUrl = await uploadOrNull()
      const payload = toCreateInput(imageUrl, draft.address)
      if (!payload) throw new AppError('UNKNOWN', { message: 'Missing scan draft' })

      // Offline: queue rather than fail (spec section 37).
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await queueOffline(payload)
        return
      }

      const pothole = await repo.createPothole(payload)
      setFiledPotholeId(pothole.id)
      toast.success('Report filed', `${pothole.incident_code} registered for repair.`)

      // Dispatch the nearest suitable officer. A failure here must not lose
      // the report — it is already safely stored.
      const result = await repo.assignOfficer(pothole.id)

      if (result.assigned && result.officer) {
        toast.success(
          'Officer dispatched',
          `${result.officer.full_name} · ${result.assignment?.distance_km?.toFixed(1) ?? '?'} km · ETA ${result.assignment?.estimated_arrival_minutes ?? '?'} min`,
        )
        navigate(`/reports/${pothole.id}`)
      } else {
        toast.info(
          'Added to maintenance queue',
          result.message ??
            'No available officer nearby. Your report has been registered and added to the maintenance queue.',
        )
        navigate(`/reports/${pothole.id}`)
      }
    } catch (caught) {
      const appError = AppError.from(caught, 'UNKNOWN')
      if (appError.code === 'NETWORK_FAILED') {
        const payload = toCreateInput(null, draft.address)
        if (payload) {
          await queueOffline(payload)
          return
        }
      }
      toast.error('Could not file the report', appError.userMessage)
    } finally {
      setFiling(false)
    }
  }

  const queueOffline = async (payload: ReturnType<typeof toCreateInput>) => {
    if (!payload) return
    await queueReport({
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      attempts: 0,
      lastError: null,
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracy: draft.accuracy,
      roadType: payload.roadType,
      nearSchool: payload.nearSchool ?? false,
      nearHospital: payload.nearHospital ?? false,
      nearIntersection: payload.nearIntersection ?? false,
      trafficRisk: payload.analysis.traffic_risk,
      notes: payload.notes ?? null,
      imageDataUrl: draft.imageDataUrl,
      analysis: payload.analysis,
      priority: payload.priority,
    })
    toast.offline(
      'Offline — report saved locally',
      'It will upload automatically when your connection returns.',
    )
    navigate('/reports')
  }

  const severityColor = SEVERITY_META[assignment.severity].hex

  return (
    <>
      <TopBar
        title="Pothole detected"
        subtitle={draft.address ?? 'Location captured'}
        back
        right={<SeverityBadge severity={assignment.severity} size="sm" />}
      />

      <Screen className="pt-3">
        {/* --------------------------------------------------------- preview */}
        <GlassCard padded={false} className="overflow-hidden">
          <div className="relative">
            <img
              src={draft.imageDataUrl}
              alt="Captured road surface with detected pothole"
              className="block max-h-[290px] w-full object-cover"
            />

            {/* Bounding box + measurement labels (spec section 42) */}
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="pointer-events-none absolute"
              style={{ left: '22%', top: '34%', width: '52%', height: '40%' }}
            >
              {[
                'top-0 left-0 border-t-2 border-l-2',
                'top-0 right-0 border-t-2 border-r-2',
                'bottom-0 left-0 border-b-2 border-l-2',
                'bottom-0 right-0 border-b-2 border-r-2',
              ].map((position) => (
                <span
                  key={position}
                  className="absolute h-5 w-5 rounded-[3px] border-aurora-400"
                  style={{ borderColor: severityColor }}
                  aria-hidden
                />
              ))}
              <span
                className="absolute inset-0 rounded-md"
                style={{ backgroundColor: `${severityColor}22` }}
                aria-hidden
              />
              <span
                className="absolute -top-6 left-0 rounded-lg px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink-950 uppercase"
                style={{ backgroundColor: severityColor }}
              >
                {assignment.damageType.replace(/_/g, ' ')} · {formatPercent(assignment.confidence)}
              </span>
              <span className="absolute top-1/2 -left-2 -translate-x-full -translate-y-1/2 rounded-md bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold text-white tabular-nums">
                {formatCm(assignment.width, 0)}
              </span>
              <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums" style={{ color: severityColor }}>
                ≈ {formatCm(assignment.depth.depth_value, 1)}
              </span>
            </motion.div>

            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-3.5 pt-8 pb-3">
              <span className="flex items-center gap-1.5 text-[10px] text-white/70">
                <MapPin className="h-3 w-3" aria-hidden />
                {draft.fix.latitude.toFixed(5)}, {draft.fix.longitude.toFixed(5)}
              </span>
              <span className="text-[10px] text-white/50">
                ±{Math.round(draft.accuracy ?? 0)} m
              </span>
            </div>
          </div>
        </GlassCard>

        {/* ------------------------------------------------------- headline */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-3"
        >
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-white/45 uppercase">
              Severity
            </p>
            <p className="text-[24px] leading-tight font-semibold tracking-tight" style={{ color: severityColor }}>
              {SEVERITY_META[assignment.severity].label}
            </p>
          </div>
          <PriorityBadge level={assignment.priority.priority_level} score={assignment.priority.priority_score} />
        </motion.div>

        {/* ----------------------------------------------------- measurements */}
        <div>
          <SectionTitle
            title="Measurements"
            action={<Chip tone={estimated ? 'warn' : 'success'}>{estimated ? 'Estimated' : 'Measured'}</Chip>}
          />
          <MeasurementGrid
            pothole={{
              width_cm: assignment.width,
              length_cm: assignment.length,
              depth_cm: assignment.depth.depth_value,
              area_cm2: assignment.area,
              ai_confidence: assignment.confidence,
              priority_score: assignment.priority.priority_score,
            }}
          />
        </div>

        {/* ---------------------------------------------------- depth provenance */}
        <DepthConfidencePanel
          depthCm={assignment.depth.depth_value}
          method={assignment.method}
          depthConfidence={assignment.depth.depth_confidence}
          measurementConfidence={draft.analysis.analysis.measurement_confidence}
          source={assignment.depth.source}
        />

        {estimated ? (
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-3.5 py-2.5">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
            <p className="text-[11px] leading-relaxed text-amber-100/85">
              Approximate depth: this figure came from visual estimation, not a depth sensor. A
              single photo cannot determine absolute scale, so treat it as an estimate and verify
              on site before ordering materials.
            </p>
          </div>
        ) : null}

        {/* ------------------------------------------------------------ risk */}
        <div>
          <SectionTitle title="Risk assessment" />
          <RiskPanel
            traffic={assignment.trafficRisk}
            vehicle={assignment.vehicleRisk}
            pedestrian={assignment.pedestrianRisk}
          />
        </div>

        {/* ----------------------------------------------------- AI reasoning */}
        <AiReasoningPanel
          priority={assignment.priority}
          evidence={assignment.evidence}
          explanation={assignment.explanation}
          damageType={assignment.damageType}
          recommendedAction={assignment.recommendedAction}
        />

        {/* -------------------------------------------------------- validation */}
        {assignment.validated.issues.length > 0 || assignment.validated.scale_reference_cm ? (
          <GlassCard className="space-y-2">
            <div className="flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-white/50" aria-hidden />
              <p className="text-[12px] font-semibold text-white/85">Validation notes</p>
            </div>
            <ul className="space-y-1 text-[11px] leading-relaxed text-white/55">
              {assignment.validated.scale_reference_cm ? (
                <li>
                  Scale calibrated against a{" "}
                  {formatCm(assignment.validated.scale_reference_cm, 0)} reference object.
                </li>
              ) : null}
              {assignment.validated.depth_from_sensor ? (
                <li>Depth derived from real depth samples supplied by the capture pipeline.</li>
              ) : null}
              {assignment.validated.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
              <li>
                Scoring weights sourced from{' '}
                {assignment.validated.engine_config_source === 'database'
                  ? 'the jurisdiction configuration in PostgreSQL'
                  : 'built-in defaults (database config unavailable)'}
                .
              </li>
            </ul>
          </GlassCard>
        ) : null}

        {/* ------------------------------------------------------------ area */}
        <div className="grid grid-cols-2 gap-2">
          <div className="glass rounded-2xl px-3 py-2.5">
            <p className="text-[10px] tracking-wider text-white/45 uppercase">Surface area</p>
            <p className="mt-0.5 text-[15px] font-semibold text-white tabular-nums">
              {formatArea(assignment.area)}
            </p>
          </div>
          <div className="glass rounded-2xl px-3 py-2.5">
            <p className="text-[10px] tracking-wider text-white/45 uppercase">Composite score</p>
            <p className="mt-0.5 text-[15px] font-semibold text-white tabular-nums">
              {round(assignment.priority.priority_score, 0)}/100
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowEvidence((value) => !value)}
          className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-aurora-300"
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
          {showEvidence ? 'Hide' : 'Show'} model provenance
        </button>

        {showEvidence ? (
          <GlassCard className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-[11px] text-white/70">
              <Brain className="h-3.5 w-3.5 text-aurora-400" aria-hidden />
              Model: {draft.analysis.model}
            </p>
            <p className="text-[11px] text-white/50">Prompt version: {draft.analysis.prompt_version}</p>
            <p className="text-[11px] text-white/50">
              Generated: {new Date(draft.analysis.generated_at).toLocaleString()}
            </p>
          </GlassCard>
        ) : null}

        {/* ---------------------------------------------------------- actions */}
        <div className="space-y-2 pt-1">
          <Button
            size="lg"
            fullWidth
            loading={filing}
            onClick={() => void handleReport()}
            icon={<Send className="h-5 w-5" />}
          >
            REPORT ISSUE
          </Button>
          <Button
            variant="secondary"
            fullWidth
            onClick={() => {
              clearDraft()
              navigate('/scan')
            }}
            icon={<RefreshCw className="h-4 w-4" />}
          >
            SCAN AGAIN
          </Button>
        </div>

        <p className="flex items-start gap-2 pb-2 text-[10px] leading-relaxed text-white/35">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          Reporting files this incident with GPS coordinates and dispatches the nearest available
          road officer for that zone. If nobody is available it enters the maintenance queue.
        </p>

        {/* GPS uncertainty is surfaced rather than hidden */}
        {draft.accuracy != null && draft.accuracy > 80 ? (
          <p className="pb-2 text-[10px] leading-relaxed text-white/35">
            GPS fix uncertainty ≈ {Math.round(draft.accuracy)} m — the location pin may be
            approximate. Move outdoors and rescan for a tighter fix.
          </p>
        ) : null}
      </Screen>
    </>
  )
}
