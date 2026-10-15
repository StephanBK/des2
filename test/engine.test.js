import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  climateOf, createEngineClient, ECHO_EXEMPT, ECHO_KEYS, engineParams, HttpError, parseScenario, scenarioKey,
} from '../server/engine.js'
import { ADDRESS, DEFAULTS, EXISTING, FIXED, GLASSES, GRAMS_PER_LB, RANGES, SEALS_EXISTING, SEALS_RETROFIT, THERMAL, thermalOf } from '../shared/scenario.js'
import { fakeEngine } from './fake-engine.js'

const q = (o) => new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)]))
const client = (opts, extra = {}) => {
  const f = fakeEngine(opts)
  return { f, c: createEngineClient({ baseUrl: 'http://engine.test', fetchImpl: f.fetchImpl, retryDelayMs: 1, ...extra }) }
}

// ------------------------------------------------------------ validation

test('defaults parse', () => {
  assert.deepEqual(parseScenario(q(DEFAULTS)), DEFAULTS)
})

test('every control option parses', () => {
  for (const x of EXISTING) assert.equal(parseScenario(q({ ...DEFAULTS, ex: x.key })).ex, x.key)
  assert.throws(() => parseScenario(q({ ...DEFAULTS, ex: 'triple' })), (e) => e.status === 400)
  for (const g of GLASSES) for (const o of SEALS_EXISTING) for (const i of SEALS_RETROFIT) {
    assert.equal(parseScenario(q({ ...DEFAULTS, glass: g.key, seal_out: o.key, seal_in: i.key })).glass, g.key)
  }
  for (let lb = RANGES.lb.min; lb <= RANGES.lb.max; lb++) assert.equal(parseScenario(q({ ...DEFAULTS, lb })).lb, lb)
})

test('hermetic is not accepted on either side', () => {
  assert.throws(() => parseScenario(q({ ...DEFAULTS, seal_out: 'hermetic' })), HttpError)
  assert.throws(() => parseScenario(q({ ...DEFAULTS, seal_in: 'hermetic' })), HttpError)
})

test('out of range, fractional, missing and unknown inputs are rejected with 400', () => {
  const bad = [
    { ...DEFAULTS, lb: 9 }, { ...DEFAULTS, lb: -1 }, { ...DEFAULTS, lb: '2.5' }, { ...DEFAULTS, lb: '' },
    { ...DEFAULTS, t: 59 }, { ...DEFAULTS, t: 81 }, { ...DEFAULTS, rh: 9 }, { ...DEFAULTS, rh: 61 },
    { ...DEFAULTS, rh: '30abc' }, { ...DEFAULTS, glass: 'triple' }, { ...DEFAULTS, rh_in_pct: 30 },
  ]
  for (const b of bad) {
    assert.throws(() => parseScenario(q(b)), (e) => e instanceof HttpError && e.status === 400, JSON.stringify(b))
  }
  const { lb, ...noLb } = DEFAULTS
  assert.throws(() => parseScenario(q(noLb)), (e) => e.status === 400)
})

test('address: whitespace collapses, length and plain text are enforced', () => {
  assert.equal(parseScenario(q({ ...DEFAULTS, addr: '  233  South Wacker Drive,\tChicago ' })).addr, '233 South Wacker Drive, Chicago')
  assert.equal(parseScenario(q({ ...DEFAULTS, addr: '350 Fifth Avenue\r\nNew York, NY' })).addr, '350 Fifth Avenue New York, NY')
  const bad = ['abc', 'x'.repeat(ADDRESS.max + 1), 'bell\u0007 street 12', '   ']
  for (const addr of bad) assert.throws(() => parseScenario(q({ ...DEFAULTS, addr })), (e) => e.status === 400, JSON.stringify(addr))
  const { addr, ...noAddr } = DEFAULTS
  assert.throws(() => parseScenario(q(noAddr)), (e) => e.status === 400 && /addr/.test(e.message))
})

