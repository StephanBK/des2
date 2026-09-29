// Talks to the desiccant_life- engine on behalf of the browser.
//
// Robustness rules, each tested in test/engine.test.js:
//   1. The browser may only send the six controls, each whitelisted.
//   2. Every hidden 277 Park input is added here and pinned explicitly.
//   3. Every input is checked against the engine's echo; a mismatch is an
//      error, never a silently wrong picture.
//   4. Network errors and 502/503/504 are retried once; every call has a
//      timeout.
//   5. An engine without the fog-map API is reported as out of date.

import {
  EXPECTED_SITE, FIXED, GLASSES, GRAMS_PER_LB, RANGES, SEALS_EXISTING, SEALS_RETROFIT, YEARS_AFTER_FULL,
} from '../shared/scenario.js'

export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

const CONTROLS = ['glass', 'seal_out', 'seal_in', 'lb', 't', 'rh']

function intInRange(name, raw, { min, max, step }) {
  if (raw === null || raw === undefined || raw === '') throw new HttpError(400, `Missing ${name}`)
  if (!/^-?\d+$/.test(raw)) throw new HttpError(400, `${name} must be a whole number, got "${raw}"`)
  const v = Number(raw)
  if (v < min || v > max) throw new HttpError(400, `${name} must be between ${min} and ${max}, got ${v}`)
  if ((v - min) % step !== 0) throw new HttpError(400, `${name} must be in steps of ${step}`)
  return v
}

function oneOf(name, raw, list) {
  const hit = list.find((o) => o.key === raw)
  if (!hit) throw new HttpError(400, `${name} must be one of ${list.map((o) => o.key).join(', ')}, got "${raw}"`)
  return hit.key
}

/** URLSearchParams from the browser -> validated scenario. */
export function parseScenario(params) {
  for (const k of params.keys()) {
    if (!CONTROLS.includes(k)) throw new HttpError(400, `Unknown parameter "${k}"`)
  }
  return {
    glass: oneOf('glass', params.get('glass'), GLASSES),
    seal_out: oneOf('seal_out', params.get('seal_out'), SEALS_EXISTING),
    seal_in: oneOf('seal_in', params.get('seal_in'), SEALS_RETROFIT),
    lb: intInRange('lb', params.get('lb'), RANGES.lb),
    t: intInRange('t', params.get('t'), RANGES.t),
    rh: intInRange('rh', params.get('rh'), RANGES.rh),
  }
}

/** Canonical cache key: same scenario, same key, whatever the query order. */
export function scenarioKey(s) {
  return CONTROLS.map((k) => `${k}=${s[k]}`).join('&')
}

/** Full engine query for a scenario. */
export function engineParams(s) {
  const glass = GLASSES.find((g) => g.key === s.glass)
  const grams = Math.round(s.lb * GRAMS_PER_LB * 1000) / 1000
  return {
    ...FIXED,
    // Without desiccant nothing ever fills, so the engine would play all
    // max_years years. Two are enough: year 1 starts from a clean pane and
    // fresh cavity air (a start-up year, less fog); year 2 is the settled
    // year the page reports.
    max_years: s.lb === 0 ? 2 : FIXED.max_years,
    f_cold: glass.f_cold,
    u_ip: glass.u_ip,
    al_out: s.seal_out,
    al_in: s.seal_in,
    grams,
    t_in: s.t,
    rh_in: s.rh,
    trace: false,
    fog_map: true,
    years_after_full: YEARS_AFTER_FULL,
  }
}

export function toQuery(params) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) q.set(k, typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v))
  return q.toString()
}

// Sent parameter -> where the engine echoes it. Every sent parameter must
// appear here (a test enforces it), so nothing can go unchecked.
const ECHO = {
  address: 'address', orientation: 'orientation',
  width_in: 'width_in', height_in: 'height_in', offset_in: 'offset_in',
  u_ip: 'u_ip', r_ip: 'r_ip', f_cold: 'f_cold',
  t_in: 't_in_f', rh_in: 'rh_in_pct',
  grams: 'grams', desiccant: 'desiccant', desorption: 'desorption',
  absorptance: 'absorptance', floors: 'floors', window_floor: 'window_floor',
  p_occ_pa: 'p_occ_pa', p_unocc_pa: 'p_unocc_pa', occ_start_h: 'occ_start_h',
  occ_end_h: 'occ_end_h', weekdays_only: 'weekdays_only',
  sealant_out: 'sealant_out', sealant_in: 'sealant_in', max_years: 'max_years',
  al_out: 'al_out', al_in: 'al_in',
}
// Checked elsewhere: trace (response shape), fog_map and years_after_full
// (payload.fog).
export const ECHO_EXEMPT = ['trace', 'fog_map', 'years_after_full']
export const ECHO_KEYS = ECHO

function same(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(a), Math.abs(b))
  }
  return a === b
}

/**
 * Compare what was sent with what the engine says it used. `presets` maps
 * seal keys to cfm/ft2 ({ al_out: {key: value}, al_in: {...} }); seal keys
 * are sent as names and echoed as numbers.
 */
