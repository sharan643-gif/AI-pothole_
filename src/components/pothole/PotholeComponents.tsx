import { motion } from 'framer-motion'
import {
  AlertTriangle,
  Brain,
  Car,
  Check,
  Clock,
  Gauge,
  MapPin,
  PersonStanding,
  Ruler,
  ShieldQuestion,
  TriangleAlert,
} from 'lucide-react'
import { type ReactNode } from 'react'
import {
  MEASUREMENT_METHOD_META,
  PRIORITY_META,
  RISK_META,
  ROAD_DAMAGE_LABEL,
  SEVERITY_META,
  STATUS_FLOW,
  STATUS_META,
} from '@/lib/constants'
import {
  cn,
  formatArea,
  formatCm,
  formatDuration,
  formatNumber,
  formatPercent,
  timeAgo,
} from '@/lib/utils'
import type {
  Assignment,
  MeasurementMethod,
  Pothole,
  PotholeStatus,
  PriorityAssessment,
  RiskLevel,
  Severity,
} from '@/types'
import { Chip, GlassCard, ProgressRing } from '@/components/ui/primitives'

/* ------------------------------------------------------------------ *
 * Badges
 * ------------------------------------------------------------------ */

export function SeverityBadge({ severity, size = 'md' }: { severity: Severity; size?: 'sm' | 'md' }) {
  const meta = SEVERITY_META[severity]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold tracking-wide uppercase',
        meta.chip,
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]',
      )}
    >
      <span aria-hidden>{meta.emoji}</span>
      {meta.label}
    </span>
  )
}

export function PriorityBadge({ level, score }: { level: Pothole['priority_level']; score?: number | null }) {
  const meta = PRIORITY_META[level]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase',
        meta.className,
      )}
    >
      <span className="opacity-70">{meta.code}</span>
      {meta.label}
      {score != null ? <span className="tabular-nums opacity-80">{Math.round(score)}</span> : null}
    </span>
  )
}

export function StatusBadge({ status }: { status: PotholeStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
        STATUS_META[status].tone,
      )}
    >
      {STATUS_META[status].label}
    </span>
  )
}

