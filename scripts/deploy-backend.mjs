#!/usr/bin/env node
/**
 * RoadGuard AI — one-command backend deploy.
 *
 * Deploys all six Gemini-backed Edge Functions, sets the server-only Gemini
 * secrets, and removes every seeded demo incident. Requires a Supabase
 * Personal Access Token (https://supabase.com/dashboard/account/tokens):
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... npm run deploy:backend
 *
 * The token is never written to disk and never printed.
 */
import { execFileSync } from 'node:child_process'
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
const token = env.SUPABASE_ACCESS_TOKEN

const FUNCTIONS = [
  'analyze-pothole',
  'assign-officer',
  'calculate-priority',
  'verify-repair',
  'road-insights',
  'reverse-geocode',
]

/**
 * Idempotent database step:
 *  1. make sure the four private storage buckets exist (they may already have
 *     been created by migration 0003 — `on conflict do nothing` is safe),
 *  2. remove every seeded demo incident.
 * Returns a row so we can print a verification count.
 */
const SETUP_SQL = `
-- Self-registration role (migration 0005): honour CITIZEN/OFFICER from auth
-- metadata and provision an officers row for officers. ADMIN/SUPERVISOR can
-- never be self-granted.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  requested_role text := upper(coalesce(new.raw_user_meta_data ->> 'role', 'CITIZEN'));
  final_role     public.user_role;
begin
  final_role := case
    when requested_role = 'OFFICER' then 'OFFICER'::public.user_role
    else 'CITIZEN'::public.user_role
  end;

  insert into public.profiles (id, full_name, email, avatar_url, role)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    new.email,
    new.raw_user_meta_data ->> 'avatar_url',
    final_role
  )
  on conflict (id) do nothing;

  if final_role = 'OFFICER'::public.user_role then
    insert into public.officers (profile_id, phone, department, status)
    values (new.id, null, 'ROADS', 'AVAILABLE'::public.officer_status)
    on conflict (profile_id) do nothing;
  end if;

  return new;
end;
$fn$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('pothole-images', 'pothole-images', false, 15728640,
   array['image/jpeg','image/png','image/webp','image/heic']),
  ('repair-images', 'repair-images', false, 15728640,
   array['image/jpeg','image/png','image/webp','image/heic']),
  ('avatars', 'avatars', false, 5242880,
   array['image/jpeg','image/png','image/webp']),
  ('reports', 'reports', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

delete from public.potholes where notes = 'DEMO_SEED';
delete from public.potholes
where incident_code in (
  'PTH-1042','PTH-1043','PTH-1044','PTH-1045','PTH-1046',
  'PTH-1047','PTH-1048','PTH-1049','PTH-1050'
);

select
  (select count(*) from storage.buckets) as buckets,
  (select count(*) from public.potholes where notes = 'DEMO_SEED') as demo_rows;
`

function fail(message) {
  console.error(`\n❌ ${message}\n`)
  process.exit(1)
}

if (!token) {
  fail(
    'SUPABASE_ACCESS_TOKEN is not set.\n' +
      'Create one at https://supabase.com/dashboard/account/tokens then run:\n\n' +
      '  SUPABASE_ACCESS_TOKEN=sbp_... npm run deploy:backend',
  )
}

// Derive the project ref from the configured project URL.
let ref = null
try {
  ref = new URL(env.VITE_SUPABASE_URL).host.split('.')[0]
} catch {
  fail('VITE_SUPABASE_URL is missing or invalid in .env')
}
if (!ref) fail('Could not derive the Supabase project ref.')

const geminiKey = env.GEMINI_API_KEY
const geminiModel = env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
if (!geminiKey) fail('GEMINI_API_KEY is missing in .env')

console.log(`\nRoadGuard AI — deploying backend to project "${ref}"\n${'='.repeat(52)}`)

// On Windows the npm shims are .cmd batch files. Node ≥20 refuses to spawn
// those without a shell (ENOENT/EINVAL), so run through the shell there.
function run(args) {
  return execFileSync('npx', ['--yes', 'supabase', ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
  })
}

// 1. Edge Functions ---------------------------------------------------------
for (const fn of FUNCTIONS) {
  console.log(`\n→ Deploying function: ${fn}`)
  run(['functions', 'deploy', fn, '--project-ref', ref])
}

// 2. Server-only secrets ----------------------------------------------------
console.log('\n→ Setting Gemini secrets (server-only)')
run([
  'secrets',
  'set',
  `GEMINI_API_KEY=${geminiKey}`,
  `GEMINI_MODEL=${geminiModel}`,
  '--project-ref',
  ref,
])

// 3. Storage buckets + remove demo data -------------------------------------
console.log('\n→ Ensuring storage buckets and removing seeded demo incidents')
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: SETUP_SQL.trim() }),
})
if (!res.ok) {
  console.error(`⚠️  Could not run the setup SQL automatically (HTTP ${res.status}).`)
  console.error('   Run supabase/clear-demo-data.sql in the Supabase SQL Editor instead.')
} else {
  const rows = await res.json().catch(() => [])
  const summary = Array.isArray(rows) ? rows[0] : rows
  console.log(
    `   Storage buckets present: ${summary?.buckets ?? '?'} · remaining DEMO_SEED rows: ${summary?.demo_rows ?? '?'}`,
  )
}

console.log(`\n${'='.repeat(52)}`)
console.log('✅ Backend deployed. Run `npm run verify:live` to confirm.\n')
