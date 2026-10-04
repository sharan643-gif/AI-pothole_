import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEVERITY_THRESHOLDS,
  DEFAULT_SEVERITY_WEIGHTS,
  assessPriority,
  levelFromScore,
  scoreArea,
  scoreDepth,
} from './severity'
import type { SeverityContext } from './severity'

function context(overrides: Partial<SeverityContext> = {}): SeverityContext {
  return {
    depthCm: 4,
    areaCm2: 4000,
    trafficRisk: 'MEDIUM',
    roadType: 'LOCAL',
    aiConfidence: 0.9,
    depthConfidence: 0.8,
    reportCount: 1,
    ...overrides,
  }
}

describe('severity engine', () => {
  it('scores depth proportionally to the configured ceiling', () => {
    expect(scoreDepth(0, DEFAULT_SEVERITY_THRESHOLDS)).toBe(25)
    expect(scoreDepth(12.5, DEFAULT_SEVERITY_THRESHOLDS)).toBe(50)
    expect(scoreDepth(25, DEFAULT_SEVERITY_THRESHOLDS)).toBe(100)
    // Values beyond the ceiling are clamped, never extrapolated.
    expect(scoreDepth(90, DEFAULT_SEVERITY_THRESHOLDS)).toBe(100)
    expect(scoreDepth(null, DEFAULT_SEVERITY_THRESHOLDS)).toBe(25)
  })

  it('clamps area scores', () => {
    expect(scoreArea(10000, DEFAULT_SEVERITY_THRESHOLDS)).toBe(50)
    expect(scoreArea(999999, DEFAULT_SEVERITY_THRESHOLDS)).toBe(100)
    expect(scoreArea(0, DEFAULT_SEVERITY_THRESHOLDS)).toBe(20)
  })

  it('maps scores onto the configured bands', () => {
    expect(levelFromScore(85, DEFAULT_SEVERITY_THRESHOLDS)).toBe('CRITICAL')
    expect(levelFromScore(80, DEFAULT_SEVERITY_THRESHOLDS)).toBe('CRITICAL')
    expect(levelFromScore(60, DEFAULT_SEVERITY_THRESHOLDS)).toBe('HIGH')
    expect(levelFromScore(40, DEFAULT_SEVERITY_THRESHOLDS)).toBe('MEDIUM')
    expect(levelFromScore(39.9, DEFAULT_SEVERITY_THRESHOLDS)).toBe('LOW')
  })

  it('rates a deep highway pothole as critical', () => {
    const result = assessPriority(
      context({
        depthCm: 18,
        areaCm2: 16000,
        trafficRisk: 'HIGH',
        roadType: 'HIGHWAY',
        nearSchool: true,
        aiConfidence: 0.95,
        depthConfidence: 0.9,
      }),
    )
    expect(result.priority_level).toBe('CRITICAL')
    expect(result.priority_score).toBeGreaterThanOrEqual(80)
  })

  it('rates a shallow residential pothole as low', () => {
    const result = assessPriority(
      context({
        depthCm: 1.5,
        areaCm2: 600,
        trafficRisk: 'LOW',
        roadType: 'SERVICE',
        aiConfidence: 0.9,
        depthConfidence: 0.8,
      }),
    )
    expect(result.priority_level).toBe('LOW')
    expect(result.priority_score).toBeLessThan(40)
  })

  it('lets context outrank raw depth (spec section 8)', () => {
    const shallowButSensitive = assessPriority(
      context({
        depthCm: 5,
        areaCm2: 4000,
        trafficRisk: 'HIGH',
        roadType: 'ARTERIAL',
        nearSchool: true,
        nearHospital: true,
        nearIntersection: true,
        reportCount: 4,
      }),
    )
    const deepButQuiet = assessPriority(
      context({
        depthCm: 10,
        areaCm2: 4000,
        trafficRisk: 'LOW',
        roadType: 'SERVICE',
      }),
    )

    expect(shallowButSensitive.priority_score).toBeGreaterThan(deepButQuiet.priority_score)
  })

  it('discounts severity by one band when vision confidence is low', () => {
    const confident = assessPriority(
      context({ depthCm: 20, areaCm2: 18000, trafficRisk: 'HIGH', roadType: 'HIGHWAY', aiConfidence: 0.95 }),
    )
    const shaky = assessPriority(
      context({ depthCm: 20, areaCm2: 18000, trafficRisk: 'HIGH', roadType: 'HIGHWAY', aiConfidence: 0.4 }),
    )
    expect(confident.priority_level).toBe('CRITICAL')
    expect(shaky.priority_level).toBe('CRITICAL') // the score band is unchanged
    expect(shaky.severity).toBe('HIGH') // but reported severity is discounted
  })

  it('normalises weights so custom configs need not sum to one', () => {
    const balanced = assessPriority(context(), { ...DEFAULT_SEVERITY_WEIGHTS })
    const depthOnly = assessPriority(context(), {
      depth: 1,
      area: 0,
      traffic: 0,
      location_risk: 0,
      confidence: 0,
      recurrence: 0,
    })
    expect(balanced.priority_score).toBeGreaterThan(0)
    // Depth-only weighting must equal the raw depth component.
    expect(Math.round(depthOnly.priority_score)).toBe(
      Math.round(depthOnly.components.depth),
    )
  })

  it('reports how many times a location has recurred', () => {
    const once = assessPriority(context({ reportCount: 1 }))
    const many = assessPriority(context({ reportCount: 5 }))
    expect(once.components.recurrence).toBe(0)
    expect(many.components.recurrence).toBe(100)
  })
})
