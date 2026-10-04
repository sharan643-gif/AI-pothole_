import { SUPABASE_URL } from '@/lib/config'
import { EDGE_FUNCTIONS } from '@/lib/constants'
import { AppError, toAppError } from '@/lib/errors'
import { potholeAnalysisResultSchema, sanitiseAnalysis } from '@/lib/schemas'
import { requireSupabase } from '@/lib/supabase'
import type {
  AppNotification,
  Assignment,
  AssignmentStatus,
  Coordinate,
  DashboardStats,
  GeoFix,
  Officer,
  Pothole,
  PotholeAnalysisResult,
  PotholeStatus,
  RepairRecord,
} from '@/types'
import type {
  AnalyzeInput,
  AnalyzeResponse,
  AssignOfficerResponse,
  CreatePotholeInput,
  GeocodeResult,
  PotholeFilters,
  Repository,
  VerifyRepairInput,
  VerifyRepairResponse,
} from './types'

/**
 * Live repository — every method hits Supabase.
 *
 * AI work is delegated to Edge Functions so the Gemini key never reaches the
 * browser; the client only ever holds the anon key.
 */

/** Signed URLs are short-lived; cache them for reuse within a session. */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()

interface EdgeEnvelope {
  ok?: boolean
  error?: { code?: string; message?: string }
  [key: string]: unknown
}

type DeploymentProbe = 'deployed' | 'missing' | 'unreachable'

/**
 * Work out whether the Edge Functions exist on this Supabase project.
 *
 * Calling a function that was never deployed makes the Supabase gateway reply
 * 404 — but that reply is only reachable when the request is a CORS "simple
 * request". A POST carrying `Content-Type: application/json` triggers a
 * preflight, and the gateway's allow-list for a missing function omits
 * `content-type`, so the browser blocks the call and the app only ever sees a
 * generic fetch failure. A bare GET sends no custom headers, so no preflight
 * is performed and the real status is readable: a deployed function answers
 * 405 (POST-only) while a missing one answers 404.
 */
