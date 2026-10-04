/**
 * Versioned prompt library (spec section 32).
 *
 * Prompt text is treated as code: every change bumps `PROMPT_VERSION` and is
 * stored alongside the analysis so a score can always be traced back to the
 * exact instructions that produced it.
 */

export const PROMPT_VERSION = 'roadguard-analysis/v4'

export interface AnalysisPromptInput {
  hasScaleReference: boolean
  referenceSizeCm: number | null
  hasDepthSamples: boolean
  roadType: string | null
  latitude: number
  longitude: number
}

export function analysisPrompt(input: AnalysisPromptInput): string {
  const scaleNote = input.hasScaleReference
    ? `A calibration reference of known size (${input.referenceSizeCm} cm) is present in the frame. Use it to derive pixel-to-centimetre scale before estimating any dimension.`
    : `No calibration reference object is present. You therefore CANNOT know true physical scale. For width_cm and length_cm give a best guess and set measurement_confidence low (<= 0.45).`

  const depthNote = input.hasDepthSamples
    ? `On-device depth samples were captured alongside this image. They are supplied separately; you do not need to estimate depth — set depth_cm to null and let the geometry pipeline own that value.`
    : `No depth sensor data is available. Estimate depth only from visual cues (shadow, visible wall of the hole, perspective foreshortening, occlusion of the far edge). Be conservative.`

  return `You are an AI road-surface inspection system for a municipal road-maintenance platform.

Analyse the provided road image and determine whether a pothole is visible.

If a pothole is detected, identify:
1. pothole boundary (a normalised bounding box AND a short description)
2. approximate width
3. approximate length
4. approximate depth
5. road damage type
6. severity
7. traffic risk
8. vehicle risk
9. pedestrian risk
10. recommended repair urgency
11. confidence

LOCALISATION RULES:
- Report the pothole's location as "bounding_box": the tightest axis-aligned rectangle that encloses it, with x/y/width/height NORMALISED to 0..1 of the image (x,y = top-left corner).
- If no pothole is visible, set "bounding_box": null and "pothole_detected": false.

MEASUREMENT RULES — follow these exactly:
- Do NOT invent precision. Round millimetre-level guesses to the nearest centimetre.
- ${scaleNote}
- ${depthNote}
- A single RGB image does not contain absolute scale. Your numbers are ESTIMATES, and measurement_confidence must reflect that honestly.
- If you cannot see the pothole clearly, report the evidence you actually have in "visual_evidence" and lower confidence. Do not fabricate.

CONTEXT:
- Approximate location: ${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}
- Road classification hint: ${input.roadType ?? 'unknown'}

Return ONLY valid JSON matching exactly this schema (no markdown, no commentary):
{
  "pothole_detected": boolean,
  "confidence": number (0..1),
  "bounding_box": {"x": number, "y": number, "width": number, "height": number} | null,
  "width_cm": number|null,
  "length_cm": number|null,
  "depth_cm": number|null,
  "measurement_confidence": number (0..1),
  "measurement_method": "VISION_ESTIMATE",
  "severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "traffic_risk": "LOW"|"MEDIUM"|"HIGH",
  "vehicle_risk": "LOW"|"MEDIUM"|"HIGH",
  "pedestrian_risk": "LOW"|"MEDIUM"|"HIGH",
  "road_damage_type": "POTHOLE"|"ALLIGATOR_CRACKING"|"RUTTING"|"EDGE_BREAK"|"SINKHOLE"|"UNKNOWN",
  "recommended_action": "MONITOR"|"SCHEDULE_REPAIR"|"PRIORITY_REPAIR"|"URGENT_REPAIR",
  "visual_evidence": string[],
  "explanation": string
}`
}

export const PROMPT_VERSION_REPAIR = 'roadguard-repair/v2'

export function repairVerificationPrompt(): string {
  return `You are an AI repair-verification assistant for a municipal road-maintenance platform.

You are given two images of the SAME location:
- Image 1: BEFORE the repair (the reported pothole)
- Image 2: AFTER the repair

Determine, as carefully and honestly as you can:
- whether a repair is actually visible ("repair_detected")
- whether any visible damage remains ("remaining_damage")
- whether the road surface appears restored ("surface_restored")
- how confident you are ("confidence", 0..1)
- a recommendation: APPROVE, REVIEW, or REJECT

Rules:
- If the two images clearly show different locations, set repair_detected=false, remaining_damage=true, confidence low, and recommendation "REJECT".
- If the after image is dark, blurry, or obstructed, use "REVIEW" rather than guessing.
- This is an assistive signal only. Never state that it replaces a human inspection.

Return ONLY valid JSON (no markdown, no commentary):
{
  "repair_detected": boolean,
  "remaining_damage": boolean,
  "surface_restored": boolean,
  "confidence": number,
  "recommendation": "APPROVE"|"REVIEW"|"REJECT",
  "notes": string
}`
}

export const PROMPT_VERSION_INSIGHTS = 'roadguard-insights/v1'

/**
 * The insight model is deliberately given ONLY pre-computed statistics and is
 * forbidden from introducing new ones (spec section 29).
 */
export function insightPhrasingPrompt(stats: unknown): string {
  return `You are a road-maintenance analyst. You will be given a JSON object containing
statistics computed directly from a municipal database.

Rewrite each statistic as one short, clear, professional English sentence for a dashboard.

ABSOLUTE RULES:
- Use ONLY the numbers present in the input. Never introduce, extrapolate, round differently, or invent any figure.
- If you are unsure, repeat the input figure verbatim.
- Do not add recommendations that are not already present in the data.

Input statistics:
${JSON.stringify(stats, null, 2)}

Return ONLY valid JSON:
{ "insights": [ { "id": string, "headline": string, "detail": string, "severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL" } ] }`
}
