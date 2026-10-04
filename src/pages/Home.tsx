import { motion } from 'framer-motion'
import { ArrowRight, Bell, CloudOff, MapPin, ScanLine, Sparkles, WifiOff } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen, TopBar } from '@/components/layout/AppShell'
import { StatGrid } from '@/components/dashboard/DashboardComponents'
import { PotholeCard } from '@/components/pothole/PotholeComponents'
import { Button, EmptyState, GlassCard, SectionTitle, Skeleton } from '@/components/ui/primitives'
import { useAuth } from '@/context/AuthContext'
import { useDashboardStats, usePotholes } from '@/hooks/useData'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { cn, greeting, haversineKm } from '@/lib/utils'

/**
 * Citizen dashboard (spec section 16).
 *
 * Every figure comes straight from the live Supabase repository — nothing is
 * simulated or fabricated.
 */
export default function Home() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { fix, isLowAccuracy } = useGeolocation({ auto: true })
  const stats = useDashboardStats()
  const potholes = usePotholes({ limit: 120 })
  const { online, queued } = useOnlineStatus()

  const nearby = useMemo(() => {
    const rows = potholes.data ?? []
    const withDistance = rows.map((pothole) => ({
      pothole,
      distanceKm: fix
        ? haversineKm(
            { latitude: fix.latitude, longitude: fix.longitude },
            { latitude: pothole.latitude, longitude: pothole.longitude },
          )
        : null,
    }))

    const unresolved = withDistance.filter((row) => row.pothole.status !== 'RESOLVED')
    const pool = unresolved.length > 0 ? unresolved : withDistance

    return pool
      .sort((a, b) => {
        if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm
        return b.pothole.priority_score - a.pothole.priority_score
      })
      .slice(0, 5)
  }, [potholes.data, fix])

  return (
    <>
      <TopBar
        title={`${greeting()}, ${profile?.full_name?.split(' ')[0] ?? 'there'}`}
        subtitle="Road Safety Dashboard"
        large
        right={
          <button
            type="button"
            onClick={() => navigate('/reports')}
            aria-label="Open notifications and reports"
            className="glass-pill relative inline-flex h-10 w-10 items-center justify-center rounded-full text-white"
          >
            <Bell className="h-4 w-4" aria-hidden />
            {stats.data && stats.data.critical > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {stats.data.critical}
              </span>
            ) : null}
          </button>
        }
      />

      <Screen className="pt-2">
        {/* ---------------------------------------------------------- notices */}
        <div className="space-y-3">

          {!online || queued > 0 ? (
            <div
              className={cn(
                'flex items-start gap-2.5 rounded-2xl border px-3.5 py-2.5',
                online ? 'border-sky-400/30 bg-sky-500/12' : 'border-amber-400/30 bg-amber-500/12',
              )}
              role="status"
            >
              {online ? (
                <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden />
              ) : (
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-white/90">
                  {online ? 'Syncing queued reports' : 'Offline'}
                </p>
                <p className="text-[11px] leading-snug text-white/60">
                  {online
                    ? `${queued} report${queued === 1 ? '' : 's'} saved on this device will upload automatically.`
                    : `Report saved locally. ${queued} item${queued === 1 ? '' : 's'} will upload automatically when your connection returns.`}
                </p>
              </div>
            </div>
          ) : null}

          {isLowAccuracy ? (
            <p className="rounded-2xl border border-amber-400/25 bg-amber-500/10 px-3.5 py-2 text-[11px] leading-snug text-amber-100/85">
              Location accuracy is low ({Math.round(fix?.accuracy ?? 0)} m). Move outdoors or enable
              precise location for an exact fix.
            </p>
          ) : null}
        </div>

        {/* ------------------------------------------------------------ stats */}
        <StatGrid stats={stats.data} loading={stats.loading} />

        {/* -------------------------------------------------- desktop split */}
        <div className="space-y-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
          <div className="space-y-4 lg:col-span-7">
            {/* CTA */}
            <motion.button
              type="button"
              onClick={() => navigate('/scan')}
              whileTap={{ scale: 0.985 }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 26 }}
              className="relative w-full overflow-hidden rounded-ios bg-gradient-to-br from-aurora-400 via-aurora-500 to-aurora-600 p-[1.5px] text-left shadow-[0_22px_60px_-22px_rgba(76,201,240,0.95)]"
            >
              <span className="relative flex items-center justify-between gap-4 rounded-[1.3rem] bg-ink-950/70 px-5 py-5 backdrop-blur-xl">
                <span className="flex items-center gap-3.5">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-aurora-400 to-aurora-600 text-ink-950">
                    <ScanLine className="h-6 w-6" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-[17px] font-semibold tracking-tight text-white lg:text-[18px]">
                      START AI SCAN
                    </span>
                    <span className="block text-[11px] text-white/55">
                      Detect, measure and report in one tap
                    </span>
                  </span>
                </span>
                <ArrowRight className="h-5 w-5 text-aurora-300" aria-hidden />
              </span>
            </motion.button>

            <GlassCard className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-aurora-400/25 to-aurora-600/25">
                <Sparkles className="h-4 w-4 text-aurora-300" aria-hidden />
              </span>
              <div>
                <p className="text-[12px] font-semibold text-white/90">How measurement works</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-white/50">
                  Vision models reason about the scene, but a single photo cannot yield absolute
                  depth. RoadGuard reports depth as an{' '}
                  <strong className="text-white/70">estimate</strong> with an explicit confidence
                  value, and upgrades to a measured depth only when real depth samples or a scale
                  reference are available.
                </p>
              </div>
            </GlassCard>
          </div>

          {/* nearby */}
          <div className="lg:col-span-5">
            <SectionTitle
              title="Nearby issues"
              action={
                <button
                  type="button"
                  onClick={() => navigate('/map')}
                  className="text-[12px] font-medium text-aurora-300 hover:text-aurora-400"
                >
                  View map
                </button>
              }
            />

            {potholes.loading ? (
              <div className="space-y-2.5">
                {[0, 1, 2].map((index) => (
                  <Skeleton key={index} className="h-[118px]" />
                ))}
              </div>
            ) : nearby.length === 0 ? (
              <GlassCard>
                <EmptyState
                  icon={<MapPin className="h-5 w-5" />}
                  title="No incidents recorded yet"
                  description="Run an AI scan to log the first pothole in this area."
                  action={
                    <Button size="sm" onClick={() => navigate('/scan')}>
                      Open scanner
                    </Button>
                  }
                />
              </GlassCard>
            ) : (
              <div className="space-y-2.5">
                {nearby.map((row, index) => (
                  <PotholeCard
                    key={row.pothole.id}
                    pothole={row.pothole}
                    index={index}
                    distanceKm={row.distanceKm}
                    onSelect={() => navigate(`/reports/${row.pothole.id}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </Screen>
    </>
  )
}
