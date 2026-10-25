// Talks to the desiccant_life- engine on behalf of the browser.
//
// Robustness rules, each tested in test/engine.test.js:
//   1. The browser may only send the controls, each whitelisted.
//   2. Every hidden input is added here and pinned explicitly.
//   3. Every input is checked against the engine's echo; a mismatch is an
//      error, never a silently wrong picture.
//   4. Network errors and 502/503/504 are retried once; every call has a
//      timeout.
//   5. An engine without the fog-map API is reported as out of date.

import {
  ADDRESS, BUILDING_INPUT, EXISTING, FACADES, FIXED, GLASSES, GRAMS_PER_LB, HUMIDITY, normalizeU, OFFSET_INPUT, RANGES, SEALS_EXISTING, SEALS_RETROFIT, SITE_TOL_DEG, thermalOf, U_INPUT, WINDOW_INPUT, YEARS_AFTER_FULL,
} from '../shared/scenario.js'

export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

export const CONTROLS = ['ex', 'glass', 'u', 'offset', 'facade', 'width', 'height', 'floors', 'wfloor', 'seal_out', 'seal_in', 'lb', 't', 'rh', 'hum', 'addr', 'lat', 'lon']
// Optional controls and the value they take when absent; a scenario at that
// value keeps its pre-v2.5 cache key and report id (facade, width and height
// since v2.7: north, 60 x 96 in, the values that were fixed before; floors,
// window floor and room humidity since v2.8: 20, 10 and a fixed RH).
const OPTIONAL = {
  u: null, offset: OFFSET_INPUT.default, facade: 'north', width: WINDOW_INPUT.width, height: WINDOW_INPUT.height,
  floors: BUILDING_INPUT.floors, wfloor: BUILDING_INPUT.wfloor, hum: 'fixed',
}

/** True when an optional control is absent or at its default (left out of keys and links). */
export function atDefault(k, v) {
  return k in OPTIONAL && (v === undefined || v === null || v === OPTIONAL[k])
}

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

/** One line of text: trimmed, inner whitespace collapsed, length-checked. */
export function cleanAddress(raw) {
  if (raw === null || raw === undefined) throw new HttpError(400, 'Missing addr (the building address)')
  // eslint-disable-next-line no-control-regex
  // Tabs and line breaks (a pasted address) collapse like spaces; other control characters are refused.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) throw new HttpError(400, 'addr must be plain text')
  const v = String(raw).replace(/\s+/g, ' ').trim()
  if (v.length < ADDRESS.min) throw new HttpError(400, `addr is too short: give a street address, city and state`)
  if (v.length > ADDRESS.max) throw new HttpError(400, `addr must be at most ${ADDRESS.max} characters`)
  return v
}

/** Typed assembly U (v2.5): optional; absent or empty = the table value. */
function uValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null
  const re = new RegExp(`^\\d{1,2}(\\.\\d{1,${U_INPUT.decimals}})?$|^\\.\\d{1,${U_INPUT.decimals}}$`)
  if (!re.test(raw)) throw new HttpError(400, `u must be a number with at most ${U_INPUT.decimals} decimals, got "${raw}"`)
  const v = Number(raw)
  if (v < U_INPUT.min || v > U_INPUT.max) throw new HttpError(400, `u must be between ${U_INPUT.min.toFixed(3)} and ${U_INPUT.max.toFixed(3)} Btu/hr.ft2.F, got ${v}`)
  return v
}

/** Cavity depth in inches (v2.6): optional; absent or empty = 0.6 in. */
function offsetValue(raw) {
  if (raw === null || raw === undefined || raw === '') return OFFSET_INPUT.default
  const re = new RegExp(`^\\d{1,2}(\\.\\d{1,${OFFSET_INPUT.decimals}})?$|^\\.\\d{1,${OFFSET_INPUT.decimals}}$`)
  if (!re.test(raw)) throw new HttpError(400, `offset must be a number of inches with at most ${OFFSET_INPUT.decimals} decimals, got "${raw}"`)
  const v = Number(raw)
  if (v < OFFSET_INPUT.min || v > OFFSET_INPUT.max) throw new HttpError(400, `offset must be between ${OFFSET_INPUT.min.toFixed(2)} and ${OFFSET_INPUT.max.toFixed(2)} in, got ${v}`)
  return v
}

/** Facade orientation (v2.7): optional; absent or empty = north. */
function facadeValue(raw) {
  if (raw === null || raw === undefined || raw === '') return OPTIONAL.facade
  return oneOf('facade', raw, FACADES)
}

/** Window width or height in whole inches (v2.7): optional; absent or empty = the default. */
function windowSide(name, raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback
  return intInRange(name, raw, { min: WINDOW_INPUT.min, max: WINDOW_INPUT.max, step: 1 })
}

