import { motion } from 'framer-motion'
import {
  Activity,
  Brain,
  Building2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen, TopBar } from '@/components/layout/AppShell'
import { MapLegend, MapView } from '@/components/map/MapView'
import {
  AdminStatGrid,
  AiInsightsPanel,
  HeatmapDensityBars,
  monthlyBreakdown,
  severityBreakdown,
  statusBreakdown,
  zoneBreakdown,
} from '@/components/dashboard/DashboardComponents'
import {
  OfficerWorkloadChart,
  SeverityDonut,
  StatusBarChart,
  TrendAreaChart,
  ZoneBarChart,
} from '@/components/dashboard/charts'
import { SeverityBadge, StatusBadge } from '@/components/pothole/PotholeComponents'
import { Button, Chip, GlassCard, SectionTitle, Skeleton } from '@/components/ui/primitives'
import { useToast } from '@/context/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import {
  useDashboardStats,
  useHeatmapGrid,
  useOfficers,
  usePotholes,
  useRoadInsights,
} from '@/hooks/useData'
import { OFFICER_STATUS_META } from '@/lib/constants'
import { cn, formatDateSafe, timeAgo } from '@/lib/utils'
import { getRepository } from '@/services'
import type { OfficerStatus } from '@/types'

/**
 * Administrator console (spec sections 28, 29, 52, 53).
 *
 * Every chart is computed from real rows — no sample statistics are injected.
 */
