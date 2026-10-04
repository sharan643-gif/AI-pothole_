import { AnimatePresence, motion } from 'framer-motion'
import {
  Camera as CameraIcon,
  Check,
  ChevronLeft,
  Image as ImageIcon,
  RefreshCw,
  ScanLine,
  SwitchCamera,
  Zap,
  ZapOff,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCamera, type CaptureResult } from '@/hooks/useCamera'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/primitives'

/**
 * Premium scan interface (spec sections 12, 13, 41).
 *
 * Deliberately not the browser default camera chrome: full-bleed preview,
 * custom shutter, animated detection frames and a staged scan readout.
 */

export interface ScanStage {
  label: string
  done: boolean
}

export interface Detection {
  label: string
  confidence: number
  /** Normalised 0..1 box within the preview. */
  box: { x: number; y: number; width: number; height: number }
  measurements?: { width: string; length: string; depth: string }
}

export interface CameraViewProps {
  onBack: () => void
  onCapture: (capture: CaptureResult) => void
  onPickGallery: () => void
  scanning?: boolean
  stages?: ScanStage[]
  detection?: Detection | null
  progress?: number
}

export function CameraView({
  onBack,
  onCapture,
  onPickGallery,
  scanning = false,
  stages = [],
  detection = null,
  progress = 0,
}: CameraViewProps) {
  const camera = useCamera()
  const [flashFrame, setFlashFrame] = useState(false)
  const startedRef = useRef(false)

  const { start, error, ready, starting } = camera

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void start()
  }, [start])

  const handleShutter = useCallback(() => {
    const result = camera.capture()
    if (!result) return
    setFlashFrame(true)
    window.setTimeout(() => setFlashFrame(false), 170)
    onCapture(result)
  }, [camera, onCapture])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-black">
      {/* ------------------------------------------------------------ preview */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={camera.videoRef}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
            ready ? 'opacity-100' : 'opacity-0',
          )}
          playsInline
          muted
          aria-label="Live camera preview"
        />

        {/* Fallback surface when the camera is unavailable */}
        {!ready ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-ink-900 to-ink-950 px-8 text-center">
            {starting ? (
              <>
                <ScanLine className="h-10 w-10 animate-pulse text-aurora-400" aria-hidden />
                <p className="text-[13px] text-white/60">Starting camera…</p>
              </>
            ) : error ? (
              <>
                <div className="glass-pill flex h-14 w-14 items-center justify-center rounded-full">
                  <CameraIcon className="h-6 w-6 text-white/60" aria-hidden />
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-white">Camera unavailable</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-white/55">
                    {error.userMessage}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void start()}>
                    Retry
                  </Button>
                  <Button size="sm" variant="secondary" onClick={onPickGallery}>
                    Choose a photo
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {/* --------------------------------------------------- top chrome */}
        <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 pt-3 pb-8">
          <button
            type="button"
            onClick={onBack}
            aria-label="Close scanner"
            className="glass-pill inline-flex h-9 w-9 items-center justify-center rounded-full text-white"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <div className="glass-pill flex items-center gap-2 rounded-full px-3.5 py-1.5">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                scanning ? 'animate-pulse bg-aurora-400' : 'bg-emerald-400',
              )}
              aria-hidden
            />
            <span className="text-[11px] font-semibold tracking-[0.14em] text-white/90 uppercase">
              AI Scan
            </span>
          </div>
          <button
            type="button"
            onClick={() => void camera.toggleTorch()}
            disabled={!camera.torchSupported}
            aria-label={camera.torchOn ? 'Turn flash off' : 'Turn flash on'}
            className="glass-pill inline-flex h-9 w-9 items-center justify-center rounded-full text-white disabled:opacity-35"
          >
            {camera.torchOn ? (
              <Zap className="h-4 w-4" aria-hidden />
            ) : (
              <ZapOff className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>

        {/* -------------------------------------------------- scan overlay */}
        <ScanOverlay
          scanning={scanning}
          detection={detection}
          stages={stages}
          progress={progress}
          hasPreview={ready}
        />

        {/* shutter flash */}
        <AnimatePresence>
          {flashFrame ? (
            <motion.div
              className="absolute inset-0 z-40 bg-white"
              initial={{ opacity: 0.85 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.17 }}
              aria-hidden
            />
          ) : null}
        </AnimatePresence>
      </div>

      {/* ------------------------------------------------------ bottom bar */}
      <div className="relative z-30 border-t border-white/10 bg-gradient-to-t from-black/85 to-black/40 px-5 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-2xl">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onPickGallery}
            aria-label="Choose from gallery"
            className="glass-pill inline-flex h-11 w-11 items-center justify-center rounded-2xl text-white"
          >
            <ImageIcon className="h-5 w-5" aria-hidden />
          </button>

          <ShutterButton onPress={handleShutter} disabled={!ready || scanning} />

          <button
            type="button"
            onClick={() => void camera.switchCamera()}
            aria-label="Switch camera"
            className="glass-pill inline-flex h-11 w-11 items-center justify-center rounded-2xl text-white"
          >
            <SwitchCamera className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <div className="mt-2.5 flex items-center justify-center gap-2 text-[10px] font-medium tracking-wider text-white/45 uppercase">
          <RefreshCw className="h-3 w-3" aria-hidden />
          <span>{scanning ? 'Analysing capture' : 'Hold steady · fill frame with damage'}</span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Shutter
 * ------------------------------------------------------------------ */

function ShutterButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <motion.button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label="Capture photo"
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
      className="relative inline-flex h-[72px] w-[72px] items-center justify-center rounded-full disabled:opacity-40"
    >
      <span className="absolute inset-0 rounded-full border-[3px] border-white/85" aria-hidden />
      <span className="absolute inset-[6px] rounded-full bg-white/95" aria-hidden />
      <span className="absolute inset-[6px] rounded-full bg-gradient-to-br from-aurora-400 to-aurora-600 opacity-0 transition-opacity hover:opacity-100" aria-hidden />
    </motion.button>
  )
}