function RiskRow({ label, level, icon }: { label: string; level: RiskLevel; icon: ReactNode }) {
  return (
    <div className="glass flex items-center justify-between rounded-2xl px-3 py-2.5">
      <span className="flex items-center gap-2 text-[12px] text-white/70">
        <span className="text-white/45">{icon}</span>
        {label}
      </span>
      <span className={cn('text-[12px] font-semibold', RISK_META[level].className)}>
        {RISK_META[level].label}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Depth confidence (spec section 5)
 * ------------------------------------------------------------------ */

export function DepthConfidencePanel({
  depthCm,
  method,
  depthConfidence,
  measurementConfidence,
  source,
}: {
  depthCm: number | null
  method: MeasurementMethod
  depthConfidence: number | null
  measurementConfidence: number | null
  source?: 'sensor_samples' | 'visual_estimate' | null
}) {
  const meta = MEASUREMENT_METHOD_META[method] ?? MEASUREMENT_METHOD_META.UNKNOWN
  const confidence = depthConfidence ?? measurementConfidence ?? null
  const isMeasured = method === 'AR_DEPTH_SENSOR' || source === 'sensor_samples'

  return (
    <GlassCard className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-white/50 uppercase">
            {isMeasured ? 'Measured depth' : 'Estimated depth'}
          </p>
          <p className="mt-0.5 text-[26px] leading-none font-semibold text-white tabular-nums">
            {depthCm != null ? `${depthCm}` : '—'}
            <span className="ml-1 text-[14px] font-medium text-white/50">cm</span>
          </p>
        </div>
        {confidence != null ? (
          <ProgressRing
            value={confidence * 100}
            size={64}
            stroke={6}
            label={formatPercent(confidence)}
            color={confidence >= 0.7 ? '#30d158' : confidence >= 0.45 ? '#ffd60a' : '#ff9f0a'}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={isMeasured ? 'success' : 'warn'}>
          {isMeasured ? 'Sensor-derived' : 'Approximate'}
        </Chip>
        <Chip>{meta.short}</Chip>
      </div>

      <p className="text-[11px] leading-relaxed text-white/50">
        {isMeasured
          ? 'Depth was derived from device depth samples, not from a single photograph.'
          : 'A single RGB frame cannot yield absolute scale. This is a visual estimate and should be treated as approximate.'}
        {' '}
        Method: {meta.label}
        {meta.reliability !== 'HIGH' ? ` (${meta.reliability.toLowerCase()} reliability)` : ''}.
      </p>
    </GlassCard>
  )
}

/* ------------------------------------------------------------------ *
 * Measurement grid (spec sections 17, 18)
 * ------------------------------------------------------------------ */

export function MeasurementGrid({
  pothole,
  compact = false,
}: {
  pothole: Pick<Pothole, 'width_cm' | 'length_cm' | 'depth_cm' | 'area_cm2' | 'ai_confidence' | 'priority_score'>
  compact?: boolean
}) {
  const items = [
    { label: 'Width', value: formatCm(pothole.width_cm, 0), icon: <Ruler className="h-3.5 w-3.5" /> },
    { label: 'Length', value: formatCm(pothole.length_cm, 0), icon: <Ruler className="h-3.5 w-3.5" /> },
    { label: 'Depth', value: formatCm(pothole.depth_cm), icon: <TriangleAlert className="h-3.5 w-3.5" /> },
    { label: 'Area', value: formatArea(pothole.area_cm2), icon: <Gauge className="h-3.5 w-3.5" /> },
    {
      label: 'AI confidence',
      value: formatPercent(pothole.ai_confidence),
      icon: <Brain className="h-3.5 w-3.5" />,
    },
    {
      label: 'Priority',
      value: `${Math.round(pothole.priority_score)}/100`,
      icon: <ShieldQuestion className="h-3.5 w-3.5" />,
    },
  ]

  return (
    <div className={cn('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-2')}>
      {items.map((item) => (
        <div key={item.label} className="glass rounded-2xl px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[10px] font-medium tracking-wider text-white/45 uppercase">
            {item.icon}
            {item.label}
          </span>
          <p className="mt-1 text-[15px] font-semibold text-white tabular-nums">{item.value}</p>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Risk panel
 * ------------------------------------------------------------------ */

export function RiskPanel({
  traffic,
  vehicle,
  pedestrian = 'MEDIUM',
}: {
  traffic: RiskLevel
  vehicle: RiskLevel
  pedestrian?: RiskLevel
}) {
  return (
    <div className="space-y-2">
      <RiskRow label="Traffic risk" level={traffic} icon={<Car className="h-3.5 w-3.5" />} />
      <RiskRow label="Vehicle risk" level={vehicle} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
      <RiskRow label="Pedestrian risk" level={pedestrian} icon={<PersonStanding className="h-3.5 w-3.5" />} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Status timeline (spec section 24)
 * ------------------------------------------------------------------ */

export function StatusTimeline({ status }: { status: PotholeStatus }) {
  const currentIndex = STATUS_FLOW.indexOf(status)

  return (
    <ol className="relative space-y-0">
      {STATUS_FLOW.map((step, index) => {
        const done = currentIndex >= index
        const active = currentIndex === index
        const isLast = index === STATUS_FLOW.length - 1
        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px]',
                  done
                    ? 'border-emerald-400/50 bg-emerald-400/20 text-emerald-300'
                    : 'border-white/20 text-transparent',
                  active && 'ring-2 ring-aurora-400/50',
                )}
                aria-hidden
              >
                {done ? <Check className="h-3 w-3" /> : null}
              </span>
              {!isLast ? (
                <span
                  className={cn('my-0.5 w-px flex-1', done ? 'bg-emerald-400/35' : 'bg-white/12')}
                  aria-hidden
                />
              ) : null}
            </div>
            <div className={cn('pb-3', isLast && 'pb-0')}>
              <p
                className={cn(
                  'text-[13px] font-medium',
                  active ? 'text-white' : done ? 'text-white/75' : 'text-white/35',
                )}
              >
                {STATUS_META[step].label}
              </p>
              {active ? (
                <p className="mt-0.5 text-[11px] text-white/50">{STATUS_META[step].description}</p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------------ *
 * Pothole card
 * ------------------------------------------------------------------ */

export function PotholeCard({
  pothole,
  onSelect,
  distanceKm,
  assignment,
  index = 0,
}: {
  pothole: Pothole
  onSelect?: () => void
  distanceKm?: number | null
  assignment?: Assignment | null
  index?: number
}) {
  const meta = SEVERITY_META[pothole.severity]

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.28), type: 'spring', stiffness: 320, damping: 30 }}
      whileTap={{ scale: 0.985 }}
      className="glass sheen relative w-full overflow-hidden rounded-ios p-3.5 text-left transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-aurora-400"
    >
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: meta.hex }}
        aria-hidden
      />

      <div className="flex items-start justify-between gap-3 pl-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-semibold tracking-tight text-white/85">
              {pothole.incident_code}
            </span>
            <StatusBadge status={pothole.status} />
          </div>
          <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-white/50">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden />
            {pothole.address ?? `${pothole.latitude.toFixed(4)}, ${pothole.longitude.toFixed(4)}`}
          </p>
        </div>
        <SeverityBadge severity={pothole.severity} size="sm" />
      </div>

      <div className="mt-3 flex items-center gap-3 pl-1.5">
        <Metric label="Depth" value={formatCm(pothole.depth_cm)} />
        <Metric label="Size" value={`${formatCm(pothole.width_cm, 0)} × ${formatCm(pothole.length_cm, 0)}`} />
        <Metric label="Priority" value={`${Math.round(pothole.priority_score)}`} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 pl-1.5 text-[10px] text-white/40">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden />
          {timeAgo(pothole.created_at)}
        </span>
        {distanceKm != null ? <span>{distanceKm.toFixed(2)} km away</span> : null}
        {assignment?.officer?.profile?.full_name ? (
          <span>Officer: {assignment.officer.profile.full_name}</span>
        ) : null}
      </div>
    </motion.button>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-medium tracking-wider text-white/40 uppercase">{label}</p>
      <p className="truncate text-[12px] font-semibold text-white tabular-nums">{value}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * AI reasoning panel
 * ------------------------------------------------------------------ */

export function AiReasoningPanel({
  priority,
  evidence,
  explanation,
  damageType,
  recommendedAction,
}: {
  priority: PriorityAssessment
  evidence: string[]
  explanation: string
  damageType: Pothole['road_damage_type']
  recommendedAction: Pothole['recommended_action']
}) {
  const components: { label: string; value: number }[] = [
    { label: 'Depth', value: priority.components.depth },
    { label: 'Area', value: priority.components.area },
    { label: 'Traffic', value: priority.components.traffic },
    { label: 'Location', value: priority.components.location_risk },
    { label: 'Confidence', value: priority.components.confidence },
    { label: 'Recurrence', value: priority.components.recurrence },
  ]

  return (
    <GlassCard className="space-y-3.5">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-aurora-400" aria-hidden />
        <h3 className="text-[13px] font-semibold tracking-tight text-white">AI reasoning</h3>
        <span className="ml-auto text-[10px] text-white/40">
          {ROAD_DAMAGE_LABEL[damageType]} · {recommendedAction.replace(/_/g, ' ').toLowerCase()}
        </span>
      </div>

      {explanation ? (
        <p className="text-[12px] leading-relaxed text-white/65">{explanation}</p>
      ) : null}

      <div className="space-y-2">
        {components.map((component) => (
          <div key={component.label} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-[11px] text-white/50">{component.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-aurora-400 to-aurora-600"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, component.value)}%` }}
                transition={{ type: 'spring', stiffness: 90, damping: 22 }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-[11px] font-semibold text-white/70 tabular-nums">
              {Math.round(component.value)}
            </span>
          </div>
        ))}
      </div>

      {evidence.length > 0 ? (
        <div className="space-y-1.5 border-t border-white/8 pt-3">
          <p className="text-[10px] font-semibold tracking-wider text-white/45 uppercase">
            Visual evidence
          </p>
          <ul className="space-y-1">
            {evidence.map((item) => (
              <li key={item} className="flex items-start gap-1.5 text-[12px] text-white/65">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-aurora-400" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {priority.rationale.length > 0 ? (
        <div className="space-y-1.5 border-t border-white/8 pt-3">
          <p className="text-[10px] font-semibold tracking-wider text-white/45 uppercase">
            Why this priority
          </p>
          <ul className="space-y-1">
            {priority.rationale.map((item) => (
              <li key={item} className="text-[11px] leading-relaxed text-white/55">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </GlassCard>
  )
}

/* ------------------------------------------------------------------ *
 * Verification result (spec section 27)
 * ------------------------------------------------------------------ */

export function VerificationCard({
  verification,
  advisory,
}: {
  verification: {
    repair_detected: boolean
    remaining_damage: boolean
    surface_restored: boolean
    confidence: number
    recommendation: string
    notes: string
  }
  advisory: string
}) {
  const approved = verification.recommendation === 'APPROVE'
  return (
    <GlassCard className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full',
            approved ? 'bg-emerald-400/20 text-emerald-300' : 'bg-amber-400/20 text-amber-300',
          )}
        >
          {approved ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        </span>
        <div>
          <p className="text-[13px] font-semibold text-white">
            {approved ? 'Repair verified' : 'Verification inconclusive'}
          </p>
          <p className="text-[11px] text-white/50">
            Confidence {formatPercent(verification.confidence)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Flag label="Repair visible" on={verification.repair_detected} />
        <Flag label="Damage remains" on={verification.remaining_damage} invert />
        <Flag label="Surface restored" on={verification.surface_restored} />
      </div>

      {verification.notes ? (
        <p className="text-[12px] leading-relaxed text-white/60">{verification.notes}</p>
      ) : null}

      <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] leading-relaxed text-white/50">
        {advisory}
      </p>
    </GlassCard>
  )
}

function Flag({ label, on, invert = false }: { label: string; on: boolean; invert?: boolean }) {
  const good = invert ? !on : on
  return (
    <div
      className={cn(
        'rounded-2xl border px-2.5 py-2 text-center',
        good ? 'border-emerald-400/30 bg-emerald-400/10' : 'border-amber-400/30 bg-amber-400/10',
      )}
    >
      <p className={cn('text-[11px] font-semibold', good ? 'text-emerald-300' : 'text-amber-300')}>
        {on ? 'Yes' : 'No'}
      </p>
      <p className="mt-0.5 text-[9px] leading-tight tracking-wide text-white/50 uppercase">{label}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Stat strip used on dashboards
 * ------------------------------------------------------------------ */

export function MetricTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string | number
  tone?: 'neutral' | 'critical' | 'success' | 'warn'
}) {
  const tones = {
    neutral: 'text-white',
    critical: 'text-red-400',
    success: 'text-emerald-400',
    warn: 'text-amber-300',
  }
  return (
    <div className="glass rounded-2xl px-3 py-2.5">
      <p className="text-[10px] font-medium tracking-wider text-white/45 uppercase">{label}</p>
      <p className={cn('mt-0.5 text-[18px] font-semibold tabular-nums', tones[tone])}>
        {typeof value === 'number' ? formatNumber(value) : value}
      </p>
    </div>
  )
}

export function EtaPill({ minutes }: { minutes: number | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-aurora-400/15 px-2 py-0.5 text-[11px] font-semibold text-aurora-300">
      <Clock className="h-3 w-3" aria-hidden />
      ETA {formatDuration(minutes)}
    </span>
  )
}
