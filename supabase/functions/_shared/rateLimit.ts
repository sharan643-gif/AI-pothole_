/**
 * Best-effort in-isolate rate limiting (spec section 33).
 *
 * Edge isolates are ephemeral and horizontally scaled, so this is a
 * *deterrent*, not a hard guarantee. For production-grade enforcement put a
 * counter in Postgres or Redis keyed on `user_id`. The interface is written so
 * that swap is a one-line change.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_KEYS = 5000

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now()

  // Opportunistic garbage collection to bound memory in a long-lived isolate.
  if (buckets.size > MAX_KEYS) {
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k)
    }
  }

  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 }
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  existing.count += 1
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 }
}
