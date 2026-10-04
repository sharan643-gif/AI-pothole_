import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Info, WifiOff, X } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

export type ToastTone = 'success' | 'error' | 'info' | 'offline'

export interface Toast {
  id: string
  title: string
  description?: string
  tone: ToastTone
  duration: number
}

export interface ToastApi {
  show: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => string
  success: (title: string, description?: string) => string
  error: (title: string, description?: string) => string
  info: (title: string, description?: string) => string
  offline: (title: string, description?: string) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const TONE_STYLES: Record<ToastTone, { ring: string; icon: ReactNode }> = {
  success: {
    ring: 'border-emerald-400/30',
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden />,
  },
  error: {
    ring: 'border-red-400/30',
    icon: <AlertTriangle className="h-5 w-5 text-red-400" aria-hidden />,
  },
  info: {
    ring: 'border-sky-400/30',
    icon: <Info className="h-5 w-5 text-sky-400" aria-hidden />,
  },
  offline: {
    ring: 'border-amber-400/30',
    icon: <WifiOff className="h-5 w-5 text-amber-400" aria-hidden />,
  },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback<ToastApi['show']>(
    (input) => {
      const id = crypto.randomUUID()
      const toast: Toast = { ...input, id, duration: input.duration ?? 5200 }
      setToasts((current) => [...current.slice(-2), toast])
      if (toast.duration > 0) {
        window.setTimeout(() => dismiss(id), toast.duration)
      }
      return id
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, description) => show({ title, description, tone: 'success' }),
      error: (title, description) => show({ title, description, tone: 'error', duration: 7000 }),
      info: (title, description) => show({ title, description, tone: 'info' }),
      offline: (title, description) =>
        show({ title, description, tone: 'offline', duration: 8000 }),
    }),
    [show, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-4"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: -24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className={cn(
                'glass-strong sheen pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-2xl border px-4 py-3 shadow-2xl shadow-black/50',
                TONE_STYLES[toast.tone].ring,
              )}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0">{TONE_STYLES[toast.tone].icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold tracking-tight text-white">
                    {toast.title}
                  </p>
                  {toast.description ? (
                    <p className="mt-0.5 text-[12px] leading-snug text-white/70">
                      {toast.description}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                  className="rounded-full p-1 text-white/50 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-aurora-400"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within <ToastProvider>')
  return context
}
