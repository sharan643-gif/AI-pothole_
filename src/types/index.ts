/**
 * Domain types for RoadGuard AI.
 *
 * These mirror the PostgreSQL enums/tables in `supabase/migrations`.
 * Note: the project compiles with `erasableSyntaxOnly`, so string-literal
 * unions are used instead of TS enums.
 */

export type UserRole = 'CITIZEN' | 'OFFICER' | 'ADMIN' | 'SUPERVISOR'

export type OfficerStatus = 'AVAILABLE' | 'BUSY' | 'OFFLINE' | 'ON_SITE'

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type PriorityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export type RoadDamageType =
  | 'POTHOLE'
  | 'ALLIGATOR_CRACKING'
  | 'RUTTING'
  | 'EDGE_BREAK'
  | 'SINKHOLE'
  | 'UNKNOWN'

export type RecommendedAction =
  | 'MONITOR'
  | 'SCHEDULE_REPAIR'
  | 'PRIORITY_REPAIR'
  | 'URGENT_REPAIR'

export type PotholeStatus =
  | 'DETECTED'
  | 'REPORTED'
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'ON_SITE'
  | 'UNDER_REPAIR'
  | 'AI_VERIFICATION'
  | 'RESOLVED'
  | 'REJECTED'

/**
 * How a measurement was derived. The UI must never present an estimate as a
 * ground-truth physical measurement (see spec section 56).
 */
export type MeasurementMethod =
  | 'AR_DEPTH_SENSOR'
  | 'MONOCULAR_DEPTH_ESTIMATION'
  | 'REFERENCE_OBJECT'
  | 'CV_GEOMETRY'
  | 'VISION_ESTIMATE'
  | 'FUSED'
  | 'MANUAL'
  | 'UNKNOWN'

export type AssignmentStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'EN_ROUTE'
  | 'ON_SITE'
  | 'COMPLETED'
  | 'DECLINED'
  | 'CANCELLED'

export type NotificationType =
  | 'REPORT_RECEIVED'
  | 'OFFICER_ASSIGNED'
  | 'OFFICER_EN_ROUTE'
  | 'REPAIR_COMPLETED'
  | 'STATUS_CHANGE'
  | 'ASSIGNMENT_OFFER'
  | 'SYSTEM'

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  role: UserRole
  avatar_url: string | null
  created_at: string
}

export interface Officer {
  id: string
  profile_id: string
  department: string
  phone: string | null
  latitude: number | null
  longitude: number | null
  status: OfficerStatus
  assigned_zone: string | null
  specialization: string | null
  created_at: string
  updated_at: string
  /** Joined from profiles when available. */
  profile?: Pick<Profile, 'full_name' | 'email' | 'avatar_url'> | null
}

export interface Pothole {
  id: string
  incident_code: string
  reported_by: string | null
  latitude: number
  longitude: number
  address: string | null
  image_url: string | null
  width_cm: number | null
  length_cm: number | null
  depth_cm: number | null
  area_cm2: number | null
  depth_method: MeasurementMethod
  depth_confidence: number | null
  measurement_confidence: number | null
  ai_confidence: number | null
  severity: Severity
  priority_score: number
  priority_level: PriorityLevel
  traffic_risk: RiskLevel
  vehicle_risk: RiskLevel
  road_damage_type: RoadDamageType
  recommended_action: RecommendedAction
  status: PotholeStatus
  zone: string | null
  road_type: string | null
  near_school: boolean
  near_hospital: boolean
  near_intersection: boolean
  report_count: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PotholeAnalysis {
  id: string
  pothole_id: string
  model: string
  prompt_version: string
  raw_response: unknown
  structured_response: unknown
  confidence: number | null
  created_at: string
}

export interface Assignment {
  id: string
  pothole_id: string
  officer_id: string
  assigned_at: string
  accepted_at: string | null
  arrived_at: string | null
  completed_at: string | null
  status: AssignmentStatus
  distance_km: number | null
  estimated_arrival_minutes: number | null
  assignment_score: number | null
  officer?: Officer | null
  pothole?: Pothole | null
}

export interface RepairRecord {
  id: string
  pothole_id: string
  officer_id: string
  before_image_url: string | null
  after_image_url: string | null
  repair_notes: string | null
  repair_type: string | null
  ai_verification: unknown
  verification_confidence: number | null
  completed_at: string | null
  created_at: string
}

export interface AppNotification {
  id: string
  user_id: string
  pothole_id: string | null
  title: string
  message: string
  type: NotificationType
  read: boolean
  created_at: string
}

/** Row in `severity_config` — weights are data, not hard-coded constants. */
export interface SeverityConfig {
  id: string
  key: string
  weight: number
  thresholds: Record<string, number>
  notes: string | null
  updated_at: string
}

/**
 * Normalised (0..1) rectangle locating the detected defect within the frame.
 * `x`/`y` are the top-left corner; used to draw the detection overlay.
 */
export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

/** Structured Gemini analysis payload (validated by Zod). */
export interface PotholeAnalysisResult {
  pothole_detected: boolean
  confidence: number
  /** Normalised box around the defect, or null when the model could not localise it. */
  bounding_box: BoundingBox | null
  width_cm: number | null
  length_cm: number | null
  depth_cm: number | null
  measurement_confidence: number
  measurement_method: MeasurementMethod
  severity: Severity
  traffic_risk: RiskLevel
  vehicle_risk: RiskLevel
  pedestrian_risk: RiskLevel
  road_damage_type: RoadDamageType
  recommended_action: RecommendedAction
  visual_evidence: string[]
  explanation: string
}

/** Severity/priority engine output. */
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

export interface GeoFix {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
}

export interface Coordinate {
  latitude: number
  longitude: number
}

export interface RoadInsight {
  id: string
  headline: string
  detail: string
  metric: string | null
  trend: 'up' | 'down' | 'flat'
  severity: Severity
}

export interface DashboardStats {
  total: number
  critical: number
  inRepair: number
  resolved: number
  avgResolutionHours: number | null
  resolvedToday: number
}
