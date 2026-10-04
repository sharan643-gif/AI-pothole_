import { fail, ok } from '../_shared/cors.ts'
import { guard } from '../_shared/handler.ts'
import { adminClient } from '../_shared/supabase.ts'

/**
 * POST /functions/v1/assign-officer
 *
 * Body: { pothole_id, max_radius_km?, zone?, department? }
 *
 * Selects the most appropriate *available* officer using the additive scoring
 * model in `find_nearest_officers` (spec section 11) — never "the first row".
 * When nobody is eligible the report stays queued and the caller is told
 * honestly rather than being handed a fabricated assignment.
 */
Deno.serve((req) =>
  guard(req, { auth: true, limit: 20, windowMs: 60_000 }, async (caller, body) => {
    const potholeId = typeof body.pothole_id === 'string' ? body.pothole_id : null
    if (!potholeId) {
      return fail('INVALID_INPUT', 'pothole_id is required.', 422)
    }

    const maxRadiusKm = Number.isFinite(Number(body.max_radius_km))
      ? Math.max(1, Number(body.max_radius_km))
      : 15
    const department = typeof body.department === 'string' ? body.department : 'ROADS'

    const admin = adminClient()

    const { data: pothole, error: potholeError } = await admin
      .from('potholes')
      .select('id, incident_code, reported_by, latitude, longitude, priority_level, depth_cm, zone')
      .eq('id', potholeId)
      .maybeSingle()

    if (potholeError) {
      return fail('DB_ERROR', potholeError.message, 500)
    }
    if (!pothole) {
      return fail('NOT_FOUND', 'That pothole report no longer exists.', 404)
    }

    const privileged = ['OFFICER', 'ADMIN', 'SUPERVISOR'].includes(caller!.role)
    if (!privileged && pothole.reported_by !== caller!.user.id) {
      return fail('FORBIDDEN', 'You can only dispatch officers for your own reports.', 403)
    }

    // -----------------------------------------------------------------
    // Rank eligible officers
    // -----------------------------------------------------------------
    const { data: candidates, error: rpcError } = await admin.rpc('find_nearest_officers', {
      p_latitude: pothole.latitude,
      p_longitude: pothole.longitude,
      p_department: department,
      p_zone: typeof body.zone === 'string' ? body.zone : pothole.zone,
      p_limit: 10,
    })

    if (rpcError) {
      return fail('DB_ERROR', `Officer lookup failed: ${rpcError.message}`, 500)
    }

    const ranked = (candidates ?? []).map((row: Record<string, unknown>) => ({
      officer_id: String(row.officer_id),
      profile_id: String(row.profile_id),
      full_name: String(row.full_name ?? 'Unnamed officer'),
      distance_km: row.distance_km == null ? null : Number(row.distance_km),
      eta_minutes: row.eta_minutes == null ? null : Number(row.eta_minutes),
      assignment_score: Number(row.assignment_score ?? 0),
      assigned_zone: (row.assigned_zone as string | null) ?? null,
      specialization: (row.specialization as string | null) ?? null,
    }))

    const inRange = ranked.filter(
      (officer) => officer.distance_km == null || officer.distance_km <= maxRadiusKm,
    )

    console.log(
      `[assign-officer] ${pothole.incident_code}: ${ranked.length} available, ` +
        `${inRange.length} within ${maxRadiusKm} km`,
    )

    if (inRange.length === 0) {
      // Leave the report in the queue — do NOT invent an assignment.
      if (pothole.incident_code) {
        await admin
          .from('potholes')
          .update({ status: 'REPORTED' })
          .eq('id', potholeId)
          .eq('status', 'DETECTED')
      }
      return ok({
        assigned: false,
        reason: 'NO_OFFICER_AVAILABLE',
        message:
          'No available officer nearby. Your report has been registered and added to the maintenance queue.',
        candidates_considered: ranked.length,
        radius_km: maxRadiusKm,
      })
    }

    const chosen = inRange[0]

    // -----------------------------------------------------------------
    // Retire any stale assignment, then create the new one
    // -----------------------------------------------------------------
    await admin
      .from('assignments')
      .update({ status: 'CANCELLED', decline_reason: 'Reassigned' })
      .eq('pothole_id', potholeId)
      .in('status', ['PENDING', 'ACCEPTED', 'EN_ROUTE', 'ON_SITE'])

    const { data: assignment, error: assignError } = await admin
      .from('assignments')
      .insert({
        pothole_id: potholeId,
        officer_id: chosen.officer_id,
        status: 'PENDING',
        distance_km: chosen.distance_km,
        estimated_arrival_minutes: chosen.eta_minutes,
        assignment_score: chosen.assignment_score,
        assigned_by: caller!.user.id,
      })
      .select('*')
      .single()

    if (assignError) {
      return fail('DB_ERROR', `Assignment failed: ${assignError.message}`, 500)
    }

    // Claim the officer and progress the incident (the DB trigger fans out
    // notifications to both the officer and the citizen).
    await admin.from('officers').update({ status: 'BUSY' }).eq('id', chosen.officer_id)
    await admin.from('potholes').update({ status: 'ASSIGNED' }).eq('id', potholeId)

    return ok({
      assigned: true,
      assignment: {
        id: assignment.id,
        status: assignment.status,
        distance_km: assignment.distance_km,
        estimated_arrival_minutes: assignment.estimated_arrival_minutes,
        assignment_score: assignment.assignment_score,
        assigned_at: assignment.assigned_at,
      },
      officer: {
        id: chosen.officer_id,
        full_name: chosen.full_name,
        zone: chosen.assigned_zone,
        specialization: chosen.specialization,
      },
      alternatives_considered: ranked.length - 1,
    })
  }),
)
