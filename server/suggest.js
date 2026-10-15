// Address suggestions for the address box, from Mapbox Geocoding v6.
//
// The browser asks this server, this server asks Mapbox. The Mapbox token
// stays on the server (Railway variable MAPBOX_TOKEN), and the page's
// content security policy can keep connect-src 'self'.
//
// The engine geocodes with the same API (Mapbox Geocoding v6 forward), so a
// picked suggestion's full address lands on the same point when the engine
// looks it up again; engine.js checks that it does.

import { LruCache } from './cache.js'
import { HttpError } from './engine.js'

export const MAPBOX_FORWARD_URL = 'https://api.mapbox.com/search/geocode/v6/forward'

// NREL's weather set covers the Americas; INOVUES works in North America.
export const SUGGEST_COUNTRIES = 'us,ca,mx,pr'
export const SUGGEST_TYPES = 'address,street,postcode,place'
export const QUERY = { min: 3, max: 120 }

/** Mapbox feature -> what the address box shows and sends back. */
export function toSuggestion(f) {
  const p = f?.properties || {}
  const c = p.coordinates || {}
  const lon = typeof c.longitude === 'number' ? c.longitude : f?.geometry?.coordinates?.[0]
  const lat = typeof c.latitude === 'number' ? c.latitude : f?.geometry?.coordinates?.[1]
  const full = p.full_address || [p.name, p.place_formatted].filter(Boolean).join(', ')
  if (!full || typeof lat !== 'number' || typeof lon !== 'number') return null
  return {
    full,
    name: p.name || full,
    place: p.place_formatted || '',
    type: p.feature_type || null,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
  }
}

export function createSuggester({
  token = process.env.MAPBOX_TOKEN || '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  cache = new LruCache({ max: 2000, ttlMs: 7 * 24 * 3600 * 1000 }),
} = {}) {
  const available = Boolean(token)

  async function suggest(rawQuery) {
    if (!available) throw new HttpError(503, 'Address suggestions are not set up on this server (MAPBOX_TOKEN missing). Type the full address instead.')
    const q = String(rawQuery ?? '').replace(/\s+/g, ' ').trim()
    if (q.length < QUERY.min) throw new HttpError(400, `Type at least ${QUERY.min} characters`)
    if (q.length > QUERY.max) throw new HttpError(400, `At most ${QUERY.max} characters`)
    const key = q.toLowerCase()
    const hit = cache.get(key)
    if (hit) return hit

    const url = new URL(MAPBOX_FORWARD_URL)
    url.search = new URLSearchParams({
      q, autocomplete: 'true', limit: '5', types: SUGGEST_TYPES, country: SUGGEST_COUNTRIES,
      language: 'en', access_token: token,
    }).toString()
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    let res
    try {
      res = await fetchImpl(url.toString(), { signal: ctl.signal, headers: { accept: 'application/json' } })
    } catch (err) {
      // Never echo the URL: it carries the token.
      throw new HttpError(err.name === 'AbortError' ? 504 : 502, 'The address service did not answer. Try again, or type the full address.')
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'The address service rejected this server\'s key (check MAPBOX_TOKEN).')
    if (res.status !== 200) throw new HttpError(502, `The address service answered ${res.status}. Type the full address instead.`)
    let body = null
    try { body = await res.json() } catch { body = null }
    const out = (body?.features || []).map(toSuggestion).filter(Boolean)
    cache.set(key, out)
    return out
  }

  return { available, suggest }
}
