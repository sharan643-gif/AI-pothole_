/**
 * Server-side severity / priority engine.
 *
 * This is the authoritative copy — scores are always computed here and
 * persisted. `src/lib/severity.ts` is a byte-for-byte behavioural mirror used
 * for client-side previews so the two can never disagree about a score.
 *
 * Weights and thresholds are loaded from the `severity_config` table, so a
 * jurisdiction can retune the model without a redeploy.
 */

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type PriorityLevel = Severity
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export interface SeverityWeights {
  depth: number
  area: number
  traffic: number
  location_risk: number
  confidence: number
  recurrence: number
}

export interface SeverityThresholds {
  critical: number
  high: number
  medium: number
  depthMaxCm: number
  areaMaxCm2: number
  recurrenceMaxReports: number
}

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

const ROAD_TYPE_RISK: Record<string, number> = {
  HIGHWAY: 100,
  ARTERIAL: 82,
  COLLECTOR: 64,
  LOCAL: 46,
  RESIDENTIAL: 34,
  SERVICE: 22,
}

const RISK_SCORE: Record<RiskLevel, number> = { LOW: 34, MEDIUM: 67, HIGH: 100 }

export interface SeverityContext {
  depthCm: number | null
  areaCm2: number | null
  trafficRisk: RiskLevel
  roadType: string
  nearIntersection?: boolean
  nearSchool?: boolean
  nearHospital?: boolean
  aiConfidence: number
  depthConfidence?: number
  reportCount?: number
}

export interface PriorityAssessment {
  severity: Severity
  priority_level: PriorityLevel
  priority_score: number
  components: {
    depth: number
    area: number
    traffic: number
    location_risk: number
    confidence: number
    recurrence: number
  }
  rationale: string[]
}

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
const round = (v: number, d = 1) => {
  const f = 10 ** d
  return Math.round(v * f) / f
}

export function scoreDepth(d: number | null, t: SeverityThresholds): number {
  if (d == null || d <= 0) return 25
  return clamp((d / t.depthMaxCm) * 100, 0, 100)
}

export function scoreArea(a: number | null, t: SeverityThresholds): number {
  if (a == null || a <= 0) return 20
  return clamp((a / t.areaMaxCm2) * 100, 0, 100)
}

export function scoreLocationRisk(c: SeverityContext): number {
  let score = ROAD_TYPE_RISK[c.roadType?.toUpperCase()] ?? 50
  if (c.nearSchool) score += 18
  if (c.nearHospital) score += 16
  if (c.nearIntersection) score += 10
  return clamp(score, 0, 100)
}

export function scoreRecurrence(reports: number, t: SeverityThresholds): number {
  if (!reports || reports <= 1) return 0
  return clamp((reports / t.recurrenceMaxReports) * 100, 0, 100)
}

export function levelFromScore(score: number, t: SeverityThresholds): PriorityLevel {
  if (score >= t.critical) return 'CRITICAL'
  if (score >= t.high) return 'HIGH'
  if (score >= t.medium) return 'MEDIUM'
  return 'LOW'
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

export function assessPriority(
  context: SeverityContext,
  weights: SeverityWeights = DEFAULT_SEVERITY_WEIGHTS,
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): PriorityAssessment {
  const components = {
    depth: scoreDepth(context.depthCm, thresholds),
    area: scoreArea(context.areaCm2, thresholds),
    traffic: RISK_SCORE[context.trafficRisk] ?? 50,
    location_risk: scoreLocationRisk(context),
    confidence: clamp(
      (clamp(context.aiConfidence ?? 0, 0, 1) * 0.6 +
        clamp(context.depthConfidence ?? context.aiConfidence ?? 0, 0, 1) * 0.4) *
        100,
      0,
      100,
    ),
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

  let severity: Severity = priority_level
  if (context.aiConfidence < 0.55 && severity !== 'LOW') {
    severity = downgrade(severity)
  }

  const rationale: string[] = []
  if (context.depthCm != null && context.depthCm >= 8) {
    rationale.push(`Depth ${round(context.depthCm, 1)} cm exceeds the urgent threshold.`)
  } else if (context.depthCm == null) {
    rationale.push('Depth unavailable — treated as approximate.')
  }
  if (components.area >= 60) rationale.push('Large surface area.')
  if (context.trafficRisk === 'HIGH') rationale.push('High traffic exposure.')
  if (['HIGHWAY', 'ARTERIAL'].includes(context.roadType?.toUpperCase())) {
    rationale.push(`Located on a ${String(context.roadType).toLowerCase()} road.`)
  }
  if (context.nearSchool) rationale.push('Near a school.')
  if (context.nearHospital) rationale.push('Near a hospital.')
  if (context.nearIntersection) rationale.push('Near an intersection.')
  if ((context.reportCount ?? 1) > 1) rationale.push(`${context.reportCount} repeat reports.`)
  if (context.aiConfidence < 0.55) rationale.push('Low confidence — discounted one band.')

  return { severity, priority_level, priority_score, components, rationale }
}

/** Map the `severity_config` rows into engine weights + thresholds. */
export function configFromRows(
  rows: { key: string; weight: number; thresholds: Record<string, unknown> | null }[],
): { weights: SeverityWeights; thresholds: SeverityThresholds } {
  const weights = { ...DEFAULT_SEVERITY_WEIGHTS }
  const thresholds = { ...DEFAULT_SEVERITY_THRESHOLDS }

  for (const row of rows) {
    const t = (row.thresholds ?? {}) as Record<string, number>
    switch (row.key) {
      case 'depth':
        weights.depth = Number(row.weight)
        if (t.maxCm) thresholds.depthMaxCm = Number(t.maxCm)
        break
      case 'area':
        weights.area = Number(row.weight)
        if (t.maxCm2) thresholds.areaMaxCm2 = Number(t.maxCm2)
        break
      case 'traffic':
        weights.traffic = Number(row.weight)
        break
      case 'location_risk':
        weights.location_risk = Number(row.weight)
        break
      case 'confidence':
        weights.confidence = Number(row.weight)
        break
      case 'recurrence':
        weights.recurrence = Number(row.weight)
        if (t.maxReports) thresholds.recurrenceMaxReports = Number(t.maxReports)
        break
      case 'thresholds':
        if (t.critical != null) thresholds.critical = Number(t.critical)
        if (t.high != null) thresholds.high = Number(t.high)
        if (t.medium != null) thresholds.medium = Number(t.medium)
        break
      default:
        break
    }
  }

  return { weights, thresholds }
}
