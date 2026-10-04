import { ROAD_TYPE_RISK, type RoadType } from '@/lib/constants'
import { clamp, round } from '@/lib/utils'
import type { PriorityAssessment, PriorityLevel, RiskLevel, Severity } from '@/types'

/**
 * Severity / priority engine.
 *
 * This module is intentionally pure and data-driven: the weights and cut points
 * live in `severity_config` (PostgreSQL) and are passed in here. The defaults
 * below are a defensible starting point, NOT an authoritative civic standard —
 * every term is tunable per jurisdiction.
 *
 * The identical algorithm runs server-side in
 * `supabase/functions/_shared/severity.ts` so client previews and stored
 * scores can never drift apart.
 */

export interface SeverityWeights {
  depth: number
  area: number
  traffic: number
  location_risk: number
  confidence: number
  recurrence: number
}

export interface SeverityThresholds {
  /** Score at/above which each level applies. */
  critical: number
  high: number
  medium: number
  /** Depth (cm) mapped to a full 100 depth score. */
  depthMaxCm: number
  /** Area (cm²) mapped to a full 100 area score. */
  areaMaxCm2: number
  /** Reports at which the recurrence term saturates. */
  recurrenceMaxReports: number
}

/** Section 6 conceptual formula, plus an optional recurrence term. */
export const DEFAULT_SEVERITY_WEIGHTS: SeverityWeights = {
  depth: 0.3,
  area: 0.2,
  traffic: 0.2,
  location_risk: 0.15,
  confidence: 0.15,
  recurrence: 0.05,
}

export const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = {
  critical: 80,
  high: 60,
  medium: 40,
  depthMaxCm: 25,
  areaMaxCm2: 20000,
  recurrenceMaxReports: 5,
}

export interface SeverityContext {
  depthCm: number | null
  areaCm2: number | null
  trafficRisk: RiskLevel
  roadType: RoadType
  nearIntersection?: boolean
  nearSchool?: boolean
  nearHospital?: boolean
  /** Gemini/vision confidence, 0..1. */
  aiConfidence: number
  /** Depth-method confidence, 0..1. */
  depthConfidence?: number
  /** How many times this location has been reported. */
  reportCount?: number
}

const RISK_SCORE: Record<RiskLevel, number> = { LOW: 34, MEDIUM: 67, HIGH: 100 }

export function scoreDepth(depthCm: number | null, thresholds: SeverityThresholds): number {
  if (depthCm == null || depthCm <= 0) return 25 // unknown depth — conservative floor
  return clamp((depthCm / thresholds.depthMaxCm) * 100, 0, 100)
}

export function scoreArea(areaCm2: number | null, thresholds: SeverityThresholds): number {
  if (areaCm2 == null || areaCm2 <= 0) return 20
  return clamp((areaCm2 / thresholds.areaMaxCm2) * 100, 0, 100)
}

export function scoreTraffic(trafficRisk: RiskLevel): number {
  return RISK_SCORE[trafficRisk] ?? 50
}

/**
 * Location risk blends road classification with proximity to sensitive
 * receptors — a shallow pothole beside a school outranks a deep one on a
 * quiet service road (spec section 8).
 */
export function scoreLocationRisk(context: SeverityContext): number {
  const base = ROAD_TYPE_RISK[context.roadType] ?? 50
  let bonus = 0
  if (context.nearSchool) bonus += 18
  if (context.nearHospital) bonus += 16
  if (context.nearIntersection) bonus += 10
  return clamp(base + bonus, 0, 100)
}

export function scoreConfidence(context: SeverityContext): number {
  const ai = clamp(context.aiConfidence ?? 0, 0, 1)
  const depth = context.depthConfidence == null ? ai : clamp(context.depthConfidence, 0, 1)
  // Higher confidence increases the *certainty* contribution, not the danger.
  return clamp((ai * 0.6 + depth * 0.4) * 100, 0, 100)
}

export function scoreRecurrence(
  reportCount: number,
  thresholds: SeverityThresholds,
): number {
  if (!reportCount || reportCount <= 1) return 0
  return clamp((reportCount / thresholds.recurrenceMaxReports) * 100, 0, 100)
}