/* ------------------------------------------------------------------ *
 * Scan overlay — detection frame, scanning line, staged readout
 * ------------------------------------------------------------------ */

export function ScanOverlay({
  scanning,
  detection,
  stages,
  progress,
  hasPreview,
}: {
  scanning: boolean
  detection: Detection | null
  stages: ScanStage[]
  progress: number
  hasPreview: boolean
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* Rule-of-thirds framing guides */}
      <div className="absolute inset-0 opacity-25" aria-hidden>
        <div className="absolute top-1/3 right-0 left-0 h-px bg-white/50" />
        <div className="absolute top-2/3 right-0 left-0 h-px bg-white/50" />
        <div className="absolute top-0 bottom-0 left-1/3 w-px bg-white/50" />
        <div className="absolute top-0 bottom-0 left-2/3 w-px bg-white/50" />
      </div>

      {/* Header readout */}
      <div className="absolute inset-x-0 top-20 flex flex-col items-center gap-1.5 px-6">
        <p className="text-[11px] font-semibold tracking-[0.22em] text-aurora-300 uppercase">
          {scanning ? 'Scanning…' : 'AI Road Analysis'}
        </p>
        {!scanning && hasPreview ? (
          <p className="text-[11px] text-white/50">
            Position the damaged area inside the frame
          </p>
        ) : null}
      </div>

      {/* Scanning sweep */}
      {scanning ? (
        <motion.div
          className="absolute inset-x-6"
          initial={{ top: '14%' }}
          animate={{ top: ['14%', '82%', '14%'] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden
        >
          <div className="relative h-0.5 w-full rounded-full bg-gradient-to-r from-transparent via-aurora-400 to-transparent shadow-[0_0_22px_6px_rgba(76,201,240,0.55)]" />
        </motion.div>
      ) : null}

      {/* Detection frame */}
      <AnimatePresence>
        {detection ? <DetectionFrame detection={detection} /> : null}
      </AnimatePresence>

      {/* Staged scan readout */}
      <AnimatePresence>
        {scanning && stages.length > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute inset-x-4 bottom-4"
          >
            <div className="glass-strong sheen rounded-2xl p-3.5">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold tracking-wider text-white/75 uppercase">
                  Analysing road surface
                </span>
                <span className="text-[11px] font-semibold tabular-nums text-aurora-300">
                  {Math.round(progress)}%
                </span>
              </div>
              <div className="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-aurora-400 to-aurora-600"
                  animate={{ width: `${Math.max(4, progress)}%` }}
                  transition={{ type: 'spring', stiffness: 90, damping: 20 }}
                />
              </div>
              <ul className="space-y-1.5">
                {stages.map((stage) => (
                  <li key={stage.label} className="flex items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px]',
                        stage.done
                          ? 'border-emerald-400/60 bg-emerald-400/20 text-emerald-300'
                          : 'border-white/25 text-transparent',
                      )}
                      aria-hidden
                    >
                      {stage.done ? <Check className="h-2.5 w-2.5" /> : null}
                    </span>
                    <span
                      className={cn(
                        'text-[12px] transition-colors',
                        stage.done ? 'text-white/85' : 'text-white/40',
                      )}
                    >
                      {stage.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Detection frame with measurement labels (spec section 42)
 * ------------------------------------------------------------------ */

export function DetectionFrame({ detection }: { detection: Detection }) {
  const { box, label, confidence, measurements } = detection
  const percent = confidence <= 1 ? confidence * 100 : confidence

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="absolute"
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.width * 100}%`,
        height: `${box.height * 100}%`,
      }}
      role="img"
      aria-label={`${label} detected with ${Math.round(percent)}% confidence`}
    >
      {/* corner brackets */}
      {[
        'top-0 left-0 border-t-2 border-l-2',
        'top-0 right-0 border-t-2 border-r-2',
        'bottom-0 left-0 border-b-2 border-l-2',
        'bottom-0 right-0 border-b-2 border-r-2',
      ].map((position) => (
        <span
          key={position}
          className={cn('absolute h-5 w-5 rounded-[3px] border-aurora-400', position)}
          aria-hidden
        />
      ))}

      <span className="absolute inset-0 rounded-[6px] bg-aurora-400/8" aria-hidden />

      <div className="absolute -top-7 left-0 flex items-center gap-1.5 rounded-lg bg-aurora-400 px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink-950 uppercase">
        {label}
        <span className="tabular-nums">{Math.round(percent)}%</span>
      </div>

      {measurements ? (
        <>
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white tabular-nums">
            {measurements.length}
          </span>
          <span className="absolute top-1/2 -left-12 -translate-y-1/2 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white tabular-nums">
            {measurements.width}
          </span>
          <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-aurora-300 tabular-nums">
            ≈ {measurements.depth}
          </span>
        </>
      ) : null}
    </motion.div>
  )
}
