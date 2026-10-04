import { fail, ok } from '../_shared/cors.ts'
import { guard } from '../_shared/handler.ts'

interface AddressResult {
  address: string | null
  area: string | null
  city: string | null
  region: string | null
  country: string | null
  provider: string
  precision: 'approximate' | 'address' | 'street'
}

/**
 * POST /functions/v1/reverse-geocode
 *
 * Body: { latitude, longitude }
 *
 * Uses Mapbox when MAPBOX_SECRET_TOKEN is configured (kept server-side so the
 * token never ships to the browser), otherwise falls back to the free
 * OpenStreetMap Nominatim service with a descriptive User-Agent.
 */
Deno.serve((req) =>
  guard(req, { auth: true, limit: 30, windowMs: 60_000 }, async (_caller, body) => {
    const latitude = Number(body.latitude)
    const longitude = Number(body.longitude)

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return fail('INVALID_INPUT', 'latitude must be between -90 and 90.', 422)
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return fail('INVALID_INPUT', 'longitude must be between -180 and 180.', 422)
    }

    const mapboxToken = Deno.env.get('MAPBOX_SECRET_TOKEN')

    if (mapboxToken) {
      try {
        const result = await viaMapbox(latitude, longitude, mapboxToken)
        if (result) return ok({ result })
      } catch (error) {
        console.error('[reverse-geocode] Mapbox failed:', error)
      }
    }

    try {
      const result = await viaNominatim(latitude, longitude)
      if (result) return ok({ result })
    } catch (error) {
      console.error('[reverse-geocode] Nominatim failed:', error)
    }

    return fail(
      'GEOCODE_FAILED',
      'An address could not be resolved for these coordinates. The coordinates were kept.',
      502,
    )
  }),
)

async function viaMapbox(
  latitude: number,
  longitude: number,
  token: string,
): Promise<AddressResult | null> {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json` +
    `?types=address,poi,street,place&limit=1&access_token=${encodeURIComponent(token)}`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'RoadGuardAI/1.0 (municipal road maintenance platform)' },
  })
  if (!res.ok) throw new Error(`Mapbox ${res.status}`)

  const payload = await res.json()
  const feature = payload?.features?.[0]
  if (!feature) return null

  const context: { id: string; text: string }[] = payload.features[0].context ?? []
  const find = (prefix: string) =>
    context.find((c) => c.id?.startsWith(prefix))?.text ?? null

  return {
    address: feature.place_name ?? null,
    area: find('neighborhood') ?? find('locality'),
    city: find('place'),
    region: find('region'),
    country: find('country'),
    provider: 'mapbox',
    precision: feature.place_type?.includes('address') ? 'address' : 'street',
  }
}

async function viaNominatim(
  latitude: number,
  longitude: number,
): Promise<AddressResult | null> {
  const url =
    'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1' +
    `&lat=${latitude}&lon=${longitude}`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'RoadGuardAI/1.0 (municipal road maintenance platform)',
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)

  const payload = await res.json()
  const address = payload?.address
  if (!payload || !address) return null

  const parts = [
    [address.house_number, address.road].filter(Boolean).join(' '),
    address.suburb ?? address.neighbourhood,
    address.city ?? address.town ?? address.village,
    address.state,
  ].filter(Boolean)

  return {
    address: payload.display_name ?? (parts.length ? parts.join(', ') : null),
    area: address.suburb ?? address.neighbourhood ?? null,
    city: address.city ?? address.town ?? address.village ?? null,
    region: address.state ?? null,
    country: address.country ?? null,
    provider: 'nominatim',
    precision: address.road ? 'street' : 'approximate',
  }
}
