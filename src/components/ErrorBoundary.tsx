import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Last-resort UI boundary.
 *
 * Without one, a single throwing component unmounts the entire React tree and
 * the user is left staring at a blank screen with no explanation — which is
 * both confusing and impossible to report. This keeps the app alive and says
 * what happened.
 */

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[roadguard] unhandled UI error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-svh items-center justify-center px-6">
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-white/10 bg-ink-950/70 p-5 text-center">
          <p className="text-[15px] font-semibold text-white">This screen could not load</p>
          <p className="text-[12px] leading-relaxed text-white/60">
            Something went wrong while rendering. Nothing was lost — reload to continue.
          </p>
          <pre className="max-h-32 overflow-auto rounded-xl bg-black/40 p-2.5 text-left text-[10px] leading-snug break-words whitespace-pre-wrap text-red-200/80">
            {error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl bg-white px-4 py-2 text-[12px] font-semibold text-ink-950"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
