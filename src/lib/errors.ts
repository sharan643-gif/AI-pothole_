/**
 * Typed error surface (spec section 36).
 *
 * Every failure path maps to a message a citizen can act on — never a raw
 * stack trace, and never a fabricated success.
 */

export type AppErrorCode =
  | 'CONFIG_MISSING'
  | 'AUTH_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'GEOLOCATION_UNAVAILABLE'
  | 'GEOLOCATION_LOW_ACCURACY'
  | 'CAMERA_UNAVAILABLE'
  | 'AI_FAILED'
  | 'AI_INVALID_RESPONSE'
  | 'NO_POTHOLE_DETECTED'
  | 'LOW_CONFIDENCE'
  | 'UPLOAD_FAILED'
  | 'NETWORK_FAILED'
  | 'NO_OFFICER_AVAILABLE'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'UNKNOWN'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly userMessage: string
  readonly cause?: unknown
  readonly recoverable: boolean

  constructor(
    code: AppErrorCode,
    options: { message?: string; userMessage?: string; cause?: unknown; recoverable?: boolean } = {},
  ) {
    super(options.message ?? code)
    this.name = 'AppError'
    this.code = code
    this.cause = options.cause
    this.userMessage = options.userMessage ?? DEFAULT_MESSAGES[code]
    this.recoverable = options.recoverable ?? code !== 'AUTH_REQUIRED'
  }

  static from(error: unknown, fallback: AppErrorCode = 'UNKNOWN'): AppError {
    if (error instanceof AppError) return error
    const message = error instanceof Error ? error.message : String(error)
    return new AppError(fallback, { message, cause: error })
  }
}

export const DEFAULT_MESSAGES: Record<AppErrorCode, string> = {
  CONFIG_MISSING:
    'This deployment is not connected to Supabase. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  AUTH_REQUIRED: 'Sign in to continue.',
  PERMISSION_DENIED: 'Permission was denied. Enable it in your browser settings and try again.',
  GEOLOCATION_UNAVAILABLE:
    'Location is unavailable. Move outdoors or enable precise location, then retry.',
  GEOLOCATION_LOW_ACCURACY:
    'Location accuracy is low. Move outdoors or enable precise location for an exact fix.',
  CAMERA_UNAVAILABLE:
    'The camera could not be started. Check browser permissions or try a rear-camera device.',
  AI_FAILED: 'The AI analysis service did not respond. Your capture is safe — please retry.',
  AI_INVALID_RESPONSE:
    'The AI returned an unexpected response. Nothing was saved and no measurement was trusted.',
  NO_POTHOLE_DETECTED: 'No pothole was detected in this image. Move closer and retry.',
  LOW_CONFIDENCE:
    'Detection confidence is low. Treat these measurements as approximate or rescan.',
  UPLOAD_FAILED: 'The image upload failed. Your report is saved locally and will retry.',
  NETWORK_FAILED:
    'You appear to be offline. The report is queued and will upload automatically.',
  NO_OFFICER_AVAILABLE:
    'No available officer nearby. Your report has been registered and added to the maintenance queue.',
  VALIDATION_FAILED: 'Some values in this report are invalid and were rejected.',
  NOT_FOUND: 'That record no longer exists.',
  UNKNOWN: 'Something went wrong. Please try again.',
}

/** Postgres/PostgREST error shape surfaced by supabase-js. */
interface PostgrestLike {
  message?: string
  code?: string
  details?: string
  hint?: string
  error?: string
}

export function toAppError(error: unknown, fallback: AppErrorCode = 'UNKNOWN'): AppError {
  if (error instanceof AppError) return error
  if (error && typeof error === 'object') {
    const pg = error as PostgrestLike
    const message = pg.message ?? pg.error ?? ''
    if (pg.code === '23503') {
      return new AppError('VALIDATION_FAILED', { message, cause: error })
    }
    if (pg.code === '42501' || /row-level security/i.test(message)) {
      return new AppError('PERMISSION_DENIED', { message, cause: error })
    }
    if (pg.code === 'PGRST301' || /jwt|token/i.test(message)) {
      return new AppError('AUTH_REQUIRED', { message, cause: error })
    }
    if (message) {
      return new AppError(fallback, { message, userMessage: message, cause: error })
    }
  }
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return new AppError('NETWORK_FAILED', { cause: error })
  }
  return new AppError(fallback, { cause: error })
}