/** Building floors and the window's floor (v2.8): optional (20 and 10); the window floor at most the floors. */
function building(params) {
  const get = (k) => params.get(k)
  const empty = (x) => x === null || x === undefined || x === ''
  const floors = empty(get('floors')) ? OPTIONAL.floors : intInRange('floors', get('floors'), { min: BUILDING_INPUT.min, max: BUILDING_INPUT.max, step: 1 })
  const wfloor = empty(get('wfloor')) ? OPTIONAL.wfloor : intInRange('wfloor', get('wfloor'), { min: BUILDING_INPUT.min, max: BUILDING_INPUT.max, step: 1 })
  if (wfloor > floors) throw new HttpError(400, `wfloor (the window's floor) must be at most floors (${floors}), got ${wfloor}`)
  return { floors, wfloor }
}

/** Room humidity mode (v2.8): optional; absent or empty = a fixed RH. */
function humValue(raw) {
  if (raw === null || raw === undefined || raw === '') return OPTIONAL.hum
  return oneOf('hum', raw, HUMIDITY)
}

function coord(name, raw, limit) {
  if (!/^-?\d{1,3}(\.\d{1,12})?$/.test(raw)) throw new HttpError(400, `${name} must be a number in degrees, got "${raw}"`)
  const v = Number(raw)
  if (Math.abs(v) > limit) throw new HttpError(400, `${name} must be between -${limit} and ${limit}`)
  return Math.round(v * 1e5) / 1e5
}

/** lat and lon come as a pair or not at all. */
function site(params) {
  const la = params.get('lat')
  const lo = params.get('lon')
  const has = (x) => x !== null && x !== ''
  if (!has(la) && !has(lo)) return { lat: null, lon: null }
  if (!has(la) || !has(lo)) throw new HttpError(400, 'lat and lon must be sent together')
  return { lat: coord('lat', la, 90), lon: coord('lon', lo, 180) }
}

/** URLSearchParams from the browser -> validated scenario. */
export function parseScenario(params) {
  for (const k of params.keys()) {
    if (!CONTROLS.includes(k)) throw new HttpError(400, `Unknown parameter "${k}"`)
  }
  const ex = oneOf('ex', params.get('ex'), EXISTING)
  const glass = oneOf('glass', params.get('glass'), GLASSES)
  return {
    ex,
    glass,
    u: normalizeU(ex, glass, uValue(params.get('u'))),
    offset: offsetValue(params.get('offset')),
    facade: facadeValue(params.get('facade')),
    width: windowSide('width', params.get('width'), WINDOW_INPUT.width),
    height: windowSide('height', params.get('height'), WINDOW_INPUT.height),
    ...building(params),
    seal_out: oneOf('seal_out', params.get('seal_out'), SEALS_EXISTING),
    seal_in: oneOf('seal_in', params.get('seal_in'), SEALS_RETROFIT),
    lb: intInRange('lb', params.get('lb'), RANGES.lb),
    t: intInRange('t', params.get('t'), RANGES.t),
    rh: intInRange('rh', params.get('rh'), RANGES.rh),
    hum: humValue(params.get('hum')),
    addr: cleanAddress(params.get('addr')),
    ...site(params),
  }
}

/** Canonical cache key: same scenario, same key, whatever the query order. */
// Optional controls at their default (or missing) stay out of the key, so a
// scenario without a typed U or a changed offset keeps the key it had before
// v2.5 (same cache keys, same report ids).
export function scenarioKey(s) {
  return CONTROLS.filter((k) => !atDefault(k, s[k]))
    .map((k) => `${k}=${k === 'addr' ? s[k].toLowerCase() : s[k]}`).join('&')
}