export function echoMismatches(sent, payload, presets) {
  const echo = payload && payload.inputs
  if (!echo) return ['engine response has no input echo']
  const out = []
  for (const [k, v] of Object.entries(sent)) {
    if (ECHO_EXEMPT.includes(k)) continue
    const ek = ECHO[k]
    if (!ek) { out.push(`${k}: no echo mapping`); continue }
    let expected = v
    if (k === 'al_out' || k === 'al_in') {
      expected = presets?.[k]?.[v]
      if (expected === undefined) { out.push(`${k}: preset "${v}" unknown to the engine`); continue }
    }
    const got = echo[ek]
    if (!same(expected, got)) out.push(`${k}: sent ${JSON.stringify(expected)}, engine used ${JSON.stringify(got)}`)
  }
  // The echo proves the engine received the address; this proves its
  // geocoder found the right building.
  const loc = payload.location
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') out.push('location: engine returned no geocoded location')
  else {
    const far = Math.abs(loc.lat - EXPECTED_SITE.lat) > EXPECTED_SITE.tol_deg || Math.abs(loc.lon - EXPECTED_SITE.lon) > EXPECTED_SITE.tol_deg
    const zip = String(loc.matched_address || '').includes(EXPECTED_SITE.zip)
    if (far || !zip) out.push(`location: engine matched "${loc.matched_address}" (${loc.lat}, ${loc.lon}), not 277 Park Avenue ${EXPECTED_SITE.zip}`)
  }
  const fog = payload.fog
  if (!fog || !Array.isArray(fog.years)) out.push('engine returned no fog map (engine predates the 2026-09-23 fog-map API)')
  else if (fog.years_after_full !== sent.years_after_full) out.push(`years_after_full: sent ${sent.years_after_full}, engine used ${fog.years_after_full}`)
  return out
}

/** Keep only what the page draws. */
export function trimPayload(payload, scenario, sent) {
  const h = payload.headline
  const q25 = payload.q_max_25
  const fogYears = payload.fog.years
  if (fogYears.length !== payload.years.length) {
    throw new HttpError(502, 'Engine returned a fog map that does not match its years', { fog: fogYears.length, years: payload.years.length })
  }
  return {
    scenario,
    result: {
      lb: scenario.lb,
      full_hour: h.exhausted_hour,
      first_fog_hour: h.first_visible_hour,
      capped: h.capped,
      hours_run: h.hours_run,
      years_run: h.years_run,
      max_years: sent.max_years,
      years: payload.years.map((y, i) => ({ year: y.year, fog_hours: y.hours_visible, fog: fogYears[i] })),
      daily_loading_pct: q25 ? payload.daily.loading.map((x) => Math.round((1000 * 100 * x) / q25) / 1000) : [],
      fog_scale: {
        visible_um: payload.fog.visible_um, max_um: payload.fog.max_um,
        levels: payload.fog.levels, scale: payload.fog.scale,
      },
    },
    engine: {
      version: payload.version,
      weather: payload.weather?.source || payload.weather?.label || null,
      site: payload.location?.matched_address ?? null,
      weather_cell: payload.weather ? [payload.weather.grid_lat, payload.weather.grid_lon] : null,
    },
  }
}

const RETRYABLE = new Set([502, 503, 504])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url, { fetchImpl, timeoutMs }) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { accept: 'application/json' } })
    let body = null
    try { body = await res.json() } catch { body = null }
    return { status: res.status, body }
  } catch (err) {
    if (err.name === 'AbortError') throw new HttpError(504, `The simulation engine did not answer within ${Math.round(timeoutMs / 1000)} s`)
    throw new HttpError(502, 'The simulation engine could not be reached', String(err.message || err))
  } finally {
    clearTimeout(timer)
  }
}

async function getWithRetry(url, opts) {
  let last
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (attempt > 0) await sleep(opts.retryDelayMs)
    try {
      const r = await getJson(url, opts)
      if (!RETRYABLE.has(r.status)) return r
      last = new HttpError(502, `The simulation engine answered ${r.status}`, r.body)
    } catch (err) {
      if (err.status === 504) throw err            // a timeout is not retried: it already took minutes
      last = err
    }
  }
  throw last
}

export function createEngineClient({
  baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 150_000, retries = 1, retryDelayMs = 1500,
  presetsTtlMs = 3_600_000,
}) {
  const base = baseUrl.replace(/\/+$/, '')
  const opts = { fetchImpl, timeoutMs, retries, retryDelayMs }
  let presetsCache = null
  let presetsAt = 0

  async function presets() {
    if (presetsCache && Date.now() - presetsAt < presetsTtlMs) return presetsCache
    const r = await getWithRetry(`${base}/api/presets`, { ...opts, timeoutMs: 20_000 })
    if (r.status !== 200 || !r.body?.al_out || !r.body?.al_in) {
      throw new HttpError(502, 'The simulation engine did not return its seal presets', r.body)
    }
    const pick = (list) => Object.fromEntries(list.map((p) => [p.key, p.al_cfm_ft2]))
    const meta = (list) => Object.fromEntries(list.map((p) => [p.key, { al_cfm_ft2: p.al_cfm_ft2, label: p.label, source: p.source, estimate: p.estimate }]))
    presetsCache = {
      al_out: pick(r.body.al_out), al_in: pick(r.body.al_in),
      meta: { al_out: meta(r.body.al_out), al_in: meta(r.body.al_in) },
      version: r.body.version,
    }
    presetsAt = Date.now()
    return presetsCache
  }

  async function run(scenario) {
    const sent = engineParams(scenario)
    const p = await presets()
    const r = await getWithRetry(`${base}/api/lifetime?${toQuery(sent)}`, opts)
    if (r.status === 400) throw new HttpError(502, 'The simulation engine rejected the request', r.body?.error || r.body)
    if (r.status !== 200 || !r.body) throw new HttpError(502, `The simulation engine answered ${r.status}`, r.body?.error || r.body)
    const bad = echoMismatches(sent, r.body, p)
    if (bad.length) throw new HttpError(502, 'The simulation engine used different inputs than requested, so the result is withheld', bad)
    return trimPayload(r.body, scenario, sent)
  }

  return { run, presets }
}
