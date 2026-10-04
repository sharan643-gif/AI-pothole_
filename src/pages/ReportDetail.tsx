import {
  Building2,
  Clock,
  GraduationCap,
  Info,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Screen, TopBar } from '@/components/layout/AppShell'
import { MapView } from '@/components/map/MapView'
import {
  AiReasoningPanel,
  DepthConfidencePanel,
  EtaPill,
  MeasurementGrid,
  PriorityBadge,
  RiskPanel,
  SeverityBadge,
  StatusBadge,
  StatusTimeline,
} from '@/components/pothole/PotholeComponents'
import { Button, Chip, DetailRow, GlassCard, SectionTitle, Skeleton } from '@/components/ui/primitives'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { usePothole } from '@/hooks/useData'
import { useAsync } from '@/hooks/useAsync'
import { useSignedImage } from '@/hooks/useSignedImage'
import {
  ASSIGNMENT_STATUS_META,
  MEASUREMENT_METHOD_META,
  STORAGE_BUCKETS,
  type RoadType,
} from '@/lib/constants'
import { assessPriority } from '@/lib/severity'
import {
  formatDateTime,
  formatDistanceKm,
  formatDuration,
  timeAgo,
} from '@/lib/utils'
import { getRepository } from '@/services'

/**
 * Issue detail (spec section 18): the single source of truth for one incident —
 * capture, measurements, provenance, risk, location, dispatch and workflow.
 */
