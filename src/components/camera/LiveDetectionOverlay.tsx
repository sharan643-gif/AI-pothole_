import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Brain,
  Check,
  Clock,
  Cpu,
  Info,
  Ruler,
  ScanLine,
  Sparkles,
  TriangleAlert,
  WifiOff,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { DepthEstimate } from '@/lib/depth'
import type { LiveDetection, PipelineStep } from '@/hooks/useLiveDetection'
import { SEVERITY_META } from '@/lib/constants'
import { cn, formatCm, formatPercent } from '@/lib/utils'
import type { Severity } from '@/types'

/**
 * Real-time detection overlay (spec sections 6, 7).
 *
 * Draws the model's normalised bounding box directly over the live video and
 * annotates it with severity, dimensions and depth. Severity is conveyed with
 * an icon, a word and a colour — never colour alone — so it stays legible for
 * colour-blind users and in bright sunlight.
 */

/** Per-severity icon + wording, so colour is never the only signal. */
const SEVERITY_ICON: Record<Severity, typeof AlertTriangle> = {
  CRITICAL: TriangleAlert,
  HIGH: AlertTriangle,
  MEDIUM: Info,
  LOW: Check,
}

export function DetectionOverlay({
  detection,
  depth,
}: {
  detection: LiveDetection | null
  depth: DepthEstimate | null
}) {
  const box = detection?.analysis.bounding_box ?? null

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <AnimatePresence>
        {detection && box ? (
          <motion.div
            key={detection.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            className="absolute"
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
            }}
            role="img"
            aria-label={describe(detection)}
          >
            <DetectedBox detection={detection} depth={depth} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function DetectedBox({ detection, depth }: { detection: LiveDetection; depth: DepthEstimate | null }) {
  const severity = detection.priority.severity
  const meta = SEVERITY_META[severity]
  const Icon = SEVERITY_ICON[severity]
  const { analysis } = detection
  const measured = depth != null && !depth.estimated

  return (
    <>
      {/* Lensed corner brackets */}
      {[
        'top-0 left-0 border-t-2 border-l-2',
        'top-0 right-0 border-t-2 border-r-2',
        'bottom-0 left-0 border-b-2 border-l-2',
        'bottom-0 right-0 border-b-2 border-r-2',
      ].map((position) => (
        <span
          key={position}
          className={cn('absolute h-6 w-6 rounded-[4px]', position)}
          style={{ borderColor: meta.hex }}
          aria-hidden
        />
      ))}

      <span
        className="absolute inset-0 rounded-[8px]"
        style={{ backgroundColor: `${meta.hex}14`, boxShadow: `0 0 0 1px ${meta.hex}55` }}
        aria-hidden
      />

      {/* Severity label — icon + word + confidence */}
      <div
        className="absolute -top-8 left-0 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-bold tracking-wide text-ink-950 uppercase shadow-lg"
        style={{ backgroundColor: meta.hex }}
      >
        <Icon className="h-3 w-3" aria-hidden />
        <span>{meta.label}</span>
        <span className="tabular-nums opacity-80">{formatPercent(analysis.confidence)}</span>
      </div>

      {/* Dimension labels along the edges */}
      <span className="absolute -bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold text-white tabular-nums">
        <Ruler className="h-2.5 w-2.5 opacity-70" aria-hidden />
        {formatCm(analysis.width_cm, 0)} × {formatCm(analysis.length_cm, 0)}
      </span>
      <span className="absolute top-1/2 -left-[4.5rem] flex -translate-y-1/2 items-center gap-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold text-white tabular-nums">
        {formatCm(analysis.length_cm, 0)}
      </span>

      {/* Depth annotation — explicitly "≈" when only a visual estimate */}
      {depth?.depthCm != null ? (
        <span
          className={cn(
            'absolute -top-8 right-0 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold tabular-nums',
            measured ? 'bg-emerald-500/90 text-ink-950' : 'bg-black/75 text-aurora-300',
          )}
        >
          {measured ? null : <span aria-hidden>≈</span>}
          {formatCm(depth.depthCm)}
          <span className="opacity-70">{measured ? 'measured' : 'est.'}</span>
        </span>
      ) : null}

      {/* Timestamp */}
      <span className="absolute -bottom-6 right-0 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] text-white/70 tabular-nums">
        <Clock className="h-2.5 w-2.5" aria-hidden />
        {new Date(detection.detectedAt).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>

    </>
  )
}

function describe(detection: LiveDetection): string {
  const { analysis } = detection
  return `${analysis.road_damage_type.replace(/_/g, ' ').toLowerCase()} detected, ${SEVERITY_META[
    detection.priority.severity
  ].label.toLowerCase()} severity, ${formatPercent(analysis.confidence)} confidence`
}

/* ------------------------------------------------------------------ *
 * AI processing pipeline indicator (spec section 15)
 * ------------------------------------------------------------------ */

const STEP_ICON: Record<string, typeof ScanLine> = {
  camera: ScanLine,
  frame: Cpu,
  ai: Brain,
  pothole: Sparkles,
  depth: Ruler,
}

export function AiPipelineIndicator({
  pipeline,
  analysing,
  aiUnavailable,
  analysisFps,
}: {
  pipeline: PipelineStep[]
  analysing: boolean
  aiUnavailable: boolean
  analysisFps: number
}) {
  return (
    <div className="glass-strong sheen rounded-2xl p-3">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold tracking-wider text-white/75 uppercase">
          AI pipeline
        </span>
        {aiUnavailable ? (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
            <WifiOff className="h-3 w-3" aria-hidden />
            AI temporarily unavailable
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-white/55 tabular-nums">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                analysing ? 'animate-pulse bg-aurora-400' : 'bg-emerald-400',
              )}
              aria-hidden
            />
            {analysisFps > 0 ? `${analysisFps.toFixed(1)} fps` : 'idle'}
          </span>
        )}
      </div>

      <ul className="space-y-1.5">
        {pipeline.map((step) => {
          const Icon = STEP_ICON[step.key] ?? ScanLine
          return (
            <li key={step.key} className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                  step.state === 'done'
                    ? 'border-emerald-400/60 bg-emerald-400/20 text-emerald-300'
                    : step.state === 'active'
                      ? 'border-aurora-400/70 bg-aurora-400/20 text-aurora-300'
                      : 'border-white/20 text-white/30',
                )}
                aria-hidden
              >
                {step.state === 'active' ? (
                  <motion.span
                    className="h-2 w-2 rounded-full bg-aurora-400"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.1, repeat: Infinity }}
                  />
                ) : (
                  <Icon className="h-3 w-3" />
                )}
              </span>
              <span
                className={cn(
                  'text-[12px] transition-colors',
                  step.state === 'done'
                    ? 'text-white/85'
                    : step.state === 'active'
                      ? 'text-white'
                      : 'text-white/35',
                )}
              >
                {step.label}
              </span>
              {step.state === 'done' ? (
                <Check className="ml-auto h-3 w-3 text-emerald-300" aria-hidden />
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Floating status pills over the video
 * ------------------------------------------------------------------ */

export function LiveStatusPills({
  cameraActive,
  aiActive,
  aiUnavailable,
}: {
  cameraActive: boolean
  aiActive: boolean
  aiUnavailable: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <StatusPill active={cameraActive} label="Camera active" />
      {aiUnavailable ? (
        <StatusPill tone="warn" active label="AI unavailable" />
      ) : (
        <StatusPill active={aiActive} label="AI analysis active" />
      )}
    </div>
  )
}

function StatusPill({
  active,
  label,
  tone = 'ok',
}: {
  active: boolean
  label: string
  tone?: 'ok' | 'warn'
}): ReactNode {
  const dot = tone === 'warn' ? 'bg-amber-400' : active ? 'bg-emerald-400' : 'bg-white/40'
  return (
    <span className="glass-pill flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white/90 uppercase">
      <span
        className={cn('h-1.5 w-1.5 rounded-full', dot, active && tone === 'ok' && 'animate-pulse')}
        aria-hidden
      />
      {label}
    </span>
  )
}
