import type {
  AssignmentStatus,
  MeasurementMethod,
  NotificationType,
  OfficerStatus,
  PotholeStatus,
  PriorityLevel,
  RecommendedAction,
  RiskLevel,
  RoadDamageType,
  Severity,
} from '@/types'

export const APP_NAME = 'RoadGuard AI'
export const APP_TAGLINE = 'See the Damage. Measure the Risk. Fix the Road.'

/** Storage buckets (spec section 21). */
export const STORAGE_BUCKETS = {
  potholeImages: 'pothole-images',
  repairImages: 'repair-images',
  avatars: 'avatars',
  reports: 'reports',
} as const

/** Supabase Edge Function names (spec section 35). */
export const EDGE_FUNCTIONS = {
  analyzePothole: 'analyze-pothole',
  assignOfficer: 'assign-officer',
  calculatePriority: 'calculate-priority',
  verifyRepair: 'verify-repair',
  roadInsights: 'road-insights',
  reverseGeocode: 'reverse-geocode',
} as const

export const OFFICER_STATUS_META: Record<
  OfficerStatus,
  { label: string; color: string; dot: string }
> = {
  AVAILABLE: { label: 'Available', color: 'text-emerald-300', dot: 'bg-emerald-400' },
  BUSY: { label: 'Busy', color: 'text-amber-300', dot: 'bg-amber-400' },
  ON_SITE: { label: 'On site', color: 'text-sky-300', dot: 'bg-sky-400' },
  OFFLINE: { label: 'Offline', color: 'text-slate-400', dot: 'bg-slate-500' },
}

export const SEVERITY_META: Record<
  Severity,
  { label: string; hex: string; className: string; chip: string; emoji: string }
> = {
  CRITICAL: {
    label: 'Critical',
    hex: '#ff453a',
    className: 'text-red-400',
    chip: 'bg-red-500/18 text-red-300 border-red-400/30',
    emoji: '🔴',
  },
  HIGH: {
    label: 'High',
    hex: '#ff9f0a',
    className: 'text-orange-400',
    chip: 'bg-orange-500/18 text-orange-300 border-orange-400/30',
    emoji: '🟠',
  },
  MEDIUM: {
    label: 'Medium',
    hex: '#ffd60a',
    className: 'text-yellow-300',
    chip: 'bg-yellow-500/18 text-yellow-200 border-yellow-400/30',
    emoji: '🟡',
  },
  LOW: {
    label: 'Low',
    hex: '#30d158',
    className: 'text-emerald-400',
    chip: 'bg-emerald-500/18 text-emerald-300 border-emerald-400/30',
    emoji: '🟢',
  },
}

export const PRIORITY_META: Record<
  PriorityLevel,
  { code: string; label: string; className: string }
> = {
  CRITICAL: {
    code: 'P1',
    label: 'Critical',
    className: 'bg-red-500/20 text-red-300 border-red-400/40',
  },
  HIGH: {
    code: 'P2',
    label: 'High',
    className: 'bg-orange-500/20 text-orange-300 border-orange-400/40',
  },
  MEDIUM: {
    code: 'P3',
    label: 'Medium',
    className: 'bg-yellow-500/20 text-yellow-200 border-yellow-400/40',
  },
  LOW: {
    code: 'P4',
    label: 'Low',
    className: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40',
  },
}

/** Ordered status flow (spec section 24). */
export const STATUS_FLOW: PotholeStatus[] = [
  'DETECTED',
  'REPORTED',
  'ASSIGNED',
  'ACCEPTED',
  'EN_ROUTE',
  'ON_SITE',
  'UNDER_REPAIR',
  'AI_VERIFICATION',
  'RESOLVED',
]

export const STATUS_META: Record<
  PotholeStatus,
  { label: string; tone: string; description: string }
> = {
  DETECTED: {
    label: 'Detected',
    tone: 'bg-slate-500/20 text-slate-300 border-slate-400/30',
    description: 'Captured by AI scan, not yet reported.',
  },
  REPORTED: {
    label: 'Reported',
    tone: 'bg-sky-500/20 text-sky-300 border-sky-400/30',
    description: 'Report filed and waiting in the maintenance queue.',
  },
  ASSIGNED: {
    label: 'Assigned',
    tone: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30',
    description: 'A road officer has been assigned.',
  },
  ACCEPTED: {
    label: 'Accepted',
    tone: 'bg-violet-500/20 text-violet-300 border-violet-400/30',
    description: 'The officer accepted the job.',
  },
  EN_ROUTE: {
    label: 'En route',
    tone: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/30',
    description: 'Officer is travelling to the location.',
  },
  ON_SITE: {
    label: 'On site',
    tone: 'bg-teal-500/20 text-teal-300 border-teal-400/30',
    description: 'Officer has arrived at the pothole.',
  },
  UNDER_REPAIR: {
    label: 'Under repair',
    tone: 'bg-amber-500/20 text-amber-300 border-amber-400/30',
    description: 'Repair work is in progress.',
  },
  AI_VERIFICATION: {
    label: 'AI verification',
    tone: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/30',
    description: 'Before/after images are being verified.',
  },
  RESOLVED: {
    label: 'Resolved',
    tone: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
    description: 'Repair completed and verified.',
  },
  REJECTED: {
    label: 'Rejected',
    tone: 'bg-rose-500/20 text-rose-300 border-rose-400/30',
    description: 'Report was closed as invalid or duplicate.',
  },
}

