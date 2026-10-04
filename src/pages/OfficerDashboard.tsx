import { motion } from 'framer-motion'
import {
  Camera,
  CheckCircle2,
  Clock,
  Image as ImageIcon,
  Navigation,
  RefreshCw,
  Route,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen, TopBar } from '@/components/layout/AppShell'
import { MapView } from '@/components/map/MapView'
import {
  MeasurementGrid,
  PriorityBadge,
  SeverityBadge,
  StatusBadge,
  VerificationCard,
} from '@/components/pothole/PotholeComponents'
import { Button, Chip, EmptyState, GlassCard, SectionTitle, Sheet, Skeleton } from '@/components/ui/primitives'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useOfficerAssignments, useOfficers } from '@/hooks/useData'
import { useGeolocation } from '@/hooks/useGeolocation'
import { compressImage, fileToDataUrl } from '@/hooks/useCamera'
import { MEASUREMENT_METHOD_META, OFFICER_STATUS_META, STORAGE_BUCKETS } from '@/lib/constants'
import { AppError } from '@/lib/errors'
import { cn, formatCm, formatDistanceKm, formatDuration, haversineKm, timeAgo } from '@/lib/utils'
import { getRepository } from '@/services'
import type { OfficerStatus } from '@/types'
import type { VerifyRepairResponse } from '@/services/types'

/**
 * Officer dashboard (spec sections 25, 26, 27).
 * Accept → travel → arrive → repair → AI-assisted verification.
 */
