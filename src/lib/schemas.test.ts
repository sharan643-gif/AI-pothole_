import { describe, expect, it } from 'vitest'
import {
  extractJson,
  potholeAnalysisResultSchema,
  repairVerificationSchema,
  sanitiseAnalysis,
} from './schemas'

const VALID = {
  pothole_detected: true,
  confidence: 0.94,
  width_cm: 85,
  length_cm: 120,
  depth_cm: 9,
  measurement_confidence: 0.7,
  measurement_method: 'MONOCULAR_DEPTH_ESTIMATION',
  severity: 'HIGH',
  traffic_risk: 'HIGH',
  vehicle_risk: 'HIGH',
  pedestrian_risk: 'MEDIUM',
  road_damage_type: 'POTHOLE',
  recommended_action: 'URGENT_REPAIR',
  visual_evidence: ['Deep depression visible'],
  explanation: 'A deep depression with broken edges.',
}

describe('AI response validation (spec section 49)', () => {
  it('accepts a well-formed analysis', () => {
    const result = potholeAnalysisResultSchema.safeParse(VALID)
    expect(result.success).toBe(true)
  })

  it('rejects negative measurements', () => {
    const result = potholeAnalysisResultSchema.safeParse({ ...VALID, depth_cm: -3 })
    expect(result.success).toBe(false)
  })

  it('rejects confidence above 1', () => {
    const result = potholeAnalysisResultSchema.safeParse({ ...VALID, confidence: 1.4 })
    expect(result.success).toBe(false)
  })

  it('rejects physically implausible dimensions', () => {
    const result = potholeAnalysisResultSchema.safeParse({ ...VALID, width_cm: 9000 })
    expect(result.success).toBe(false)
  })

  it('accepts null measurements (unknown depth is honest, not an error)', () => {
    const result = potholeAnalysisResultSchema.safeParse({ ...VALID, depth_cm: null })
    expect(result.success).toBe(true)
  })

  it('rejects a non-boolean detection flag', () => {
    const result = potholeAnalysisResultSchema.safeParse({
      ...VALID,
      pothole_detected: 'yes',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown severity label', () => {
    const result = potholeAnalysisResultSchema.safeParse({ ...VALID, severity: 'EXTREME' })
    expect(result.success).toBe(false)
  })

  it('round-trips repair verification payloads', () => {
    const result = repairVerificationSchema.safeParse({
      repair_detected: true,
      remaining_damage: false,
      surface_restored: true,
      confidence: 0.93,
      recommendation: 'APPROVE',
      notes: 'Surface is consistent.',
    })
    expect(result.success).toBe(true)
  })
})

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses JSON wrapped in a markdown fence', () => {
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 })
  })

  it('parses JSON embedded in prose', () => {
    expect(extractJson('Here is the result: {"a":3} — hope that helps')).toEqual({ a: 3 })
  })

  it('handles braces inside strings', () => {
    expect(extractJson('{"note":"a } b","n":1}')).toEqual({ note: 'a } b', n: 1 })
  })

  it('throws when no JSON object is present', () => {
    expect(() => extractJson('no json here')).toThrow()
  })
})

describe('sanitiseAnalysis', () => {
  it('strips measurements when no pothole was detected', () => {
    const parsed = potholeAnalysisResultSchema.parse({ ...VALID, pothole_detected: false })
    const clean = sanitiseAnalysis(parsed)
    expect(clean.width_cm).toBeNull()
    expect(clean.depth_cm).toBeNull()
  })

  it('discards a depth below the measurement floor', () => {
    const parsed = potholeAnalysisResultSchema.parse({ ...VALID, depth_cm: 0.2 })
    expect(sanitiseAnalysis(parsed).depth_cm).toBeNull()
  })

  it('keeps a credible depth intact', () => {
    const parsed = potholeAnalysisResultSchema.parse(VALID)
    expect(sanitiseAnalysis(parsed).depth_cm).toBe(9)
  })
})
