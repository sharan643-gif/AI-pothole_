/**
 * Runtime configuration.
 *
 * Only `VITE_`-prefixed variables reach the browser. Secrets
 * (GEMINI_API_KEY, SUPABASE_SERVICE_ROLE_KEY) live exclusively in Supabase
 * Edge Function secrets and are never referenced here — see spec section 33.
 */

const env = import.meta.env

/**
 * The Supabase client needs the bare project origin
 * (`https://<ref>.supabase.co`). People frequently paste the REST endpoint
 * shown on the dashboard (`.../rest/v1/`) instead — normalise it away so a
 * trailing path can never silently break every request.
 */
function normaliseSupabaseUrl(raw: string | undefined): string {
  const value = raw?.trim() ?? ''
  if (!value) return ''
  try {
    return new URL(value).origin
  } catch {
    return value.replace(/\/+$/, '')
  }
}

export const SUPABASE_URL = normaliseSupabaseUrl(env.VITE_SUPABASE_URL)
export const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

export const HAS_SUPABASE_CREDENTIALS = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/** Map tiles work without a key via the MapLibre demo style. */
export const MAP_STYLE_URL =
  env.VITE_MAP_STYLE_URL?.trim() ||
  (env.VITE_MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=${env.VITE_MAPBOX_TOKEN}`
    : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json')

export const HAS_ROUTING = Boolean(env.VITE_MAPBOX_TOKEN)

export const APP_VERSION = '1.0.0'

/** Feature availability shown to the user so nothing is misrepresented. */
export const CAPABILITIES = {
  realtime: HAS_SUPABASE_CREDENTIALS,
  storage: HAS_SUPABASE_CREDENTIALS,
  routing: HAS_ROUTING,
  depthSensor: typeof navigator !== 'undefined' && 'mediaDevices' in navigator,
} as const
