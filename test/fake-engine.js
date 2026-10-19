// A stand-in for the desiccant_life- API. It echoes inputs the way the real
// engine does (t_in -> t_in_f, rh_in -> rh_in_pct, seal keys -> numbers)
// and can be told to misbehave.

export const PRESETS = {
  version: 'fake',
  al_out: [
    { key: 'hermetic', label: 'Hermetic', al_cfm_ft2: 0.0, source: 's', estimate: true },
    { key: 'wet_sealed', label: 'Wet-sealed, continuous bead', al_cfm_ft2: 0.005, source: 's', estimate: true },
    { key: 'new_fixed', label: 'New fixed window', al_cfm_ft2: 0.06, source: 's', estimate: false },
    { key: 'resealed', label: 'Freshly resealed', al_cfm_ft2: 0.10, source: 's', estimate: true },
    { key: 'operable', label: 'Operable, in spec', al_cfm_ft2: 0.30, source: 's', estimate: false },
    { key: 'aged', label: 'Aged, worn gaskets', al_cfm_ft2: 1.0, source: 's', estimate: true },
    { key: 'baseline', label: 'AERC baseline single-pane', al_cfm_ft2: 2.0, source: 's', estimate: false },
  ],
  al_in: [
    { key: 'hermetic', label: 'Hermetic', al_cfm_ft2: 0.0, source: 's', estimate: true },
    { key: 'wet_sealed', label: 'Wet-sealed, continuous bead', al_cfm_ft2: 0.005, source: 's', estimate: true },
    { key: 'gasketed', label: 'Well-gasketed fixed insert', al_cfm_ft2: 0.01, source: 's', estimate: true },
    { key: 'certified_best', label: 'Best certified insert', al_cfm_ft2: 0.06, source: 's', estimate: false },
    { key: 'certified_typical', label: 'Typical certified insert', al_cfm_ft2: 0.30, source: 's', estimate: true },
    { key: 'vented', label: 'Deliberate vent slots', al_cfm_ft2: 2.0, source: 's', estimate: true },
  ],
}

const RENAME = { t_in: 't_in_f', rh_in: 'rh_in_pct' }
const BOOL = new Set(['desorption', 'weekdays_only'])
const STRING = new Set(['address', 'orientation', 'desiccant', 'sealant_out', 'sealant_in', 'room_humidity'])

// Where the fake geocoder puts known addresses; anything else lands at the
// first entry, like a real geocoder that matched something.
export const PLACES = {
  '350 Fifth Avenue, New York, New York 10118, United States': { lat: 40.74843, lon: -73.985667 },
  '233 South Wacker Drive, Chicago, Illinois 60606, United States': { lat: 41.878687, lon: -87.635955 },
}