export default function OfficerDashboard() {
  const navigate = useNavigate()
  const toast = useToast()
  const repo = getRepository()
  const { profile } = useAuth()
  const { fix } = useGeolocation({ auto: true })

  const officers = useOfficers()
  const officer = useMemo(
    () => (officers.data ?? []).find((row) => row.profile_id === profile?.id) ?? officers.data?.[0] ?? null,
    [officers.data, profile?.id],
  )

  const assignments = useOfficerAssignments(officer?.id ?? null)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [repairTarget, setRepairTarget] = useState<string | null>(null)
  const [afterImage, setAfterImage] = useState<string | null>(null)
  const [beforeImage, setBeforeImage] = useState<string | null>(null)
  const [repairNotes, setRepairNotes] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verification, setVerification] = useState<VerifyRepairResponse | null>(null)
  const [routeTarget, setRouteTarget] = useState<string | null>(null)

  const afterInputRef = useRef<HTMLInputElement | null>(null)
  const beforeInputRef = useRef<HTMLInputElement | null>(null)

  const active = useMemo(
    () => (assignments.data ?? []).filter((row) => row.status !== 'COMPLETED' && row.status !== 'CANCELLED'),
    [assignments.data],
  )
  const completed = useMemo(
    () => (assignments.data ?? []).filter((row) => row.status === 'COMPLETED'),
    [assignments.data],
  )

  const targetAssignment = useMemo(
    () => (assignments.data ?? []).find((row) => row.id === repairTarget) ?? null,
    [assignments.data, repairTarget],
  )

  const routeAssignment = useMemo(
    () => (assignments.data ?? []).find((row) => row.id === routeTarget) ?? null,
    [assignments.data, routeTarget],
  )

  const advance = useCallback(
    async (assignmentId: string, status: 'ACCEPTED' | 'EN_ROUTE' | 'ON_SITE') => {
      setBusyId(assignmentId)
      try {
        await repo.updateAssignment(assignmentId, status)
        await assignments.refresh()
        toast.success(
          status === 'ACCEPTED'
            ? 'Job accepted'
            : status === 'EN_ROUTE'
              ? 'Marked en route'
              : 'Marked on site',
          'The citizen sees this status change immediately.',
        )
      } catch (error) {
        toast.error('Could not update', AppError.from(error).userMessage)
      } finally {
        setBusyId(null)
      }
    },
    [assignments, repo, toast],
  )

  const handleStatusChange = useCallback(
    async (status: OfficerStatus) => {
      if (!officer) return
      try {
        await repo.updateOfficerStatus(officer.id, status)
        await officers.refresh()
        toast.info(
          'Availability updated',
          status === 'AVAILABLE'
            ? 'You will receive new dispatches.'
            : 'You will not receive new dispatches while off duty.',
        )
      } catch (error) {
        toast.error('Could not update availability', AppError.from(error).userMessage)
      }
    },
    [officer, officers, repo, toast],
  )

  const pickImage = useCallback(async (file: File | null, setter: (value: string) => void) => {
    if (!file) return
    try {
      const raw = await fileToDataUrl(file)
      setter(await compressImage(raw, 1400, 0.85))
    } catch (error) {
      toast.error('Could not read that image', AppError.from(error, 'UPLOAD_FAILED').userMessage)
    }
  }, [toast])

  const uploadRepairImage = useCallback(
    async (dataUrl: string, kind: string): Promise<string> => {
      if (!profile?.id) return dataUrl
      try {
        return await repo.uploadImage({
          dataUrl,
          bucket: STORAGE_BUCKETS.repairImages,
          kind,
          userId: profile.id,
        })
      } catch (error) {
        // A failed upload keeps the image local; the workflow still completes.
        if (error instanceof AppError && error.code === 'CONFIG_MISSING') return dataUrl
        toast.info('Image kept on device', AppError.from(error, 'UPLOAD_FAILED').userMessage)
        return dataUrl
      }
    },
    [profile?.id, repo, toast],
  )

  const submitRepair = useCallback(async () => {
    if (!targetAssignment?.pothole || !afterImage) {
      toast.error('After photo required', 'Upload a photo of the repaired surface.')
      return
    }

    setVerifying(true)
    try {
      await repo.updateAssignment(targetAssignment.id, 'ON_SITE').catch(() => undefined)

      const beforeUrl =
        beforeImage ??
        (await uploadRepairImage(
          targetAssignment.pothole.image_url ?? afterImage,
          'before',
        ))

      const [afterUrl, resolvedBeforeUrl] = await Promise.all([
        uploadRepairImage(afterImage, 'after'),
        Promise.resolve(beforeUrl),
      ])

      const result = await repo.verifyRepair({
        potholeId: targetAssignment.pothole.id,
        beforeImageUrl: resolvedBeforeUrl,
        afterImageUrl: afterUrl,
        repairNotes: repairNotes || undefined,
        repairType: 'PATCH',
      })

      setVerification(result)
      toast.success(
        result.approved ? 'Repair verified' : 'Submitted for review',
        result.approved
          ? 'AI verification is an assistive signal only.'
          : 'A reviewer will confirm this repair.',
      )
      await Promise.all([assignments.refresh(), officers.refresh()])
    } catch (error) {
      toast.error('Verification failed', AppError.from(error, 'AI_FAILED').userMessage)
    } finally {
      setVerifying(false)
    }
  }, [
    afterImage,
    assignments,
    beforeImage,
    officers,
    repairNotes,
    repo,
    targetAssignment,
    toast,
    uploadRepairImage,
  ])

  const closeRepairSheet = useCallback(() => {
    setRepairTarget(null)
    setAfterImage(null)
    setBeforeImage(null)
    setRepairNotes('')
    setVerification(null)
  }, [])

  return (
    <>
      <TopBar
        title="Officer dashboard"
        subtitle={officer?.profile?.full_name ?? profile?.full_name ?? 'Field officer'}
        right={
          officer ? (
            <span
              className={cn(
                'flex items-center gap-1.5 rounded-full border border-white/12 px-2.5 py-1 text-[10px] font-semibold',
                OFFICER_STATUS_META[officer.status].color,
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', OFFICER_STATUS_META[officer.status].dot)} aria-hidden />
              {OFFICER_STATUS_META[officer.status].label}
            </span>
          ) : null
        }
      />

      <Screen className="pt-3">
        {/* -------------------------------------------------------- availability */}
        <GlassCard className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-aurora-400" aria-hidden />
            <h2 className="text-[13px] font-semibold text-white">Availability</h2>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {(['AVAILABLE', 'ON_SITE', 'BUSY', 'OFFLINE'] as OfficerStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => void handleStatusChange(status)}
                aria-pressed={officer?.status === status}
                className={cn(
                  'rounded-xl border px-2 py-2 text-[10px] font-semibold tracking-wide uppercase transition',
                  officer?.status === status
                    ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
                    : 'border-white/12 text-white/50 hover:text-white',
                )}
              >
                {OFFICER_STATUS_META[status].label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Active" value={String(active.length)} />
            <MiniStat label="Completed" value={String(completed.length)} />
            <MiniStat
              label="Nearest"
              value={
                active[0]?.distance_km != null ? formatDistanceKm(active[0].distance_km) : '—'
              }
            />
          </div>
        </GlassCard>

        {/* -------------------------------------------------------------- queue */}
        <div>
          <SectionTitle
            title="Assigned issues"
            action={
              <button
                type="button"
                onClick={() => void assignments.refresh()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-aurora-300"
              >
                <RefreshCw className={cn('h-3 w-3', assignments.refreshing && 'animate-spin')} aria-hidden />
                Refresh
              </button>
            }
          />

          {assignments.loading ? (
            <div className="space-y-2.5">
              {[0, 1].map((index) => (
                <Skeleton key={index} className="h-[168px]" />
              ))}
            </div>
          ) : active.length === 0 ? (
            <GlassCard>
              <EmptyState
                icon={<Wrench className="h-5 w-5" />}
                title="No active assignments"
                description="Dispatch assigns the nearest available officer for each new critical report. Set your availability to AVAILABLE to receive work."
              />
            </GlassCard>
          ) : (
            <div className="space-y-2.5">
              {active.map((assignment, index) => {
                const pothole = assignment.pothole
                if (!pothole) return null
                const distance =
                  fix && pothole
                    ? haversineKm(
                        { latitude: fix.latitude, longitude: fix.longitude },
                        { latitude: pothole.latitude, longitude: pothole.longitude },
                      )
                    : assignment.distance_km

                return (
                  <motion.div
                    key={assignment.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                  >
                    <GlassCard className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-[13px] font-semibold text-white">
                            {pothole.incident_code}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <SeverityBadge severity={pothole.severity} size="sm" />
                            <StatusBadge status={pothole.status} />
                          </div>
                        </div>
                        <PriorityBadge level={pothole.priority_level} score={pothole.priority_score} />
                      </div>

                      <MeasurementGrid pothole={pothole} compact />

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/55">
                        <span className="flex items-center gap-1">
                          <Route className="h-3 w-3" aria-hidden />
                          {formatDistanceKm(distance)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" aria-hidden />
                          ETA {formatDuration(assignment.estimated_arrival_minutes)}
                        </span>
                        <span>{timeAgo(assignment.assigned_at)}</span>
                      </div>

                      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-white/50">
                        <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-300/80" aria-hidden />
                        {MEASUREMENT_METHOD_META[pothole.depth_method]?.label}:{' '}
                        {pothole.depth_method === 'VISION_ESTIMATE'
                          ? 'verify depth on site before ordering material.'
                          : `reported depth ${formatCm(pothole.depth_cm)}.`}
                      </p>

                      <div className="flex flex-wrap gap-2">
                        {assignment.status === 'PENDING' ? (
                          <Button
                            size="sm"
                            loading={busyId === assignment.id}
                            onClick={() => void advance(assignment.id, 'ACCEPTED')}
                            icon={<CheckCircle2 className="h-4 w-4" />}
                          >
                            ACCEPT
                          </Button>
                        ) : null}

                        {assignment.status === 'ACCEPTED' ? (
                          <Button
                            size="sm"
                            loading={busyId === assignment.id}
                            onClick={() => void advance(assignment.id, 'EN_ROUTE')}
                            icon={<Navigation className="h-4 w-4" />}
                          >
                            Start travel
                          </Button>
                        ) : null}

                        {assignment.status === 'EN_ROUTE' ? (
                          <Button
                            size="sm"
                            loading={busyId === assignment.id}
                            onClick={() => void advance(assignment.id, 'ON_SITE')}
                            icon={<CheckCircle2 className="h-4 w-4" />}
                          >
                            Arrived on site
                          </Button>
                        ) : null}

                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setRouteTarget(assignment.id)}
                          icon={<Route className="h-4 w-4" />}
                        >
                          Navigate
                        </Button>

                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setRepairTarget(assignment.id)
                            setBeforeImage(pothole.image_url ?? null)
                          }}
                          icon={<Wrench className="h-4 w-4" />}
                        >
                          File repair
                        </Button>

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/reports/${pothole.id}`)}
                        >
                          Details
                        </Button>
                      </div>
                    </GlassCard>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>

        {completed.length > 0 ? (
          <div>
            <SectionTitle title="Recently completed" />
            <div className="space-y-2">
              {completed.slice(0, 5).map((assignment) => (
                <button
                  key={assignment.id}
                  type="button"
                  onClick={() =>
                    assignment.pothole && navigate(`/reports/${assignment.pothole.id}`)
                  }
                  className="glass flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-[12px] text-white/80">
                      {assignment.pothole?.incident_code ?? assignment.pothole_id.slice(0, 8)}
                    </span>
                    <span className="block text-[10px] text-white/40">
                      Completed {timeAgo(assignment.completed_at)}
                    </span>
                  </span>
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <GlassCard className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-white/40" aria-hidden />
          <p className="text-[11px] leading-relaxed text-white/50">
            AI repair verification flags whether the surface appears restored. It is an assistive
            signal, not an engineering sign-off — escalate anything ambiguous for manual review.
          </p>
        </GlassCard>
      </Screen>

      {/* ------------------------------------------------------ navigation sheet */}
      <Sheet open={Boolean(routeAssignment)} onClose={() => setRouteTarget(null)} title="Navigate to pothole">
        {routeAssignment?.pothole ? (
          <div className="space-y-3 pb-2">
            <MapView
              className="h-64"
              potholes={[routeAssignment.pothole]}
              userFix={fix}
              center={[routeAssignment.pothole.longitude, routeAssignment.pothole.latitude]}
              zoom={14}
              route={
                fix
                  ? [
                      [fix.longitude, fix.latitude],
                      [routeAssignment.pothole.longitude, routeAssignment.pothole.latitude],
                    ]
                  : undefined
              }
              heatCells={[]}
            />
            <p className="text-[11px] leading-relaxed text-white/50">
              The dashed line is a direct bearing, not a turn-by-turn route. Configure a Mapbox
              token to enable true directions.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat
                label="Distance"
                value={formatDistanceKm(
                  fix
                    ? haversineKm(
                        { latitude: fix.latitude, longitude: fix.longitude },
                        {
                          latitude: routeAssignment.pothole.latitude,
                          longitude: routeAssignment.pothole.longitude,
                        },
                      )
                    : routeAssignment.distance_km,
                )}
              />
              <MiniStat
                label="ETA"
                value={formatDuration(routeAssignment.estimated_arrival_minutes)}
              />
            </div>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${routeAssignment.pothole.latitude},${routeAssignment.pothole.longitude}`}
              target="_blank"
              rel="noreferrer noopener"
              className="block"
            >
              <Button fullWidth icon={<Navigation className="h-4 w-4" />}>
                Open turn-by-turn directions
              </Button>
            </a>
          </div>
        ) : null}
      </Sheet>

      {/* ---------------------------------------------------------- repair sheet */}
      <Sheet
        open={Boolean(repairTarget)}
        onClose={closeRepairSheet}
        title={verification ? 'Verification result' : 'File repair'}
        footer={
          verification ? (
            <Button fullWidth onClick={closeRepairSheet}>
              Done
            </Button>
          ) : (
            <Button
              fullWidth
              loading={verifying}
              disabled={!afterImage}
              onClick={() => void submitRepair()}
              icon={<ShieldCheck className="h-4 w-4" />}
            >
              Verify repair
            </Button>
          )
        }
      >
        <div className="space-y-4 pb-2">
          {verification ? (
            <VerificationCard verification={verification.verification} advisory={verification.advisory} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <ImagePicker
                  label="Before"
                  image={beforeImage}
                  onPick={() => beforeInputRef.current?.click()}
                />
                <ImagePicker
                  label="After (required)"
                  image={afterImage}
                  onPick={() => afterInputRef.current?.click()}
                  highlight
                />
              </div>

              <input
                ref={beforeInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                aria-label="Upload before repair photo"
                onChange={(event) => void pickImage(event.target.files?.[0] ?? null, setBeforeImage)}
              />
              <input
                ref={afterInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                aria-label="Upload after repair photo"
                onChange={(event) => void pickImage(event.target.files?.[0] ?? null, setAfterImage)}
              />

              <div>
                <label htmlFor="repair-notes" className="mb-1.5 block text-[11px] text-white/55">
                  Repair notes
                </label>
                <textarea
                  id="repair-notes"
                  value={repairNotes}
                  onChange={(event) => setRepairNotes(event.target.value)}
                  rows={3}
                  placeholder="Material used, depth achieved, any caveats…"
                  className="w-full resize-none rounded-2xl border border-white/12 bg-white/6 px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 focus:border-aurora-400/60 focus:outline-none"
                />
              </div>

              {targetAssignment?.pothole ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <p className="mb-2 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
                    Reported severity
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={targetAssignment.pothole.severity} size="sm" />
                    <Chip>{formatCm(targetAssignment.pothole.depth_cm)}</Chip>
                    <Chip>{targetAssignment.pothole.incident_code}</Chip>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Sheet>
    </>
  )
}

function ImagePicker({
  label,
  image,
  onPick,
  highlight = false,
}: {
  label: string
  image: string | null
  onPick: () => void
  highlight?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'relative flex h-32 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl border text-[11px] font-medium transition',
        highlight && !image
          ? 'border-aurora-400/50 bg-aurora-400/10 text-aurora-200'
          : 'border-white/12 bg-white/5 text-white/55',
      )}
    >
      {image ? (
        <>
          <img src={image} alt={`${label} repair`} className="absolute inset-0 h-full w-full object-cover" />
          <span className="relative rounded-md bg-black/65 px-2 py-0.5">{label}</span>
        </>
      ) : (
        <>
          <Camera className="h-5 w-5" aria-hidden />
          {label}
          <span className="flex items-center gap-1 text-[10px] text-white/35">
            <ImageIcon className="h-3 w-3" aria-hidden />
            Tap to capture
          </span>
        </>
      )}
    </button>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-2.5 py-2 text-center">
      <p className="text-[9px] tracking-wider text-white/45 uppercase">{label}</p>
      <p className="mt-0.5 text-[12px] font-semibold text-white tabular-nums">{value}</p>
    </div>
  )
}