export default function ReportDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const repo = getRepository()
  const { profile, role, userId } = useAuth()

  const pothole = usePothole(id)
  const [assigning, setAssigning] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const assignments = useAsync(
    () => (id ? repo.listAssignments({ potholeId: id }) : Promise.resolve([])),
    [id],
    { enabled: Boolean(id) },
  )

  const beforeImage = useSignedImage(pothole.data?.image_url ?? null, STORAGE_BUCKETS.potholeImages)
  const repairs = useAsync(() => (id ? repo.listRepairs(id) : Promise.resolve([])), [id], {
    enabled: Boolean(id),
  })

  const activeAssignment = useMemo(
    () => (assignments.data ?? []).find((row) => row.status !== 'CANCELLED' && row.status !== 'DECLINED'),
    [assignments.data],
  )

  /** Recompute the rationale locally from stored values so the page can explain
   *  a historical score even though the original inputs are not all persisted. */
  const priority = useMemo(() => {
    if (!pothole.data) return null
    const row = pothole.data
    return assessPriority({
      depthCm: row.depth_cm,
      areaCm2: row.area_cm2,
      trafficRisk: row.traffic_risk,
      roadType: (row.road_type ?? 'LOCAL') as RoadType,
      nearSchool: false,
      nearHospital: false,
      nearIntersection: false,
      aiConfidence: row.ai_confidence ?? 0.5,
      depthConfidence: row.depth_confidence ?? undefined,
      reportCount: row.report_count,
    })
  }, [pothole.data])

  const handleAssign = useCallback(async () => {
    if (!id) return
    setAssigning(true)
    try {
      const result = await repo.assignOfficer(id)
      if (result.assigned && result.officer) {
        toast.success(
          'Officer assigned',
          `${result.officer.full_name} · ${formatDistanceKm(result.assignment?.distance_km)} · ETA ${formatDuration(result.assignment?.estimated_arrival_minutes)}`,
        )
      } else {
        toast.info('No officer available', result.message ?? 'The incident remains queued.')
      }
      await Promise.all([pothole.refresh(), assignments.refresh()])
    } catch (error) {
      toast.error(
        'Could not assign an officer',
        error instanceof Error ? error.message : 'Please retry.',
      )
    } finally {
      setAssigning(false)
    }
  }, [assignments, id, pothole, repo, toast])

  if (pothole.loading) {
    return (
      <>
        <TopBar title="Incident" back />
        <Screen className="space-y-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-28" />
          <Skeleton className="h-40" />
        </Screen>
      </>
    )
  }

  if (pothole.error || !pothole.data) {
    return (
      <>
        <TopBar title="Incident" back />
        <Screen>
          <GlassCard className="space-y-3 text-center">
            <Info className="mx-auto h-6 w-6 text-white/40" aria-hidden />
            <p className="text-[14px] font-semibold text-white">Incident unavailable</p>
            <p className="text-[12px] text-white/50">
              {pothole.error?.userMessage ?? 'This record could not be loaded.'}
            </p>
            <Button variant="secondary" onClick={() => void pothole.refresh()}>
              Retry
            </Button>
          </GlassCard>
        </Screen>
      </>
    )
  }

  const row = pothole.data
  const methodMeta = MEASUREMENT_METHOD_META[row.depth_method] ?? MEASUREMENT_METHOD_META.UNKNOWN
  const measured = row.depth_method !== 'VISION_ESTIMATE' && row.depth_method !== 'UNKNOWN'
  const isOwner = row.reported_by != null && row.reported_by === userId
  const canStaffAct = role === 'OFFICER' || role === 'ADMIN' || role === 'SUPERVISOR'

  return (
    <>
      <TopBar
        title={row.incident_code}
        subtitle={row.address ?? `${row.latitude.toFixed(4)}, ${row.longitude.toFixed(4)}`}
        back
        right={<StatusBadge status={row.status} />}
      />

      <Screen className="pt-3">
        {/* ----------------------------------------------------------- capture */}
        <GlassCard padded={false} className="overflow-hidden">
          {beforeImage.url ? (
            <img
              src={beforeImage.url}
              alt={`Captured road surface for ${row.incident_code}`}
              className="block max-h-[300px] w-full object-cover"
            />
          ) : (
            <div className="flex h-44 items-center justify-center bg-white/4 text-[12px] text-white/40">
              No capture attached to this report
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-white/8 px-3.5 py-2.5">
            <span className="flex items-center gap-1.5 text-[10px] text-white/50">
              <Clock className="h-3 w-3" aria-hidden />
              {timeAgo(row.created_at)}
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-white/50">
              <Users className="h-3 w-3" aria-hidden />
              {row.report_count} report{row.report_count === 1 ? '' : 's'}
            </span>
            <PriorityBadge level={row.priority_level} score={row.priority_score} />
          </div>
        </GlassCard>

        {/* -------------------------------------------------------- headline */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-white/45 uppercase">
              Severity
            </p>
            <p className="text-[22px] leading-tight font-semibold tracking-tight text-white">
              {row.severity}
            </p>
          </div>
          <SeverityBadge severity={row.severity} />
        </div>

        {/* ---------------------------------------------------- measurements */}
        <div>
          <SectionTitle
            title="Measurements"
            action={<Chip tone={measured ? 'success' : 'warn'}>{measured ? 'Measured' : 'Approximate'}</Chip>}
          />
          <MeasurementGrid pothole={row} />
        </div>

        <DepthConfidencePanel
          depthCm={row.depth_cm}
          method={row.depth_method}
          depthConfidence={row.depth_confidence}
          measurementConfidence={row.measurement_confidence}
          source={measured ? 'sensor_samples' : 'visual_estimate'}
        />

        <GlassCard>
          <dl className="divide-y divide-white/6">
            <DetailRow label="Depth method" value={methodMeta.short} />
            <DetailRow label="Reliability" value={methodMeta.reliability} />
            <DetailRow label="AI confidence" value={row.ai_confidence != null ? `${Math.round(row.ai_confidence * 100)}%` : '—'} />
            <DetailRow label="Damage type" value={row.road_damage_type.replace(/_/g, ' ')} />
            <DetailRow label="Recommended action" value={row.recommended_action.replace(/_/g, ' ')} />
            <DetailRow label="Zone" value={row.zone ?? '—'} />
            <DetailRow label="Reported" value={formatDateTime(row.created_at)} />
          </dl>
        </GlassCard>

        {/* ------------------------------------------------------------- risk */}
        <div>
          <SectionTitle title="Risk" />
          <RiskPanel traffic={row.traffic_risk} vehicle={row.vehicle_risk} />
        </div>

        {/* --------------------------------------------------------- location */}
        <div>
          <SectionTitle
            title="Location"
            action={
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${row.latitude},${row.longitude}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-[12px] font-medium text-aurora-300"
              >
                <Navigation className="h-3 w-3" aria-hidden />
                Directions
              </a>
            }
          />
          <MapView
            className="h-52"
            potholes={[row]}
            selectedId={selected ?? row.id}
            onSelect={(pothole) => setSelected(pothole.id)}
            center={[row.longitude, row.latitude]}
            zoom={16}
            heatCells={[]}
          />
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-white/50">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            {row.address ?? `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`}
          </p>
        </div>

        {/* ------------------------------------------------------- assignment */}
        <div>
          <SectionTitle
            title="Assignment"
            action={
              activeAssignment ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ASSIGNMENT_STATUS_META[activeAssignment.status].tone}`}
                >
                  {ASSIGNMENT_STATUS_META[activeAssignment.status].label}
                </span>
              ) : null
            }
          />

          {assignments.loading ? (
            <Skeleton className="h-28" />
          ) : activeAssignment ? (
            <GlassCard className="space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-aurora-400/30 to-aurora-600/30 text-[15px] font-semibold text-white">
                  {(activeAssignment.officer?.profile?.full_name ?? 'Officer')
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-white">
                    {activeAssignment.officer?.profile?.full_name ?? 'Assigned officer'}
                  </p>
                  <p className="text-[11px] text-white/50">
                    {activeAssignment.officer?.assigned_zone ?? 'Zone unassigned'} ·{' '}
                    {activeAssignment.officer?.specialization?.replace(/_/g, ' ').toLowerCase() ??
                      'road maintenance'}
                  </p>
                </div>
                {activeAssignment.officer?.profile?.email ? (
                  <a
                    href={`mailto:${activeAssignment.officer.profile.email}`}
                    aria-label="Contact officer by email"
                    className="glass-pill inline-flex h-8 w-8 items-center justify-center rounded-full text-white/70"
                  >
                    <Phone className="h-3.5 w-3.5" aria-hidden />
                  </a>
                ) : null}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <MiniStat label="Distance" value={formatDistanceKm(activeAssignment.distance_km)} />
                <MiniStat
                  label="ETA"
                  value={formatDuration(activeAssignment.estimated_arrival_minutes)}
                />
                <MiniStat
                  label="Score"
                  value={
                    activeAssignment.assignment_score != null
                      ? Math.round(activeAssignment.assignment_score).toString()
                      : '—'
                  }
                />
              </div>

              {activeAssignment.estimated_arrival_minutes != null ? (
                <EtaPill minutes={activeAssignment.estimated_arrival_minutes} />
              ) : null}

              <dl className="divide-y divide-white/6">
                <DetailRow label="Assigned" value={formatDateTime(activeAssignment.assigned_at)} />
                <DetailRow label="Accepted" value={formatDateTime(activeAssignment.accepted_at)} />
                <DetailRow label="Arrived" value={formatDateTime(activeAssignment.arrived_at)} />
                <DetailRow label="Completed" value={formatDateTime(activeAssignment.completed_at)} />
              </dl>

              {canStaffAct ? (
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  onClick={() => navigate('/officer')}
                  icon={<UserCheck className="h-4 w-4" />}
                >
                  Open officer workflow
                </Button>
              ) : null}
            </GlassCard>
          ) : (
            <GlassCard className="space-y-3">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
                  <Clock className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-white">
                    Waiting in the maintenance queue
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-white/50">
                    No officer is currently assigned. Dispatch picks the nearest <em>available</em>{' '}
                    officer for this zone using distance, availability, zone match and
                    specialization — never simply the first record.
                  </p>
                </div>
              </div>
              <Button
                fullWidth
                loading={assigning}
                onClick={() => void handleAssign()}
                icon={<Users className="h-4 w-4" />}
              >
                Dispatch nearest officer
              </Button>
            </GlassCard>
          )}
        </div>

        {/* --------------------------------------------------------- workflow */}
        <div>
          <SectionTitle title="Workflow status" />
          <GlassCard>
            <StatusTimeline status={row.status} />
          </GlassCard>
        </div>

        {/* ------------------------------------------------------- AI reason */}
        {priority ? (
          <AiReasoningPanel
            priority={priority}
            evidence={[]}
            explanation={
              isOwner || canStaffAct
                ? 'Rationale recomputed from the stored measurements using the current jurisdiction weights.'
                : ''
            }
            damageType={row.road_damage_type}
            recommendedAction={row.recommended_action}
          />
        ) : null}

        {/* --------------------------------------------------------- repairs */}
        <div>
          <SectionTitle
            title="Repair records"
            action={
              repairs.data && repairs.data.length > 0 ? (
                <span className="text-[11px] text-white/45">
                  {repairs.data.length} record{repairs.data.length === 1 ? '' : 's'}
                </span>
              ) : null
            }
          />
          {repairs.loading ? (
            <Skeleton className="h-24" />
          ) : (repairs.data ?? []).length === 0 ? (
            <GlassCard className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-white/40" aria-hidden />
              <p className="text-[11px] leading-relaxed text-white/50">
                No repair has been filed yet. When an officer uploads before/after photographs the
                AI verification result and its confidence will appear here as an assistive signal —
                it never replaces an official inspection.
              </p>
            </GlassCard>
          ) : (
            <div className="space-y-2.5">
              {(repairs.data ?? []).map((record) => (
                <RepairRecordCard key={record.id} record={record} />
              ))}
            </div>
          )}
        </div>

        {row.road_damage_type === 'SINKHOLE' ? (
          <div className="flex items-start gap-2.5 rounded-2xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-red-300" aria-hidden />
            <p className="text-[11px] leading-relaxed text-red-100/85">
              Classified as a sinkhole-type defect. Sub-surface failure is possible — escalate for
              structural assessment before patching.
            </p>
          </div>
        ) : null}

        {row.near_school || row.near_hospital ? (
          <div className="flex flex-wrap gap-1.5">
            {row.near_school ? (
              <Chip tone="info">
                <GraduationCap className="h-3 w-3" aria-hidden />
                Near school
              </Chip>
            ) : null}
            {row.near_hospital ? (
              <Chip tone="info">
                <Building2 className="h-3 w-3" aria-hidden />
                Near hospital
              </Chip>
            ) : null}
          </div>
        ) : null}

        {profile?.role === 'ADMIN' ? (
          <GlassCard className="space-y-2">
            <p className="text-[12px] font-semibold text-white/85">Administrator</p>
            <p className="text-[11px] leading-relaxed text-white/50">
              Administrative overrides are recorded against your profile. Re-scoring uses the
              jurisdiction weights stored in <code className="text-white/70">severity_config</code>.
            </p>
          </GlassCard>
        ) : null}
      </Screen>
    </>
  )
}

function RepairRecordCard({
  record,
}: {
  record: {
    id: string
    before_image_url: string | null
    after_image_url: string | null
    repair_notes: string | null
    repair_type: string | null
    verification_confidence: number | null
    completed_at: string | null
    created_at: string
  }
}) {
  const after = useSignedImage(record.after_image_url, STORAGE_BUCKETS.repairImages)
  const before = useSignedImage(record.before_image_url, STORAGE_BUCKETS.repairImages)

  return (
    <GlassCard className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold text-white">
            {record.repair_type?.replace(/_/g, ' ') ?? 'Repair'}
          </p>
          <p className="text-[11px] text-white/50">{formatDateTime(record.completed_at ?? record.created_at)}</p>
        </div>
        {record.verification_confidence != null ? (
          <Chip tone={record.verification_confidence >= 0.7 ? 'success' : 'warn'}>
            AI {Math.round(record.verification_confidence * 100)}%
          </Chip>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Before', url: before.url },
          { label: 'After', url: after.url },
        ].map((image) =>
          image.url ? (
            <figure key={image.label} className="overflow-hidden rounded-2xl border border-white/10">
              <img src={image.url} alt={`${image.label} repair`} className="h-28 w-full object-cover" />
              <figcaption className="bg-white/5 px-2 py-1 text-[10px] tracking-wider text-white/50 uppercase">
                {image.label}
              </figcaption>
            </figure>
          ) : (
            <div
              key={image.label}
              className="flex h-28 items-center justify-center rounded-2xl border border-white/10 bg-white/4 text-[10px] text-white/35"
            >
              {image.label} unavailable
            </div>
          ),
        )}
      </div>

      {record.repair_notes ? (
        <p className="text-[11px] leading-relaxed text-white/60">{record.repair_notes}</p>
      ) : null}
    </GlassCard>
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
