import { ok } from '../_shared/cors.ts'
import { GeminiError, extractJson, generateText } from '../_shared/gemini.ts'
import { guard } from '../_shared/handler.ts'
import { insightPhrasingPrompt } from '../_shared/prompts.ts'
import { adminClient } from '../_shared/supabase.ts'

/**
 * POST /functions/v1/road-insights
 *
 * Body: { window_days? }
 *
 * Every figure is computed from the database first. Gemini is then asked only
 * to *phrase* those figures — and its output is discarded if it introduces a
 * number that was not in the source statistics. This is what keeps the
 * dashboard from ever showing invented "statistics" (spec section 29).
 */
Deno.serve((req) =>
  guard(req, { auth: true, staff: true, limit: 10, windowMs: 60_000 }, async (_caller, body) => {
    const windowDays = Math.min(Math.max(Number(body.window_days) || 30, 7), 180)
    const admin = adminClient()

    const now = Date.now()
    const windowStart = new Date(now - windowDays * 86_400_000).toISOString()
    const previousStart = new Date(now - windowDays * 2 * 86_400_000).toISOString()

    const [currentRes, previousRes, openRes, repeatRes, resolutionRes] = await Promise.all([
      admin
        .from('potholes')
        .select('zone, severity, priority_level, created_at')
        .gte('created_at', windowStart),
      admin
        .from('potholes')
        .select('zone')
        .gte('created_at', previousStart)
        .lt('created_at', windowStart),
      admin
        .from('potholes')
        .select('id, incident_code, severity, priority_level, zone, depth_cm, status')
        .eq('severity', 'CRITICAL')
        .neq('status', 'RESOLVED'),
      admin
        .from('potholes')
        .select('id, incident_code, zone, report_count, severity')
        .gt('report_count', 1),
      admin
        .from('potholes')
        .select('created_at, updated_at')
        .eq('status', 'RESOLVED')
        .gte('created_at', previousStart),
    ])

    const current = currentRes.data ?? []
    const previous = previousRes.data ?? []
    const openCritical = openRes.data ?? []
    const repeats = repeatRes.data ?? []
    const resolved = resolutionRes.data ?? []

    // ---- zone deltas ------------------------------------------------
    const countBy = (rows: { zone: string | null }[]) => {
      const map = new Map<string, number>()
      for (const row of rows) {
        const zone = row.zone ?? 'UNASSIGNED'
        map.set(zone, (map.get(zone) ?? 0) + 1)
      }
      return map
    }
    const currentByZone = countBy(current)
    const previousByZone = countBy(previous)

    const zoneDeltas = [...currentByZone.entries()]
      .map(([zone, count]) => {
        const before = previousByZone.get(zone) ?? 0
        const pct = before === 0 ? (count > 0 ? 100 : 0) : ((count - before) / before) * 100
        return { zone, current: count, previous: before, changePct: Math.round(pct) }
      })
      .sort((a, b) => b.changePct - a.changePct)

    const fastestRising = zoneDeltas.find((z) => z.changePct > 0) ?? null

    // ---- roads needing preventive inspection ------------------------
    const mediumPlusByZone = new Map<string, number>()
    for (const row of current) {
      if (row.severity === 'MEDIUM' || row.severity === 'HIGH') {
        const zone = row.zone ?? 'UNASSIGNED'
        mediumPlusByZone.set(zone, (mediumPlusByZone.get(zone) ?? 0) + 1)
      }
    }
    const inspectionZones = [...mediumPlusByZone.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])

    // ---- mean resolution time (hours) -------------------------------
    const resolutionHours = resolved
      .map(
        (row) =>
          (new Date(row.updated_at).getTime() - new Date(row.created_at).getTime()) / 3_600_000,
      )
      .filter((h) => Number.isFinite(h) && h >= 0)
    const avgResolutionHours = resolutionHours.length
      ? Math.round((resolutionHours.reduce((a, b) => a + b, 0) / resolutionHours.length) * 10) / 10
      : null

    const totalCurrent = current.length
    const totalPrevious = previous.length
    const overallChangePct =
      totalPrevious === 0
        ? totalCurrent > 0
          ? 100
          : 0
        : Math.round(((totalCurrent - totalPrevious) / totalPrevious) * 100)

    const stats = {
      window_days: windowDays,
      total_current: totalCurrent,
      total_previous: totalPrevious,
      overall_change_pct: overallChangePct,
      unresolved_critical: openCritical.length,
      repeat_locations: repeats.length,
      zones_needing_inspection: inspectionZones.length,
      inspection_zones: inspectionZones.slice(0, 3).map(([zone, count]) => ({ zone, count })),
      fastest_rising_zone: fastestRising,
      avg_resolution_hours: avgResolutionHours,
      top_open_critical: openCritical
        .slice(0, 3)
        .map((row) => ({ code: row.incident_code, zone: row.zone, depth_cm: row.depth_cm })),
    }

    // ---- deterministic, guaranteed-grounded insights ----------------
    const fallback = buildInsights(stats)

    // ---- optional phrasing pass, guarded against invented numbers ----
    let insights = fallback
    let source: 'gemini' | 'deterministic' = 'deterministic'
    try {
      const text = await generateText({
        prompt: insightPhrasingPrompt(stats),
        temperature: 0.2,
        timeoutMs: 20_000,
      })
      const parsed = extractJson(text) as { insights?: unknown }
      const candidate = Array.isArray(parsed.insights) ? parsed.insights : []
      const allowed = new Set(collectNumbers(stats))
      const cleaned = candidate
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
          id: String(item.id ?? crypto.randomUUID()),
          headline: String(item.headline ?? ''),
          detail: String(item.detail ?? ''),
          severity: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(item.severity))
            ? (item.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL')
            : ('MEDIUM' as const),
        }))
        .filter((item) => item.headline.length > 0 && numbersAreGrounded(item, allowed))

      if (cleaned.length > 0) {
        insights = cleaned
        source = 'gemini'
      }
    } catch (error) {
      if (!(error instanceof GeminiError)) {
        console.error('[road-insights] phrasing failed:', error)
      }
      // Deliberately silent: the deterministic insights are already valid.
    }

    return ok({
      stats,
      insights,
      narration_source: source,
      generated_at: new Date().toISOString(),
      note: 'All figures are computed from live incident records; no values are simulated.',
    })
  }),
)

