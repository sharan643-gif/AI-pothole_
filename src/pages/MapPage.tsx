/**
 * MapPage — full-viewport satellite map.
 *
 * The Leaflet satellite view fills the entire screen; all controls
 * (search, legend, filters, detail panel) float as transparent glass
 * overlays so the map is never cropped.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, Globe2, MapPin, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapLegend, MapView } from '@/components/map/MapView'
import {
  MeasurementGrid,
  PriorityBadge,
  SeverityBadge,
  StatusBadge,
} from '@/components/pothole/PotholeComponents'
import { Button, Chip, GlassCard, Sheet } from '@/components/ui/primitives'
import { useHeatmapGrid, useOfficers, usePotholes } from '@/hooks/useData'
import { useGeolocation } from '@/hooks/useGeolocation'
import { cn, formatCm, timeAgo } from '@/lib/utils'
import type { Pothole, PotholeStatus } from '@/types'

const SEVERITY_FILTERS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
const STATUS_FILTERS: { value: PotholeStatus | 'OPEN' | 'ALL'; label: string }[] = [
  { value: 'ALL',         label: 'All' },
  { value: 'OPEN',        label: 'Unresolved' },
  { value: 'REPORTED',    label: 'Reported' },
  { value: 'ASSIGNED',    label: 'Assigned' },
  { value: 'UNDER_REPAIR',label: 'Repairing' },
  { value: 'RESOLVED',    label: 'Resolved' },
]

export default function MapPage() {
  const navigate = useNavigate()
  const { fix } = useGeolocation({ auto: true })
  const potholes = usePotholes({ limit: 300 })
  const officers  = useOfficers()

  const [severityFilter, setSeverityFilter] = useState<string[]>([])
  const [statusFilter,   setStatusFilter]   = useState<PotholeStatus | 'OPEN' | 'ALL'>('ALL')
  const [search,         setSearch]         = useState('')
  const [showHeatmap,    setShowHeatmap]    = useState(false)
  const [filtersOpen,    setFiltersOpen]    = useState(false)
  const [selected,       setSelected]       = useState<Pothole | null>(null)

  const filtered = useMemo(() => {
    let rows = potholes.data ?? []
    if (severityFilter.length > 0)
      rows = rows.filter((p) => severityFilter.includes(p.severity))
    if (statusFilter === 'OPEN')
      rows = rows.filter((p) => p.status !== 'RESOLVED')
    else if (statusFilter !== 'ALL')
      rows = rows.filter((p) => p.status === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(
        (p) => p.incident_code.toLowerCase().includes(q) || (p.address ?? '').toLowerCase().includes(q),
      )
    }
    return rows
  }, [potholes.data, severityFilter, statusFilter, search])

  const heatCells = useHeatmapGrid(filtered, 0.01)

  return (
    /* Full-viewport container — sits on top of AppShell's <main> but breaks out */
    <div className="fixed inset-0 z-0">

      {/* ── Full-screen satellite map ── */}
      <MapView
        className="absolute inset-0 rounded-none"
        style={{ height: '100%', minHeight: '100vh' }}
        potholes={filtered}
        officers={showHeatmap ? [] : (officers.data ?? [])}
        userFix={fix}
        heatmap={showHeatmap}
        heatCells={heatCells}
        selectedId={selected?.id ?? null}
        onSelect={setSelected}
        interactive
      />

      {/* ── TOP BAR overlay ── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex flex-col gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">

        {/* Title + actions row */}
        <div className="pointer-events-auto flex items-center gap-2">
          {/* Back button */}
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-xl transition hover:bg-black/75"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>

          <div className="flex min-w-0 flex-1 flex-col leading-tight rounded-2xl border border-white/12 bg-black/55 px-3.5 py-2 backdrop-blur-xl">
            <span className="text-[13px] font-semibold text-white">Incident Map</span>
            <span className="text-[10px] text-white/50">
              {filtered.length} incident{filtered.length === 1 ? '' : 's'} shown
            </span>
          </div>

          {/* Globe button */}
          <button
            type="button"
            onClick={() => navigate('/globe')}
            aria-label="3D globe view"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-xl transition hover:bg-black/75"
          >
            <Globe2 className="h-4 w-4" aria-hidden />
          </button>

          {/* Filters button */}
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label="Filters"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-xl transition hover:bg-black/75"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Search bar */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/12 bg-black/55 px-3 backdrop-blur-xl">
          <Search className="h-4 w-4 shrink-0 text-white/40" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search incident ID or location…"
            aria-label="Search incidents"
            className="h-10 w-full bg-transparent text-[13px] text-white placeholder:text-white/30 focus:outline-none"
          />
          {search ? (
            <button type="button" onClick={() => setSearch('')} className="text-white/40 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {/* Legend */}
        <div className="pointer-events-auto">
          <MapLegend showHeatmap={showHeatmap} onToggleHeatmap={setShowHeatmap} />
        </div>
      </div>

      {/* ── BOTTOM quick-filter chips ── */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000] flex flex-col gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex gap-1.5 overflow-x-auto pb-1">
          {SEVERITY_FILTERS.map((sev) => {
            const active = severityFilter.includes(sev)
            return (
              <button
                key={sev}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setSeverityFilter((cur) =>
                    active ? cur.filter((s) => s !== sev) : [...cur, sev],
                  )
                }
                className={cn(
                  'shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold backdrop-blur-xl transition',
                  active
                    ? 'border-aurora-400/60 bg-aurora-400/25 text-aurora-200'
                    : 'border-white/15 bg-black/50 text-white/60 hover:text-white',
                )}
              >
                {sev}
              </button>
            )
          })}
          {(severityFilter.length > 0 || statusFilter !== 'ALL') ? (
            <button
              type="button"
              onClick={() => { setSeverityFilter([]); setStatusFilter('ALL') }}
              className="shrink-0 rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-[11px] text-white/50 backdrop-blur-xl"
            >
              <RotateCcw className="inline-block h-3 w-3 mr-1" />
              Reset
            </button>
          ) : null}
        </div>
      </div>

      {/* ── FILTERS sheet ── */}
      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <Button fullWidth onClick={() => setFiltersOpen(false)}>
            Show {filtered.length} incidents
          </Button>
        }
      >
        <div className="space-y-4 pb-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-white/50 uppercase">Status</p>
            <div className="grid grid-cols-2 gap-1.5">
              {STATUS_FILTERS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatusFilter(opt.value)}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-[12px] font-medium',
                    statusFilter === opt.value
                      ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
                      : 'border-white/12 text-white/55',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-white/50 uppercase">Severity</p>
            <div className="flex flex-wrap gap-1.5">
              {SEVERITY_FILTERS.map((sev) => {
                const active = severityFilter.includes(sev)
                return (
                  <button
                    key={sev}
                    type="button"
                    onClick={() =>
                      setSeverityFilter((cur) =>
                        active ? cur.filter((s) => s !== sev) : [...cur, sev],
                      )
                    }
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[11px] font-semibold',
                      active
                        ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
                        : 'border-white/12 text-white/55',
                    )}
                  >
                    {sev}
                  </button>
                )
              })}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-white/40">
            Filters apply to the map, the heatmap, and the incident count.
          </p>
        </div>
      </Sheet>

      {/* ── DETAIL panel ── */}
      <AnimatePresence>
        {selected ? (
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 28 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            className="absolute inset-x-3 bottom-20 z-[1100] mx-auto max-w-md lg:bottom-8"
          >
            <GlassCard className="space-y-3 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[13px] font-semibold text-white">
                    POTHOLE #{selected.incident_code}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <SeverityBadge severity={selected.severity} size="sm" />
                    <StatusBadge status={selected.status} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <PriorityBadge level={selected.priority_level} score={selected.priority_score} />
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    aria-label="Close"
                    className="text-white/40 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <MeasurementGrid pothole={selected} compact />

              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <div className="glass rounded-2xl px-3 py-2">
                  <p className="text-[10px] tracking-wider text-white/45 uppercase">Detected</p>
                  <p className="mt-0.5 font-semibold text-white">{timeAgo(selected.created_at)}</p>
                </div>
                <div className="glass rounded-2xl px-3 py-2">
                  <p className="text-[10px] tracking-wider text-white/45 uppercase">Depth</p>
                  <p className="mt-0.5 font-semibold text-white">{formatCm(selected.depth_cm)}</p>
                </div>
              </div>

              <GlassCard padded={false} className="p-3">
                <p className="flex items-start gap-2 text-[12px] text-white/60">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {selected.address ?? `${selected.latitude.toFixed(5)}, ${selected.longitude.toFixed(5)}`}
                </p>
              </GlassCard>

              <div className="flex flex-wrap gap-1.5">
                <Chip tone={selected.depth_method === 'VISION_ESTIMATE' ? 'warn' : 'success'}>
                  {selected.depth_method === 'VISION_ESTIMATE' ? 'Est. depth' : 'Measured'}
                </Chip>
                <Chip>{selected.zone ?? 'Unzoned'}</Chip>
              </div>

              <Button fullWidth onClick={() => navigate(`/reports/${selected.id}`)}>
                Open full report
              </Button>
            </GlassCard>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