test('lat and lon: a pair or nothing, in range, rounded to 5 decimals', () => {
  const { lat, lon, ...typed } = DEFAULTS
  const s = parseScenario(q(typed))
  assert.equal(s.lat, null)
  assert.equal(s.lon, null)
  assert.equal(parseScenario(q({ ...DEFAULTS, lat: '41.8786871234', lon: '-87.6359559' })).lat, 41.87869)
  for (const b of [{ lat: 41 }, { lon: -87 }].map(({ lat: la, lon: lo }) => ({ ...typed, ...(la ? { lat: la } : { lon: lo }) }))) {
    assert.throws(() => parseScenario(q(b)), (e) => e.status === 400 && /together/.test(e.message))
  }
  for (const b of [{ lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: 'north', lon: 0 }]) {
    assert.throws(() => parseScenario(q({ ...typed, ...b })), (e) => e.status === 400, JSON.stringify(b))
  }
})

test('cache key ignores address case', () => {
  const a = parseScenario(q(DEFAULTS))
  const b = parseScenario(q({ ...DEFAULTS, addr: DEFAULTS.addr.toUpperCase() }))
  assert.equal(scenarioKey(a), scenarioKey(b))
})

test('cache key ignores parameter order', () => {
  const a = parseScenario(q(DEFAULTS))
  const b = parseScenario(new URLSearchParams(Object.entries(DEFAULTS).reverse().map(([k, v]) => [k, String(v)])))
  assert.equal(scenarioKey(a), scenarioKey(b))
})

// ------------------------------------------------------------ engine params

test('engine params pin every fixed input and map the controls', () => {
  const p = engineParams({ ...DEFAULTS, glass: 'double', lb: 3, t: 65, rh: 45 })
  for (const [k, v] of Object.entries(FIXED)) if (k !== 'max_years') assert.equal(p[k], v, k)
  assert.equal(p.address, DEFAULTS.addr)
  assert.equal('addr' in p || 'lat' in p || 'lon' in p, false, 'address box fields never reach the engine')
  assert.equal(p.f_cold, 0.040)
  assert.equal(p.u_ip, 0.249)
  assert.equal(p.grams, Math.round(3 * GRAMS_PER_LB * 1000) / 1000)
  assert.equal(p.t_in, 65)
  assert.equal(p.rh_in, 45)            // the name the engine actually reads
  assert.equal(p.rh_in_pct, undefined) // the name it silently ignores
  assert.equal(p.desorption, true)
  assert.equal(p.fog_map, true)
  assert.equal(p.years_after_full, 1)
  assert.equal(p.max_years, 20)
})

test('no desiccant runs two years (year 2 is the settled one)', () => {
  assert.equal(engineParams({ ...DEFAULTS, lb: 0 }).max_years, 2)
})

test('every parameter sent to the engine is echo-checked', () => {
  const p = engineParams(DEFAULTS)
  for (const k of Object.keys(p)) assert.ok(ECHO_KEYS[k] || ECHO_EXEMPT.includes(k), `unchecked parameter ${k}`)
})

// ------------------------------------------------------------ run

test('a normal run returns the trimmed result', async () => {
  const { c, f } = client()
  const out = await c.run(DEFAULTS)
  assert.equal(out.result.full_hour, 3940)
  assert.equal(out.result.years.length, 2)
  assert.equal(out.result.years[1].fog.length, 8760)
  assert.equal(out.result.years[0].fog, null)
  assert.equal(out.result.fog_scale.levels, 9)
  assert.ok(out.result.daily_loading_pct.every((x) => x >= 0 && x <= 100.001))
  assert.equal(f.calls.lifetime, 1)
})

test('an input the engine ignores is caught by the echo check', async () => {
  const { c } = client({ ignore: ['rh_in'] })
  await assert.rejects(c.run(DEFAULTS), (e) => e.status === 502 && e.detail.some((d) => d.startsWith('rh_in')))
})

test('an ignored fixed input is caught too', async () => {
  const { c } = client({ ignore: ['window_floor'] })
  await assert.rejects(c.run(DEFAULTS), (e) => e.status === 502 && e.detail.some((d) => d.startsWith('window_floor')))
})

test('an engine without the fog map is reported as out of date', async () => {
  const { c } = client({ noFog: true })
  await assert.rejects(c.run(DEFAULTS), (e) => e.status === 502 && e.detail.some((d) => /fog map/.test(d)))
})

test('one 503 is retried and succeeds', async () => {
  const { c, f } = client({ failFirst: 1 })
  const out = await c.run(DEFAULTS)
  assert.equal(out.result.full_hour, 3940)
  assert.equal(f.calls.lifetime, 2)
})

