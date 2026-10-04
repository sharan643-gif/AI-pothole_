import { useEffect, useState } from 'react'
import { STORAGE_BUCKETS } from '@/lib/constants'
import { getRepository } from '@/services'

/**
 * Storage buckets are private (spec section 21), so a stored object path is
 * resolved to a short-lived signed URL before it can be displayed.
 *
 * Returns `undefined` while resolving, `null` when the image is unavailable or
 * is a local data URL that needs no signing.
 */
export function useSignedImage(
  value: string | null | undefined,
  bucket: string = STORAGE_BUCKETS.potholeImages,
): { url: string | null; loading: boolean } {
  const [url, setUrl] = useState<string | null>(value ?? null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (!value) {
      setUrl(null)
      return
    }
    // Local captures and absolute URLs need no signing.
    if (value.startsWith('data:') || /^https?:\/\//.test(value)) {
      setUrl(value)
      return
    }

    setLoading(true)
    void getRepository()
      .signedUrl(bucket, value)
      .then((resolved) => {
        if (!cancelled) setUrl(resolved)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [value, bucket])

  return { url, loading }
}
