import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  ChevronLeft,
  FileText,
  Globe2,
  Home,
  LogOut,
  Map as MapIcon,
  Radio,
  ScanLine,
  User,
  Wrench,
} from 'lucide-react'
import { type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { AmbientBackdrop, LiquidGlass } from '@/components/ui/LiquidGlass'
import { useAuth } from '@/context/AuthContext'
import { APP_NAME, APP_TAGLINE } from '@/lib/constants'
import { cn, initials } from '@/lib/utils'
import type { UserRole } from '@/types'

/* ------------------------------------------------------------------ *
 * Canvas
 *
 * Full-bleed on phones. On desktop it becomes a centred glass surface
 * floating over the ambient backdrop — no phone mock-up, a real layout.
 * ------------------------------------------------------------------ */

const CANVAS_WIDTHS = {
  sm: 'lg:max-w-md',
  md: 'lg:max-w-2xl',
  lg: 'lg:max-w-4xl',
  xl: 'lg:max-w-6xl',
  full: 'lg:max-w-none',
} as const

export function Canvas({
  children,
  width = 'full',
  panel = false,
  className,
}: {
  children: ReactNode
  width?: keyof typeof CANVAS_WIDTHS
  /** Wrap the content in a liquid-glass surface on desktop. */
  panel?: boolean
  className?: string
}) {
  return (
    <div className="relative flex h-svh w-full justify-center overflow-hidden lg:h-screen lg:p-5">
      <AmbientBackdrop />
      <div
        className={cn(
          'relative z-10 flex min-h-0 w-full flex-col',
          CANVAS_WIDTHS[width],
          // The material is applied unconditionally; on phones the camera view
          // paints over it opaquely, and the desktop rim only appears at lg+.
          panel && 'liquid border-0 lg:overflow-hidden lg:border lg:border-white/10 lg:rounded-[2rem]',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Navigation model
 * ------------------------------------------------------------------ */

interface NavItem {
  to: string
  label: string
  hint: string
  icon: typeof Home
}

const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Home', hint: 'Safety dashboard', icon: Home },
  { to: '/scan', label: 'Scan', hint: 'AI road analysis', icon: ScanLine },
  { to: '/scan/live', label: 'Live', hint: 'Real-time detection', icon: Radio },
  { to: '/globe', label: 'Globe', hint: '3D world view', icon: Globe2 },
  { to: '/map', label: 'Map', hint: 'Incident map', icon: MapIcon },
  { to: '/reports', label: 'Reports', hint: 'All incidents', icon: FileText },
  { to: '/profile', label: 'Profile', hint: 'Account & settings', icon: User },
]

const ROLE_NAV: Partial<Record<UserRole, NavItem[]>> = {
  OFFICER: [{ to: '/officer', label: 'Officer', hint: 'Assignments', icon: Wrench }],
  SUPERVISOR: [
    { to: '/officer', label: 'Officer', hint: 'Assignments', icon: Wrench },
    { to: '/admin', label: 'Admin', hint: 'Analytics console', icon: Activity },
  ],
  ADMIN: [{ to: '/admin', label: 'Admin', hint: 'Analytics console', icon: Activity }],
}

function useNavItems(): NavItem[] {
  const { role } = useAuth()
  return [...PRIMARY_NAV, ...(ROLE_NAV[role] ?? [])]
}

function isActivePath(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname.startsWith(to)
}

/* ------------------------------------------------------------------ *
 * Desktop sidebar rail
 * ------------------------------------------------------------------ */

function DesktopNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { profile, role, signOut } = useAuth()
  const items = useNavItems()

  return (
    <header className="relative z-20 hidden w-full shrink-0 lg:block">
      <LiquidGlass
        deep
        className="flex items-center gap-2 overflow-hidden rounded-full py-1.5 pr-2 pl-2.5"
      >
        {/* brand */}
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex shrink-0 items-center gap-2.5 rounded-full px-1 py-1 text-left transition hover:bg-white/5"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.8rem] bg-gradient-to-br from-aurora-400 to-aurora-600 text-[14px] font-bold text-ink-950 shadow-[0_10px_30px_-12px_rgba(76,201,240,0.9)]">
            RG
          </span>
          <span className="hidden leading-tight xl:block">
            <span className="block text-[13px] font-semibold tracking-tight text-white">
              {APP_NAME}
            </span>
            <span className="block text-[10px] text-white/45">{APP_TAGLINE}</span>
          </span>
        </button>

        {/* nav pills */}
        <nav
          className="flex min-w-0 flex-1 items-center justify-center gap-0.5 overflow-x-auto"
          aria-label="Primary"
        >
          {items.map((item) => {
            const active = isActivePath(location.pathname, item.to)
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                title={item.hint}
                className={cn(
                  'group relative flex shrink-0 items-center gap-2 rounded-full px-3 py-2 transition-colors',
                  active ? 'text-white' : 'text-white/55 hover:bg-white/6 hover:text-white',
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="desktop-nav-pill"
                    className="absolute inset-0 rounded-full bg-white/12 ring-1 ring-white/15"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                ) : null}
                <Icon className="relative z-10 h-[17px] w-[17px] shrink-0" aria-hidden />
                <span className="relative z-10 text-[12.5px] font-medium whitespace-nowrap">
                  {item.label}
                </span>
              </NavLink>
            )
          })}
        </nav>

        {/* primary action */}
        <motion.button
          type="button"
          onClick={() => navigate('/scan')}
          whileTap={{ scale: 0.98 }}
          className="group relative flex shrink-0 items-center gap-2 overflow-hidden rounded-full bg-gradient-to-br from-aurora-400 to-aurora-600 px-3.5 py-2 shadow-[0_14px_34px_-16px_rgba(76,201,240,0.95)]"
        >
          <span className="absolute inset-0 bg-gradient-to-t from-black/10 to-white/20 opacity-0 transition-opacity group-hover:opacity-100" />
          <ScanLine className="relative h-4 w-4 text-ink-950" aria-hidden />
          <span className="relative text-[12.5px] font-semibold whitespace-nowrap text-ink-950">
            Start AI Scan
          </span>
        </motion.button>

        {/* user */}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-semibold text-white ring-1 ring-white/12">
            {initials(profile?.full_name)}
          </span>
          <span className="hidden min-w-0 leading-tight 2xl:block">
            <span className="block max-w-[140px] truncate text-[12px] font-medium text-white">
              {profile?.full_name ?? 'Guest user'}
            </span>
            <span className="block text-[9.5px] tracking-wider text-white/45 uppercase">
              {role}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void signOut().then(() => navigate('/login', { replace: true }))}
            aria-label="Sign out"
            title="Sign out"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/55 transition hover:bg-white/8 hover:text-white"
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </LiquidGlass>
    </header>
  )
}

/* ------------------------------------------------------------------ *
 * Top bar
 * ------------------------------------------------------------------ */

export function TopBar({
  title,
  subtitle,
  back,
  onBack,
  right,
  large,
}: {
  title: string
  subtitle?: string
  /** Force the back control on/off. Defaults to on for every non-root screen. */
  back?: boolean
  onBack?: () => void
  right?: ReactNode
  large?: boolean
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // Every screen can step back except the dashboard, which is the tab root —
  // a back press there would leave the app rather than navigate within it.
  const showBack = back ?? pathname !== '/'

  return (
    <header className="sticky top-0 z-40 border-b border-white/8 bg-ink-950/45 px-4 pt-2 pb-3 backdrop-blur-2xl lg:px-8 lg:pt-5 lg:pb-4">
      <div className="mx-auto flex w-full max-w-[1180px] items-center gap-2">
        {showBack ? (
          <button
            type="button"
            onClick={onBack ?? (() => navigate(-1))}
            aria-label="Go back"
            className="-ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-aurora-400 transition hover:bg-white/8"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1
            className={cn(
              'truncate font-semibold tracking-tight text-white',
              large ? 'text-[26px] lg:text-[30px]' : 'text-[17px] lg:text-[21px]',
            )}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="truncate text-[12px] text-white/50 lg:text-[13px]">{subtitle}</p>
          ) : null}
        </div>
        {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ *
 * Floating tab bar — phones only
 * ------------------------------------------------------------------ */

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/scan', label: 'Scan', icon: ScanLine },
  { to: '/scan/live', label: 'Live', icon: Radio },
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/profile', label: 'Me', icon: User },
] as const

export function FloatingNav() {
  const location = useLocation()
  const active =
    NAV_ITEMS.find((item) => isActivePath(location.pathname, item.to))?.to ?? '/'

  return (
    <nav
      aria-label="Tab bar"
      className="pointer-events-none sticky bottom-0 z-40 px-3 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className="liquid pointer-events-auto relative mx-auto flex max-w-md items-center justify-between gap-0.5 overflow-hidden rounded-[1.6rem] px-1.5 py-1.5 shadow-[0_18px_50px_-16px_rgba(0,0,0,0.85)]">
        {NAV_ITEMS.map((item) => {
          const isActive = item.to === active
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-2 text-[10px] font-medium transition-colors',
                isActive ? 'text-ink-950' : 'text-white/55 hover:text-white',
              )}
            >
              <AnimatePresence initial={false}>
                {isActive ? (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-2xl bg-white"
                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                  />
                ) : null}
              </AnimatePresence>
              <Icon className="relative z-10 h-[18px] w-[18px]" aria-hidden />
              <span className="relative z-10 tracking-tight">{item.label}</span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}

/* ------------------------------------------------------------------ *
 * Banners & branding
 * ------------------------------------------------------------------ */

export function BrandHeader() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-aurora-400 to-aurora-600 text-[15px] font-bold text-ink-950">
        RG
      </div>
      <div className="leading-tight">
        <p className="text-[13px] font-semibold tracking-tight text-white">{APP_NAME}</p>
        <p className="text-[10px] text-white/45">{APP_TAGLINE}</p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Shell & screen
 * ------------------------------------------------------------------ */

export function AppShell({ children, nav = true }: { children: ReactNode; nav?: boolean }) {
  return (
    <div className="relative flex h-svh w-full flex-col overflow-hidden lg:h-screen lg:gap-3.5 lg:p-4">
      <AmbientBackdrop />
      {nav ? <DesktopNav /> : null}

      <div
        className={cn(
          'liquid relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
          'border-0 lg:rounded-[1.75rem] lg:border lg:border-white/10',
        )}
      >
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</main>
        {nav ? <FloatingNav /> : null}
      </div>
    </div>
  )
}

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-full flex-col gap-4 px-4 pt-4 pb-6',
        'lg:mx-auto lg:w-full lg:max-w-[1180px] lg:gap-5 lg:px-8 lg:pt-7 lg:pb-10',
        className,
      )}
    >
      {children}
    </div>
  )
}