test('two 503s give a clean 502', async () => {
  const { c, f } = client({ failFirst: 5 })
  await assert.rejects(c.run(DEFAULTS), (e) => e.status === 502)
  assert.equal(f.calls.lifetime, 2)
})

test('an unreachable engine gives a clean 502', async () => {
  const { c } = client({ down: true })
  await assert.rejects(c.run(DEFAULTS), (e) => e instanceof HttpError && e.status === 502)
})

test('a hanging engine times out with 504 and is not retried', async () => {
  const { c, f } = client({ hang: true }, { timeoutMs: 50 })
  await assert.rejects(c.run(DEFAULTS), (e) => e.status === 504)
  assert.equal(f.calls.lifetime, 1)
})

test('presets are fetched once and reused', async () => {
  const { c, f } = client()
  await c.run(DEFAULTS)
  await c.run({ ...DEFAULTS, lb: 2 })
  assert.equal(f.calls.presets, 1)
})

test('the engine URL gets exactly the parameters built here', async () => {
  const { c, f } = client()
  await c.run({ ...DEFAULTS, rh: 42 })
  const u = f.calls.urls.find((x) => x.pathname === '/api/lifetime')
  assert.equal(u.searchParams.get('rh_in'), '42')
  assert.equal(u.searchParams.get('desorption'), 'true')
  assert.equal(u.searchParams.get('al_out'), 'wet_sealed')
})

test('a geocode far from the picked address is rejected', async () => {
  const { c } = client({ far: true })
  await assert.rejects(c.run(DEFAULTS), (e) => e.status === 502 && e.detail.some((d) => d.startsWith('location') && d.includes('not the picked address')))
})

test('a typed address (no pick) is accepted wherever the engine lands, and the match is reported', async () => {
  const { c } = client({ far: true })
  const { lat, lon, ...typed } = DEFAULTS
  const out = await c.run({ ...typed, addr: '233 South Wacker Drive, Chicago, Illinois 60606, United States', lat: null, lon: null })
  assert.match(out.engine.site, /Chicago/)
  assert.ok(out.engine.location.lat > 42, 'reports where the engine actually landed')
})

test('the matched site, location and weather cell are reported with the result', async () => {
  const { c } = client()
  const out = await c.run(DEFAULTS)
  assert.match(out.engine.site, /10118/)
  assert.deepEqual(out.engine.location, { lat: 40.74843, lon: -73.985667 })
  assert.deepEqual(out.engine.weather_cell, [40.73, -73.98])
})

test('site climate: heating degree days and freezing days from daily means, extremes in F', () => {
  // 100 days at 25 F (HDD 40 each) + 265 days at 70 F (HDD 0) = 4,000
  const c = climateOf({
    weather: { t_out_c_min: -10, t_out_c_max: 35, t_out_c_mean: 12.5, elevation_m: 10 },
    daily: { t_out_f: [...Array(100).fill(25), ...Array(265).fill(70), ...Array(365).fill(0)] },
  })
  assert.deepEqual(c, { coldest_f: 14, warmest_f: 95, mean_f: 54.5, hdd65: 4000, freezing_days: 100, elevation_m: 10 })
  assert.deepEqual(climateOf({}), { coldest_f: null, warmest_f: null, mean_f: null, hdd65: null, freezing_days: null, elevation_m: null })
})

test('pounds to grams against independent literal values', () => {
  // 1 lb = 453.59237 g exactly (international pound, 1959)
  const expect = { 0: 0, 1: 453.592, 3: 1360.777, 4: 1814.369, 8: 3628.739 }
  for (const [lb, g] of Object.entries(expect)) {
    assert.equal(engineParams({ ...DEFAULTS, lb: Number(lb) }).grams, g, `${lb} lb`)
  }
})

