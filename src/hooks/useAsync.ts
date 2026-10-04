import { useCallback, useEffect, useRef, useState } from 'react'
import { AppError, toAppError } from '@/lib/errors'

export interface AsyncState<T> {
  data: T | null
  error: AppError | null
  loading: boolean
  refreshing: boolean
  refresh: () => Promise<void>
  setData: (updater: T | ((previous: T | null) => T | null)) => void
}

/**
 * Minimal async data hook.
 *
 * Deliberately not a query library: the surface area we need is small, and
 * keeping it explicit makes the failure states visible in the UI rather than
 * hidden behind cache semantics.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  options: { enabled?: boolean } = {},
): AsyncState<T> {
  const enabled = options.enabled ?? true
  const [data, setDataState] = useState<T | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [refreshing, setRefreshing] = useState(false)
  const mounted = useRef(true)
  const loaderRef = useRef(loader)

  // Declared before the fetch effect so a changed loader is in place before the
  // next run. Syncing in an effect rather than during render keeps the React
  // Compiler's ref rules satisfied.
  useEffect(() => {
    loaderRef.current = loader
  }, [loader])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(
    async (mode: 'initial' | 'refresh') => {
      if (mode === 'initial') setLoading(true)
      else setRefreshing(true)
      try {
        const result = await loaderRef.current()
        if (!mounted.current) return
        setDataState(result)
        setError(null)
      } catch (caught) {
        if (!mounted.current) return
        setError(toAppError(caught))
      } finally {
        if (mounted.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [],
  )

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void run('initial')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  const refresh = useCallback(async () => {
    await run('refresh')
  }, [run])

  const setData = useCallback<AsyncState<T>['setData']>((updater) => {
    setDataState((previous) =>
      typeof updater === 'function'
        ? (updater as (p: T | null) => T | null)(previous)
        : updater,
    )
  }, [])

  return { data, error, loading, refreshing, refresh, setData }
}
