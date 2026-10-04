import { useCallback, useMemo } from 'react'
import { getRepository } from '@/services'
import type { PotholeFilters } from '@/services/types'
import type { Assignment, DashboardStats, Pothole } from '@/types'
import { useAsync } from './useAsync'
import { useRealtimeTable } from './useRealtime'

const repo = () => getRepository()

/** Potholes with live refresh as incidents are created or updated. */
export function usePotholes(filters: PotholeFilters = {}, enabled = true) {
  const key = JSON.stringify(filters)
  const state = useAsync<Pothole[]>(() => repo().listPotholes(filters), [key], { enabled })
  const { refresh } = state

  useRealtimeTable('potholes', useCallback(() => void refresh(), [refresh]))

  return state
}

export function usePothole(id: string | undefined) {
  const state = useAsync<Pothole | null>(
    () => (id ? repo().getPothole(id) : Promise.resolve(null)),
    [id],
    { enabled: Boolean(id) },
  )
  const { refresh, setData } = state

  useRealtimeTable(
    'potholes',
    useCallback(
      (change) => {
        if (change.new?.id === id && id) setData(change.new as unknown as Pothole)
        else void refresh()
      },
      [id, refresh, setData],
    ),
    { filter: id ? `id=eq.${id}` : undefined, enabled: Boolean(id) },
  )

  return state
}

export function useMyReports(userId: string | null) {
  const state = useAsync<Pothole[]>(
    () => repo().myReports(userId),
    [userId],
    { enabled: Boolean(userId) },
  )
  const { refresh } = state
  useRealtimeTable(
    'potholes',
    useCallback(() => void refresh(), [refresh]),
    { enabled: Boolean(userId) },
  )
  return state
}

export function useOfficerAssignments(officerId: string | null) {
  const state = useAsync<Assignment[]>(
    () => repo().listAssignments({ officerId }),
    [officerId],
    { enabled: Boolean(officerId) },
  )
  const { refresh } = state
  useRealtimeTable(
    'assignments',
    useCallback(() => void refresh(), [refresh]),
    { enabled: Boolean(officerId) },
  )
  return state
}

export function useNotifications(userId: string | null) {
  const state = useAsync(
    () => repo().listNotifications(userId ?? ''),
    [userId],
    { enabled: Boolean(userId) },
  )
  const { refresh } = state
  useRealtimeTable(
    'notifications',
    useCallback(() => void refresh(), [refresh]),
    { filter: userId ? `user_id=eq.${userId}` : undefined, enabled: Boolean(userId) },
  )
  return state
}

export function useDashboardStats() {
  const state = useAsync<DashboardStats>(() => repo().dashboardStats(), [])
  const { refresh } = state
  useRealtimeTable('potholes', useCallback(() => void refresh(), [refresh]))
  return state
}

/** AI road intelligence — only fetched on demand (it costs a model call). */
export function useRoadInsights(enabled: boolean) {
  return useAsync(() => repo().roadInsights(), [enabled], { enabled })
}

export function useOfficers(enabled = true) {
  const state = useAsync(() => repo().listOfficers(), [], { enabled })
  const { refresh } = state
  useRealtimeTable('officers', useCallback(() => void refresh(), [refresh]), { enabled })
  return state
}

/** Derived client-side aggregate used by the map heatmap. */
export function useHeatmapGrid(potholes: Pothole[], cellDeg = 0.01) {
  return useMemo(() => {
    const grid = new Map<string, { lat: number; lon: number; total: number; critical: number }>()
    for (const pothole of potholes) {
      const lat = Math.round(pothole.latitude / cellDeg) * cellDeg
      const lon = Math.round(pothole.longitude / cellDeg) * cellDeg
      const key = `${lat.toFixed(4)}:${lon.toFixed(4)}`
      const cell = grid.get(key) ?? { lat, lon, total: 0, critical: 0 }
      cell.total += 1
      if (pothole.severity === 'CRITICAL') cell.critical += 1
      grid.set(key, cell)
    }
    return [...grid.values()]
  }, [potholes, cellDeg])
}
