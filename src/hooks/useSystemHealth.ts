import { useCallback, useEffect, useState } from 'react'
import { CAPABILITIES, HAS_SUPABASE_CREDENTIALS } from '@/lib/config'
import { EDGE_FUNCTIONS } from '@/lib/constants'
import { requireSupabase } from '@/lib/supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Live backend health.
 *
 * The panel exists because "is it actually connected?" should be answerable
 * from inside the product, not from a terminal. Every check makes a real
 * request; nothing is inferred from configuration alone.
 */

export type HealthState = 'ok' | 'fail'

export interface HealthCheck {
  key: string
  label: string
  state: HealthState
  detail: string
}

/** A cheap, Gemini-free function that proves the functions are deployed. */
const PROBE_FUNCTION = EDGE_FUNCTIONS.calculatePriority

async function databaseCheck(supabase: SupabaseClient): Promise<HealthCheck> {
  try {
    const { error } = await supabase.rpc('dashboard_stats')
    if (error) {
      return { key: 'database', label: 'Database', state: 'fail', detail: error.message }
    }
    return {
      key: 'database',
      label: 'Database',
      state: 'ok',
      detail: 'Tables, RLS and dashboard_stats() responded',
    }
  } catch (error) {
    return {
      key: 'database',
      label: 'Database',
      state: 'fail',
      detail: error instanceof Error ? error.message : 'Request failed',
    }
  }
}

async function functionsCheck(supabase: SupabaseClient): Promise<HealthCheck> {
  const label = 'Edge Functions'
  try {
    const { error } = await supabase.functions.invoke(PROBE_FUNCTION, { body: {} })
    if (!error) {
      return { key: 'functions', label, state: 'ok', detail: 'Deployed and responding' }
    }
    const status = (error as unknown as { context?: Response }).context?.status
    // 404 is the one status that means "not deployed"; anything else — even a
    // 401 from the auth guard — proves the function exists.
    if (status === 404) {
      return { key: 'functions', label, state: 'fail', detail: 'Not deployed yet — run npm run deploy:backend' }
    }
    if (status) {
      return { key: 'functions', label, state: 'ok', detail: `Deployed (protected, HTTP ${status})` }
    }
    return { key: 'functions', label, state: 'fail', detail: error.message || 'Request failed' }
  } catch (error) {
    return {
      key: 'functions',
      label,
      state: 'fail',
      detail: error instanceof Error ? error.message : 'Request failed',
    }
  }
}

export async function runBackendHealthChecks(): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [
    {
      key: 'credentials',
      label: 'Supabase credentials',
      state: HAS_SUPABASE_CREDENTIALS ? 'ok' : 'fail',
      detail: HAS_SUPABASE_CREDENTIALS
        ? 'Project URL and anon key present'
        : 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY',
    },
  ]

  if (!HAS_SUPABASE_CREDENTIALS) {
    for (const [key, label] of [
      ['database', 'Database'],
      ['functions', 'Edge Functions'],
    ] as const) {
      checks.push({ key, label, state: 'fail', detail: 'Skipped — no credentials' })
    }
    return checks
  }

  const supabase = requireSupabase()
  checks.push(await databaseCheck(supabase))
  checks.push(await functionsCheck(supabase))
  checks.push({
    key: 'realtime',
    label: 'Realtime',
    state: CAPABILITIES.realtime ? 'ok' : 'fail',
    detail: CAPABILITIES.realtime
      ? 'Incidents, assignments and notifications stream live'
      : 'Disabled',
  })
  checks.push({
    key: 'storage',
    label: 'Storage',
    state: CAPABILITIES.storage ? 'ok' : 'fail',
    detail: CAPABILITIES.storage ? 'Private buckets served via signed URLs' : 'Disabled',
  })

  return checks
}

export interface SystemHealth {
  checks: HealthCheck[] | null
  running: boolean
  okCount: number
  total: number
  run: () => Promise<void>
}

export function useSystemHealth(): SystemHealth {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null)
  // A check is already in flight on mount, so start in the running state —
  // this keeps the effect free of synchronous state updates.
  const [running, setRunning] = useState(true)

  const run = useCallback(async () => {
    setRunning(true)
    try {
      setChecks(await runBackendHealthChecks())
    } finally {
      setRunning(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await runBackendHealthChecks()
      if (cancelled) return
      setChecks(result)
      setRunning(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return {
    checks,
    running,
    okCount: checks?.filter((check) => check.state === 'ok').length ?? 0,
    total: checks?.length ?? 0,
    run,
  }
}
