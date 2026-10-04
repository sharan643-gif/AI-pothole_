import { AnimatePresence, motion, type HTMLMotionProps } from 'framer-motion'
import { Loader2, X } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ *
 * Surfaces
 * ------------------------------------------------------------------ */

export interface GlassCardProps extends HTMLMotionProps<'div'> {
  padded?: boolean
  glow?: boolean
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(function GlassCard(
  { className, padded = true, glow = false, children, ...rest },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      className={cn(
        'glass sheen relative overflow-hidden rounded-ios',
        padded && 'p-4',
        glow && 'shadow-[0_18px_60px_-20px_rgba(76,201,240,0.45)]',
        className,
      )}
      {...rest}
    >
      {children}
    </motion.div>
  )
})

export function SectionTitle({
  title,
  action,
  className,
}: {
  title: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex items-end justify-between gap-3', className)}>
      <h2 className="text-[15px] font-semibold tracking-tight text-white/90">{title}</h2>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Buttons
 * ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-br from-aurora-400 to-aurora-600 text-ink-950 font-semibold shadow-[0_10px_30px_-10px_rgba(76,201,240,0.8)] hover:brightness-110',
  secondary: 'glass text-white hover:bg-white/12',
  ghost: 'text-white/70 hover:bg-white/8 hover:text-white',
  danger:
    'bg-gradient-to-br from-red-500 to-red-600 text-white font-semibold shadow-[0_10px_30px_-12px_rgba(255,69,58,0.8)]',
  success:
    'bg-gradient-to-br from-emerald-400 to-emerald-600 text-ink-950 font-semibold shadow-[0_10px_30px_-12px_rgba(48,209,88,0.8)]',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-[13px] rounded-xl gap-1.5',
  md: 'h-11 px-4 text-[14px] rounded-2xl gap-2',
  lg: 'h-14 px-6 text-[16px] rounded-[1.25rem] gap-2.5',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    icon,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: disabled || loading ? 1 : 0.97 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...(rest as HTMLMotionProps<'button'>)}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : icon ? (
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
      ) : null}
      {children}
    </motion.button>
  )
})

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'glass-pill inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition hover:bg-white/16 active:scale-95',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Badges
 * ------------------------------------------------------------------ */

export function Chip({
  children,
  className,
  tone = 'neutral',
}: {
  children: ReactNode
  className?: string
  tone?: 'neutral' | 'info' | 'warn' | 'danger' | 'success'
}) {
  const tones = {
    neutral: 'bg-white/10 text-white/80 border-white/15',
    info: 'bg-sky-500/18 text-sky-200 border-sky-400/30',
    warn: 'bg-amber-500/18 text-amber-200 border-amber-400/30',
    danger: 'bg-red-500/18 text-red-200 border-red-400/30',
    success: 'bg-emerald-500/18 text-emerald-200 border-emerald-400/30',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * Feedback
 * ------------------------------------------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded-2xl bg-white/8', className)}
      role="presentation"
      aria-hidden
    />
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon ? (
        <div className="glass-pill flex h-14 w-14 items-center justify-center rounded-full text-white/70">
          {icon}
        </div>
      ) : null}
      <div>
        <p className="text-[15px] font-semibold text-white/90">{title}</p>
        {description ? (
          <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-white/55">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export function ProgressRing({
  value,
  size = 96,
  stroke = 8,
  label,
  sublabel,
  color = '#4cc9f0',
  trackColor = 'rgba(255,255,255,0.12)',
}: {
  value: number
  size?: number
  stroke?: number
  label?: string
  sublabel?: string
  color?: string
  trackColor?: string
}) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))
  const offset = circumference - (clamped / 100) * circumference

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ type: 'spring', stiffness: 60, damping: 18 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {label ? <span className="text-lg font-semibold text-white">{label}</span> : null}
        {sublabel ? (
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/50">
            {sublabel}
          </span>
        ) : null}
      </div>
      <span className="sr-only">
        {label} {sublabel}
      </span>
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  options: { value: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (value: T) => void
  className?: string
  ariaLabel: string
}) {
  const layoutId = useId()
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('glass flex gap-1 rounded-2xl p-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition-colors',
              active ? 'text-ink-950' : 'text-white/60 hover:text-white',
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-xl bg-white"
                transition={{ type: 'spring', stiffness: 480, damping: 36 }}
              />
            ) : null}
            <span className="relative z-10 flex items-center gap-1.5">
              {option.icon}
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Bottom sheet
 * ------------------------------------------------------------------ */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[90] flex items-end justify-center lg:items-center lg:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close sheet"
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: '100%', opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_event, info) => {
              if (info.offset.y > 120) onClose()
            }}
            className="liquid liquid-deep relative z-10 max-h-[88svh] w-full max-w-lg overflow-hidden rounded-t-[1.75rem] pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:max-h-[86vh] lg:max-w-2xl lg:rounded-[1.75rem]"
          >
            <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2 lg:pt-5">
              <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25 lg:hidden" aria-hidden />
            </div>
            {title ? (
              <div className="flex items-center justify-between px-5 pb-2">
                <h2 className="text-[17px] font-semibold tracking-tight text-white">{title}</h2>
                <IconButton label="Close" onClick={onClose} className="h-8 w-8">
                  <X className="h-4 w-4" aria-hidden />
                </IconButton>
              </div>
            ) : null}
            <div className="max-h-[64svh] overflow-y-auto px-5 pb-4 lg:max-h-[62vh] lg:px-6">
              {children}
            </div>
            {footer ? <div className="px-5 pt-2 pb-3">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/* ------------------------------------------------------------------ *
 * Data display
 * ------------------------------------------------------------------ */

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'neutral' | 'critical' | 'success' | 'info'
  icon?: ReactNode
}) {
  const tones = {
    neutral: 'text-white',
    critical: 'text-red-400',
    success: 'text-emerald-400',
    info: 'text-aurora-400',
  }
  return (
    <GlassCard padded={false} className="p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-white/50">
          {label}
        </span>
        {icon ? <span className="text-white/40">{icon}</span> : null}
      </div>
      <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums tracking-tight', tones[tone])}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-white/45">{hint}</p> : null}
    </GlassCard>
  )
}

export function DetailRow({
  label,
  value,
  className,
}: {
  label: string
  value: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4 py-2', className)}>
      <dt className="text-[13px] text-white/55">{label}</dt>
      <dd className="text-[13px] font-semibold tabular-nums text-white">{value}</dd>
    </div>
  )
}
