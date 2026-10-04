import { fail, ok } from '../_shared/cors.ts'
import {
  GeminiError,
  extractJson,
  generateText,
  imageFromUrl,
  type InlineImage,
} from '../_shared/gemini.ts'
import { guard } from '../_shared/handler.ts'
import { PROMPT_VERSION_REPAIR, repairVerificationPrompt } from '../_shared/prompts.ts'
import { verificationSchema } from '../_shared/schemas.ts'
import { adminClient } from '../_shared/supabase.ts'

const ADVISORY =
  'AI verification is an assistive signal only. It does not replace an official ' +
  'engineering inspection or sign-off.'

/**
 * POST /functions/v1/verify-repair
 *
 * Body: { pothole_id, before_image_url?, after_image_url, repair_notes?,
 *         repair_type?, material? }
 *
 * Downloads both frames, asks Gemini whether the repair is visible, validates
 * the verdict, then writes an immutable repair record and advances the
 * incident. A "REVIEW" verdict deliberately parks the incident instead of
 * auto-closing it.
 */
Deno.serve((req) =>
  guard(
    req,
    { auth: true, staff: true, limit: 15, windowMs: 60_000 },
    async (caller, body) => {
      const potholeId = typeof body.pothole_id === 'string' ? body.pothole_id : null
      const afterUrl = typeof body.after_image_url === 'string' ? body.after_image_url : null
      if (!potholeId) return fail('INVALID_INPUT', 'pothole_id is required.', 422)
      if (!afterUrl) return fail('INVALID_INPUT', 'after_image_url is required.', 422)

      const admin = adminClient()
      const { data: pothole, error } = await admin
        .from('potholes')
        .select('id, incident_code, image_url, status')
        .eq('id', potholeId)
        .maybeSingle()

      if (error) return fail('DB_ERROR', error.message, 500)
      if (!pothole) return fail('NOT_FOUND', 'That pothole no longer exists.', 404)

      const beforeUrl =
        typeof body.before_image_url === 'string' ? body.before_image_url : pothole.image_url

      if (!beforeUrl) {
        return fail(
          'MISSING_BEFORE_IMAGE',
          'A before image is required to verify a repair.',
          422,
        )
      }

      // ---------------------------------------------------------------
      // Load both frames
      // ---------------------------------------------------------------
      let before: InlineImage
      let after: InlineImage
      try {
        before = await imageFromUrl(beforeUrl, 'before')
        after = await imageFromUrl(afterUrl, 'after')
      } catch (error) {
        const gemini = error instanceof GeminiError ? error : null
        return fail(
          'IMAGE_UNAVAILABLE',
          gemini?.message ?? 'Could not download the repair images.',
          gemini?.status ?? 422,
        )
      }

      // ---------------------------------------------------------------
      // Ask Gemini to compare
      // ---------------------------------------------------------------
      let verdict
      try {
        const text = await generateText({
          prompt: repairVerificationPrompt(),
          images: [before, after],
          temperature: 0.1,
        })
        const parsed = verificationSchema.safeParse(extractJson(text))
        if (!parsed.success) {
          return fail(
            'AI_INVALID_RESPONSE',
            'The verification model returned an unusable verdict; nothing was approved.',
            422,
            { issues: parsed.error.issues.slice(0, 6).map((i) => i.message) },
          )
        }
        verdict = parsed.data
      } catch (error) {
        const gemini = error instanceof GeminiError ? error : null
        return fail(
          'AI_FAILED',
          gemini?.message ?? 'The verification service did not respond.',
          gemini?.status === 429 ? 429 : 502,
        )
      }

      // ---------------------------------------------------------------
      // Persist the repair record and advance the incident
      // ---------------------------------------------------------------
      const approved = verdict.recommendation === 'APPROVE'
      const nextStatus = approved ? 'RESOLVED' : 'AI_VERIFICATION'

      const { data: record, error: insertError } = await admin
        .from('repair_records')
        .insert({
          pothole_id: potholeId,
          officer_id: caller!.officerId,
          before_image_url: beforeUrl,
          after_image_url: afterUrl,
          repair_notes: typeof body.repair_notes === 'string' ? body.repair_notes : null,
          repair_type: typeof body.repair_type === 'string' ? body.repair_type : 'PATCH',
          material: typeof body.material === 'string' ? body.material : null,
          ai_verification: {
            ...verdict,
            model: Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash-lite',
            prompt_version: PROMPT_VERSION_REPAIR,
          },
          verification_confidence: verdict.confidence,
          approved,
          completed_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (insertError) {
        return fail('DB_ERROR', `Could not store the repair record: ${insertError.message}`, 500)
      }

      await admin
        .from('potholes')
        .update({ status: nextStatus })
        .eq('id', potholeId)

      await admin
        .from('assignments')
        .update({ status: 'COMPLETED', completed_at: new Date().toISOString() })
        .eq('pothole_id', potholeId)
        .in('status', ['PENDING', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE'])

      if (caller!.officerId) {
        await admin
          .from('officers')
          .update({ status: 'AVAILABLE' })
          .eq('id', caller!.officerId)
      }

      return ok({
        verification: verdict,
        approved,
        repair_record_id: record.id,
        pothole_status: nextStatus,
        advisory: ADVISORY,
      })
    },
  ),
)
