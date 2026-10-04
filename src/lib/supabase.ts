import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  HAS_SUPABASE_CREDENTIALS,
  SUPABASE_ANON_KEY,
  SUPABASE_CONFIG_HINT,
  SUPABASE_URL,
} from '@/lib/config'
import { AppError } from '@/lib/errors'

/**
 * The browser client uses only the anon key, guarded by Row Level Security.
 * Service-role operations are confined to Supabase Edge Functions.
 */
export const supabase: SupabaseClient | null = HAS_SUPABASE_CREDENTIALS
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
      realtime: { params: { eventsPerSecond: 8 } },
    })
  : null

export function isSupabaseReady(): boolean {
  return supabase !== null
}

/** Throws a typed, user-safe error instead of leaking a null dereference. */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new AppError('CONFIG_MISSING', {
      message: SUPABASE_CONFIG_HINT,
    })
  }
  return supabase
}