test('the default engine request is pinned', () => {
  // v2.0 (universal): compared with park277-desiccant and desiccant_life-
  // (the Odoo simulator) this request differs in the address (any building
  // now), the building height (20 floors, window on 10: still mid-height,
  // where the stack effect is near zero, so results match 50/25; checked
  // against the live engine 2026-10-15) and the per-glass U (v1.11).
  assert.deepEqual({ ...engineParams(DEFAULTS) }, {
    address: '350 Fifth Avenue, New York, New York 10118, United States', orientation: 'north',
    width_in: 60, height_in: 96, offset_in: 0.6, u_ip: 0.164, r_ip: 0.97,
    desiccant: 'ms3a', desorption: true, absorptance: 0.1, floors: 20, window_floor: 10,
    p_occ_pa: 5, p_unocc_pa: 0, occ_start_h: 7, occ_end_h: 19, weekdays_only: true,
    sealant_out: 'silicone', sealant_in: 'silicone', max_years: 20,
    f_cold: 0.014, al_out: 'wet_sealed', al_in: 'wet_sealed', grams: 3628.739, t_in: 70, rh_in: 30,
    trace: false, fog_map: true, years_after_full: 1,
  })
})

test('each existing + retrofit pairing sends its own U and f', () => {
  // [U, f] by existing glass, then retrofit glass. Single: WINDOW f, INOVUES U.
  // Double: the 2026-10-15 estimates (see THERMAL), until WINDOW replaces them.
  const expect = {
    single: { single: [0.352, 0.068], double: [0.249, 0.040], vig: [0.164, 0.014] },
    double: { single: [0.249, 0.291], double: [0.193, 0.190], vig: [0.138, 0.074] },
  }
  assert.deepEqual(EXISTING.map((x) => x.key).sort(), Object.keys(expect).sort())
  for (const [ex, row] of Object.entries(expect)) {
    assert.deepEqual(GLASSES.map((g) => g.key).sort(), Object.keys(row).sort())
    for (const [glass, [u, f]] of Object.entries(row)) {
      for (const lb of [0, 4, 8]) {
        const p = engineParams({ ...DEFAULTS, ex, glass, lb })
        assert.equal(p.u_ip, u, `${ex}/${glass} ${lb} lb U`)
        assert.equal(p.f_cold, f, `${ex}/${glass} ${lb} lb f`)
      }
    }
  }
})

test('thermal table: double-pane rows are flagged as estimates, single-pane rows are not', () => {
  for (const g of GLASSES) {
    assert.equal(thermalOf('single', g.key).estimate, false)
    assert.equal(thermalOf('double', g.key).estimate, true)
  }
  assert.throws(() => thermalOf('triple', 'vig'), RangeError)
})

test('thermal table: physical ordering holds', () => {
  for (const ex of Object.keys(THERMAL)) {
    const t = THERMAL[ex]
    // better retrofit glass -> lower U, and a colder existing glass (lower f)
    assert.ok(t.single.u_ip > t.double.u_ip && t.double.u_ip > t.vig.u_ip, `${ex} U order`)
    assert.ok(t.single.f_cold > t.double.f_cold && t.double.f_cold > t.vig.f_cold, `${ex} f order`)
  }
  for (const g of GLASSES) {
    // an existing IGU adds resistance outboard: warmer cavity-side glass, lower U
    assert.ok(THERMAL.double[g.key].f_cold > THERMAL.single[g.key].f_cold, `${g.key} f rises`)
    assert.ok(THERMAL.double[g.key].u_ip < THERMAL.single[g.key].u_ip, `${g.key} U falls`)
  }
})

test('thermal table: the double-pane estimates follow from the stated resistances', () => {
  // Independent recomputation of the comment in shared/scenario.js.
  const Ro = 1 / 26 + 0.006
  const dR = 0.200 + 0.006
  for (const g of GLASSES) {
    const s1 = THERMAL.single[g.key]
    const f2 = (Ro + dR) / (Ro / s1.f_cold + dR)
    const u2 = 1 / (1 / s1.u_ip + dR * 5.678263)
    assert.ok(Math.abs(f2 - THERMAL.double[g.key].f_cold) < 0.0006, `${g.key} f ${f2}`)
    assert.ok(Math.abs(u2 - THERMAL.double[g.key].u_ip) < 0.0006, `${g.key} U ${u2}`)
  }
})

test('guard: U and f are never fixed', () => {
  assert.equal('u_ip' in FIXED, false, 'u_ip must not be in FIXED')
  assert.equal('f_cold' in FIXED, false, 'f_cold must not be in FIXED')
})
