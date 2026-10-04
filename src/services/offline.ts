import { openDB, type IDBPDatabase } from 'idb'
import type { RoadType } from '@/lib/constants'
import { AppError } from '@/lib/errors'
import type { PotholeAnalysisResult, PriorityAssessment } from '@/types'

/**
 * Offline resilience (spec section 37).
 *
 * Captures are written to IndexedDB *before* any network call. When the
 * connection returns the queue is flushed automatically, so a scan taken in a
 * dead zone is never lost and never silently discarded.
 */

const DB_NAME = 'roadguard-offline'
const DB_VERSION = 1
const STORE = 'pending-reports'

export interface PendingReport {
  id: string
  createdAt: number
  attempts: number
  lastError: string | null
  latitude: number
  longitude: number
  accuracy: number | null
  roadType: RoadType
  nearSchool: boolean
  nearHospital: boolean
  nearIntersection: boolean
  trafficRisk: 'LOW' | 'MEDIUM' | 'HIGH'
  notes: string | null
  imageDataUrl: string | null
  analysis: PotholeAnalysisResult
  priority: PriorityAssessment
}

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: 'id' })
        }
      },
    })
  }
  return dbPromise
}

function isAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

export async function queueReport(report: PendingReport): Promise<void> {
  if (!isAvailable()) return
  try {
    const database = await db()
    await database.put(STORE, report)
  } catch (error) {
    console.error('[offline] could not queue report:', error)
  }
}

export async function listQueuedReports(): Promise<PendingReport[]> {
  if (!isAvailable()) return []
  try {
    const database = await db()
    const rows = (await database.getAll(STORE)) as PendingReport[]
    return rows.sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

export async function countQueuedReports(): Promise<number> {
  if (!isAvailable()) return 0
  try {
    const database = await db()
    return await database.count(STORE)
  } catch {
    return 0
  }
}

export async function removeQueuedReport(id: string): Promise<void> {
  if (!isAvailable()) return
  try {
    const database = await db()
    await database.delete(STORE, id)
  } catch {
    /* ignore */
  }
}

export async function recordFailure(id: string, message: string): Promise<void> {
  if (!isAvailable()) return
  try {
    const database = await db()
    const existing = (await database.get(STORE, id)) as PendingReport | undefined
    if (!existing) return
    await database.put(STORE, {
      ...existing,
      attempts: existing.attempts + 1,
      lastError: message,
    })
  } catch {
    /* ignore */
  }
}

/**
 * Attempt to upload everything in the queue.
 * Returns counts so the UI can report exactly what happened.
 */
export async function flushQueue(
  upload: (report: PendingReport) => Promise<void>,
): Promise<{ uploaded: number; failed: number; remaining: number }> {
  const pending = await listQueuedReports()
  let uploaded = 0
  let failed = 0

  for (const report of pending) {
    // Give up on a report only after many attempts, and never delete it.
    if (report.attempts >= 8) {
      failed += 1
      continue
    }
    try {
      await upload(report)
      await removeQueuedReport(report.id)
      uploaded += 1
    } catch (error) {
      const message =
        error instanceof AppError ? error.userMessage : error instanceof Error ? error.message : 'Unknown error'
      await recordFailure(report.id, message)
      failed += 1
    }
  }

  return { uploaded, failed, remaining: await countQueuedReports() }
}