export default function AdminDashboard() {
  const navigate = useNavigate()
  const toast = useToast()
  const repo = getRepository()

  const stats = useDashboardStats()
  const potholes = usePotholes({ limit: 500 })
  const officers = useOfficers()
  const insights = useRoadInsights(false)

  const assignments = useAsync(() => repo.listAssignments({}), [])

  // Memoised so the derived aggregates below are not recomputed on every render.
  const rows = useMemo(() => potholes.data ?? [], [potholes.data])
  const severityData = useMemo(() => severityBreakdown(rows), [rows])
  const zoneData = useMemo(() => zoneBreakdown(rows), [rows])
  const trendData = useMemo(() => monthlyBreakdown(rows, 6), [rows])
  const statusData = useMemo(() => statusBreakdown(rows), [rows])
  const heatCells = useHeatmapGrid(rows, 0.01)

  const workload = useMemo(() => {
    const byOfficer = new Map<string, { name: string; active: number; completed: number }>()
    for (const assignment of assignments.data ?? []) {
      const name = assignment.officer?.profile?.full_name ?? 'Unassigned'
      const row = byOfficer.get(name) ?? { name, active: 0, completed: 0 }
      if (assignment.status === 'COMPLETED') row.completed += 1
      else if (assignment.status !== 'CANCELLED' && assignment.status !== 'DECLINED') row.active += 1
      byOfficer.set(name, row)
    }
    return [...byOfficer.values()].slice(0, 6)
  }, [assignments.data])

  const criticalRows = useMemo(
    () =>
      rows
        .filter((row) => row.severity === 'CRITICAL' && row.status !== 'RESOLVED')
        .sort((a, b) => b.priority_score - a.priority_score)
        .slice(0, 6),
    [rows],
  )

  const handleInsights = async () => {
    try {
      await insights.refresh()
      toast.success('Insights refreshed', 'Figures recomputed from live incident records.')
    } catch {
      toast.error('Insights unavailable', 'The road-intelligence service did not respond.')
    }
  }

  const handleOfficerStatus = async (officerId: string, status: OfficerStatus) => {
    try {
      await repo.updateOfficerStatus(officerId, status)
      await officers.refresh()
      toast.info('Officer updated', `Availability set to ${status.toLowerCase()}.`)
    } catch (error) {
      toast.error('Could not update officer', error instanceof Error ? error.message : 'Retry.')
    }
  }

  return (
    <>
      <TopBar
        title="Admin console"
        subtitle="Municipal road maintenance analytics"
        large
        right={
          <Button
            size="sm"
            variant="secondary"
            loading={potholes.refreshing || stats.refreshing}
            onClick={() => {
              void potholes.refresh()
              void stats.refresh()
              void officers.refresh()
              void assignments.refresh()
            }}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Refresh
          </Button>
        }
      />

      <Screen className="pt-2 lg:max-w-none">
        <AdminStatGrid stats={stats.data} loading={stats.loading} />

        {/* --------------------------------------------------------- insights */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-aurora-400" aria-hidden />
            <h2 className="text-[13px] font-semibold text-white">Road intelligence</h2>
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={insights.loading}
            onClick={() => void handleInsights()}
            icon={<Brain className="h-3.5 w-3.5" />}
          >
            Generate
          </Button>
        </div>

        <AiInsightsPanel
          insights={insights.data?.insights ?? []}
          loading={insights.loading}
          note={insights.data?.note}
          narrationSource={insights.data?.narration_source}
          error={insights.error?.userMessage ?? null}
        />

        {!insights.data && !insights.loading ? (
          <p className="text-[11px] leading-relaxed text-white/40">
            Insights are computed on demand from real incident records. Generating them costs one
            model call, so they are not fetched automatically.
          </p>
        ) : null}

        {/* ----------------------------------------------------------- charts */}
        <div className="grid gap-3 lg:grid-cols-2">
          {potholes.loading ? (
            <>
              <Skeleton className="h-[248px]" />
              <Skeleton className="h-[248px]" />
            </>
          ) : (
            <>
              <SeverityDonut data={severityData} />
              <ZoneBarChart data={zoneData} />
              <TrendAreaChart data={trendData} />
              <StatusBarChart data={statusData} />
              <OfficerWorkloadChart data={workload} />
              <HeatmapDensityBars cells={heatCells} />
            </>
          )}
        </div>

        {/* -------------------------------------------------------- heatmap */}
        <div>
          <SectionTitle
            title="Priority heatmap"
            action={<Chip tone="info">{rows.length} incidents</Chip>}
          />
          <div className="space-y-2">
            <MapLegend showHeatmap onToggleHeatmap={() => undefined} showOfficers={false} />
            <MapView
              className="h-[320px]"
              potholes={rows}
              heatmap
              heatCells={heatCells}
              onSelect={(pothole) => navigate(`/reports/${pothole.id}`)}
            />
          </div>
          <p className="mt-2 text-[11px] text-white/45">
            Density is aggregated per grid cell from live coordinates. Warmer cells carry a higher
            share of critical incidents.
          </p>
        </div>

        {/* --------------------------------------------------- critical queue */}
        <div>
          <SectionTitle
            title="Critical backlog"
            action={
              criticalRows.length > 0 ? <Chip tone="danger">{criticalRows.length}</Chip> : null
            }
          />
          {criticalRows.length === 0 ? (
            <GlassCard className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
              <p className="text-[11px] text-white/55">
                No unresolved critical incidents in the current dataset.
              </p>
            </GlassCard>
          ) : (
            <div className="space-y-2">
              {criticalRows.map((row, index) => (
                <motion.button
                  key={row.id}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  onClick={() => navigate(`/reports/${row.id}`)}
                  className="glass flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-left transition hover:bg-white/10"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-[12px] text-white/85">
                      {row.incident_code}
                    </span>
                    <span className="block truncate text-[10px] text-white/45">
                      {row.zone ?? 'Unzoned'} · {timeAgo(row.created_at)} · {formatDateSafe(row.created_at)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <SeverityBadge severity={row.severity} size="sm" />
                    <StatusBadge status={row.status} />
                  </span>
                </motion.button>
              ))}
            </div>
          )}
        </div>

        {/* --------------------------------------------------------- officers */}
        <div>
          <SectionTitle
            title="Officer roster"
            action={<Chip tone="info">{(officers.data ?? []).length} officers</Chip>}
          />
          {officers.loading ? (
            <Skeleton className="h-32" />
          ) : (officers.data ?? []).length === 0 ? (
            <GlassCard className="flex items-start gap-3">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-white/40" aria-hidden />
              <p className="text-[11px] leading-relaxed text-white/50">
                No officers registered. Promote a profile to the OFFICER role, or insert a row into
                the <code className="text-white/70">officers</code> table, to enable dispatch.
              </p>
            </GlassCard>
          ) : (
            <div className="space-y-2">
              {(officers.data ?? []).map((officer) => (
                <GlassCard key={officer.id} padded={false} className="p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-white">
                        {officer.profile?.full_name ?? 'Unnamed officer'}
                      </p>
                      <p className="truncate text-[11px] text-white/45">
                        {officer.department} · {officer.assigned_zone ?? 'No zone'} ·{' '}
                        {officer.specialization?.replace(/_/g, ' ').toLowerCase() ?? 'general'}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-1.5 text-[10px] font-semibold',
                        OFFICER_STATUS_META[officer.status].color,
                      )}
                    >
                      <span
                        className={cn('h-1.5 w-1.5 rounded-full', OFFICER_STATUS_META[officer.status].dot)}
                        aria-hidden
                      />
                      {OFFICER_STATUS_META[officer.status].label}
                    </span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {(['AVAILABLE', 'BUSY', 'ON_SITE', 'OFFLINE'] as OfficerStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => void handleOfficerStatus(officer.id, status)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wide uppercase transition',
                          officer.status === status
                            ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
                            : 'border-white/12 text-white/45 hover:text-white',
                        )}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>

        {/* ------------------------------------------------------- data notes */}
        <GlassCard className="space-y-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-aurora-400" aria-hidden />
            <p className="text-[12px] font-semibold text-white/85">Data provenance</p>
          </div>
          <p className="text-[11px] leading-relaxed text-white/50">
            All metrics on this page are computed from live incident rows and assignment records.
            Resolution time is measured from report creation to verified closure. When the database
            is empty, charts render genuinely empty rather than showing placeholder figures.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Chip>{rows.length} incidents loaded</Chip>
            <Chip>{(assignments.data ?? []).length} assignments</Chip>
            <Chip tone="info">RLS enforced</Chip>
          </div>
        </GlassCard>

        <GlassCard className="flex items-start gap-3">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-white/40" aria-hidden />
          <p className="text-[11px] leading-relaxed text-white/50">
            Severity and priority weights are stored in{' '}
            <code className="text-white/70">severity_config</code> and can be tuned per
            jurisdiction. They are triage aids, not statutory standards.
          </p>
        </GlassCard>
      </Screen>
    </>
  )
}
