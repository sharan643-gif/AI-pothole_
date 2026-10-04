import { motion } from 'framer-motion'
import {
  Bell,
  CheckCircle2,
  Database,
  Info,
  LogOut,
  MapPinned,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  UserCog,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Screen, TopBar } from '@/components/layout/AppShell'
import { Button, Chip, GlassCard, SectionTitle, Skeleton } from '@/components/ui/primitives'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useNotifications } from '@/hooks/useData'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useSystemHealth } from '@/hooks/useSystemHealth'
import { APP_NAME, APP_TAGLINE, NOTIFICATION_TYPE_META } from '@/lib/constants'
import { APP_VERSION, CAPABILITIES, HAS_SUPABASE_CREDENTIALS } from '@/lib/config'
import { cn, initials, timeAgo } from '@/lib/utils'
import { getRepository } from '@/services'

export default function Profile() {
  const navigate = useNavigate()
  const toast = useToast()
  const { profile, role, signOut } = useAuth()
  const notifications = useNotifications(profile?.id ?? null)
  const { queued, flush, online } = useOnlineStatus()
  const health = useSystemHealth()
  const [refreshing, setRefreshing] = useState(false)

  const handleSignOut = useCallback(async () => {
    await signOut()
    navigate('/login', { replace: true })
  }, [navigate, signOut])

  const handleFlush = useCallback(async () => {
    setRefreshing(true)
    try {
      const result = await flush()
      if (!result) {
        toast.info('Nothing to sync', 'The offline queue is empty.')
      } else if (result.uploaded > 0) {
        toast.success('Reports synced', `${result.uploaded} queued report(s) uploaded.`)
      } else {
        toast.error('Sync failed', `${result.failed} report(s) could not be uploaded.`)
      }
    } finally {
      setRefreshing(false)
    }
  }, [flush, toast])

  const markRead = useCallback(
    async (id: string) => {
      try {
        await getRepository().markNotificationRead(id)
        await notifications.refresh()
      } catch {
        /* non-critical */
      }
    },
    [notifications],
  )

  const unread = (notifications.data ?? []).filter((item) => !item.read).length

  return (
    <>
      <TopBar
        title="Profile"
        subtitle={profile?.email ?? 'Not signed in'}
        right={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleSignOut()}
            icon={<LogOut className="h-4 w-4" />}
          >
            Sign out
          </Button>
        }
      />

      <Screen className="pt-3">
        {/* ------------------------------------------------------------ identity */}
        <GlassCard className="flex items-center gap-3.5">
          <span className="flex h-14 w-14 items-center justify-center rounded-[1.15rem] bg-gradient-to-br from-aurora-400 to-aurora-600 text-[19px] font-bold text-ink-950">
            {initials(profile?.full_name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-white">
              {profile?.full_name ?? 'Guest user'}
            </p>
            <p className="truncate text-[12px] text-white/50">{profile?.email ?? '—'}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Chip tone={role === 'CITIZEN' ? 'neutral' : 'info'}>{role}</Chip>
            </div>
          </div>
        </GlassCard>

        {/* ----------------------------------------------------------- shortcuts */}
        <div className="grid grid-cols-2 gap-2.5">
          {role !== 'CITIZEN' ? (
            <button
              type="button"
              onClick={() => navigate('/officer')}
              className="glass sheen rounded-ios px-3.5 py-3 text-left transition hover:bg-white/10"
            >
              <UserCog className="h-4 w-4 text-aurora-400" aria-hidden />
              <p className="mt-2 text-[12px] font-semibold text-white">Officer dashboard</p>
              <p className="text-[10px] text-white/45">Assignments & repairs</p>
            </button>
          ) : null}
          {role === 'ADMIN' || role === 'SUPERVISOR' ? (
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="glass sheen rounded-ios px-3.5 py-3 text-left transition hover:bg-white/10"
            >
              <MapPinned className="h-4 w-4 text-aurora-400" aria-hidden />
              <p className="mt-2 text-[12px] font-semibold text-white">Admin console</p>
              <p className="text-[10px] text-white/45">Analytics & insights</p>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => navigate('/reports')}
            className="glass sheen rounded-ios px-3.5 py-3 text-left transition hover:bg-white/10"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
            <p className="mt-2 text-[12px] font-semibold text-white">My reports</p>
            <p className="text-[10px] text-white/45">Track filed incidents</p>
          </button>
        </div>

        {/* ------------------------------------------------------- offline queue */}
        <GlassCard className="space-y-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-aurora-400" aria-hidden />
            <h3 className="text-[13px] font-semibold text-white">Offline queue</h3>
            <span className="ml-auto text-[11px] text-white/50">{queued} pending</span>
          </div>
          <p className="text-[11px] leading-relaxed text-white/50">
            Captures taken without a connection are stored in this device&apos;s IndexedDB and
            uploaded automatically when the network returns. Nothing is discarded silently.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={refreshing}
              disabled={!online || queued === 0}
              onClick={() => void handleFlush()}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Sync now
            </Button>
            {queued > 0 ? (
              <Chip tone="warn">{queued} queued</Chip>
            ) : (
              <Chip tone="success">Queue empty</Chip>
            )}
          </div>
        </GlassCard>

        {/* ------------------------------------------------------ notifications */}
        <div>
          <SectionTitle
            title="Notifications"
            action={
              unread > 0 ? <Chip tone="info">{unread} unread</Chip> : null
            }
          />
          {notifications.loading ? (
            <div className="space-y-2">
              {[0, 1].map((index) => (
                <Skeleton key={index} className="h-16" />
              ))}
            </div>
          ) : (notifications.data ?? []).length === 0 ? (
            <GlassCard className="flex items-start gap-3">
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-white/40" aria-hidden />
              <p className="text-[11px] leading-relaxed text-white/50">
                No notifications yet. Reporting an incident files it, dispatches an officer and
                pushes every status change back here.
              </p>
            </GlassCard>
          ) : (
            <ul className="space-y-2">
              {(notifications.data ?? []).slice(0, 12).map((item, index) => (
                <motion.li
                  key={item.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      void markRead(item.id)
                      if (item.pothole_id) navigate(`/reports/${item.pothole_id}`)
                    }}
                    className={cn(
                      'glass w-full rounded-ios px-3.5 py-3 text-left transition hover:bg-white/10',
                      !item.read && 'ring-1 ring-aurora-400/30',
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <span aria-hidden className="mt-0.5 text-[14px]">
                        {NOTIFICATION_TYPE_META[item.type]?.icon ?? '🔔'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-semibold text-white/90">{item.title}</p>
                        <p className="truncate text-[11px] text-white/50">{item.message}</p>
                      </div>
                      <span className="shrink-0 text-[10px] text-white/35">
                        {timeAgo(item.created_at)}
                      </span>
                    </div>
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
        </div>

        {/* -------------------------------------------------- connection health */}
        <div>
          <SectionTitle
            title="Connection health"
            action={
              <Button
                variant="ghost"
                size="sm"
                loading={health.running}
                onClick={() => void health.run()}
                icon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                Re-check
              </Button>
            }
          />
          {health.checks ? (
            <GlassCard className="divide-y divide-white/6">
              <p className="pb-1 text-[11px] text-white/45">
                {health.okCount === health.total
                  ? 'Everything the app depends on is live.'
                  : `${health.total - health.okCount} of ${health.total} checks need attention.`}
              </p>
              {health.checks.map((check) => (
                <div key={check.key} className="flex items-center gap-3 py-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      check.state === 'ok' ? 'bg-emerald-400' : 'bg-red-400',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-white/90">{check.label}</p>
                    <p className="truncate text-[10.5px] text-white/45">{check.detail}</p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 text-[10px] font-semibold tracking-wider uppercase',
                      check.state === 'ok' ? 'text-emerald-300' : 'text-red-300',
                    )}
                  >
                    {check.state === 'ok' ? 'Live' : 'Issue'}
                  </span>
                </div>
              ))}
            </GlassCard>
          ) : (
            <Skeleton className="h-28" />
          )}
        </div>

        {/* ---------------------------------------------------------- settings */}
        <div>
          <SectionTitle title="System" />
          <GlassCard>
            <dl className="divide-y divide-white/6">
              <Row
                icon={<Database className="h-3.5 w-3.5" />}
                label="Backend"
                value={HAS_SUPABASE_CREDENTIALS ? 'Supabase connected' : 'Not configured'}
              />
              <Row
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="Mode"
                value={HAS_SUPABASE_CREDENTIALS ? 'LIVE' : 'OFFLINE'}
              />
              <Row
                icon={<Shield className="h-3.5 w-3.5" />}
                label="Realtime"
                value={CAPABILITIES.realtime ? 'Enabled' : 'Off'}
              />
              <Row
                icon={<MapPinned className="h-3.5 w-3.5" />}
                label="Routing"
                value={CAPABILITIES.routing ? 'Mapbox' : 'Distance estimate'}
              />
              <Row icon={<Info className="h-3.5 w-3.5" />} label="Version" value={APP_VERSION} />
            </dl>
          </GlassCard>
        </div>

        <GlassCard className="space-y-2">
          <p className="text-[12px] font-semibold text-white/85">{APP_NAME}</p>
          <p className="text-[11px] text-white/45">{APP_TAGLINE}</p>
          <p className="text-[10px] leading-relaxed text-white/40">
            Secrets such as the Gemini API key and the service-role key never reach this browser.
            All AI calls and privileged writes run inside Supabase Edge Functions, and every table
            is protected by Row Level Security.
          </p>
          <div className="flex items-center gap-1.5 pt-1">
            <Trash2 className="h-3 w-3 text-white/25" aria-hidden />
            <span className="text-[10px] text-white/30">
              Sessions are stored by Supabase Auth and persist across restarts.
            </span>
          </div>
        </GlassCard>
      </Screen>
    </>
  )
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="flex items-center gap-2 text-[12px] text-white/55">
        <span className="text-white/35">{icon}</span>
        {label}
      </dt>
      <dd className="text-[12px] font-semibold text-white">{value}</dd>
    </div>
  )
}
