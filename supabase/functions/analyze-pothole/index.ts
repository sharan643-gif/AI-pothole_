import { fail, ok } from '../_shared/cors.ts'
import {
  GeminiError,
  extractJson,
  generateText,
  imageFromBase64,
  imageFromUrl,
  type InlineImage,
} from '../_shared/gemini.ts'
import { guard, loadSeverityConfig } from '../_shared/handler.ts'
import { PROMPT_VERSION, analysisPrompt } from '../_shared/prompts.ts'
import {
  analysisSchema,
  coerceMethod,
  sanitiseMeasurements,
  type AnalysisResult,
  type MeasurementMethod,
} from '../_shared/schemas.ts'
import { adminClient, type Caller } from '../_shared/supabase.ts'
import { assessPriority } from '../_shared/severity.ts'

/**
 * POST /functions/v1/analyze-pothole
 *
 * Body:
 *   image_url?        signed URL of the captured frame
 *   image_base64?     inline base64 (mutually exclusive with image_url)
 *   mime_type?        defaults to image/jpeg
 *   latitude, longitude
 *   road_type?, near_school?, near_hospital?, near_intersection?
 *   traffic_risk?     LOW | MEDIUM | HIGH
 *   reference_size_cm?  known size of a calibration object in frame (option A/C)
 *   depth_samples_cm?   per-pixel depth samples from an AR/depth/ML pipeline (option A/B)
 *   depth_method_hint?  how those samples were produced
 *   pothole_id?       when provided, the analysis is appended to that row
 *
 * The response distinguishes a *measured* depth (from sensor/ML samples) from
 * an *estimated* one (visual inference), and never presents the latter as a
 * physical measurement (spec sections 5 and 56).
 */
