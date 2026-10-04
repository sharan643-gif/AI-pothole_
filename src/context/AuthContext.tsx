import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AppError, toAppError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { Profile, UserRole } from '@/types'

/**
 * Authentication (spec section 22).
 *
 * RoadGuard AI has no demo identities: every session is a real Supabase Auth
 * session, so a signed-in user is always backed by a real profile row and the
 * Row Level Security policies enforce exactly who they are.
 */

export interface AuthState {
  userId: string | null
  email: string | null
  profile: Profile | null
  role: UserRole
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (
    email: string,
    password: string,
    fullName: string,
    role?: 'CITIZEN' | 'OFFICER',
  ) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  signInWithGoogle: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

function requireClient() {
  if (!supabase) {
    throw new AppError('CONFIG_MISSING', {
      message: 'Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).',
    })
  }
  return supabase
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string, fallbackEmail: string | null) => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('[auth] profile fetch failed:', error.message)
    }

    if (data) {
      setProfile(data as Profile)
    } else {
      // The signup trigger may not have fired yet — fall back to a minimal
      // profile so the UI still works.
      setProfile({
        id: userId,
        full_name: null,
        email: fallbackEmail,
        phone: null,
        role: 'CITIZEN',
        avatar_url: null,
        created_at: new Date().toISOString(),
      })
    }
  }, [])

  // ---------------------------------------------------------------- bootstrap
  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let cancelled = false

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return
      const user = data.session?.user
      if (user) {
        setEmail(user.email ?? null)
        await loadProfile(user.id, user.email ?? null)
      }
      if (!cancelled) setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (cancelled) return
      const user = session?.user
      if (user) {
        setEmail(user.email ?? null)
        await loadProfile(user.id, user.email ?? null)
      } else {
        setProfile(null)
        setEmail(null)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [loadProfile])

  // ------------------------------------------------------------------ actions

  const signIn = useCallback(async (emailInput: string, password: string) => {
    const client = requireClient()
    const { error } = await client.auth.signInWithPassword({
      email: emailInput.trim(),
      password,
    })
    if (error) {
      throw new AppError(
        /invalid login/i.test(error.message) ? 'AUTH_REQUIRED' : 'NETWORK_FAILED',
        { message: error.message, userMessage: error.message },
      )
    }
  }, [])

  const signUp = useCallback(
    async (
      emailInput: string,
      password: string,
      fullName: string,
      role: 'CITIZEN' | 'OFFICER' = 'CITIZEN',
    ) => {
      const client = requireClient()
      const { data, error } = await client.auth.signUp({
        email: emailInput.trim(),
        password,
        // The `handle_new_user` trigger reads this to set the profile role.
        // Only CITIZEN/OFFICER are honoured server-side; anything else is
        // downgraded to CITIZEN so privileges can never be self-granted.
        options: { data: { full_name: fullName, role } },
      })
      if (error) {
        throw new AppError('VALIDATION_FAILED', {
          message: error.message,
          userMessage: error.message,
        })
      }
      return { needsConfirmation: !data.session }
    },
    [],
  )

  const signOut = useCallback(async () => {
    const client = requireClient()
    await client.auth.signOut()
    setProfile(null)
    setEmail(null)
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const client = requireClient()
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      throw new AppError('NETWORK_FAILED', {
        message: error.message,
        userMessage:
          'Google sign-in is unavailable. Make sure the provider is enabled in your Supabase project.',
      })
    }
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.auth.getUser()
    if (data.user) await loadProfile(data.user.id, data.user.email ?? null)
  }, [loadProfile])

  const value = useMemo<AuthState>(
    () => ({
      userId: profile?.id ?? null,
      email,
      profile,
      role: profile?.role ?? 'CITIZEN',
      loading,
      signIn,
      signUp,
      signOut,
      signInWithGoogle,
      refreshProfile,
    }),
    [profile, email, loading, signIn, signUp, signOut, signInWithGoogle, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within <AuthProvider>')
  return context
}

/** Convenience wrapper that converts anything thrown into a user-safe AppError. */
export async function runAuthAction(action: () => Promise<void>): Promise<AppError | null> {
  try {
    await action()
    return null
  } catch (error) {
    return toAppError(error)
  }
}
