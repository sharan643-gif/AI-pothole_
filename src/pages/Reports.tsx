import { FileText, Search, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen, TopBar } from '@/components/layout/AppShell'
import { PotholeCard } from '@/components/pothole/PotholeComponents'
import { Button, EmptyState, GlassCard, Segmented, Sheet, Skeleton } from '@/components/ui/primitives'
import { useAuth } from '@/context/AuthContext'
import { useMyReports, usePotholes } from '@/hooks/useData'
import { cn } from '@/lib/utils'
import type { PotholeStatus } from '@/types'

/**
 * Reports list with search and filtering (spec section 54).
 */

type Scope = 'mine' | 'all'

const STATUS_OPTIONS: { value: PotholeStatus | 'ALL' | 'OPEN'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'REPORTED', label: 'Reported' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'UNDER_REPAIR', label: 'Repairing' },
  { value: 'RESOLVED', label: 'Resolved' },
]

const SEVERITY_OPTIONS = [
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
] as const

export default function Reports() {
  const navigate = useNavigate()
  const { userId, profile } = useAuth()

  const [scope, setScope] = useState<Scope>('mine')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<PotholeStatus | 'ALL' | 'OPEN'>('ALL')
  const [severity, setSeverity] = useState<string[]>([])
  const [sort, setSort] = useState<'priority' | 'recent'>('priority')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const mine = useMyReports(scope === 'mine' ? userId : null)
  const all = usePotholes({ limit: 300 }, scope === 'all')

  const source = useMemo(
    () => (scope === 'mine' ? (mine.data ?? []) : (all.data ?? [])),
    [scope, mine.data, all.data],
  )
  const loading = scope === 'mine' ? mine.loading : all.loading

  const filtered = useMemo(() => {
    let rows = [...source]

    if (status === 'OPEN') rows = rows.filter((row) => row.status !== 'RESOLVED')
    else if (status !== 'ALL') rows = rows.filter((row) => row.status === status)

    if (severity.length > 0) rows = rows.filter((row) => severity.includes(row.severity))

    if (search.trim()) {
      const query = search.trim().toLowerCase()
      rows = rows.filter(
        (row) =>
          row.incident_code.toLowerCase().includes(query) ||
          (row.address ?? '').toLowerCase().includes(query) ||
          (row.zone ?? '').toLowerCase().includes(query),
      )
    }

    rows.sort((a, b) =>
      sort === 'priority'
        ? b.priority_score - a.priority_score
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )

    return rows
  }, [source, status, severity, search, sort])

  const activeFilterCount =
    (status === 'ALL' ? 0 : 1) + severity.length + (search.trim() ? 1 : 0)

  return (
    <>
      <TopBar
        title="Reports"
        subtitle={`${filtered.length} record${filtered.length === 1 ? '' : 's'}`}
        right={
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label="Open filters"
            className={cn(
              'glass-pill relative inline-flex h-9 w-9 items-center justify-center rounded-full text-white',
              activeFilterCount > 0 && 'ring-1 ring-aurora-400/60',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            {activeFilterCount > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-aurora-500 text-[9px] font-bold text-ink-950">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        }
      />

      <Screen className="pt-3">
        <Segmented
          ariaLabel="Report scope"
          value={scope}
          onChange={(value: Scope) => setScope(value)}
          options={[
            { value: 'mine', label: 'My reports' },
            { value: 'all', label: 'All incidents' },
          ]}
        />

        <div className="flex items-center gap-2 rounded-2xl border border-white/12 bg-white/6 px-3">
          <Search className="h-4 w-4 shrink-0 text-white/35" aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search ID, address or zone"
            aria-label="Search reports"
            className="h-11 w-full bg-transparent text-[13px] text-white placeholder:text-white/25 focus:outline-none"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="text-white/40 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="flex gap-1.5">
          {(['priority', 'recent'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSort(option)}
              aria-pressed={sort === option}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[11px] font-semibold transition',
                sort === option
                  ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
                  : 'border-white/12 text-white/50',
              )}
            >
              {option === 'priority' ? 'Highest priority' : 'Most recent'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2.5">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-[118px]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <GlassCard>
            <EmptyState
              icon={<FileText className="h-5 w-5" />}
              title={scope === 'mine' ? 'No reports yet' : 'No incidents match these filters'}
              description={
                scope === 'mine'
                  ? 'Scan a road surface to file your first pothole report.'
                  : 'Try clearing the filters or switching scope.'
              }
              action={
                scope === 'mine' ? (
                  <Button size="sm" onClick={() => navigate('/scan')}>
                    Open scanner
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setStatus('ALL')
                      setSeverity([])
                      setSearch('')
                    }}
                  >
                    Clear filters
                  </Button>
                )
              }
            />
          </GlassCard>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((pothole, index) => (
              <PotholeCard
                key={pothole.id}
                pothole={pothole}
                index={index}
                onSelect={() => navigate(`/reports/${pothole.id}`)}
              />
            ))}
          </div>
        )}

        {profile?.role !== 'CITIZEN' ? (
          <Button variant="secondary" fullWidth onClick={() => navigate('/officer')}>
            Open officer dashboard
          </Button>
        ) : null}
      </Screen>

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filter reports"
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                setStatus('ALL')
                setSeverity([])
                setSearch('')
              }}
            >
              Reset
            </Button>
            <Button fullWidth onClick={() => setFiltersOpen(false)}>
              Apply
            </Button>
          </div>
        }
      >
        <div className="space-y-4 pb-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
              Status
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatus(option.value)}
                  className={cn(
                    'rounded-xl border px-2 py-2 text-[11px] font-medium',
                    status === option.value
                      ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
                      : 'border-white/12 text-white/55',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
              Severity
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SEVERITY_OPTIONS.map((option) => {
                const active = severity.includes(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() =>
                      setSeverity((current) =>
                        active
                          ? current.filter((value) => value !== option.value)
                          : [...current, option.value],
                      )
                    }
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-[11px] font-semibold',
                      active
                        ? 'border-aurora-400/60 bg-aurora-400/20 text-aurora-200'
                        : 'border-white/12 text-white/55',
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </Sheet>
    </>
  )
}
