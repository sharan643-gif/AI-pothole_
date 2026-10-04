# RoadGuard AI

**See the Damage. Measure the Risk. Fix the Road.**

A full-stack, production-shaped platform for municipal pothole detection, measurement,
prioritisation and repair management. Citizens scan a road with their phone; the system
detects the pothole, estimates its geometry with explicit uncertainty, scores severity and
priority, files a tracked incident, dispatches the nearest available road officer, and
verifies the repair when it is done.

> **Honesty first.** A single smartphone photo cannot yield centimetre-accurate depth.
> RoadGuard never presents a guess as a measurement — every depth value carries a method and a
> confidence, and the UI labels visual estimates as *approximate*. See
> [Measurement honesty](#measurement-honesty).

---

## Table of contents

1. [Project overview](#project-overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Requirements](#requirements)
5. [Installation](#installation)
6. [Supabase setup](#supabase-setup)
7. [Database migration](#database-migration)
8. [Storage setup](#storage-setup)
9. [RLS setup](#rls-setup)
10. [Gemini API setup](#gemini-api-setup)
11. [Map setup](#map-setup)
12. [Environment variables](#environment-variables)
13. [Edge Function deployment](#edge-function-deployment)
14. [Local development](#local-development)
15. [Production deployment](#production-deployment)
16. [Account types](#account-types)
17. [Going live](#going-live)
18. [Measurement honesty](#measurement-honesty)
19. [Testing](#testing)
20. [Project structure](#project-structure)
21. [Data model](#data-model)
22. [Incident lifecycle](#incident-lifecycle)
23. [Security model](#security-model)
24. [Known limitations](#known-limitations)
25. [Troubleshooting](#troubleshooting)
26. [Layout & design system](#layout--design-system)

---

## Project overview

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion, Lucide |
| Maps | MapLibre GL JS (no key required by default) |
| Globe | Three.js via React Three Fiber + Drei (no key required) |
| Charts | Recharts (lazily loaded) |
| Backend | Supabase PostgreSQL, Auth, Storage, Realtime, Edge Functions (Deno) |
| AI | Google Gemini (`gemini-3.5-flash-lite` by default) |
| Validation | Zod on both the client and inside edge functions |
| Tests | Vitest + Testing Library |

Everything privileged — AI calls, officer dispatch, repair verification — runs inside Supabase
Edge Functions. The browser only ever holds the Supabase anon key.

---

## Features

**Citizen**

- **Live AI detection** — a real-time mode that samples the feed to Gemini a few
  times a second, draws animated bounding boxes over the video with severity,
  dimensions and depth, and files an incident from a confirmed detection
- **3D world globe** — a rotating, zoomable Three.js globe (no map key) plotting
  every incident as a severity-coloured marker with assign/resolve actions
- One-tap AI road scan with a custom iOS-style camera (torch, camera switch, gallery import)
- Animated multi-stage scanning readout and detection frames with measurement labels
- Explicit severity, priority score, risk and depth-confidence display
- Real GPS capture with accuracy disclosure; reverse-geocoded address
- Incident filing, live status tracking and notifications
- Offline capture: reports are queued in IndexedDB and uploaded automatically

**Officer**

- Availability control (`AVAILABLE` / `BUSY` / `ON_SITE` / `OFFLINE`)
- Accept → travel → arrive → repair workflow with live status propagation
- Navigate-to-pothole with distance, ETA and a direction link
- Before/after photo upload and AI-assisted repair verification

**Administrator**

- Aggregate statistics computed from live rows (no placeholder figures)
- Severity, zone, trend, workflow and officer-workload charts
- Priority heatmap with density-by-cell breakdown
- Critical backlog triage and officer roster management
- "AI Road Intelligence" insights grounded in real aggregates

**Platform**

- Row Level Security on every table, with role-aware policies
- Realtime updates for incidents, assignments and notifications
- Configurable severity weights and thresholds stored in PostgreSQL
- Typed error surface with user-actionable messages for every failure path
- Accessibility: ARIA labelling, keyboard navigation, reduced-motion support

---

## Architecture

```
React (browser)
  │
  ├── Supabase Auth          sessions, roles
  ├── Supabase Database      incidents, officers, assignments (RLS)
  ├── Supabase Storage       private buckets + signed URLs
  ├── Supabase Realtime      live status fan-out
  └── Supabase Edge Functions
            ├── analyze-pothole      → Gemini + depth fusion + validation
            ├── assign-officer       → ranked nearest-officer dispatch
            ├── calculate-priority   → configurable scoring engine
            ├── verify-repair        → before/after comparison
            ├── road-insights        → grounded aggregate narratives
            └── reverse-geocode      → Mapbox (secret token) or Nominatim
```

The frontend talks to the backend through a single `Repository` interface with exactly one
implementation: `LiveRepository`. Every read and write goes to the configured Supabase project,
so nothing on screen can ever be sample data.

---

## Requirements

- Node.js 20+ (developed on Node 24) and npm
- A Supabase project (free tier is fine)
- A Google Gemini API key
- Optional: Supabase CLI, Mapbox token for turn-by-turn routing

---

## Installation

```bash
git clone <your-repo-url> roadguard-ai
cd roadguard-ai
npm install
cp .env.example .env      # then fill in your values
npm run dev
```

The app is live-only: fill in real Supabase credentials in `.env` before starting, then run
`npm run verify:live` to confirm the backend is reachable.

---

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Copy **Project URL** and the **anon public key** from *Project Settings → API* into `.env`.
3. Enable the sign-in providers you need under *Authentication → Providers*:
   - Email/password is enabled by default.
   - Google requires a client ID/secret from Google Cloud Console; set the authorised
     redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`.
4. Under *Authentication → URL Configuration*, add your dev and production origins
   (`http://localhost:5173`, plus your deployed domain) to the redirect allow-list.

Keep the **service-role key** out of `.env`. It is used only inside edge functions, where the
Supabase runtime injects it automatically.

---

## Database migration

Migrations live in `supabase/migrations` and run in filename order:

| File | Contents |
| --- | --- |
| `20260101000001_schema.sql` | Extensions, enums, tables, indexes |
| `20260101000002_rls.sql` | Row Level Security policies and role helpers |
| `20260101000003_functions.sql` | Functions, triggers, storage buckets, config seed, realtime |
| `20260101000004_seed.sql` | No-op — the database starts empty |
| `20260101000005_self_signup_role.sql` | Public/Officer self-registration role + officers-row provisioning |

### Option A — Supabase CLI (recommended)

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

### Option B — SQL editor

Paste each migration into *SQL Editor* in order and run it. The files are written to be run
top-to-bottom exactly once.

After migrating you should have: `profiles`, `officers`, `potholes`, `pothole_analysis`,
`assignments`, `repair_records`, `notifications`, `severity_config`, `scan_queue`, plus four
storage buckets and the seeded severity configuration. The database starts **empty** —
migration `0004` seeds no incidents.

If you migrated from an older revision that inserted five sample rows, remove them once with
`supabase/clear-demo-data.sql` (SQL Editor) or `psql "$DATABASE_URL" -f supabase/clear-demo-data.sql`.

---

## Storage setup

Migration `0003` creates four **private** buckets:

| Bucket | Purpose | Limit |
| --- | --- | --- |
| `pothole-images` | Citizen scan captures | 15 MB |
| `repair-images` | Officer before/after repairs | 15 MB |
| `avatars` | Profile images | 5 MB |
| `reports` | Generated PDF exports | 15 MB |

Objects are namespaced `<bucket>/<auth.uid()>/<file>`, and the storage policies enforce that
namespace, so one user can never read or overwrite another's uploads. Officers and admins get
read access to civic imagery. Because buckets are private, the client resolves paths to
short-lived signed URLs (`useSignedImage`).

---

## RLS setup

Every table has RLS enabled. Summary of the policy model:

| Actor | Can do |
| --- | --- |
| **Citizen** | Create reports, read their own reports, read public incident status, read/update their own notifications |
| **Officer** | Read assigned incidents, advance their own assignment status, upload repair images, submit repairs, update their own officer record |
| **Admin / Supervisor** | Manage officers and profiles, dispatch/reassign, tune `severity_config`, read everything, view analytics |

A role-escalation guard trigger prevents any non-admin from changing a profile's `role`
column; promoting a profile to `OFFICER` provisions an `officers` row automatically.

Helper functions (`current_role_name()`, `is_admin()`, `is_officer()`, `my_officer_id()`) are
`SECURITY DEFINER` so policies never recurse into `profiles`.

---

## Gemini API setup

1. Create an API key in [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Store it as an edge-function secret — **never** in `.env`:

```bash
supabase secrets set GEMINI_API_KEY=your_key_here
# optional overrides
supabase secrets set GEMINI_MODEL=gemini-3.5-flash-lite
```

The key is read inside the function at request time and is never returned to the client.

Prompt design (see `supabase/functions/_shared/prompts.ts`):

- Prompts are versioned; the version is stored with every analysis so a score is traceable to
  the exact instructions that produced it.
- The model is told explicitly not to invent precision, and to report low confidence when no
  scale reference is present.
- Responses are parsed defensively (markdown fences, surrounding prose) and validated with Zod
  against physical bounds before anything is trusted.
- Rejected responses are still written to `pothole_analysis` for audit.

---

## Map setup

The default basemap is the free CARTO dark style, so **no map key is required**.

To use your own style, set `VITE_MAP_STYLE_URL` to a MapLibre-compatible style JSON.

For server-side geocoding and higher rate limits, add a Mapbox token as an edge secret:

```bash
supabase secrets set MAPBOX_SECRET_TOKEN=pk.your_mapbox_token
```

When it is absent, `reverse-geocode` falls back to OpenStreetMap Nominatim. Turn-by-turn
routing degrades to a straight bearing line plus a distance/ETA estimate, and the UI says so.

---

## Environment variables

### Client (`.env`)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes (for live mode) | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes (for live mode) | Public anon key, guarded by RLS |
| `VITE_MAP_STYLE_URL` | No | Custom MapLibre style |
| `VITE_MAPBOX_TOKEN` | No | Public Mapbox token for a Mapbox basemap |
| `VITE_GLOBE_TEXTURE_URL` | No | Equirectangular earth texture for the 3D globe |

### Edge Function secrets (server-only)

| Secret | Required | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Gemini access |
| `GEMINI_MODEL` | No | Model override (default `gemini-3.5-flash-lite`) |
| `MAPBOX_SECRET_TOKEN` | No | Server-side geocoding |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Injected by the runtime; never expose it |

---

## Edge Function deployment

```bash
supabase functions deploy analyze-pothole
supabase functions deploy assign-officer
supabase functions deploy calculate-priority
supabase functions deploy verify-repair
supabase functions deploy road-insights
supabase functions deploy reverse-geocode
```

Or all at once:

```bash
supabase functions deploy
```

`supabase/config.toml` sets `verify_jwt = false` for these functions because each one performs
its own explicit JWT resolution and role check, returning typed `401`/`403` responses rather
than an opaque gateway error.

### API surface

| Function | Method | Body |
| --- | --- | --- |
| `analyze-pothole` | POST | `{ image_url \| image_base64, latitude, longitude, road_type?, near_*? , traffic_risk?, reference_size_cm?, depth_samples_cm?, depth_method_hint? }` |
| `assign-officer` | POST | `{ pothole_id, max_radius_km?, zone?, department? }` |
| `calculate-priority` | POST | `{ depth_cm?, width_cm?, length_cm?, area_cm2?, traffic_risk?, road_type?, near_*?, ai_confidence?, weights?, thresholds? }` |
| `verify-repair` | POST | `{ pothole_id, after_image_url, before_image_url?, repair_notes?, repair_type?, material? }` |
| `road-insights` | POST | `{ window_days? }` |
| `reverse-geocode` | POST | `{ latitude, longitude }` |

All responses use a consistent envelope: `{ "ok": true, ... }` or
`{ "ok": false, "error": { "code", "message" } }`.

---

## Local development

```bash
npm run dev        # Vite dev server on http://localhost:5173
npm run typecheck  # tsc -b
npm run test       # Vitest (single run)
npm run test:watch # Vitest watch
npm run lint       # oxlint
npm run build      # typecheck + production bundle
```

To run the full local Supabase stack:

```bash
supabase start          # local Postgres, Auth, Storage, Studio
supabase db reset       # apply migrations
supabase functions serve --env-file ./supabase/.env.local
```

Then point `VITE_SUPABASE_URL` at the local API URL printed by `supabase start`.

> The camera requires a secure context. `http://localhost` qualifies; a plain-HTTP LAN address
> does not. Use a tunnel (e.g. `ngrok http 5173`) when testing on a physical phone.

---

## Production deployment

1. **Frontend** — build with `npm run build` and deploy `dist/` to any static host
   (Vercel, Netlify, Cloudflare Pages, S3 + CloudFront).
2. **Set client env vars** in the host's build settings (the `VITE_*` values).
3. **Deploy edge functions** with `supabase functions deploy`.
4. **Set function secrets** with `supabase secrets set`.
5. **Add the production origin** to Supabase Auth's redirect allow-list and to
   `additional_redirect_urls` if you deploy the CLI config.
6. **Verify RLS** by signing in as a citizen and confirming you cannot read another user's
   notifications or modify an officer's record.

### Go-live checklist

The repository is live-only — there is no demo fallback — so the two moving parts are the
Supabase project and the Gemini key. Confirm them with one command:

```bash
npm run verify:live
```

It checks the credentials, all nine tables, the `dashboard_stats` RPC, the six Edge Functions
and the Gemini key, and prints exactly what is missing.

To deploy the backend and scrub any seeded demo rows in one step (needs a
[personal access token](https://supabase.com/dashboard/account/tokens)):

```bash
SUPABASE_ACCESS_TOKEN=sbp_... npm run deploy:backend
```

---

## Account types

The sign-in and create-account screens offer two segments:

| Segment | Role | What it unlocks |
| --- | --- | --- |
| **Public** | `CITIZEN` | Scan & report potholes, track their status, incident map & globe |
| **Officer** | `OFFICER` | Assignment queue, navigation to site, AI repair verification |

The chosen segment sets the profile role at sign-up (via `raw_user_meta_data.role`). Only
`CITIZEN` and `OFFICER` can be self-selected — `ADMIN`/`SUPERVISOR` are admin-granted and any
other value is downgraded to `CITIZEN` server-side. Signing in as the wrong segment is harmless:
the route guards read the real role from the database and redirect.

---

## Going live

RoadGuard AI is **live-only**. There is no bundled sample dataset, no demo banner and no demo
sign-in: every incident, officer and notification comes from your Supabase project, and every AI
call is a real Gemini call through an Edge Function.

That means two things must be configured before the app is useful:

1. **Supabase** — `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`, with the
   migrations applied to that project.
2. **Gemini** — the `GEMINI_API_KEY` Edge Function secret (server-only, never `VITE_`-prefixed).

Run `npm run verify:live` to confirm both. Until they are set, sign-in and AI analysis fail with
a clear configuration error rather than fabricating data.

---

## Measurement honesty

This is the part most systems get wrong, so it is worth stating plainly.

Depth is resolved through a `DepthProvider` abstraction (`src/lib/depth.ts`) that picks the
most trustworthy source available and labels the result honestly:

```
LiDAR / AR depth  →  Stereo / model depth  →  Scale reference  →  Monocular estimate
```

A single RGB photograph has **no absolute scale**. RoadGuard therefore separates what it
measures from what it infers:

| Source | `depth_method` | Reported as |
| --- | --- | --- |
| AR/LiDAR/ARCore depth samples | `AR_DEPTH_SENSOR` | Measured |
| Monocular depth model output | `MONOCULAR_DEPTH_ESTIMATION` | Measured (model) |
| Known-size reference in frame | `REFERENCE_OBJECT` | Calibrated |
| Vision reasoning only | `VISION_ESTIMATE` | **Approximate** |

Every depth value is stored and displayed with its provenance:

```json
{
  "depth_value": 8.4,
  "depth_unit": "cm",
  "depth_method": "MONOCULAR_DEPTH_ESTIMATION",
  "depth_confidence": 0.72
}
```

When only a visual estimate is available the UI shows *"Approximate depth"*, an explicit
confidence percentage, and an explanation of why. The edge function enforces this: if no depth
samples are supplied, `measurement_confidence` is capped at `0.55` and the panel switches
wording. The API accepts `depth_samples_cm` and `depth_method_hint`, so a native wrapper — or a
browser depth/ML pipeline — can upgrade the estimate to a real measurement without any backend
change.

Gemini's job is **visual reasoning**: damage classification, boundary description, risk
assessment and selecting the recommended action. It is never the authority for geometry.

---

## Testing

```bash
npm run test        # 56 tests across the engine, validation, UI and shell
npm run typecheck
npm run build
```

Coverage of what matters:

| Suite | What it proves |
| --- | --- |
| `src/lib/severity.test.ts` | Depth/area scoring, band mapping, context outranking depth, low-confidence discounting, weight normalisation, recurrence |
| `src/lib/schemas.test.ts` | Negative/oversized measurements rejected, confidence bounds enforced, unknown enums rejected, JSON extraction from fences and prose, sanitiser stripping sub-floor depth |
| `src/components/pothole/PotholeComponents.test.tsx` | Unit formatting, em-dash for unknown values, measured vs approximate depth wording, card interaction, timeline progression |
| `src/components/layout/AppShell.test.tsx` | Sidebar/tab-bar navigation, active-section marking, role-specific sections, hidden nav on camera screens |

The edge functions are Deno modules and are not executed by Vitest (they use `npm:` specifiers
and `Deno.env`). Their pure logic is mirrored in `src/lib/severity.ts` and `src/lib/schemas.ts`,
which *are* covered — the mirror is deliberate so client previews and stored scores cannot
drift. To exercise the functions themselves, run them against the local stack and post to
`/functions/v1/<name>`.

---

## Project structure

```
src/
├── components/
│   ├── ui/            Liquid-glass surfaces, buttons, sheets, rings, skeletons
│   ├── layout/        Responsive shell: desktop rail + floating tab bar
│   ├── camera/        Scan interface, live detection overlay, scanning sweep
│   ├── pothole/       Cards, measurement grids, depth provenance, timeline
│   ├── map/           MapLibre view, markers, heatmap, legend
│   ├── globe/         Three.js world globe with incident markers
│   └── dashboard/     Stat grids, insights, charts (lazily loaded)
├── context/           Auth, toast and scan-session providers
├── hooks/             Async data, geolocation, camera, realtime, offline
├── lib/               Config, constants, utils, severity engine, Zod schemas,
│                      depth providers (depth.ts), geo projection (geo.ts)
├── pages/             Home, Scan, LiveScan, ScanResult, Map, Globe, Reports,
│                      ReportDetail, Profile, OfficerDashboard, AdminDashboard, Login
├── services/          Repository interface and the live Supabase implementation,
│                      edge-function client, IndexedDB offline queue
├── test/              Vitest setup and polyfills
└── types/             Shared domain model

supabase/
├── functions/
│   ├── _shared/       cors, handler guards, gemini, severity, schemas, prompts
│   ├── analyze-pothole/
│   ├── assign-officer/
│   ├── calculate-priority/
│   ├── verify-repair/
│   ├── road-insights/
│   └── reverse-geocode/
└── migrations/
```

---

## Data model

| Table | Purpose |
| --- | --- |
| `profiles` | One row per auth user, holds `role` |
| `officers` | Field officers: position, availability, zone, specialization |
| `potholes` | Incidents with measurements, provenance, severity and priority |
| `pothole_analysis` | Append-only AI audit trail, including rejected responses |
| `assignments` | Dispatch history with distance, ETA and score |
| `repair_records` | Before/after images and the AI verification verdict |
| `notifications` | Per-user notification feed |
| `severity_config` | Tunable weights and thresholds (data, not constants) |
| `scan_queue` | Server-side audit of queued device scans |

Severity weights live in `severity_config` and are loaded by both the edge function and the
client preview. The defaults implement:

```
priority = depth·0.30 + area·0.20 + traffic·0.20 + location_risk·0.15 + confidence·0.15 + recurrence·0.05
```

Weights are normalised, so a jurisdiction can add or remove terms without rebalancing. These are
triage aids, not statutory standards — the UI and API both say so.

---

## Incident lifecycle

```
DETECTED → REPORTED → ASSIGNED → ACCEPTED → EN_ROUTE → ON_SITE → UNDER_REPAIR → AI_VERIFICATION → RESOLVED
                                                                                              ↘ (review) ↺
```

- Citizens cannot edit severity or priority — those columns are engine-owned.
- A unique partial index guarantees at most one live assignment per incident.
- Database triggers fan out notifications on creation, status change and assignment, so the
  realtime feed works even if a client bypasses the UI.

---

## Security model

- The browser holds only the anon key; RLS is the enforcement boundary.
- `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` exist only as edge-function secrets.
- Edge functions resolve the caller's JWT themselves and check role before acting.
- Best-effort per-user rate limiting (20 req/min by default, 12/min for AI analysis) inside a
  shared `guard()` pipeline. For hard guarantees, back it with a Postgres or Redis counter.
- Zod validation runs on both sides of the AI boundary.
- Storage objects are namespaced per user and served via short-lived signed URLs.
- Debug builds of the AI client never log credentials.

---

## Known limitations

Stated plainly rather than hidden:

- **Depth from a single photo is an estimate.** Browser APIs cannot access LiDAR or ARCore
  depth directly; the API accepts depth samples so a native shell can supply them.
- **Reverse geocoding** depends on an external service; when it fails the raw coordinates are
  kept and reported as such.
- **Routing** falls back to a straight-line bearing with a speed-based ETA when no Mapbox token
  is configured. The UI labels it as an estimate, never as turn-by-turn.
- **AI repair verification is assistive.** It never marks work as officially inspected, and an
  inconclusive verdict parks the incident for human review instead of auto-closing it.
- **Realtime** requires the Supabase project's Realtime feature; without credentials the UI
  simply does not claim to be live.
- **Edge functions are not covered by Vitest.** Their pure logic is mirrored and tested; the
  Deno entrypoints require the local Supabase stack.

---

## Troubleshooting

**"This deployment is running without Supabase credentials"**
`.env` is missing or unread. Copy `.env.example`, fill in `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, and restart the dev server (Vite only reads `.env` at startup).

**Camera never starts**
`getUserMedia` requires a secure context. Use `http://localhost`, an HTTPS tunnel, or a
production domain — not a plain-HTTP LAN IP. Also check the browser's camera permission.

**"Camera not allowed" persists after granting**
Chrome caches a per-origin denial. Reset it via the padlock icon in the address bar, then reload.

**Location accuracy is always low**
Expose the device outdoors, enable precise location in OS settings, and allow the browser
permission. The UI deliberately shows the raw accuracy radius instead of hiding it.

**`analyze-pothole` returns `AI_FAILED`**
Check the secret: `supabase secrets list`. A `429` from the function means Gemini rate limiting
— the client surfaces it as a retryable error and keeps the capture.

**`AI_INVALID_RESPONSE`**
Gemini returned values outside the accepted physical range. Nothing was saved, and the rejected
payload is in `pothole_analysis` for inspection. Bump `PROMPT_VERSION` in
`supabase/functions/_shared/prompts.ts` when you change the prompt.

**Assignment always returns "no available officer"**
Officers must have `status = 'AVAILABLE'`, a matching `department` (`ROADS` by default), and
coordinates within `max_radius_km` (15 km). Offline or coordinate-less officers are never
selected.

**Map renders blank**
MapLibre needs WebGL. The app detects the failure and shows an explanatory panel with the list
view still usable. If you supply `VITE_MAP_STYLE_URL`, verify the style JSON is reachable and
allows your origin.

**`npm run test` fails on IndexedDB**
The offline queue is defensive: when IndexedDB is unavailable (some jsdom setups, private
browsing) queueing is a no-op and reporting continues online.

---

Built as a real full-stack product, not a prototype: every important feature is wired to a
functioning backend, and every uncertainty is displayed rather than smoothed over.

---

## Layout & design system

The interface is one design language rendered for two form factors. There is no phone
mock-up on desktop — a desktop gets a real desktop layout.

| | Phones (< 1024px) | Desktop (≥ 1024px) |
| --- | --- | --- |
| Navigation | Floating liquid-glass tab bar, thumb-reachable | Persistent glass sidebar rail with section hints and role-aware entries |
| Content | Full-bleed, single column | Rounded glass panel beside the rail, scrolling independently |
| Grids | Single column | 12-column splits (Home), multi-column analytics (Admin) |
| Modals | Bottom sheets, drag to dismiss | Centred sheets, rounded on all corners |
| Camera | Full viewport | Camera framed inside a rounded glass panel |

Both navigation presentations are always mounted; CSS alone decides which is visible, so the
breakpoint never remounts a screen or drops scroll position.

### The liquid-glass material

`src/index.css` defines three layers that together approximate Apple's liquid glass:

1. **Refractive body** — a 135° gradient that is brightest at the light-facing corner, over a
   dark tint, with `backdrop-filter: blur(28px) saturate(180%) brightness(1.06)`.
2. **Lensed edge** — a gradient rim painted with a `mask-composite: exclude` border, plus
   top-weighted inset highlights that read as a lit 1px edge.
3. **Pointer specular** — `LiquidGlass` writes `--sx` / `--sy` on pointer move; a radial
   gradient follows the cursor. Touch input never triggers it.

Two materials keep mobile fast: `.liquid` / `.liquid-deep` for surface-level chrome, and the
lighter `.glass` for nested cards, which avoids stacked `backdrop-filter` compositing on
low-end devices while still gaining the same lensed rim.

Ambient light orbs drift behind the glass (`AmbientBackdrop`). They are `aria-hidden`, frozen by
`prefers-reduced-motion`, and never intercept pointer events.

### Accessibility guarantees

- Sidebar and tab bar carry distinct accessible names (`Sidebar` / `Primary` / `Tab bar`) so
  screen-reader users are never given two identically labelled navigations.
- `aria-current="page"` tracks the active section in both presentations.
- All decorative layers are `aria-hidden`; every interactive element is a real `button` or `a`.
- `prefers-reduced-motion` collapses animations and transitions globally.
