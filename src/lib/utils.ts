import { type ClassValue, clsx } from 'clsx'
import { formatDistanceToNowStrict } from 'date-fns'
import { twMerge } from 'tailwind-merge'
import type { Coordinate } from '@/types'

/** Tailwind-aware class merge. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: Coordinate, b: Coordinate): number {
  const R = 6371
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Rough travel-time estimate assuming urban road speeds. Used when no routing
 * API is configured — always surfaced to the user as an estimate.
 */
export function estimateEtaMinutes(distanceKm: number, speedKmh = 28): number {
  return Math.max(1, Math.round((distanceKm / speedKmh) * 60))
}

export function formatDistanceKm(km: number | null | undefined): string {
  if (km == null || Number.isNaN(km)) return '—'
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${round(km, 1)} km`
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(minutes)) return '—'
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 24) return `${round(hours, 1)} h`
  return `${round(hours / 24, 1)} d`
}

export function formatCm(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${round(value, digits)} cm`
}

export function formatArea(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  if (value >= 10000) return `${round(value / 10000, 2)} m²`
  return `${Math.round(value).toLocaleString()} cm²`
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return Math.round(value).toLocaleString()
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${Math.round(value * 100)}%`
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return `${formatDistanceToNowStrict(new Date(iso))} ago`
  } catch {
    return '—'
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return '—'
  }
}

export function formatDateSafe(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function greeting(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function initials(name: string | null | undefined): string {
  if (!name) return 'RG'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** Bounding box around a point, in degrees. */
export function boundingBox(center: Coordinate, radiusKm: number) {
  const latDelta = radiusKm / 111
  const lonDelta = radiusKm / (111 * Math.cos((center.latitude * Math.PI) / 180) || 1)
  return {
    minLat: center.latitude - latDelta,
    maxLat: center.latitude + latDelta,
    minLon: center.longitude - lonDelta,
    maxLon: center.longitude + lonDelta,
  }
}

export function sleep(ms: number): Promise<void> {
  // Simulated latency keeps the scan animations honest in development, but it
  // only slows tests down — skip it under Vitest.
  if (import.meta.env?.MODE === 'test') return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Deterministic 0..1 hash for stable pseudo-random visuals. */
export function hashUnit(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}
