import { z } from 'npm:zod@3.23.8'

/**
 * Server-side validation of model output (spec section 49).
 * Nothing from Gemini is trusted until it passes these schemas.
 */

const unit = (label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .finite()
    .min(0, `${label} cannot be negative`)
    .max(1, `${label} cannot exceed 1`)

const measurement = (max: number, label: string) =>
  z
    .number({ invalid_type_error: `${label} must be a number` })
    .finite()
    .min(0, `${label} cannot be negative`)
    .max(max, `${label} is outside the plausible range`)
    .nullable()

/** Normalised detection box (0..1 within the frame); null when unlocalised. */
const boundingBox = z
  .object({
    x: unit('x'),
    y: unit('y'),
    width: unit('width'),
    height: unit('height'),
  })
  .nullable()
  .default(null)

export const analysisSchema = z.object({
  pothole_detected: z.boolean(),
  confidence: unit('confidence'),
  bounding_box: boundingBox,
  width_cm: measurement(2000, 'width_cm'),
  length_cm: measurement(2000, 'length_cm'),
  depth_cm: measurement(120, 'depth_cm'),
  measurement_confidence: unit('measurement_confidence').default(0),
  measurement_method: z.string().default('VISION_ESTIMATE'),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  traffic_risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  vehicle_risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  pedestrian_risk: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  road_damage_type: z
    .enum(['POTHOLE', 'ALLIGATOR_CRACKING', 'RUTTING', 'EDGE_BREAK', 'SINKHOLE', 'UNKNOWN'])
    .default('POTHOLE'),
  recommended_action: z
    .enum(['MONITOR', 'SCHEDULE_REPAIR', 'PRIORITY_REPAIR', 'URGENT_REPAIR'])
    .default('SCHEDULE_REPAIR'),
  visual_evidence: z.array(z.string()).default([]),
  explanation: z.string().default(''),
})

export type AnalysisResult = z.infer<typeof analysisSchema>

export const verificationSchema = z.object({
  repair_detected: z.boolean(),
  remaining_damage: z.boolean(),
  surface_restored: z.boolean().default(false),
  confidence: unit('confidence'),
  recommendation: z.enum(['APPROVE', 'REVIEW', 'REJECT']).default('REVIEW'),
  notes: z.string().default(''),
})

export type VerificationResult = z.infer<typeof verificationSchema>

/**
 * Measurement sanity gate. Rejects physically impossible geometry and strips
 * depth values too small to be meaningful, so downstream code never has to
 * defend against nonsense numbers.
 */
export function sanitiseMeasurements(raw: AnalysisResult): {
  result: AnalysisResult
  issues: string[]
} {
  const issues: string[] = []
  const result: AnalysisResult = { ...raw }

  if (!result.pothole_detected) {
    result.width_cm = null
    result.length_cm = null
    result.depth_cm = null
    result.bounding_box = null
    return { result, issues }
  }

  if (result.depth_cm != null && result.depth_cm < 0.5) {
    issues.push('depth_cm below the 0.5 cm measurement floor — discarded')
    result.depth_cm = null
  }
  if (result.width_cm != null && result.width_cm < 5) {
    issues.push('width_cm below the 5 cm measurement floor — discarded')
    result.width_cm = null
  }
  if (result.length_cm != null && result.length_cm < 5) {
    issues.push('length_cm below the 5 cm measurement floor — discarded')
    result.length_cm = null
  }

  // A pothole deeper than it is wide is almost always a hallucination or a
  // measurement of something that isn't a pothole.
  const minSpan = Math.min(result.width_cm ?? Infinity, result.length_cm ?? Infinity)
  if (result.depth_cm != null && minSpan !== Infinity && result.depth_cm > minSpan) {
    issues.push('depth_cm exceeds the minimum surface span — clamped')
    result.depth_cm = Math.round(minSpan * 10) / 10
  }

  if (result.depth_cm == null) {
    result.measurement_confidence = Math.min(result.measurement_confidence, 0.4)
  }

  return { result, issues }
}

/** Allowed measurement methods, used to coerce model output. */
export const MEASUREMENT_METHODS = [
  'AR_DEPTH_SENSOR',
  'MONOCULAR_DEPTH_ESTIMATION',
  'REFERENCE_OBJECT',
  'CV_GEOMETRY',
  'VISION_ESTIMATE',
  'FUSED',
  'MANUAL',
  'UNKNOWN',
] as const

export type MeasurementMethod = (typeof MEASUREMENT_METHODS)[number]

export function coerceMethod(value: string | undefined | null): MeasurementMethod {
  const upper = (value ?? '').toUpperCase().replace(/[\s-]/g, '_')
  return (MEASUREMENT_METHODS as readonly string[]).includes(upper)
    ? (upper as MeasurementMethod)
    : 'VISION_ESTIMATE'
}
