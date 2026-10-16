// The page's side of /api/run and /api/config.

import { ADDRESS, DEFAULTS, EXISTING, GLASSES, RANGES, SEALS_EXISTING, SEALS_RETROFIT } from '../../shared/scenario.js'

const ORDER = ['ex', 'glass', 'seal_out', 'seal_in', 'lb', 't', 'rh', 'addr', 'lat', 'lon']

export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

// lat/lon are left out when the address was typed rather than picked.
// An empty address (nothing entered yet) is left out too.
export function queryOf(s) {
  return new URLSearchParams(ORDER.filter((k) => s[k] !== null && s[k] !== undefined && s[k] !== '').map((k) => [k, String(s[k])])).toString()
}

// Recent results, so flipping back to a scenario is instant. Results never
// change for the same inputs, so there is nothing to invalidate.
const memory = new Map()
const MEMORY_MAX = 60

export function peek(s) {
  return memory.get(queryOf(s))
}

export async function runScenario(s, signal) {
  const q = queryOf(s)
  if (memory.has(q)) return memory.get(q)
  let res
  try {
    res = await fetch(`/api/run?${q}`, { signal })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new ApiError('The page could not reach its server. Check the connection, then try again.', 0, String(err.message || err))
  }
  let body = null
  try { body = await res.json() } catch { body = null }
  if (!res.ok || !body?.result) {
    throw new ApiError(body?.error || `The server answered ${res.status}.`, res.status, body?.detail ?? null)
  }
  memory.set(q, body)
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value)
  return body
}

export async function fetchSuggestions(q, signal) {
  const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal })
  let body = null
  try { body = await res.json() } catch { body = null }
  if (!res.ok) throw new ApiError(body?.error || `Suggestions answered ${res.status}`, res.status)
  return body?.suggestions ?? []
}

export async function fetchConfig() {
  const res = await fetch('/api/config')
  if (!res.ok) throw new ApiError(`Config answered ${res.status}`, res.status)
  return res.json()
}

// ---------------------------------------------------------- shareable URL

function pick(raw, list, fallback) {
  return list.some((o) => o.key === raw) ? raw : fallback
}

function num(raw, { min, max, step }, fallback) {
  if (raw === null || !/^\d+$/.test(raw)) return fallback
  const v = Number(raw)
  return v >= min && v <= max && (v - min) % step === 0 ? v : fallback
}

function coord(raw, limit) {
  if (raw === null || !/^-?\d{1,3}(\.\d{1,12})?$/.test(raw)) return null
  const v = Number(raw)
  return Math.abs(v) <= limit ? Math.round(v * 1e5) / 1e5 : null
}

/** Address (and where it was picked) from the address bar; empty when absent or invalid. */
function urlSite(p) {
  const addr = (p.get('addr') || '').replace(/\s+/g, ' ').trim()
  if (addr.length < ADDRESS.min || addr.length > ADDRESS.max) return { addr: DEFAULTS.addr, lat: DEFAULTS.lat, lon: DEFAULTS.lon }
  const lat = coord(p.get('lat'), 90)
  const lon = coord(p.get('lon'), 180)
  return lat !== null && lon !== null ? { addr, lat, lon } : { addr, lat: null, lon: null }
}

/** Scenario from the address bar; anything invalid falls back to the default. */
export function readUrlScenario(search = window.location.search) {
  const p = new URLSearchParams(search)
  return {
    ex: pick(p.get('ex'), EXISTING, DEFAULTS.ex),
    glass: pick(p.get('glass'), GLASSES, DEFAULTS.glass),
    seal_out: pick(p.get('seal_out'), SEALS_EXISTING, DEFAULTS.seal_out),
    seal_in: pick(p.get('seal_in'), SEALS_RETROFIT, DEFAULTS.seal_in),
    lb: num(p.get('lb'), RANGES.lb, DEFAULTS.lb),
    t: num(p.get('t'), RANGES.t, DEFAULTS.t),
    rh: num(p.get('rh'), RANGES.rh, DEFAULTS.rh),
    ...urlSite(p),
  }
}

/** Calendar view from the address bar: 'working' or 'all' (default). */
export function readUrlHours(search = window.location.search) {
  return new URLSearchParams(search).get('hours') === 'working' ? 'working' : 'all'
}

/** Scenario plus the calendar view into the address bar (the view never goes to the API). */
export function writeUrlScenario(s, hours = 'all') {
  const q = queryOf(s) + (hours === 'working' ? '&hours=working' : '')
  const url = `${window.location.pathname}?${q}`
  if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url)
}