/** Full engine query for a scenario. */
export function engineParams(s) {
  const th = thermalOf(s.ex, s.glass, s.u ?? null)
  const grams = Math.round(s.lb * GRAMS_PER_LB * 1000) / 1000
  return {
    address: s.addr,
    ...FIXED,
    orientation: s.facade ?? OPTIONAL.facade,
    width_in: s.width ?? WINDOW_INPUT.width,
    height_in: s.height ?? WINDOW_INPUT.height,
    offset_in: s.offset ?? OFFSET_INPUT.default,
    floors: s.floors ?? OPTIONAL.floors,
    window_floor: s.wfloor ?? OPTIONAL.wfloor,
    room_humidity: HUMIDITY.find((x) => x.key === (s.hum ?? OPTIONAL.hum)).engine,
    // v2.9 (engine 0.3.0, 2026-10-25): the existing glass sets how much of
    // the sun and sky on its outer surface reaches the cavity side.
    existing_glass: s.ex,
    // Without desiccant nothing ever fills, so the engine would play all
    // max_years years. Two are enough: year 1 starts from a clean pane and
    // fresh cavity air (a start-up year, less fog); year 2 is the settled
    // year the page reports.
    max_years: s.lb === 0 ? 2 : FIXED.max_years,
    f_cold: th.f_cold,
    u_ip: th.u_ip,
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
  room_humidity: 'room_humidity', people_gkg: 'people_gkg', people_fade_ach: 'people_fade_ach',
  stack_factor: 'stack_factor', existing_glass: 'existing_glass', film_correction: 'film_correction',
  sky_view_factor: 'sky_view_factor',
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
 * are sent as names and echoed as numbers. `picked` is where the address
 * box put the address ({ lat, lon }, or nulls when it was typed freehand).
 */
export function echoMismatches(sent, payload, presets, picked = { lat: null, lon: null }) {
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
  // geocoder found the same place the address box showed the user.
  const loc = payload.location
  if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') out.push('location: engine returned no geocoded location')
  else if (picked.lat !== null && picked.lon !== null) {
    const far = Math.abs(loc.lat - picked.lat) > SITE_TOL_DEG || Math.abs(loc.lon - picked.lon) > SITE_TOL_DEG
    if (far) out.push(`location: engine matched "${loc.matched_address}" (${loc.lat}, ${loc.lon}), not the picked address at (${picked.lat}, ${picked.lon})`)
  }
  const fog = payload.fog
  if (!fog || !Array.isArray(fog.years)) out.push('engine returned no fog map (engine predates the 2026-09-23 fog-map API)')
  else if (fog.years_after_full !== sent.years_after_full) out.push(`years_after_full: sent ${sent.years_after_full}, engine used ${fog.years_after_full}`)
  return out
}

const cToF = (c) => (c * 9) / 5 + 32
const r1 = (x) => Math.round(x * 10) / 10

/**
 * Site climate from the engine's weather summary and its daily mean
 * outdoor temperatures (first 365 days = one typical year). Heating degree
 * days use the US 65 F base: HDD = sum over days of max(0, 65 - daily mean).
 */
export function climateOf(payload) {
  const w = payload.weather || {}
  const days = payload.daily?.t_out_f?.slice(0, 365) ?? []
  const has = (x) => typeof x === 'number'
  return {
    coldest_f: has(w.t_out_c_min) ? r1(cToF(w.t_out_c_min)) : null,
    warmest_f: has(w.t_out_c_max) ? r1(cToF(w.t_out_c_max)) : null,
    mean_f: has(w.t_out_c_mean) ? r1(cToF(w.t_out_c_mean)) : null,
    hdd65: days.length === 365 ? Math.round(days.reduce((s, d) => s + Math.max(0, 65 - d), 0)) : null,
    freezing_days: days.length === 365 ? days.filter((d) => d < 32).length : null,
    elevation_m: has(w.elevation_m) ? w.elevation_m : null,
  }
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
      // v2.8: room RH as simulated, heating season (median, 10th, 90th %).
      room: payload.room?.heating_season ?? null,
    },
    engine: {
      version: payload.version,
      weather: payload.weather?.source || payload.weather?.label || null,
      site: payload.location?.matched_address ?? null,
      weather_cell: payload.weather ? [payload.weather.grid_lat, payload.weather.grid_lon] : null,
      station_id: payload.weather?.station_id ?? null,
      location: payload.location ? { lat: payload.location.lat, lon: payload.location.lon } : null,
      climate: climateOf(payload),
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
    const bad = echoMismatches(sent, r.body, p, { lat: scenario.lat ?? null, lon: scenario.lon ?? null })
    if (bad.length) throw new HttpError(502, 'The simulation engine used different inputs than requested, so the result is withheld', bad)
    return trimPayload(r.body, scenario, sent)
  }

  /**
   * Room-humidity sweep for the report's headroom chart: the scenario with
   * NO desiccant, two years, fog days in year 2 (the settled year) at each
   * room RH. That is the long-term state once any desiccant is spent.
   * Returns [{ rh, fog_days }].
   */
  async function sweepRh(scenario, rhValues) {
    const sent = engineParams({ ...scenario, lb: 0 })
    delete sent.trace
    delete sent.fog_map
    delete sent.years_after_full
    const p = await presets()
    const q = `${toQuery(sent)}&x_key=rh_room&x_values=${rhValues.join(',')}&sweep_max_years=2`
    const r = await getWithRetry(`${base}/api/sweep?${q}`, opts)
    if (r.status !== 200 || !r.body) throw new HttpError(502, `The simulation engine's sweep answered ${r.status}`, r.body?.error || r.body)
    // The echo carries the base inputs; the swept one (rh_in) varies per point.
    const bad = []
    for (const [k, v] of Object.entries(sent)) {
      if (k === 'rh_in') continue
      const ek = ECHO[k]
      let expected = v
      if (k === 'al_out' || k === 'al_in') expected = p?.[k]?.[v]
      if (!same(expected, r.body.inputs?.[ek])) bad.push(`${k}: sent ${JSON.stringify(expected)}, engine used ${JSON.stringify(r.body.inputs?.[ek])}`)
    }
    const pts = r.body.points || []
    if (r.body.x_key !== 'rh_room' || pts.length !== rhValues.length || pts.some((pt, i) => !same(pt.x, rhValues[i]))) {
      bad.push('sweep: engine returned different humidity points than requested')
    }
    if (bad.length) throw new HttpError(502, 'The simulation engine used different inputs than requested in the humidity sweep', bad)
    return pts.map((pt, i) => ({ rh: rhValues[i], fog_days: pt.fog_days_per_year }))
  }

  return { run, presets, sweepRh }
}