export function levelFromScore(
  score: number,
  thresholds: SeverityThresholds,
): PriorityLevel {
  if (score >= thresholds.critical) return 'CRITICAL'
  if (score >= thresholds.high) return 'HIGH'
  if (score >= thresholds.medium) return 'MEDIUM'
  return 'LOW'
}

/**
 * Compute the weighted priority assessment.
 *
 * Weights are normalised, so a jurisdiction can add or drop terms without
 * having to keep them summing to exactly 1.
 */
export function assessPriority(
  context: SeverityContext,
  weights: SeverityWeights = DEFAULT_SEVERITY_WEIGHTS,
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): PriorityAssessment {
  const components = {
    depth: scoreDepth(context.depthCm, thresholds),
    area: scoreArea(context.areaCm2, thresholds),
    traffic: scoreTraffic(context.trafficRisk),
    location_risk: scoreLocationRisk(context),
    confidence: scoreConfidence(context),
    recurrence: scoreRecurrence(context.reportCount ?? 1, thresholds),
  }

  const totalWeight =
    weights.depth +
    weights.area +
    weights.traffic +
    weights.location_risk +
    weights.confidence +
    weights.recurrence

  const weighted =
    components.depth * weights.depth +
    components.area * weights.area +
    components.traffic * weights.traffic +
    components.location_risk * weights.location_risk +
    components.confidence * weights.confidence +
    components.recurrence * weights.recurrence

  const priority_score = round(totalWeight > 0 ? weighted / totalWeight : 0, 1)
  const priority_level = levelFromScore(priority_score, thresholds)

  // Reported severity is the priority band; low-confidence vision estimates
  // are discounted one step so a shaky guess can't trigger an urgent dispatch.
  let severity: Severity = priority_level
  if (context.aiConfidence < 0.55 && severity !== 'LOW') {
    severity = downgrade(severity)
  }

  return {
    severity,
    priority_level,
    priority_score,
    components,
    rationale: buildRationale(context, components, priority_level),
  }
}

function downgrade(level: PriorityLevel): PriorityLevel {
  switch (level) {
    case 'CRITICAL':
      return 'HIGH'
    case 'HIGH':
      return 'MEDIUM'
    case 'MEDIUM':
      return 'LOW'
    default:
      return 'LOW'
  }
}

function buildRationale(
  context: SeverityContext,
  components: PriorityAssessment['components'],
  level: PriorityLevel,
): string[] {
  const out: string[] = []
  const depth = context.depthCm
  if (depth != null && depth >= 8) {
    out.push(`Depth of ${round(depth, 1)} cm exceeds the urgent-repair threshold.`)
  } else if (depth != null && depth >= 4) {
    out.push(`Depth of ${round(depth, 1)} cm is a moderate hazard.`)
  } else if (depth != null) {
    out.push(`Shallow depression (${round(depth, 1)} cm).`)
  } else {
    out.push('Depth could not be reliably measured — treated as approximate.')
  }

  if (components.area >= 60) out.push('Large surface area increases vehicle impact risk.')
  if (context.trafficRisk === 'HIGH') out.push('High traffic exposure at this location.')
  if (context.roadType === 'HIGHWAY' || context.roadType === 'ARTERIAL') {
    out.push(`Located on a ${context.roadType.toLowerCase()} road.`)
  }
  if (context.nearSchool) out.push('Within the vicinity of a school.')
  if (context.nearHospital) out.push('Within the vicinity of a hospital.')
  if (context.nearIntersection) out.push('Close to an intersection.')
  if ((context.reportCount ?? 1) > 1) {
    out.push(`Reported ${context.reportCount} times — recurring defect.`)
  }
  if (context.aiConfidence < 0.55) {
    out.push('Low vision confidence — severity discounted by one band.')
  }
  out.push(`Composite priority score ${Math.round(components.depth)} depth-weighted → ${level}.`)
  return out
}

/** Human label used in the UI for each priority band. */
export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
}