export const ASSIGNMENT_STATUS_META: Record<
  AssignmentStatus,
  { label: string; tone: string }
> = {
  PENDING: { label: 'Pending', tone: 'bg-slate-500/20 text-slate-300' },
  ACCEPTED: { label: 'Accepted', tone: 'bg-violet-500/20 text-violet-300' },
  EN_ROUTE: { label: 'En route', tone: 'bg-cyan-500/20 text-cyan-300' },
  ON_SITE: { label: 'On site', tone: 'bg-teal-500/20 text-teal-300' },
  COMPLETED: { label: 'Completed', tone: 'bg-emerald-500/20 text-emerald-300' },
  DECLINED: { label: 'Declined', tone: 'bg-rose-500/20 text-rose-300' },
  CANCELLED: { label: 'Cancelled', tone: 'bg-slate-500/20 text-slate-300' },
}

export const MEASUREMENT_METHOD_META: Record<
  MeasurementMethod,
  { label: string; short: string; reliability: 'HIGH' | 'MEDIUM' | 'LOW' }
> = {
  AR_DEPTH_SENSOR: {
    label: 'AR depth sensor (LiDAR / ARCore / ARKit)',
    short: 'AR depth sensor',
    reliability: 'HIGH',
  },
  MONOCULAR_DEPTH_ESTIMATION: {
    label: 'Monocular depth estimation',
    short: 'Monocular depth',
    reliability: 'MEDIUM',
  },
  REFERENCE_OBJECT: {
    label: 'Reference object calibration',
    short: 'Reference object',
    reliability: 'MEDIUM',
  },
  CV_GEOMETRY: {
    label: 'Computer-vision road-plane geometry',
    short: 'CV geometry',
    reliability: 'MEDIUM',
  },
  VISION_ESTIMATE: {
    label: 'AI visual estimate',
    short: 'AI visual estimate',
    reliability: 'LOW',
  },
  FUSED: {
    label: 'Fused multi-source estimate',
    short: 'Fused estimate',
    reliability: 'MEDIUM',
  },
  MANUAL: { label: 'Manual officer measurement', short: 'Manual', reliability: 'HIGH' },
  UNKNOWN: { label: 'Unknown method', short: 'Unknown', reliability: 'LOW' },
}

export const RISK_META: Record<RiskLevel, { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'text-emerald-300' },
  MEDIUM: { label: 'Medium', className: 'text-yellow-300' },
  HIGH: { label: 'High', className: 'text-red-300' },
}

export const ROAD_DAMAGE_LABEL: Record<RoadDamageType, string> = {
  POTHOLE: 'Pothole',
  ALLIGATOR_CRACKING: 'Alligator cracking',
  RUTTING: 'Rutting',
  EDGE_BREAK: 'Edge break',
  SINKHOLE: 'Sinkhole',
  UNKNOWN: 'Unknown damage',
}

export const RECOMMENDED_ACTION_LABEL: Record<RecommendedAction, string> = {
  MONITOR: 'Monitor',
  SCHEDULE_REPAIR: 'Schedule repair',
  PRIORITY_REPAIR: 'Priority repair',
  URGENT_REPAIR: 'Urgent repair',
}

export const NOTIFICATION_TYPE_META: Record<
  NotificationType,
  { label: string; icon: string }
> = {
  REPORT_RECEIVED: { label: 'Report received', icon: '📥' },
  OFFICER_ASSIGNED: { label: 'Officer assigned', icon: '🧑‍🔧' },
  OFFICER_EN_ROUTE: { label: 'Officer en route', icon: '🚚' },
  REPAIR_COMPLETED: { label: 'Repair completed', icon: '✅' },
  STATUS_CHANGE: { label: 'Status change', icon: '🔔' },
  ASSIGNMENT_OFFER: { label: 'New assignment', icon: '📌' },
  SYSTEM: { label: 'System', icon: 'ℹ️' },
}

/** Road-type classifications used by the priority engine. */
export const ROAD_TYPES = [
  'HIGHWAY',
  'ARTERIAL',
  'COLLECTOR',
  'LOCAL',
  'RESIDENTIAL',
  'SERVICE',
] as const
export type RoadType = (typeof ROAD_TYPES)[number]

export const ROAD_TYPE_RISK: Record<RoadType, number> = {
  HIGHWAY: 100,
  ARTERIAL: 82,
  COLLECTOR: 64,
  LOCAL: 46,
  RESIDENTIAL: 34,
  SERVICE: 22,
}

/** Base map style. MapLibre's demo style works without any API key. */
export const DEFAULT_MAP_STYLE =
  import.meta.env?.VITE_MAP_STYLE_URL ??
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

export const DEFAULT_MAP_CENTER: [number, number] = [
  77.5946, 12.9716, // Bengaluru — matches the spec's examples
]

export const QUERY_KEYS = {
  potholes: 'potholes',
  myReports: 'my-reports',
  officers: 'officers',
  assignments: 'assignments',
  notifications: 'notifications',
  stats: 'stats',
  insights: 'insights',
} as const
