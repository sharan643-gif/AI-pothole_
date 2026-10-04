import { motion } from 'framer-motion'
import { Activity, Brain, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { SEVERITY_META } from '@/lib/constants'
import { cn, formatDuration } from '@/lib/utils'
import type { DashboardStats, Pothole, RoadInsight, Severity } from '@/types'
import { GlassCard, Skeleton, StatCard } from '@/components/ui/primitives'

/**
 * Dashboard building blocks that do NOT pull in the charting library, so the
 * citizen home screen stays lightweight. Charts live in `./charts.tsx`.
 */

/* ------------------------------------------------------------------ *
 * Stat grids
 * ------------------------------------------------------------------ */

export function StatGrid({ stats, loading }: { stats: DashboardStats | null; loading: boolean }) {
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-[86px]" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <StatCard label="Potholes detected" value={stats.total} tone="info" />
      <StatCard label="Critical" value={stats.critical} tone="critical" />
      <StatCard label="Under repair" value={stats.inRepair} tone="neutral" />
      <StatCard
        label="Resolved"
        value={stats.resolved}
        tone="success"
        hint={
          stats.avgResolutionHours != null
            ? `avg ${formatDuration(stats.avgResolutionHours * 60)}`
            : undefined
        }
      />
    </div>
  )
}