Deno.serve((req) =>
  guard(req, { auth: true, limit: 12, windowMs: 60_000 }, async (caller, body) => {
    const latitude = Number(body.latitude)
    const longitude = Number(body.longitude)
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return fail('INVALID_INPUT', 'latitude must be between -90 and 90.', 422)
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return fail('INVALID_INPUT', 'longitude must be between -180 and 180.', 422)
    }

    const imageUrl = typeof body.image_url === 'string' ? body.image_url : null
    const imageBase64 = typeof body.image_base64 === 'string' ? body.image_base64 : null
    if (!imageUrl && !imageBase64) {
      return fail('INVALID_INPUT', 'Provide image_url or image_base64.', 422)
    }

    const roadType = typeof body.road_type === 'string' ? body.road_type : null
    const nearSchool = body.near_school === true
    const nearHospital = body.near_hospital === true
    const nearIntersection = body.near_intersection === true
    const trafficRisk = ['LOW', 'MEDIUM', 'HIGH'].includes(String(body.traffic_risk))
      ? (body.traffic_risk as 'LOW' | 'MEDIUM' | 'HIGH')
      : 'MEDIUM'

    const referenceSize = Number(body.reference_size_cm)
    const hasReference = Number.isFinite(referenceSize) && referenceSize > 0

    const depthSamples = Array.isArray(body.depth_samples_cm)
      ? (body.depth_samples_cm as unknown[])
          .map((v) => Number(v))
          .filter((v) => Number.isFinite(v) && v >= 0)
      : []
    const hasDepthSamples = depthSamples.length >= 3

    // ---------------------------------------------------------------
    // 1. Load the image for the model
    // ---------------------------------------------------------------
    let image: InlineImage
    try {
      image = imageUrl
        ? await imageFromUrl(imageUrl, 'primary')
        : imageFromBase64(
            imageBase64!,
            typeof body.mime_type === 'string' ? body.mime_type : 'image/jpeg',
            'primary',
          )
    } catch (error) {
      if (error instanceof GeminiError) {
        return fail('IMAGE_UNAVAILABLE', error.message, error.status)
      }
      return fail('IMAGE_UNAVAILABLE', 'The image could not be prepared for analysis.', 422)
    }

    // ---------------------------------------------------------------
    // 2. Ask Gemini to reason about the scene
    // ---------------------------------------------------------------
    const prompt = analysisPrompt({
      hasScaleReference: hasReference,
      referenceSizeCm: hasReference ? referenceSize : null,
      hasDepthSamples,
      roadType,
      latitude,
      longitude,
    })

    let rawText: string
    let model = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash-lite'
    try {
      rawText = await generateText({ prompt, images: [image], model })
    } catch (error) {
      const gemini = error instanceof GeminiError ? error : null
      return fail(
        'AI_FAILED',
        gemini?.message ?? 'The AI analysis service did not respond.',
        gemini?.status === 429 ? 429 : 502,
      )
    }

    // ---------------------------------------------------------------
    // 3. Validate the model output (never trust it blindly)
    // ---------------------------------------------------------------
    let parsed: AnalysisResult
    try {
      const raw = extractJson(rawText)
      const result = analysisSchema.safeParse(raw)
      if (!result.success) {
        await recordRejected(caller, body, model, rawText, result.error.issues)
        return fail(
          'AI_INVALID_RESPONSE',
          'The AI returned values outside the accepted physical range. Nothing was saved.',
          422,
          { issues: result.error.issues.slice(0, 8).map((i) => i.message) },
        )
      }
      parsed = result.data
    } catch (error) {
      await recordRejected(caller, body, model, rawText, [
        error instanceof Error ? error.message : String(error),
      ])
      return fail('AI_INVALID_RESPONSE', 'The AI response could not be parsed as JSON.', 422)
    }

    const { result: sanitised, issues } = sanitiseMeasurements(parsed)

    // ---------------------------------------------------------------
    // 4. Depth fusion — geometry beats guessing
    // ---------------------------------------------------------------
    let depthCm = sanitised.depth_cm
    let depthConfidence = sanitised.measurement_confidence
    let depthMethod: MeasurementMethod = coerceMethod(sanitised.measurement_method)
    let depthSource: 'sensor_samples' | 'visual_estimate' = 'visual_estimate'

    if (hasDepthSamples) {
      const med = median(depthSamples)
      const spread = relativeSpread(depthSamples, med)
      depthCm = Math.round(med * 10) / 10
      depthConfidence = clamp(0.92 - spread * 1.1, 0.35, 0.95)
      depthMethod = coerceMethod(
        typeof body.depth_method_hint === 'string'
          ? body.depth_method_hint
          : 'MONOCULAR_DEPTH_ESTIMATION',
      )
      depthSource = 'sensor_samples'
    } else if (hasReference) {
      depthMethod = depthMethod === 'VISION_ESTIMATE' ? 'REFERENCE_OBJECT' : depthMethod
    } else if (depthCm != null) {
      depthMethod = 'VISION_ESTIMATE'
      depthConfidence = Math.min(depthConfidence, 0.55)
    } else {
      depthMethod = 'UNKNOWN'
      depthConfidence = 0
    }

    // ---------------------------------------------------------------
    // 5. Score with the database-configurable engine
    // ---------------------------------------------------------------
    const config = await loadSeverityConfig()
    const areaCm2 =
      sanitised.width_cm != null && sanitised.length_cm != null
        ? Math.round(sanitised.width_cm * sanitised.length_cm)
        : null

    const priority = assessPriority(
      {
        depthCm,
        areaCm2,
        trafficRisk,
        roadType: roadType ?? 'LOCAL',
        nearIntersection,
        nearSchool,
        nearHospital,
        aiConfidence: sanitised.confidence,
        depthConfidence,
        reportCount: Number(body.report_count) || 1,
      },
      config.weights,
      config.thresholds,
    )

    // ---------------------------------------------------------------
    // 6. Optionally persist the audit trail
    // ---------------------------------------------------------------
    const potholeId = typeof body.pothole_id === 'string' ? body.pothole_id : null
    let persisted = false
    if (potholeId) {
      persisted = await persistAnalysis({
        potholeId,
        caller,
        model,
        rawText,
        structured: { ...sanitised, depth_cm: depthCm, measurement_method: depthMethod },
        priority,
        measurements: {
          width_cm: sanitised.width_cm,
          length_cm: sanitised.length_cm,
          depth_cm: depthCm,
          area_cm2: areaCm2,
          depth_method: depthMethod,
          depth_confidence: depthConfidence,
          measurement_confidence: sanitised.measurement_confidence,
          ai_confidence: sanitised.confidence,
        },
        context: { nearSchool, nearHospital, nearIntersection, roadType, trafficRisk },
      })
    }

    return ok({
      model,
      prompt_version: PROMPT_VERSION,
      analysis: {
        ...sanitised,
        depth_cm: depthCm,
        area_cm2: areaCm2,
        measurement_method: depthMethod,
        // Depth reports its own provenance block per spec section 5.
        depth: {
          depth_value: depthCm,
          depth_unit: 'cm',
          depth_method: depthMethod,
          depth_confidence: round(depthConfidence, 2),
          source: depthSource,
        },
      },
      severity: priority.severity,
      priority,
      validation: {
        issues,
        engine_config_source: config.source,
        depth_from_sensor: hasDepthSamples,
        scale_reference_cm: hasReference ? referenceSize : null,
      },
      persisted,
      generated_at: new Date().toISOString(),
    })
  }),
)

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Interquartile range relative to the median — a robust dispersion measure. */
function relativeSpread(values: number[], med: number): number {
  if (med <= 0) return 1
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = sorted[Math.floor(sorted.length * 0.25)]
  const q3 = sorted[Math.floor(sorted.length * 0.75)]
  return Math.abs(q3 - q1) / med
}

