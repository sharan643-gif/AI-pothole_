import { useCallback, useEffect, useRef, useState } from 'react'
import { AppError } from '@/lib/errors'
import { getRepository } from '@/services'
import type { GeoFix } from '@/types'

/**
 * Location intelligence (spec section 30).
 *
 * Never fabricates a position in production. If accuracy is poor the UI is
 * told explicitly so it can ask the user to move outdoors, rather than silently
 * reporting a vague fix as precise.
 */

/** Above this radius the fix is labelled low-accuracy. */
export const ACCURACY_THRESHOLD_M = 80

export interface GeolocationState {
  fix: GeoFix | null
  error: AppError | null
  loading: boolean
  watching: boolean
  isLowAccuracy: boolean
  request: () => void
}

export function useGeolocation(options: { auto?: boolean } = {}): GeolocationState {
  const auto = options.auto ?? true
  const [fix, setFix] = useState<GeoFix | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [loading, setLoading] = useState(false)
  const [watching, setWatching] = useState(false)
  const watchId = useRef<number | null>(null)

  const clear = useCallback(() => {
    if (watchId.current != null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
    setWatching(false)
  }, [])

  const request = useCallback(() => {
    setError(null)

    const supported =
      typeof navigator !== 'undefined' && typeof navigator.geolocation !== 'undefined'

    if (!supported) {
      setError(new AppError('GEOLOCATION_UNAVAILABLE'))
      return
    }

    setLoading(true)
    clear()

    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const next: GeoFix = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        }
        setFix(next)
        setError(null)
        setLoading(false)
        setWatching(true)
        getRepository().lastFix = next
      },
      (geolocationError) => {
        setLoading(false)
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        switch (geolocationError.code) {
          case 1:
            setError(new AppError('PERMISSION_DENIED', { cause: geolocationError }))
            break
          case 3:
            setError(
              new AppError('GEOLOCATION_UNAVAILABLE', {
                message: 'Timed out',
                userMessage: 'The location request timed out. Move outdoors and try again.',
                cause: geolocationError,
              }),
            )
            break
          default:
            setError(new AppError('GEOLOCATION_UNAVAILABLE', { cause: geolocationError }))
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )
  }, [clear])

  useEffect(() => {
    if (auto) request()
    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  const isLowAccuracy = fix != null && fix.accuracy > ACCURACY_THRESHOLD_M

  return { fix, error, loading, watching, isLowAccuracy, request }
}
