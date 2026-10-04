import { z } from 'zod'

/**
 * Runtime validation for AI output (spec section 49).
 *
 * Gemini can and does return malformed JSON. Everything crossing the AI
 * boundary is validated here *and* in the edge functions before it is trusted.
 */

export const measurementMethodSchema = z.enum([
  'AR_DEPTH_SENSOR',
  'MONOCULAR_DEPTH_ESTIMATION',
  'REFERENCE_OBJECT',
  'CV_GEOMETRY',
  'VISION_ESTIMATE',
  'FUSED',
  'MANUAL',
  'UNKNOWN',
])

export const severitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
export const priorityLevelSchema = severitySchema
export const riskSchema = z.enum(['LOW', 'MEDIUM', 'HIGH'])

export const roadDamageTypeSchema = z.enum([
  'POTHOLE',
  'ALLIGATOR_CRACKING',
  'RUTTING',
  'EDGE_BREAK',
  'SINKHOLE',
  'UNKNOWN',
])

export const recommendedActionSchema = z.enum([
  'MONITOR',
  'SCHEDULE_REPAIR',
  'PRIORITY_REPAIR',
  'URGENT_REPAIR',
])

export const potholeStatusSchema = z.enum([
  'DETECTED',
  'REPORTED',
  'ASSIGNED',
  'ACCEPTED',
  'EN_ROUTE',
  'ON_SITE',
  'UNDER_REPAIR',
  'AI_VERIFICATION',
  'RESOLVED',
  'REJECTED',
])

/** A physical measurement must be finite, non-negative and physically sane. */
const measurement = (max: number, label: string) =>
  z
    .number({ message: `${label} must be a number` })
    .finite()
    .min(0, `${label} cannot be negative`)
    .max(max, `${label} exceeds the plausible range`)
    .nullable()

const unitInterval = (label: string) =>
  z
    .number({ message: `${label} must be a number` })
    .finite()
    .min(0, `${label} cannot be negative`)
    .max(1, `${label} cannot exceed 1`)

/** Normalised detection box: every edge must sit within the frame (0..1). */
export const boundingBoxSchema = z
  .object({
    x: unitInterval('x'),
    y: unitInterval('y'),
    width: unitInterval('width'),
    height: unitInterval('height'),
  })
  .nullable()
  .default(null)

export const potholeAnalysisResultSchema = z.object({
  pothole_detected: z.boolean(),
  confidence: unitInterval('confidence'),
  bounding_box: boundingBoxSchema,
  width_cm: measurement(2000, 'width'),
  length_cm: measurement(2000, 'length'),
  depth_cm: measurement(120, 'depth'),
  measurement_confidence: unitInterval('measurement_confidence'),
  measurement_method: measurementMethodSchema.default('VISION_ESTIMATE'),
  severity: severitySchema.default('MEDIUM'),
  traffic_risk: riskSchema.default('MEDIUM'),
  vehicle_risk: riskSchema.default('MEDIUM'),
  pedestrian_risk: riskSchema.default('MEDIUM'),
  road_damage_type: roadDamageTypeSchema.default('POTHOLE'),
  recommended_action: recommendedActionSchema.default('SCHEDULE_REPAIR'),
  visual_evidence: z.array(z.string()).default([]),
  explanation: z.string().default(''),
})

export type PotholeAnalysisResultInput = z.input<typeof potholeAnalysisResultSchema>

export const repairVerificationSchema = z.object({
  repair_detected: z.boolean(),
  remaining_damage: z.boolean(),
  surface_restored: z.boolean().default(false),
  confidence: unitInterval('confidence'),
  recommendation: z.enum(['APPROVE', 'REVIEW', 'REJECT']),
  notes: z.string().default(''),
})

/** Captured scan awaiting a user decision to file it. */
export const scanDraftSchema = z.object({
  imageDataUrl: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().nullable(),
})

export const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export const reportIssueSchema = z.object({
  notes: z.string().max(1000).optional(),
  roadType: z.enum([
    'HIGHWAY',
    'ARTERIAL',
    'COLLECTOR',
    'LOCAL',
    'RESIDENTIAL',
    'SERVICE',
  ]),
  nearIntersection: z.boolean().default(false),
  nearSchool: z.boolean().default(false),
  nearHospital: z.boolean().default(false),
  trafficRisk: riskSchema.default('MEDIUM'),
})

/**
 * Defensive JSON extraction: models sometimes wrap JSON in prose or markdown
 * fences. Pull the first balanced object out of the raw string.
 */
export function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? raw
  const start = candidate.indexOf('{')
  if (start === -1) throw new Error('No JSON object found in model response')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < candidate.length; i += 1) {
    const char = candidate[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1))
      }
    }
  }
  throw new Error('Unbalanced JSON object in model response')
}

/**
 * Sanitise a validated result: null-out implausible geometry and clamp
 * confidence so nothing downstream can divide by zero or show a wild value.
 */
export function sanitiseAnalysis(
  result: z.infer<typeof potholeAnalysisResultSchema>,
): z.infer<typeof potholeAnalysisResultSchema> {
  const clean = { ...result }
  if (!clean.pothole_detected) {
    clean.width_cm = null
    clean.length_cm = null
    clean.depth_cm = null
    clean.bounding_box = null
  }
  if (clean.depth_cm != null && clean.depth_cm < 0.5) clean.depth_cm = null
  if (clean.bounding_box) {
    // Guarantee the box is on-screen: clamp to the frame and never let it
    // collapse to nothing, otherwise the overlay would be invisible.
    const box = clean.bounding_box
    const x = Math.min(Math.max(box.x, 0), 0.98)
    const y = Math.min(Math.max(box.y, 0), 0.98)
    clean.bounding_box = {
      x,
      y,
      width: Math.min(Math.max(box.width, 0.02), 1 - x),
      height: Math.min(Math.max(box.height, 0.02), 1 - y),
    }
  }
  return clean
}