// ---------------------------------------------------------------------

interface InsightStats {
  window_days: number
  overall_change_pct: number
  unresolved_critical: number
  repeat_locations: number
  zones_needing_inspection: number
  inspection_zones: { zone: string; count: number }[]
  fastest_rising_zone: { zone: string; changePct: number; current: number } | null
  avg_resolution_hours: number | null
  top_open_critical: { code: string; zone: string | null; depth_cm: number | null }[]
}

function buildInsights(stats: InsightStats) {
  const out: {
    id: string
    headline: string
    detail: string
    metric: string | null
    trend: 'up' | 'down' | 'flat'
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  }[] = []

  if (stats.overall_change_pct !== 0) {
    out.push({
      id: 'overall-trend',
      headline: `Pothole reports ${
        stats.overall_change_pct > 0 ? 'increased' : 'decreased'
      } ${Math.abs(stats.overall_change_pct)}% over the last ${stats.window_days} days`,
      detail: 'Compared with the preceding period of the same length.',
      metric: `${stats.overall_change_pct > 0 ? '+' : ''}${stats.overall_change_pct}%`,
      trend: stats.overall_change_pct > 0 ? 'up' : 'down',
      severity: stats.overall_change_pct > 25 ? 'HIGH' : 'MEDIUM',
    })
  }

  if (stats.fastest_rising_zone) {
    out.push({
      id: 'rising-zone',
      headline: `Zone ${stats.fastest_rising_zone.zone} rose ${Math.abs(
        stats.fastest_rising_zone.changePct,
      )}%`,
      detail: `${stats.fastest_rising_zone.current} reports in the last ${stats.window_days} days.`,
      metric: `${stats.fastest_rising_zone.current} reports`,
      trend: 'up',
      severity: stats.fastest_rising_zone.changePct > 40 ? 'HIGH' : 'MEDIUM',
    })
  }

  if (stats.zones_needing_inspection > 0) {
    out.push({
      id: 'inspection',
      headline: `${stats.zones_needing_inspection} zone(s) require preventive inspection`,
      detail: stats.inspection_zones
        .map((z) => `${z.zone} (${z.count})`)
        .join(', '),
      metric: `${stats.zones_needing_inspection} zones`,
      trend: 'up',
      severity: 'MEDIUM',
    })
  }

  out.push({
    id: 'critical-open',
    headline: `${stats.unresolved_critical} critical pothole(s) remain unresolved`,
    detail: stats.top_open_critical.length
      ? `Oldest open: ${stats.top_open_critical.map((c) => c.code).join(', ')}.`
      : 'No open critical incidents in the current queue.',
    metric: `${stats.unresolved_critical} open`,
    trend: stats.unresolved_critical > 0 ? 'up' : 'flat',
    severity: stats.unresolved_critical > 0 ? 'CRITICAL' : 'LOW',
  })

  if (stats.repeat_locations > 0) {
    out.push({
      id: 'recurrence',
      headline: `${stats.repeat_locations} location(s) reported more than once`,
      detail: 'Repeat defects may indicate a drainage or sub-base failure.',
      metric: `${stats.repeat_locations} repeat`,
      trend: 'flat',
      severity: 'MEDIUM',
    })
  }

  if (stats.avg_resolution_hours != null) {
    out.push({
      id: 'resolution-time',
      headline: `Average resolution time is ${stats.avg_resolution_hours} hours`,
      detail: 'Measured from report creation to verified closure.',
      metric: `${stats.avg_resolution_hours} h`,
      trend: 'flat',
      severity: 'LOW',
    })
  }

  return out
}

/** Collect every numeric literal present in the computed statistics. */
function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === 'number') out.push(value)
  else if (typeof value === 'string') {
    for (const match of value.matchAll(/-?\d+(\.\d+)?/g)) out.push(Number(match[0]))
  } else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out))
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectNumbers(v, out))
  }
  return out
}

/** Reject any phrased insight that cites a figure absent from the source data. */
function numbersAreGrounded(
  item: { headline: string; detail: string },
  allowed: Set<number>,
): boolean {
  const text = `${item.headline} ${item.detail}`
  const cited = [...text.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]))
  return cited.every((n) => allowed.has(n) || allowed.has(Math.abs(n)))
}
