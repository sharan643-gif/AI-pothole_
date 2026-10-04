import { corsHeaders, fail, preflight } from './cors.ts'
import { rateLimit } from './rateLimit.ts'
import {
  adminClient,
  isAdmin,
  isStaff,
  resolveCaller,
  type Caller,
} from './supabase.ts'
import type { SeverityThresholds, SeverityWeights } from './severity.ts'
import {
  configFromRows,
  DEFAULT_SEVERITY_THRESHOLDS,
  DEFAULT_SEVERITY_WEIGHTS,
} from './severity.ts'

export interface GuardOptions {
  /** Require a signed-in user. */
  auth?: boolean
  /** Require OFFICER / ADMIN / SUPERVISOR. */
  staff?: boolean
  /** Require ADMIN / SUPERVISOR. */
  admin?: boolean
  /** Requests allowed per window, per user/IP. Defaults to 20/min. */
  limit?: number
  windowMs?: number
}

export type GuardedHandler = (
  caller: Caller | null,
  body: Record<string, unknown>,
  req: Request,
) => Promise<Response>

/**
 * Runs the shared pre-flight pipeline: CORS, method, JSON parsing, auth,
 * role check and rate limiting. Handlers only contain business logic.
 */
export async function guard(
  req: Request,
  options: GuardOptions,
  handler: GuardedHandler,
): Promise<Response> {
  const early = preflight(req)
  if (early) return early

  const caller = await resolveCaller(req)

  if (options.auth && !caller) {
    return fail('AUTH_REQUIRED', 'Sign in to use this endpoint.', 401)
  }
  if (options.staff && !isStaff(caller)) {
    return fail('FORBIDDEN', 'This endpoint is restricted to road officers.', 403)
  }
  if (options.admin && !isAdmin(caller)) {
    return fail('FORBIDDEN', 'This endpoint is restricted to administrators.', 403)
  }

  const identity = caller?.user.id ?? req.headers.get('x-forwarded-for') ?? 'anonymous'
  const limit = rateLimit(
    `${identity}:${new URL(req.url).pathname}`,
    options.limit ?? 20,
    options.windowMs ?? 60_000,
  )
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait a moment and retry.',
        },
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(limit.retryAfterSeconds),
        },
      },
    )
  }

  let body: Record<string, unknown> = {}
  const raw = await req.text()
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>
      } else {
        return fail('INVALID_BODY', 'Request body must be a JSON object.', 400)
      }
    } catch {
      return fail('INVALID_JSON', 'Request body was not valid JSON.', 400)
    }
  }

  try {
    return await handler(caller, body, req)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[roadguard] unhandled handler error:', message)
    return fail('INTERNAL_ERROR', 'The service could not complete this request.', 500, {
      details: message.slice(0, 300),
    })
  }
}

/**
 * Load the tunable severity configuration from the database. Falls back to the
 * compiled defaults if the table is unavailable so the pipeline always works.
 */
export async function loadSeverityConfig(): Promise<{
  weights: SeverityWeights
  thresholds: SeverityThresholds
  source: 'database' | 'defaults'
}> {
  try {
    const admin = adminClient()
    const { data, error } = await admin
      .from('severity_config')
      .select('key, weight, thresholds')
    if (error || !data || data.length === 0) {
      return {
        weights: DEFAULT_SEVERITY_WEIGHTS,
        thresholds: DEFAULT_SEVERITY_THRESHOLDS,
        source: 'defaults',
      }
    }
    const { weights, thresholds } = configFromRows(data)
    return { weights, thresholds, source: 'database' }
  } catch {
    return {
      weights: DEFAULT_SEVERITY_WEIGHTS,
      thresholds: DEFAULT_SEVERITY_THRESHOLDS,
      source: 'defaults',
    }
  }
}
