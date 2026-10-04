import type { RoadType } from '@/lib/constants'
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
  PriorityAssessment,
  RepairRecord,
  RoadInsight,
} from '@/types'

export interface PotholeFilters {
  status?: PotholeStatus[]
  severity?: string[]
  search?: string
  zone?: string
  fromDate?: string
  toDate?: string
  limit?: number
}

export interface CreatePotholeInput {
  latitude: number
  longitude: number
  imageUrl: string | null
  address?: string | null
  analysis: PotholeAnalysisResult
  priority: PriorityAssessment
  roadType: RoadType
  nearSchool?: boolean
  nearHospital?: boolean
  nearIntersection?: boolean
  notes?: string
  /** Local-only capture that has not been uploaded yet. */
  imageDataUrl?: string | null
}

export interface AnalyzeInput {
  imageDataUrl?: string | null
  imageUrl?: string | null
  mimeType?: string
  fix: Coordinate
  roadType: RoadType
  nearSchool?: boolean
  nearHospital?: boolean
  nearIntersection?: boolean
  trafficRisk?: 'LOW' | 'MEDIUM' | 'HIGH'
  referenceSizeCm?: number | null
  depthSamplesCm?: number[] | null
  depthMethodHint?: string | null
  reportCount?: number
}

export interface AnalyzeResponse {
  analysis: PotholeAnalysisResult & {
    area_cm2: number | null
    depth: {
      depth_value: number | null
      depth_unit: 'cm'
      depth_method: string
      depth_confidence: number
      source: 'sensor_samples' | 'visual_estimate'
    }
  }
  priority: PriorityAssessment
  severity: string
  model: string
  prompt_version: string
  validation: {
    issues: string[]
    engine_config_source: 'database' | 'defaults'
    depth_from_sensor: boolean
    scale_reference_cm: number | null
  }
  persisted: boolean
  generated_at: string
}

export interface AssignOfficerResponse {
  assigned: boolean
  reason?: string
  message?: string
  assignment?: {
    id: string
    status: AssignmentStatus
    distance_km: number | null
    estimated_arrival_minutes: number | null
    assignment_score: number | null
    assigned_at: string
  }
  officer?: {
    id: string
    full_name: string
    zone: string | null
    specialization: string | null
  }
  candidates_considered?: number
  radius_km?: number
}

export interface VerifyRepairInput {
  potholeId: string
  beforeImageUrl: string
  afterImageUrl: string
  repairNotes?: string
  repairType?: string
  material?: string
}

export interface VerifyRepairResponse {
  verification: {
    repair_detected: boolean
    remaining_damage: boolean
    surface_restored: boolean
    confidence: number
    recommendation: 'APPROVE' | 'REVIEW' | 'REJECT'
    notes: string
  }
  approved: boolean
  pothole_status: PotholeStatus
  advisory: string
}

export interface RoadInsightsResponse {
  stats: Record<string, unknown>
  insights: RoadInsight[]
  narration_source: 'gemini' | 'deterministic'
  generated_at: string
  note: string
}

export interface GeocodeResult {
  address: string | null
  area: string | null
  city: string | null
  region: string | null
  country: string | null
  provider: string
  precision: 'approximate' | 'address' | 'street'
}

/** Everything the UI needs, from one place. */
export interface Repository {
  readonly mode: 'live'

  // potholes
  listPotholes(filters?: PotholeFilters): Promise<Pothole[]>
  getPothole(id: string): Promise<Pothole | null>
  createPothole(input: CreatePotholeInput): Promise<Pothole>
  updatePotholeStatus(id: string, status: PotholeStatus): Promise<Pothole>
  myReports(userId: string | null): Promise<Pothole[]>

  // ai
  analyze(input: AnalyzeInput): Promise<AnalyzeResponse>
  calculatePriority(input: Record<string, unknown>): Promise<PriorityAssessment>
  verifyRepair(input: VerifyRepairInput): Promise<VerifyRepairResponse>
  roadInsights(): Promise<RoadInsightsResponse>

  // officers & assignments
  listOfficers(): Promise<Officer[]>
  updateOfficerStatus(officerId: string, status: Officer['status']): Promise<void>
  assignOfficer(potholeId: string): Promise<AssignOfficerResponse>
  listAssignments(options: {
    officerId?: string | null
    potholeId?: string
  }): Promise<Assignment[]>
  updateAssignment(id: string, status: AssignmentStatus): Promise<void>

  // repairs
  listRepairs(potholeId: string): Promise<RepairRecord[]>

  // notifications
  listNotifications(userId: string): Promise<AppNotification[]>
  markNotificationRead(id: string): Promise<void>

  // analytics
  dashboardStats(): Promise<DashboardStats>

  // storage & geo
  uploadImage(params: {
    dataUrl: string
    bucket: string
    kind: string
    userId: string
  }): Promise<string>
  signedUrl(bucket: string, path: string): Promise<string | null>
  resolveAddress(coordinate: Coordinate): Promise<GeocodeResult | null>
  lastFix: GeoFix | null
}
