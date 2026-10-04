/**
 * Shared HTTP helpers for RoadGuard AI edge functions.
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-roadguard-client',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function fail(
  code: string,
  message: string,
  status = 400,
  extra: Record<string, unknown> = {},
): Response {
  return json({ ok: false, error: { code, message, ...extra } }, status)
}

export function ok<T extends Record<string, unknown>>(payload: T): Response {
  return json({ ok: true, ...payload })
}

/** Handle the CORS preflight and reject non-POST verbs early. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return fail('METHOD_NOT_ALLOWED', 'This endpoint accepts POST only.', 405)
  }
  return null
}