/** Append a rejected model response to the audit trail so it is traceable. */
async function recordRejected(
  caller: Caller | null,
  body: Record<string, unknown>,
  model: string,
  raw: string,
  issues: unknown[],
): Promise<void> {
  const potholeId = typeof body.pothole_id === 'string' ? body.pothole_id : null
  if (!potholeId || !caller) return
  try {
    const admin = adminClient()
    await admin.from('pothole_analysis').insert({
      pothole_id: potholeId,
      model,
      prompt_version: PROMPT_VERSION,
      raw_response: { text: raw.slice(0, 20000) },
      structured_response: { rejected: true, issues: issues as never },
      confidence: null,
      depth_method: 'UNKNOWN',
    })
  } catch (error) {
    // Audit failure must never mask the original error.
    console.error('[analyze-pothole] could not record rejected analysis:', error)
  }
}

interface PersistArgs {
  potholeId: string
  caller: Caller | null
  model: string
  rawText: string
  structured: Record<string, unknown>
  priority: { severity: string; priority_level: string; priority_score: number }
  measurements: Record<string, unknown>
  context: {
    nearSchool: boolean
    nearHospital: boolean
    nearIntersection: boolean
    roadType: string | null
    trafficRisk: string
  }
}

async function persistAnalysis(args: PersistArgs): Promise<boolean> {
  if (!args.caller) return false
  const admin = adminClient()

  try {
    const { data: pothole } = await admin
      .from('potholes')
      .select('id, reported_by')
      .eq('id', args.potholeId)
      .maybeSingle()

    if (!pothole) return false

    const privileged = ['OFFICER', 'ADMIN', 'SUPERVISOR'].includes(args.caller.role)
    if (!privileged && pothole.reported_by !== args.caller.user.id) return false

    await admin.from('pothole_analysis').insert({
      pothole_id: args.potholeId,
      model: args.model,
      prompt_version: PROMPT_VERSION,
      raw_response: { text: args.rawText.slice(0, 20000) },
      structured_response: args.structured as never,
      confidence: Number(args.measurements.ai_confidence) || null,
      depth_method: String(args.measurements.depth_method ?? 'UNKNOWN'),
      depth_confidence: Number(args.measurements.depth_confidence) || null,
    })

    await admin
      .from('potholes')
      .update({
        width_cm: args.measurements.width_cm,
        length_cm: args.measurements.length_cm,
        depth_cm: args.measurements.depth_cm,
        area_cm2: args.measurements.area_cm2,
        depth_method: args.measurements.depth_method,
        depth_confidence: args.measurements.depth_confidence,
        measurement_confidence: args.measurements.measurement_confidence,
        ai_confidence: args.measurements.ai_confidence,
        severity: args.priority.severity,
        priority_level: args.priority.priority_level,
        priority_score: args.priority.priority_score,
        near_school: args.context.nearSchool,
        near_hospital: args.context.nearHospital,
        near_intersection: args.context.nearIntersection,
        road_type: args.context.roadType,
        traffic_risk: args.context.trafficRisk,
      })
      .eq('id', args.potholeId)

    return true
  } catch (error) {
    console.error('[analyze-pothole] persistence failed:', error)
    return false
  }
}
