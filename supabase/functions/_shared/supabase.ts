import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'

/**
 * Service-role client. This is the ONLY place the service key is used.
 * It never leaves the edge function runtime (spec section 33).
 */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured.')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Anon client used purely to validate the caller's JWT. */
function anonClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Supabase environment is not configured.')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export interface Caller {
  user: User
  role: string
  officerId: string | null
}

/**
 * Resolve the calling user from the Authorization header.
 * Returns null when the caller is anonymous or holds an invalid token.
 */
export async function resolveCaller(req: Request): Promise<Caller | null> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null

  const client = anonClient()
  const { data: userData, error: userError } = await client.auth.getUser(token)
  if (userError || !userData.user) return null

  const admin = adminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()

  let officerId: string | null = null
  if (profile?.role === 'OFFICER') {
    const { data: officer } = await admin
      .from('officers')
      .select('id')
      .eq('profile_id', userData.user.id)
      .maybeSingle()
    officerId = officer?.id ?? null
  }

  return { user: userData.user, role: profile?.role ?? 'CITIZEN', officerId }
}

export function isStaff(caller: Caller | null): boolean {
  return !!caller && ['OFFICER', 'ADMIN', 'SUPERVISOR'].includes(caller.role)
}

export function isAdmin(caller: Caller | null): boolean {
  return !!caller && ['ADMIN', 'SUPERVISOR'].includes(caller.role)
}
