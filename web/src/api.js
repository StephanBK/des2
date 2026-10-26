// The page's side of /api/run and /api/config.

import { ADDRESS, BUILDING_INPUT, DEFAULTS, EXISTING, FACADES, GLASSES, HUMIDITY, normalizeU, OFFSET_INPUT, PRESSURE_INPUT, RANGES, SEALS_EXISTING, SEALS_RETROFIT, U_INPUT, WINDOW_INPUT } from '../../shared/scenario.js'

const ORDER = ['ex', 'glass', 'u', 'offset', 'facade', 'width', 'height', 'floors', 'wfloor', 'pa', 'seal_out', 'seal_in', 'lb', 't', 'rh', 'hum', 'addr', 'lat', 'lon']

// Optional controls left out of links (and the server's cache key) at their
// default, so links from before v2.6 / v2.7 / v2.8 / v2.10 stay the same.
const LINK_DEFAULTS = {
  offset: OFFSET_INPUT.default, facade: DEFAULTS.facade, width: DEFAULTS.width, height: DEFAULTS.height,
  floors: DEFAULTS.floors, wfloor: DEFAULTS.wfloor, pa: DEFAULTS.pa, hum: DEFAULTS.hum,
}

export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

// lat/lon are left out when the address was typed rather than picked.
// An empty address (nothing entered yet) is left out too, and so are the
// standard offset, facade and window size (LINK_DEFAULTS).
export function queryOf(s) {
  const keep = (k) => s[k] !== null && s[k] !== undefined && s[k] !== '' && !(k in LINK_DEFAULTS && s[k] === LINK_DEFAULTS[k])
  return new URLSearchParams(ORDER.filter(keep).map((k) => [k, String(s[k])])).toString()
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

/**
 * A typed U from text (the URL or the U box): a number in U_INPUT's range,
 * rounded to its decimals; null when empty or invalid.
 */
export function parseU(raw) {
  const t = String(raw ?? '').trim()
  if (!/^(\d{1,2}(\.\d*)?|\.\d+)$/.test(t)) return null
  const v = Math.round(Number(t) * 10 ** U_INPUT.decimals) / 10 ** U_INPUT.decimals
  return v >= U_INPUT.min && v <= U_INPUT.max ? v : null
}

/** Cavity depth text (the URL or the box), inches: rounded to 2 decimals; null when empty or invalid. */
export function parseOffset(raw) {
  const t = String(raw ?? '').trim()
  if (!/^(\d{1,2}(\.\d*)?|\.\d+)$/.test(t)) return null
  const v = Math.round(Number(t) * 10 ** OFFSET_INPUT.decimals) / 10 ** OFFSET_INPUT.decimals
  return v >= OFFSET_INPUT.min && v <= OFFSET_INPUT.max ? v : null
}

/** Window width or height text (the URL or the box): whole inches in WINDOW_INPUT's range; null when empty or invalid. */
export function parseWindowSide(raw) {
  const t = String(raw ?? '').trim()
  if (!/^\d{1,3}$/.test(t)) return null
  const v = Number(t)
  return v >= WINDOW_INPUT.min && v <= WINDOW_INPUT.max ? v : null
}

/** A floor count or floor number from text (the URL or a box): whole number 1 to max; null when empty or invalid. */
export function parseFloor(raw, max = BUILDING_INPUT.max) {
  const t = String(raw ?? '').trim()
  if (!/^\d{1,3}$/.test(t)) return null
  const v = Number(t)
  return v >= BUILDING_INPUT.min && v <= max ? v : null
}

/** Building pressure from the address bar (v2.10): a whole number of Pa, -10 to +10 in steps of 2; else 0. */
export function parsePa(raw) {
  const t = String(raw ?? '').trim()
  if (!/^-?\d{1,2}$/.test(t)) return PRESSURE_INPUT.default
  const v = Number(t) || 0
  const { min, max, step } = PRESSURE_INPUT
  return v >= min && v <= max && (v - min) % step === 0 ? v : PRESSURE_INPUT.default
}

/** Floors and window floor from the address bar; a window floor above the floors falls back to the defaults. */
function urlBuilding(p) {
  const floors = parseFloor(p.get('floors')) ?? DEFAULTS.floors
  const wfloor = parseFloor(p.get('wfloor')) ?? DEFAULTS.wfloor
  return wfloor <= floors ? { floors, wfloor } : { floors: DEFAULTS.floors, wfloor: DEFAULTS.wfloor }
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
  const ex = pick(p.get('ex'), EXISTING, DEFAULTS.ex)
  const glass = pick(p.get('glass'), GLASSES, DEFAULTS.glass)
  return {
    ex,
    glass,
    u: normalizeU(ex, glass, parseU(p.get('u'))),
    offset: parseOffset(p.get('offset')) ?? OFFSET_INPUT.default,
    facade: pick(p.get('facade'), FACADES, DEFAULTS.facade),
    width: parseWindowSide(p.get('width')) ?? DEFAULTS.width,
    height: parseWindowSide(p.get('height')) ?? DEFAULTS.height,
    ...urlBuilding(p),
    pa: parsePa(p.get('pa')),
    seal_out: pick(p.get('seal_out'), SEALS_EXISTING, DEFAULTS.seal_out),
    seal_in: pick(p.get('seal_in'), SEALS_RETROFIT, DEFAULTS.seal_in),
    lb: num(p.get('lb'), RANGES.lb, DEFAULTS.lb),
    t: num(p.get('t'), RANGES.t, DEFAULTS.t),
    rh: num(p.get('rh'), RANGES.rh, DEFAULTS.rh),
    hum: pick(p.get('hum'), HUMIDITY, DEFAULTS.hum),
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