export function AdminStatGrid({
  stats,
  loading,
}: {
  stats: DashboardStats | null
  loading: boolean
}) {
  const tiles = [
    { label: 'Total reports', value: stats?.total ?? 0, tone: 'info' as const },
    { label: 'Active issues', value: stats?.inRepair ?? 0, tone: 'neutral' as const },
    { label: 'Critical open', value: stats?.critical ?? 0, tone: 'critical' as const },
    { label: 'Resolved', value: stats?.resolved ?? 0, tone: 'success' as const },
    { label: 'Resolved today', value: stats?.resolvedToday ?? 0, tone: 'success' as const },
    {
      label: 'Avg resolution',
      value:
        stats?.avgResolutionHours != null
          ? formatDuration(stats.avgResolutionHours * 60)
          : '—',
      tone: 'neutral' as const,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
      {tiles.map((tile) =>
        loading ? (
          <Skeleton key={tile.label} className="h-[86px]" />
        ) : (
          <StatCard key={tile.label} label={tile.label} value={tile.value} tone={tile.tone} />
        ),
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * AI insights (spec section 29)
 * ------------------------------------------------------------------ */

export function AiInsightsPanel({
  insights,
  loading,
  note,
  narrationSource,
  error,
}: {
  insights: RoadInsight[]
  loading: boolean
  note?: string
  narrationSource?: 'gemini' | 'deterministic'
  error?: string | null
}) {
  return (
    <GlassCard className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-aurora-400/25 to-aurora-600/25">
          <Brain className="h-4 w-4 text-aurora-300" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-tight text-white">
            AI Road Intelligence
          </h3>
          <p className="truncate text-[10px] text-white/45">
            Computed from live incident records
            {narrationSource ? ` · narrated by ${narrationSource}` : ''}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100/85">
          {error}
        </p>
      ) : insights.length === 0 ? (
        <p className="text-[12px] text-white/45">
          No insights generated yet. Generate them to analyse the current backlog.
        </p>
      ) : (
        <ul className="space-y-2">
          {insights.map((insight, index) => (
            <motion.li
              key={insight.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="flex gap-2.5 rounded-2xl border border-white/8 bg-white/4 px-3 py-2.5"
            >
              <span className="mt-0.5 shrink-0" aria-hidden>
                {insight.trend === 'up' ? (
                  <TrendingUp className="h-4 w-4 text-red-400" />
                ) : insight.trend === 'down' ? (
                  <TrendingDown className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Minus className="h-4 w-4 text-white/40" />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] leading-snug font-medium text-white/90">
                  {insight.headline}
                </p>
                {insight.detail ? (
                  <p className="mt-0.5 text-[11px] leading-snug text-white/50">{insight.detail}</p>
                ) : null}
              </div>
            </motion.li>
          ))}
        </ul>
      )}

      {note ? (
        <p className="border-t border-white/8 pt-2 text-[10px] leading-relaxed text-white/35">
          {note}
        </p>
      ) : null}
    </GlassCard>
  )
}

/* ------------------------------------------------------------------ *
 * Heatmap density bars (spec section 53)
 * ------------------------------------------------------------------ */

export function HeatmapDensityBars({
  cells,
}: {
  cells: { lat: number; lon: number; total: number; critical: number }[]
}) {
  const top = [...cells].sort((a, b) => b.total - a.total).slice(0, 6)
  const max = top[0]?.total ?? 1

  return (
    <GlassCard className="space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-aurora-400" aria-hidden />
        <h3 className="text-[13px] font-semibold tracking-tight text-white">Density by grid cell</h3>
      </div>
      {top.length === 0 ? (
        <p className="text-[12px] text-white/40">No spatial data yet.</p>
      ) : (
        <ul className="space-y-2">
          {top.map((cell) => {
            const intensity = cell.total / max
            return (
              <li key={`${cell.lat}:${cell.lon}`} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono text-white/55">
                    {cell.lat.toFixed(3)}, {cell.lon.toFixed(3)}
                  </span>
                  <span className="text-white/70 tabular-nums">
                    {cell.total}
                    {cell.critical > 0 ? ` · ${cell.critical} critical` : ''}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      intensity > 0.66
                        ? 'bg-red-400'
                        : intensity > 0.33
                          ? 'bg-amber-400'
                          : 'bg-emerald-400',
                    )}
                    style={{ width: `${Math.max(6, intensity * 100)}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </GlassCard>
  )
}

/* ------------------------------------------------------------------ *
 * Derivation helpers used by pages
 * ------------------------------------------------------------------ */

export function severityBreakdown(potholes: Pothole[]) {
  const order: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
  return order.map((severity) => ({
    severity,
    count: potholes.filter((pothole) => pothole.severity === severity).length,
    hex: SEVERITY_META[severity].hex,
  }))
}

export function zoneBreakdown(potholes: Pothole[]) {
  const map = new Map<string, { zone: string; count: number; critical: number }>()
  for (const pothole of potholes) {
    const zone = pothole.zone ?? 'UNASSIGNED'
    const row = map.get(zone) ?? { zone, count: 0, critical: 0 }
    row.count += 1
    if (pothole.severity === 'CRITICAL') row.critical += 1
    map.set(zone, row)
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 8)
}

export function monthlyBreakdown(potholes: Pothole[], months = 6) {
  const buckets: { label: string; count: number; resolved: number; key: string }[] = []
  const now = new Date()

  for (let index = months - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1)
    buckets.push({
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleString(undefined, { month: 'short' }),
      count: 0,
      resolved: 0,
    })
  }

  const lookup = new Map(buckets.map((bucket) => [bucket.key, bucket]))
  for (const pothole of potholes) {
    const created = new Date(pothole.created_at)
    const bucket = lookup.get(`${created.getFullYear()}-${created.getMonth()}`)
    if (!bucket) continue
    bucket.count += 1
    if (pothole.status === 'RESOLVED') bucket.resolved += 1
  }

  return buckets
}

export function statusBreakdown(potholes: Pothole[]) {
  const groups = [
    { label: 'Reported', statuses: ['DETECTED', 'REPORTED'], tone: '#2ea8e0' },
    { label: 'Assigned', statuses: ['ASSIGNED', 'ACCEPTED'], tone: '#8b7cff' },
    { label: 'In progress', statuses: ['EN_ROUTE', 'ON_SITE', 'UNDER_REPAIR'], tone: '#ff9f0a' },
    { label: 'Verifying', statuses: ['AI_VERIFICATION'], tone: '#d946ef' },
    { label: 'Resolved', statuses: ['RESOLVED'], tone: '#30d158' },
  ]

  return groups.map((group) => ({
    status: group.label,
    tone: group.tone,
    count: potholes.filter((pothole) => group.statuses.includes(pothole.status)).length,
  }))
}