function lifetimePayload(q, opts) {
  const inputs = {}
  for (const [k, v] of q.entries()) {
    if (['trace', 'fog_map', 'years_after_full'].includes(k)) continue
    if (opts.ignore?.includes(k)) continue
    let val = STRING.has(k) ? v : BOOL.has(k) ? v === 'true' : Number(v)
    if (k === 'al_out' || k === 'al_in') val = PRESETS[k].find((p) => p.key === v).al_cfm_ft2
    inputs[RENAME[k] || k] = val
  }
  // What the real engine falls back to when a parameter is not sent.
  if (inputs.rh_in_pct === undefined) inputs.rh_in_pct = 35
  if (inputs.room_humidity === undefined) inputs.room_humidity = 'fixed'
  const years = opts.years ?? 2
  const fogYear = '0'.repeat(8000) + '1'.repeat(760)
  const payload = {
    version: '0.1.0',
    inputs,
    weather: {
      source: 'NSRDB TMY (fake)', grid_lat: 40.73, grid_lon: -73.98, station_id: '1', elevation_m: 10,
      t_out_c_min: -10, t_out_c_max: 35, t_out_c_mean: 12.5,
    },
    headline: {
      exhausted_hour: 3940, first_visible_hour: 8760 + 8000, capped: false,
      hours_run: years * 8760, years_run: years,
    },
    years: Array.from({ length: years }, (_, i) => ({ year: i + 1, hours_visible: i === years - 1 ? 760 : 0 })),
    daily: {
      loading: Array.from({ length: years * 365 }, (_, d) => Math.min(0.21, d * 0.002)),
      // 100 days at 25 F, 265 days at 70 F, repeated each year
      t_out_f: Array.from({ length: years * 365 }, (_, d) => (d % 365 < 100 ? 25 : 70)),
    },
    q_max_25: 0.21,
    // v0.2.0 engine: room RH over the heating season. A fixed room is its
    // own RH three times; "unhumidified" here is a fixed 18 % (10 to 31 %).
    room: {
      mode: inputs.room_humidity,
      heating_season: inputs.room_humidity === 'unhumidified'
        ? { median_pct: 18.0, p10_pct: 10.0, p90_pct: 31.0 }
        : { median_pct: inputs.rh_in_pct, p10_pct: inputs.rh_in_pct, p90_pct: inputs.rh_in_pct },
    },
    location: (() => {
      const addr = q.get('address')
      const hit = PLACES[addr] || Object.values(PLACES)[0]
      const shift = opts.far ? 0.5 : 0
      return { lat: hit.lat + shift, lon: hit.lon, matched_address: PLACES[addr] ? addr : Object.keys(PLACES)[0], query: addr }
    })(),
  }
  if (q.get('fog_map') === 'true' && !opts.noFog) {
    payload.fog = {
      years: Array.from({ length: years }, (_, i) => (i === years - 1 ? fogYear : null)),
      levels: 9, scale: 'log', visible_um: 5, max_um: 100,
      years_after_full: Number(q.get('years_after_full') || 0),
    }
  }
  return payload
}

// /api/sweep over room RH: the same input echo as a lifetime call, and
// fog days that start above 25 % RH (so headroom is "clear up to 25 %").
function sweepPayload(q, opts) {
  const { inputs } = lifetimePayload(q, opts)
  const xs = (q.get('x_values') || '').split(',').map(Number)
  return {
    mode: '1d', inputs, x_key: opts.sweepKey ?? q.get('x_key'), x_values: xs, sweep_max_years: Number(q.get('sweep_max_years')),
    points: xs.map((x) => ({ x, fog_days_per_year: Math.max(0, Math.round((x - 25) * 4)), years_run: 2 })),
  }
}

function response(status, body) {
  return { status, json: async () => body }
}

/**
 * fetch-compatible fake. opts:
 *   ignore: [param]    engine silently ignores these (like rh_in_pct)
 *   noFog: true        engine predates the fog-map API
 *   failFirst: n       first n lifetime calls answer 503
 *   down: true         every call throws (network error)
 *   hang: true         lifetime calls never answer (until aborted)
 *   far: true          geocoder lands 0.5 deg (55 km) north of the address
 *   sweepKey: 'x'      sweep answers for a different swept input
 */
export function fakeEngine(opts = {}) {
  const calls = { presets: 0, lifetime: 0, sweep: 0, urls: [] }
  async function fetchImpl(url, init = {}) {
    const u = new URL(url)
    calls.urls.push(u)
    if (opts.down) throw new TypeError('fetch failed')
    if (u.pathname === '/api/presets') { calls.presets++; return response(200, PRESETS) }
    if (u.pathname === '/api/lifetime') {
      calls.lifetime++
      if (opts.hang) {
        return new Promise((_, reject) => init.signal?.addEventListener('abort', () => {
          const e = new Error('aborted'); e.name = 'AbortError'; reject(e)
        }))
      }
      if (opts.failFirst && calls.lifetime <= opts.failFirst) return response(503, { error: 'busy' })
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      return response(200, lifetimePayload(u.searchParams, opts))
    }
    if (u.pathname === '/api/sweep') {
      calls.sweep++
      return response(200, sweepPayload(u.searchParams, opts))
    }
    return response(404, { error: 'not found' })
  }
  return { fetchImpl, calls }
}
