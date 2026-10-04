import { fail, ok } from '../_shared/cors.ts'
import { guard, loadSeverityConfig } from '../_shared/handler.ts'
import {
  DEFAULT_SEVERITY_THRESHOLDS,
  DEFAULT_SEVERITY_WEIGHTS,
  assessPriority,
  type SeverityContext,
  type SeverityThresholds,
  type SeverityWeights,
} from '../_shared/severity.ts'

/**
 * POST /functions/v1/calculate-priority
 *
 * Body: { depth_cm, width_cm, length_cm, area_cm2, traffic_risk, road_type,
 *         near_school, near_hospital, near_intersection, ai_confidence,
 *         depth_confidence, report_count, weights?, thresholds? }
 *
 * The engine is the same one used at intake, so a supervisor can re-score an
 * existing incident after tuning the weights without touching the client.
 */
Deno.serve((req) =>
  guard(req, { auth: true, limit: 60, windowMs: 60_000 }, async (_caller, body) => {
    const num = (key: string): number | null => {
      const value = Number(body[key])
      return Number.isFinite(value) ? value : null
    }

    const width = num('width_cm')
    const length = num('length_cm')
    const depth = num('depth_cm')
    const area = num('area_cm2') ?? (width != null && length != null ? width * length : null)

    const trafficRisk = ['LOW', 'MEDIUM', 'HIGH'].includes(String(body.traffic_risk))
      ? (body.traffic_risk as 'LOW' | 'MEDIUM' | 'HIGH')
      : 'MEDIUM'

    const aiConfidence = clamp(num('ai_confidence') ?? 0.6, 0, 1)
    const depthConfidence = clamp(num('depth_confidence') ?? aiConfidence, 0, 1)
    const reportCount = Math.max(1, Math.round(num('report_count') ?? 1))

    const context: SeverityContext = {
      depthCm: depth,
      areaCm2: area,
      trafficRisk,
      roadType: typeof body.road_type === 'string' ? body.road_type : 'LOCAL',
      nearIntersection: body.near_intersection === true,
      nearHospital: body.near_hospital === true,
      nearSchool: body.near_school === true,
      aiConfidence,
      depthConfidence,
      reportCount,
    }

    const config = await loadSeverityConfig()
    const weights = mergeWeights(config.weights, body.weights)
    const thresholds = mergeThresholds(config.thresholds, body.thresholds)

    if (!Number.isFinite(weights.depth) || weights.depth < 0) {
      return fail('INVALID_INPUT', 'weights must be non-negative numbers.', 422)
    }

    const assessment = assessPriority(context, weights, thresholds)

    return ok({
      assessment,
      severity: assessment.severity,
      priority_level: assessment.priority_level,
      priority_score: assessment.priority_score,
      engine: {
        config_source: config.source,
        weights,
        thresholds,
        defaults: {
          weights: DEFAULT_SEVERITY_WEIGHTS,
          thresholds: DEFAULT_SEVERITY_THRESHOLDS,
        },
      },
      note:
        'Scores are relative triage aids computed from configurable weights. ' +
        'They are not a statutory severity standard.',
    })
  }),
)

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function mergeWeights(base: SeverityWeights, override: unknown): SeverityWeights {
  if (!override || typeof override !== 'object') return base
  const source = override as Record<string, unknown>
  const merged = { ...base }
  for (const key of Object.keys(base) as (keyof SeverityWeights)[]) {
    const value = Number(source[key])
    if (Number.isFinite(value) && value >= 0) merged[key] = value
  }
  return merged
}

function mergeThresholds(base: SeverityThresholds, override: unknown): SeverityThresholds {
  if (!override || typeof override !== 'object') return base
  const source = override as Record<string, unknown>
  const merged = { ...base }
  for (const key of Object.keys(base) as (keyof SeverityThresholds)[]) {
    const value = Number(source[key])
    if (Number.isFinite(value) && value > 0) merged[key] = value
  }
  return merged
}
