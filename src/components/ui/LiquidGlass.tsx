import { motion, type HTMLMotionProps } from 'framer-motion'
import { useCallback, useRef, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A liquid-glass surface.
 *
 * The material itself lives in CSS (`.liquid` / `.liquid-deep`). This component
 * adds the part CSS cannot do: a specular highlight that tracks the pointer, so
 * the surface reads as a physical pane of glass rather than a flat translucent
 * rectangle. On touch devices the highlight is simply never shown.
 */

export interface LiquidGlassProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children?: ReactNode
  /** Heavier, more opaque material for sidebars and modal sheets. */
  deep?: boolean
  /** Disable the pointer-tracked highlight (e.g. for dense list surfaces). */
  static?: boolean
  className?: string
}

export function LiquidGlass({
  children,
  deep = false,
  static: isStatic = false,
  className,
  ...rest
}: LiquidGlassProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (isStatic || event.pointerType !== 'mouse') return
      const element = ref.current ?? event.currentTarget
      const rect = element.getBoundingClientRect()
      element.style.setProperty('--sx', `${event.clientX - rect.left}px`)
      element.style.setProperty('--sy', `${event.clientY - rect.top}px`)
    },
    [isStatic],
  )

  return (
    <motion.div
      ref={ref}
      onPointerMove={handlePointerMove}
      className={cn('liquid', deep && 'liquid-deep', className)}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

/**
 * Drifting ambient light behind the glass. Purely decorative, so it is hidden
 * from assistive technology and frozen by the reduced-motion rules in CSS.
 */
export function AmbientBackdrop({ className }: { className?: string }) {
  return (
    <div
      className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}
      aria-hidden
    >
      <span
        className="orb animate-drift"
        style={{
          top: '-14%',
          left: '-8%',
          width: '46rem',
          height: '34rem',
          background:
            'radial-gradient(closest-side, rgba(76,201,240,0.30), transparent 72%)',
        }}
      />
      <span
        className="orb animate-drift-slow"
        style={{
          top: '-6%',
          right: '-12%',
          width: '40rem',
          height: '32rem',
          background:
            'radial-gradient(closest-side, rgba(140,90,255,0.26), transparent 72%)',
        }}
      />
      <span
        className="orb animate-drift"
        style={{
          bottom: '-18%',
          left: '28%',
          width: '48rem',
          height: '32rem',
          background:
            'radial-gradient(closest-side, rgba(48,209,88,0.16), transparent 72%)',
          animationDelay: '-8s',
        }}
      />
    </div>
  )
}
