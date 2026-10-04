#!/usr/bin/env node
/**
 * RoadGuard AI — live integration check.
 *
 * Verifies that the root `.env` really points at a working Supabase project
 * with the schema applied and the edge functions deployed, and that the Gemini
 * key is valid. Never prints secret values.
 *
 * Usage: npm run verify:live
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

function loadEnv(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[match[1]] = value
  }
  return out
}

const env = { ...loadEnv(resolve(ROOT, '.env')), ...process.env }

const results = []
function record(ok, label, detail) {
  results.push({ ok, label, detail })
  const mark = ok ? '✅' : '❌'
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`)
}

function origin(raw) {
  try {
    return new URL(raw).origin
  } catch {
    return (raw ?? '').replace(/\/+$/, '')
  }
}

const url = origin(env.VITE_SUPABASE_URL)
const anon = env.VITE_SUPABASE_ANON_KEY
const gemini = env.GEMINI_API_KEY
const model = env.GEMINI_MODEL || 'gemini-3.5-flash-lite'

console.log('\nRoadGuard AI — live integration check\n' + '='.repeat(44))

if (!url || !anon) {
  record(false, 'Supabase credentials', 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing')
} else {
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_URL !== url) {
    console.log(`ℹ️  VITE_SUPABASE_URL contained a path; using origin ${url}`)
  }
  record(true, 'Supabase credentials present', `${new URL(url).host} · anon key ${anon.length} chars`)
}

if (env.VITE_DEMO_MODE === 'true') {
  record(false, 'Live mode', 'VITE_DEMO_MODE=true forces demo data')
} else {
  record(true, 'Live mode', env.VITE_DEMO_MODE === 'false' ? 'explicitly forced live' : 'auto (credentials present)')
}

const headers = {
  apikey: anon,
  Authorization: `Bearer ${anon}`,
}

async function checkTables() {
  if (!url || !anon) return
  const tables = [
    'profiles',
    'officers',
    'potholes',
    'pothole_analysis',
    'assignments',
    'repair_records',
    'notifications',
    'severity_config',
    'scan_queue',
  ]
  let missing = []
  for (const table of tables) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers })
      // 200 = exists (RLS may still return []), 401/403 = exists but guarded.
      if (res.status !== 200 && res.status !== 401 && res.status !== 403) missing.push(table)
    } catch (error) {
      missing.push(`${table} (${error.message})`)
    }
  }
  record(missing.length === 0, 'Database schema', missing.length ? `missing: ${missing.join(', ')}` : 'all 9 tables reachable')
}

async function checkRpc() {
  if (!url || !anon) return
  try {
    const res = await fetch(`${url}/rest/v1/rpc/dashboard_stats`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!res.ok) return record(false, 'dashboard_stats() RPC', `HTTP ${res.status}`)
    const data = await res.json()
    record(true, 'dashboard_stats() RPC', `live • total incidents = ${data.total ?? '?'}`)
    if (Number(data.total) > 0) {
      console.log('   ℹ️  Incidents present. Remove any demo rows with supabase/clear-demo-data.sql')
    }
  } catch (error) {
    record(false, 'dashboard_stats() RPC', error.message)
  }
}

async function checkEdgeFunctions() {
  if (!url || !anon) return
  const fns = [
    'analyze-pothole',
    'assign-officer',
    'calculate-priority',
    'verify-repair',
    'road-insights',
    'reverse-geocode',
  ]
  let undeployed = []
  for (const fn of fns) {
    try {
      const res = await fetch(`${url}/functions/v1/${fn}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}',
      })
      // 404 = not deployed. Any other status means the function exists.
      if (res.status === 404) undeployed.push(fn)
    } catch (error) {
      undeployed.push(`${fn} (${error.message})`)
    }
  }
  record(
    undeployed.length === 0,
    'Edge Functions deployed',
    undeployed.length ? `missing: ${undeployed.join(', ')}` : `all 6 reachable`,
  )
}

async function checkGemini() {
  if (!gemini) return record(false, 'Gemini key', 'GEMINI_API_KEY not set')
  if (!gemini.startsWith('AIza') && !gemini.startsWith('AQ.')) {
    record(false, 'Gemini key format', 'unexpected prefix (expected AIza… or AQ.…)')
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(gemini)}`,
    )
    record(res.ok, 'Gemini API key', res.ok ? `valid • model ${model}` : `HTTP ${res.status}`)
  } catch (error) {
    record(false, 'Gemini API key', error.message)
  }
}

await checkTables()
await checkRpc()
await checkEdgeFunctions()
await checkGemini()

const failed = results.filter((r) => !r.ok)
console.log('='.repeat(44))
if (failed.length === 0) {
  console.log('🎉 All integrated — the app is ready for real-world use.\n')
} else {
  console.log(`⚠️  ${failed.length} check(s) need attention.\n`)
  process.exitCode = 1
}
