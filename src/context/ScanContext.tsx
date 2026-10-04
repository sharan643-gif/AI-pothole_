import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { RoadType } from '@/lib/constants'
import type { AnalyzeResponse, CreatePotholeInput } from '@/services/types'
import type { GeoFix, RiskLevel } from '@/types'

/**
 * Holds the in-flight scan between the capture screen and the result screen.
 *
 * Kept in memory on purpose: an unsaved scan should not silently persist to
 * storage after the user walks away, and the result page is useless without the
 * capture it describes.
 */

export interface ScanContextInput {
  roadType: RoadType
  nearSchool: boolean
  nearHospital: boolean
  nearIntersection: boolean
  trafficRisk: RiskLevel
  referenceSizeCm: number | null
}

export interface ScanDraft {
  imageDataUrl: string
  fix: GeoFix
  accuracy: number | null
  address: string | null
  context: ScanContextInput
  analysis: AnalyzeResponse
  createdAt: number
}

interface ScanSessionState {
  draft: ScanDraft | null
  setDraft: (draft: ScanDraft) => void
  clearDraft: () => void
  /** Set once the report has been filed, so the result page can link out. */
  filedPotholeId: string | null
  setFiledPotholeId: (id: string | null) => void
  /** Convenience: build the repository payload from the current draft. */
  toCreateInput: (imageUrl: string | null, address: string | null) => CreatePotholeInput | null
}

const ScanSessionContext = createContext<ScanSessionState | null>(null)

export function ScanSessionProvider({ children }: { children: ReactNode }) {
  const [draft, setDraftState] = useState<ScanDraft | null>(null)
  const [filedPotholeId, setFiledPotholeId] = useState<string | null>(null)

  const setDraft = useCallback((next: ScanDraft) => {
    setDraftState(next)
    setFiledPotholeId(null)
  }, [])

  const clearDraft = useCallback(() => {
    setDraftState(null)
    setFiledPotholeId(null)
  }, [])

  const toCreateInput = useCallback<ScanSessionState['toCreateInput']>(
    (imageUrl, address) => {
      if (!draft) return null
      const { analysis } = draft
      return {
        latitude: draft.fix.latitude,
        longitude: draft.fix.longitude,
        imageUrl,
        address,
        analysis: {
          pothole_detected: analysis.analysis.pothole_detected,
          confidence: analysis.analysis.confidence,
          bounding_box: analysis.analysis.bounding_box ?? null,
          width_cm: analysis.analysis.width_cm,
          length_cm: analysis.analysis.length_cm,
          depth_cm: analysis.analysis.depth_cm,
          measurement_confidence: analysis.analysis.measurement_confidence,
          measurement_method: analysis.analysis.measurement_method,
          severity: analysis.priority.severity,
          traffic_risk: analysis.analysis.traffic_risk,
          vehicle_risk: analysis.analysis.vehicle_risk,
          pedestrian_risk: analysis.analysis.pedestrian_risk,
          road_damage_type: analysis.analysis.road_damage_type,
          recommended_action: analysis.analysis.recommended_action,
          visual_evidence: analysis.analysis.visual_evidence,
          explanation: analysis.analysis.explanation,
        },
        priority: analysis.priority,
        roadType: draft.context.roadType,
        nearSchool: draft.context.nearSchool,
        nearHospital: draft.context.nearHospital,
        nearIntersection: draft.context.nearIntersection,
        imageDataUrl: draft.imageDataUrl,
      }
    },
    [draft],
  )

  const value = useMemo<ScanSessionState>(
    () => ({
      draft,
      setDraft,
      clearDraft,
      filedPotholeId,
      setFiledPotholeId,
      toCreateInput,
    }),
    [draft, setDraft, clearDraft, filedPotholeId, toCreateInput],
  )

  return <ScanSessionContext.Provider value={value}>{children}</ScanSessionContext.Provider>
}

export function useScanSession(): ScanSessionState {
  const context = useContext(ScanSessionContext)
  if (!context) throw new Error('useScanSession must be used within <ScanSessionProvider>')
  return context
}
