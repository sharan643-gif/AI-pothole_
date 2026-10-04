/**
 * Geographic → 3D projection helpers for the globe.
 *
 * The globe uses a plain sphere with the conventional mapping: latitude runs
 * from the north pole (phi = 0) to the south pole, and longitude wraps around
 * the Y axis. Keeping this pure means it is testable without a WebGL context.
 */

export type Vec3 = [number, number, number]

const DEG = Math.PI / 180

/**
 * Convert a latitude/longitude pair to a point on a sphere of the given
 * radius. The result is in three.js coordinates: +Y is north.
 */
export function latLngToVector3(latitude: number, longitude: number, radius = 1): Vec3 {
  const phi = (90 - latitude) * DEG
  const theta = (longitude + 180) * DEG
  const sinPhi = Math.sin(phi)
  return [
    -radius * sinPhi * Math.cos(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.sin(theta),
  ]
}

/** Great-circle distance in km between two lat/lng points (Haversine). */
export function distanceKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371
  const dLat = (b.latitude - a.latitude) * DEG
  const dLon = (b.longitude - a.longitude) * DEG
  const lat1 = a.latitude * DEG
  const lat2 = b.latitude * DEG
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