async function probeEdgeDeployment(): Promise<DeploymentProbe> {
  if (!SUPABASE_URL) return 'unreachable'
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/${EDGE_FUNCTIONS.calculatePriority}`,
      { method: 'GET' },
    )
    return response.status === 404 ? 'missing' : 'deployed'
  } catch {
    return 'unreachable'
  }
}

async function invokeEdge<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const supabase = requireSupabase()

  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    // supabase-js surfaces non-2xx as FunctionsHttpError with a Response ctx.
    const context = (error as { context?: Response }).context

    // 404 means the function itself is missing — the Supabase runtime answers
    // {"code":"NOT_FOUND","message":"Requested function was not found"}.
    // supabase-js reports that as a generic "Failed to send a request", which
    // sends people hunting for a network problem that does not exist. Name the
    // real cause instead.
    if (context?.status === 404) {
      throw new AppError('CONFIG_MISSING', {
        message: `Edge Function "${name}" is not deployed on this Supabase project.`,
        userMessage:
          'The AI backend has not been deployed to Supabase yet, so analysis is unavailable.',
        cause: error,
      })
    }

    // No response reached us. Most often the request was blocked because the
    // function is not deployed; sometimes the device really is offline. Probe
    // (preflight-free) so the message names the actual problem.
    if (!context) {
      const probe = await probeEdgeDeployment()
      if (probe === 'missing') {
        throw new AppError('CONFIG_MISSING', {
          message: `Edge Function "${name}" is not deployed on this Supabase project.`,
          userMessage:
            'The AI backend has not been deployed to Supabase yet, so analysis is unavailable.',
          cause: error,
        })
      }
      if (probe === 'unreachable') {
        throw new AppError('NETWORK_FAILED', {
          message: error.message,
          userMessage: undefined,
          cause: error,
        })
      }
      throw new AppError('AI_FAILED', {
        message: error.message,
        userMessage:
          'The AI service could not be reached. Please try again in a moment.',
        cause: error,
      })
    }

    if (context && typeof context.json === 'function') {
      try {
        const payload = (await context.clone().json()) as EdgeEnvelope
        const code = payload.error?.code
        const message = payload.error?.message ?? error.message
        throw new AppError(mapEdgeCode(code), {
          message,
          userMessage: message ?? undefined,
          cause: error,
        })
      } catch (inner) {
        if (inner instanceof AppError) throw inner
      }
    }
    const message = /failed to fetch|networkerror/i.test(error.message)
      ? undefined
      : error.message
    throw new AppError(
      /failed to fetch|networkerror/i.test(error.message) ? 'NETWORK_FAILED' : 'AI_FAILED',
      { message: error.message, userMessage: message, cause: error },
    )
  }

  const envelope = data as EdgeEnvelope | null
  if (envelope && envelope.ok === false) {
    const code = envelope.error?.code
    throw new AppError(mapEdgeCode(code), {
      message: envelope.error?.message ?? 'Edge function reported a failure.',
      userMessage: envelope.error?.message ?? undefined,
    })
  }

  return data as T
}

function mapEdgeCode(code: string | undefined): import('@/lib/errors').AppErrorCode {
  switch (code) {
    case 'AUTH_REQUIRED':
      return 'AUTH_REQUIRED'
    case 'FORBIDDEN':
      return 'PERMISSION_DENIED'
    case 'AI_FAILED':
    case 'INTERNAL_ERROR':
      return 'AI_FAILED'
    case 'AI_INVALID_RESPONSE':
    case 'INVALID_INPUT':
    case 'INVALID_BODY':
      return 'AI_INVALID_RESPONSE'
    case 'RATE_LIMITED':
      return 'NETWORK_FAILED'
    case 'IMAGE_UNAVAILABLE':
      return 'UPLOAD_FAILED'
    case 'NOT_FOUND':
      return 'NOT_FOUND'
    default:
      return 'UNKNOWN'
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, payload] = dataUrl.split(',')
  if (!payload) throw new AppError('UPLOAD_FAILED', { message: 'Malformed data URL' })
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? 'image/jpeg'
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export class LiveRepository implements Repository {
  readonly mode = 'live' as const
  lastFix: GeoFix | null = null

  private get db() {
    return requireSupabase()
  }

  // ---------------------------------------------------------------- potholes

  async listPotholes(filters: PotholeFilters = {}): Promise<Pothole[]> {
    let query = this.db.from('potholes').select('*')

    if (filters.status?.length) query = query.in('status', filters.status)
    if (filters.severity?.length) query = query.in('severity', filters.severity)
    if (filters.zone) query = query.eq('zone', filters.zone)
    if (filters.fromDate) query = query.gte('created_at', filters.fromDate)
    if (filters.toDate) query = query.lte('created_at', filters.toDate)
    if (filters.search) {
      const term = filters.search.replace(/[%,]/g, '')
      query = query.or(
        `incident_code.ilike.%${term}%,address.ilike.%${term}%`,
      )
    }

    query = query.order('priority_score', { ascending: false }).limit(filters.limit ?? 300)

    const { data, error } = await query
    if (error) throw toAppError(error)
    return (data ?? []) as Pothole[]
  }

  async getPothole(id: string): Promise<Pothole | null> {
    const { data, error } = await this.db
      .from('potholes')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw toAppError(error)
    return (data as Pothole | null) ?? null
  }

  async createPothole(input: CreatePotholeInput): Promise<Pothole> {
    const { data: userData, error: userError } = await this.db.auth.getUser()
    if (userError || !userData.user) throw new AppError('AUTH_REQUIRED')

    const area =
      input.analysis.width_cm != null && input.analysis.length_cm != null
        ? Math.round(input.analysis.width_cm * input.analysis.length_cm)
        : null

    const { data, error } = await this.db
      .from('potholes')
      .insert({
        reported_by: userData.user.id,
        latitude: input.latitude,
        longitude: input.longitude,
        address: input.address ?? null,
        image_url: input.imageUrl,
        width_cm: input.analysis.width_cm,
        length_cm: input.analysis.length_cm,
        depth_cm: input.analysis.depth_cm,
        area_cm2: area,
        depth_method: input.analysis.measurement_method,
        depth_confidence: input.analysis.measurement_confidence,
        measurement_confidence: input.analysis.measurement_confidence,
        ai_confidence: input.analysis.confidence,
        severity: input.priority.severity,
        priority_score: input.priority.priority_score,
        priority_level: input.priority.priority_level,
        traffic_risk: input.analysis.traffic_risk,
        vehicle_risk: input.analysis.vehicle_risk,
        road_damage_type: input.analysis.road_damage_type,
        recommended_action: input.analysis.recommended_action,
        status: 'REPORTED',
        road_type: input.roadType,
        near_school: input.nearSchool ?? false,
        near_hospital: input.nearHospital ?? false,
        near_intersection: input.nearIntersection ?? false,
        notes: input.notes ?? null,
      })
      .select('*')
      .single()

    if (error) throw toAppError(error)
    return data as Pothole
  }

  async updatePotholeStatus(id: string, status: PotholeStatus): Promise<Pothole> {
    const { data, error } = await this.db
      .from('potholes')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single()
    if (error) throw toAppError(error)
    return data as Pothole
  }

  async myReports(userId: string | null): Promise<Pothole[]> {
    if (!userId) return []
    const { data, error } = await this.db
      .from('potholes')
      .select('*')
      .eq('reported_by', userId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw toAppError(error)
    return (data ?? []) as Pothole[]
  }

  // -------------------------------------------------------------------- ai

  async analyze(input: AnalyzeInput): Promise<AnalyzeResponse> {
    const body: Record<string, unknown> = {
      latitude: input.fix.latitude,
      longitude: input.fix.longitude,
      road_type: input.roadType,
      near_school: input.nearSchool ?? false,
      near_hospital: input.nearHospital ?? false,
      near_intersection: input.nearIntersection ?? false,
      traffic_risk: input.trafficRisk ?? 'MEDIUM',
      report_count: input.reportCount ?? 1,
    }
    if (input.imageUrl) body.image_url = input.imageUrl
    if (input.imageDataUrl) {
      body.image_base64 = input.imageDataUrl
      body.mime_type = input.mimeType ?? 'image/jpeg'
    }
    if (input.referenceSizeCm) body.reference_size_cm = input.referenceSizeCm
    if (input.depthSamplesCm?.length) body.depth_samples_cm = input.depthSamplesCm
    if (input.depthMethodHint) body.depth_method_hint = input.depthMethodHint

    const raw = await invokeEdge<AnalyzeResponse & { analysis: PotholeAnalysisResult }>(
      EDGE_FUNCTIONS.analyzePothole,
      body,
    )

    // Re-validate on the client too — defence in depth (spec section 49).
    const parsed = potholeAnalysisResultSchema.safeParse(raw.analysis)
    if (!parsed.success) {
      throw new AppError('AI_INVALID_RESPONSE', {
        message: parsed.error.issues.map((i) => i.message).join('; '),
      })
    }
    const clean = sanitiseAnalysis(parsed.data)

    return {
      ...raw,
      analysis: { ...raw.analysis, ...clean },
    }
  }

  async calculatePriority(input: Record<string, unknown>) {
    const result = await invokeEdge<{ assessment: AnalyzeResponse['priority'] }>(
      EDGE_FUNCTIONS.calculatePriority,
      input,
    )
    return result.assessment
  }

  async verifyRepair(input: VerifyRepairInput): Promise<VerifyRepairResponse> {
    return invokeEdge<VerifyRepairResponse>(EDGE_FUNCTIONS.verifyRepair, {
      pothole_id: input.potholeId,
      before_image_url: input.beforeImageUrl,
      after_image_url: input.afterImageUrl,
      repair_notes: input.repairNotes,
      repair_type: input.repairType,
      material: input.material,
    })
  }

  async roadInsights() {
    return invokeEdge<{
      stats: Record<string, unknown>
      insights: import('@/types').RoadInsight[]
      narration_source: 'gemini' | 'deterministic'
      generated_at: string
      note: string
    }>(EDGE_FUNCTIONS.roadInsights, { window_days: 30 })
  }

  // --------------------------------------------------------- officers & jobs

  async listOfficers(): Promise<Officer[]> {
    const { data, error } = await this.db
      .from('officers')
      .select('*, profile:profiles (full_name, email, avatar_url)')
      .order('status', { ascending: true })
    if (error) throw toAppError(error)
    return (data ?? []) as unknown as Officer[]
  }

  async updateOfficerStatus(officerId: string, status: Officer['status']): Promise<void> {
    const { error } = await this.db.from('officers').update({ status }).eq('id', officerId)
    if (error) throw toAppError(error)
  }

  async assignOfficer(potholeId: string): Promise<AssignOfficerResponse> {
    return invokeEdge<AssignOfficerResponse>(EDGE_FUNCTIONS.assignOfficer, {
      pothole_id: potholeId,
      max_radius_km: 15,
    })
  }

  async listAssignments(options: {
    officerId?: string | null
    potholeId?: string
  }): Promise<Assignment[]> {
    let query = this.db
      .from('assignments')
      .select('*, pothole:potholes (*), officer:officers (id, status, assigned_zone, profile:profiles (full_name, email))')

    if (options.officerId) query = query.eq('officer_id', options.officerId)
    if (options.potholeId) query = query.eq('pothole_id', options.potholeId)

    const { data, error } = await query.order('assigned_at', { ascending: false }).limit(200)
    if (error) throw toAppError(error)
    return (data ?? []) as unknown as Assignment[]
  }

  async updateAssignment(id: string, status: AssignmentStatus): Promise<void> {
    const patch: Record<string, unknown> = { status }
    const now = new Date().toISOString()
    if (status === 'ACCEPTED') patch.accepted_at = now
    if (status === 'ON_SITE') patch.arrived_at = now
    if (status === 'COMPLETED') patch.completed_at = now

    const { data, error } = await this.db
      .from('assignments')
      .update(patch)
      .eq('id', id)
      .select('pothole_id')
      .single()
    if (error) throw toAppError(error)

    // Mirror the assignment state onto the incident so citizens see progress.
    const mapped: Partial<Record<AssignmentStatus, PotholeStatus>> = {
      ACCEPTED: 'ACCEPTED',
      EN_ROUTE: 'EN_ROUTE',
      ON_SITE: 'ON_SITE',
      COMPLETED: 'RESOLVED',
    }
    const next = mapped[status]
    if (next && data?.pothole_id) {
      await this.db.from('potholes').update({ status: next }).eq('id', data.pothole_id)
    }
  }

  // ---------------------------------------------------------------- repairs

  async listRepairs(potholeId: string): Promise<RepairRecord[]> {
    const { data, error } = await this.db
      .from('repair_records')
      .select('*')
      .eq('pothole_id', potholeId)
      .order('created_at', { ascending: false })
    if (error) throw toAppError(error)
    return (data ?? []) as RepairRecord[]
  }

  // ---------------------------------------------------------- notifications

  async listNotifications(userId: string): Promise<AppNotification[]> {
    const { data, error } = await this.db
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60)
    if (error) throw toAppError(error)
    return (data ?? []) as AppNotification[]
  }

  async markNotificationRead(id: string): Promise<void> {
    const { error } = await this.db.from('notifications').update({ read: true }).eq('id', id)
    if (error) throw toAppError(error)
  }

  // --------------------------------------------------------------- analytics

  async dashboardStats(): Promise<DashboardStats> {
    const { data, error } = await this.db.rpc('dashboard_stats')
    if (error) throw toAppError(error)
    const payload = (data ?? {}) as Record<string, unknown>
    return {
      total: Number(payload.total ?? 0),
      critical: Number(payload.critical ?? 0),
      inRepair: Number(payload.inRepair ?? 0),
      resolved: Number(payload.resolved ?? 0),
      resolvedToday: Number(payload.resolvedToday ?? 0),
      avgResolutionHours: payload.avgResolutionHours == null
        ? null
        : Number(payload.avgResolutionHours),
    }
  }

  // ----------------------------------------------------------- storage & geo

  async uploadImage(params: {
    dataUrl: string
    bucket: string
    kind: string
    userId: string
  }): Promise<string> {
    const blob = dataUrlToBlob(params.dataUrl)
    const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg'
    const path = `${params.userId}/${params.kind}/${crypto.randomUUID()}.${extension}`

    const { error } = await this.db.storage.from(params.bucket).upload(path, blob, {
      contentType: blob.type,
      cacheControl: '3600',
      upsert: false,
    })
    if (error) throw toAppError(error, 'UPLOAD_FAILED')
    return path
  }

  async signedUrl(bucket: string, path: string): Promise<string | null> {
    if (!path) return null
    if (/^https?:\/\//.test(path)) return path

    const key = `${bucket}/${path}`
    const cached = signedUrlCache.get(key)
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url

    const { data, error } = await this.db.storage.from(bucket).createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) return null

    signedUrlCache.set(key, { url: data.signedUrl, expiresAt: Date.now() + 3500_000 })
    return data.signedUrl
  }

  async resolveAddress(coordinate: Coordinate): Promise<GeocodeResult | null> {
    try {
      const result = await invokeEdge<{ result: GeocodeResult }>(
        EDGE_FUNCTIONS.reverseGeocode,
        { latitude: coordinate.latitude, longitude: coordinate.longitude },
      )
      return result.result ?? null
    } catch {
      // Address resolution is best-effort; coordinates are always kept.
      return null
    }
  }
}
