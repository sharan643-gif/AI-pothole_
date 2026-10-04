import { useCallback, useEffect, useState } from 'react'
import { countQueuedReports, flushQueue, type PendingReport } from '@/services/offline'

/**
 * Connectivity + offline queue state (spec section 37).
 */
export function useOnlineStatus(options: {
  /** Uploads a single queued report. Throw to keep it queued for later. */
  onFlush?: (report: PendingReport) => Promise<void>
} = {}) {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  const [queued, setQueued] = useState(0)
  const [flushing, setFlushing] = useState(false)

  const refreshCount = useCallback(async () => {
    setQueued(await countQueuedReports())
  }, [])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    void refreshCount()
  }, [refreshCount])

  /** Attempt to push everything that was captured while offline. */
  const flush = useCallback(async () => {
    if (!navigator.onLine || !options.onFlush) return null
    setFlushing(true)
    try {
      const result = await flushQueue(options.onFlush)
      await refreshCount()
      return result
    } finally {
      setFlushing(false)
    }
  }, [options, refreshCount])

  // Automatically retry the queue when the connection returns, or when new
  // items are queued while already online.
  useEffect(() => {
    if (online && queued > 0 && options.onFlush && !flushing) {
      void flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, queued])

  return { online, queued, flushing, refreshCount, flush }
}
