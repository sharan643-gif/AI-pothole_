import { AnimatePresence, motion } from 'framer-motion'
import { Globe2, Loader2, MapPin, RotateCcw, UserPlus, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '@/components/layout/AppShell'
import { GlobeLegend, GlobeView } from '@/components/globe/GlobeView'
import { SeverityBadge, StatusBadge } from '@/components/pothole/PotholeComponents'
import { Button, Chip, GlassCard } from '@/components/ui/primitives'
import { useToast } from '@/context/ToastContext'
import { usePotholes } from '@/hooks/useData'
import { AppError } from '@/lib/errors'
import { cn, formatCm, timeAgo } from '@/lib/utils'
import { getRepository } from '@/services'
import type { Pothole } from '@/types'

/**
 * 3D world incident globe (spec sections 8, 9, 10).
 *
 * Confirmed potholes become geographic incidents on a rotating globe. Selecting
 * a marker opens a glass panel whose actions are all real: "Assign officer"
 * dispatching, "Mark resolved" persisting a status change.
 */
export default function GlobePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const repo = getRepository()
  const potholes = usePotholes({ limit: 400 })

  const [selected, setSelected] = useState<Pothole | null>(null)
  const [busy, setBusy] = useState<'assign' | 'resolve' | null>(null)
  const [autoRotate, setAutoRotate] = useState(true)

  const rows = useMemo(() => potholes.data ?? [], [potholes.data])
  const openCount = useMemo(() => rows.filter((p) => p.status !== 'RESOLVED').length, [rows])
  const criticalCount = useMemo(
    () => rows.filter((p) => p.severity === 'CRITICAL' && p.status !== 'RESOLVED').length,
    [rows],
  )

  const handleAssign = async () => {
    if (!selected) return
    setBusy('assign')
    try {
      const result = await repo.assignOfficer(selected.id)
      if (result.assigned) {
        toast.success(
          'Officer assigned',
          `${result.officer?.full_name ?? 'An officer'} dispatched to ${selected.incident_code}.`,
        )
        await potholes.refresh()
        setSelected(null)
      } else {
        toast.info('No officer available', result.message ?? 'Added to the maintenance queue.')
      }
    } catch (caught) {
      toast.error('Assignment failed', AppError.from(caught).userMessage)
    } finally {
      setBusy(null)
    }
  }

  const handleResolve = async () => {
    if (!selected) return
    setBusy('resolve')
    try {
      await repo.updatePotholeStatus(selected.id, 'RESOLVED')
      toast.success('Marked resolved', `${selected.incident_code} is now resolved.`)
      await potholes.refresh()
      setSelected(null)
    } catch (caught) {
      toast.error('Could not update status', AppError.from(caught).userMessage)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <TopBar
        title="World incident globe"
        subtitle={`${rows.length} incident${rows.length === 1 ? '' : 's'} · ${openCount} open`}
        right={
          <button
            type="button"
            onClick={() => setAutoRotate((value) => !value)}
            aria-pressed={autoRotate}
            aria-label="Toggle globe rotation"
            className={cn(
              'glass-pill inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold',
              autoRotate ? 'text-aurora-300' : 'text-white/60',
            )}
          >
            <RotateCcw
              className={cn('h-3.5 w-3.5', autoRotate && 'animate-spin')}
              style={{ animationDuration: '6s' }}
              aria-hidden
            />
            {autoRotate ? 'Rotating' : 'Paused'}
          </button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-3 pb-4">

        {/* stat strip */}
        <div className="grid grid-cols-3 gap-2">
          <StatTile label="Incidents" value={rows.length} />
          <StatTile label="Open" value={openCount} tone="info" />
          <StatTile label="Critical" value={criticalCount} tone="critical" />
        </div>

        <GlobeLegend />

        {/* globe */}
        <div className="relative min-h-[360px] flex-1 overflow-hidden rounded-ios bg-gradient-to-b from-ink-900 to-ink-950">
          <GlobeView
            className="h-full w-full"
            potholes={rows}
            selectedId={selected?.id ?? null}
            onSelect={(pothole) => setSelected(pothole)}
            autoRotate={autoRotate}
            textureUrl={import.meta.env.VITE_GLOBE_TEXTURE_URL || undefined}
          />

          {potholes.loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-ink-950/60">
              <Loader2 className="h-6 w-6 animate-spin text-aurora-400" aria-hidden />
            </div>
          ) : null}

          {!potholes.loading && rows.length === 0 ? (
            <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center">
              <Globe2 className="mx-auto h-7 w-7 text-white/35" aria-hidden />
              <p className="mt-2 text-[13px] font-semibold text-white/80">No incidents plotted yet</p>
              <p className="mt-1 text-[12px] text-white/50">
                File a scan or live detection and it will appear here.
              </p>
            </div>
          ) : null}

          <p className="absolute inset-x-4 bottom-2 text-center text-[10px] text-white/35">
            Drag to rotate · scroll to zoom · select a marker for details
          </p>
        </div>
      </div>

      {/* detail panel */}
      <AnimatePresence>
        {selected ? (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-md lg:bottom-6"
          >
            <GlassCard className="space-y-3 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[13px] font-semibold text-white">
                    POTHOLE #{selected.incident_code}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <SeverityBadge severity={selected.severity} size="sm" />
                    <StatusBadge status={selected.status} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Close details"
                  className="text-[11px] font-semibold text-white/50 hover:text-white"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label="Width" value={formatCm(selected.width_cm, 0)} />
                <MiniStat label="Length" value={formatCm(selected.length_cm, 0)} />
                <MiniStat
                  label="Depth"
                  value={
                    selected.depth_cm != null
                      ? `${selected.depth_cm} cm`
                      : '—'
                  }
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Chip tone={selected.depth_method === 'VISION_ESTIMATE' ? 'warn' : 'success'}>
                  {selected.depth_method === 'VISION_ESTIMATE' ? 'Estimated depth' : 'Measured depth'}
                </Chip>
                <Chip>
                  {selected.ai_confidence != null
                    ? `${Math.round(selected.ai_confidence * 100)}% confidence`
                    : 'Confidence n/a'}
                </Chip>
                <Chip>{timeAgo(selected.created_at)}</Chip>
              </div>

              <p className="flex items-start gap-2 text-[11px] text-white/55">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {selected.address ??
                  `${selected.latitude.toFixed(5)}, ${selected.longitude.toFixed(5)}`}
              </p>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Globe2 className="h-4 w-4" />}
                  onClick={() => navigate(`/reports/${selected.id}`)}
                >
                  View details
                </Button>
                <Button
                  size="sm"
                  loading={busy === 'assign'}
                  disabled={busy != null || selected.status === 'RESOLVED'}
                  icon={<UserPlus className="h-4 w-4" />}
                  onClick={() => void handleAssign()}
                >
                  Assign officer
                </Button>
                <Button
                  size="sm"
                  variant="success"
                  loading={busy === 'resolve'}
                  disabled={busy != null || selected.status === 'RESOLVED'}
                  icon={<Wrench className="h-4 w-4" />}
                  onClick={() => void handleResolve()}
                >
                  Mark resolved
                </Button>
              </div>
            </GlassCard>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

function StatTile({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'info' | 'critical'
}) {
  const tones = {
    neutral: 'text-white',
    info: 'text-aurora-400',
    critical: 'text-red-400',
  }
  return (
    <GlassCard padded={false} className="px-3 py-2.5">
      <p className="text-[10px] font-medium tracking-wider text-white/45 uppercase">{label}</p>
      <p className={cn('mt-0.5 text-[20px] font-semibold tabular-nums', tones[tone])}>{value}</p>
    </GlassCard>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl px-2 py-2">
      <p className="text-[9px] font-medium tracking-wider text-white/45 uppercase">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-white tabular-nums">{value}</p>
    </div>
  )
}
