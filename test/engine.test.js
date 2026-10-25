import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  climateOf, createEngineClient, ECHO_EXEMPT, ECHO_KEYS, engineParams, HttpError, parseScenario, scenarioKey,
} from '../server/engine.js'
import { ADDRESS, DEFAULTS, EXAMPLE_SITE, EXISTING, FACADES, FIXED, GLASSES, GRAMS_PER_LB, RANGES, SEALS_EXISTING, SEALS_RETROFIT, THERMAL, thermalOf, WINDOW_INPUT } from '../shared/scenario.js'

// The page's defaults have no address (v2.4); tests add a known one.
const BASE = { ...DEFAULTS, ...EXAMPLE_SITE }
import { fakeEngine } from './fake-engine.js'

// Empty values (u: null, the standard U) stay out of the link, as on the page.
const q = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)]))
const client = (opts, extra = {}) => {
  const f = fakeEngine(opts)
  return { f, c: createEngineClient({ baseUrl: 'http://engine.test', fetchImpl: f.fetchImpl, retryDelayMs: 1, ...extra }) }
}

// ------------------------------------------------------------ validation

test('page defaults: no address, no desiccant, and nothing runs without an address', () => {
  assert.equal(DEFAULTS.addr, '')
  assert.equal(DEFAULTS.lat, null)
  assert.equal(DEFAULTS.lb, 0)
  assert.throws(() => parseScenario(q(DEFAULTS)), (e) => e.status === 400 && /addr/.test(e.message))
})

test('defaults parse', () => {
  assert.deepEqual(parseScenario(q(BASE)), BASE)
})

test('every control option parses', () => {
  for (const x of EXISTING) assert.equal(parseScenario(q({ ...BASE, ex: x.key })).ex, x.key)
  assert.throws(() => parseScenario(q({ ...BASE, ex: 'triple' })), (e) => e.status === 400)
  for (const g of GLASSES) for (const o of SEALS_EXISTING) for (const i of SEALS_RETROFIT) {
    assert.equal(parseScenario(q({ ...BASE, glass: g.key, seal_out: o.key, seal_in: i.key })).glass, g.key)
  }
  for (let lb = RANGES.lb.min; lb <= RANGES.lb.max; lb++) assert.equal(parseScenario(q({ ...BASE, lb })).lb, lb)
})

test('retrofit seal labels (Anas 2026-10-17): new names, engine keys unchanged', () => {
  assert.deepEqual(SEALS_RETROFIT.map((s) => [s.key, s.label]), [
    ['wet_sealed', 'Wet-sealed'],
    ['gasketed', 'Dry-seal, max compression'],
    ['certified_best', 'Dry-seal, tight'],
    ['certified_typical', 'Dry-seal, good'],
    ['vented', 'Vented'],
  ])
})

test('hermetic is not accepted on either side', () => {
  assert.throws(() => parseScenario(q({ ...BASE, seal_out: 'hermetic' })), HttpError)
  assert.throws(() => parseScenario(q({ ...BASE, seal_in: 'hermetic' })), HttpError)
})

test('out of range, fractional, missing and unknown inputs are rejected with 400', () => {
  const bad = [
    { ...BASE, lb: 9 }, { ...BASE, lb: -1 }, { ...BASE, lb: '2.5' }, { ...BASE, lb: '' },
    { ...BASE, t: 59 }, { ...BASE, t: 81 }, { ...BASE, rh: 9 }, { ...BASE, rh: 61 },
    { ...BASE, rh: '30abc' }, { ...BASE, glass: 'triple' }, { ...BASE, rh_in_pct: 30 },
  ]
  for (const b of bad) {
    assert.throws(() => parseScenario(q(b)), (e) => e instanceof HttpError && e.status === 400, JSON.stringify(b))
  }
  const { lb, ...noLb } = BASE
  assert.throws(() => parseScenario(q(noLb)), (e) => e.status === 400)
})

test('address: whitespace collapses, length and plain text are enforced', () => {
  assert.equal(parseScenario(q({ ...BASE, addr: '  233  South Wacker Drive,\tChicago ' })).addr, '233 South Wacker Drive, Chicago')
  assert.equal(parseScenario(q({ ...BASE, addr: '350 Fifth Avenue\r\nNew York, NY' })).addr, '350 Fifth Avenue New York, NY')
  const bad = ['abc', 'x'.repeat(ADDRESS.max + 1), 'bell\u0007 street 12', '   ']
  for (const addr of bad) assert.throws(() => parseScenario(q({ ...BASE, addr })), (e) => e.status === 400, JSON.stringify(addr))
  const { addr, ...noAddr } = BASE
  assert.throws(() => parseScenario(q(noAddr)), (e) => e.status === 400 && /addr/.test(e.message))
})

test('lat and lon: a pair or nothing, in range, rounded to 5 decimals', () => {
  const { lat, lon, ...typed } = BASE
  const s = parseScenario(q(typed))
  assert.equal(s.lat, null)
  assert.equal(s.lon, null)
  assert.equal(parseScenario(q({ ...BASE, lat: '41.8786871234', lon: '-87.6359559' })).lat, 41.87869)
  for (const b of [{ lat: 41 }, { lon: -87 }].map(({ lat: la, lon: lo }) => ({ ...typed, ...(la ? { lat: la } : { lon: lo }) }))) {
    assert.throws(() => parseScenario(q(b)), (e) => e.status === 400 && /together/.test(e.message))
  }
  for (const b of [{ lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: 'north', lon: 0 }]) {
    assert.throws(() => parseScenario(q({ ...typed, ...b })), (e) => e.status === 400, JSON.stringify(b))
  }
})

test('cache key ignores address case', () => {
  const a = parseScenario(q(BASE))
  const b = parseScenario(q({ ...BASE, addr: BASE.addr.toUpperCase() }))
  assert.equal(scenarioKey(a), scenarioKey(b))
})

test('cache key ignores parameter order', () => {
  const a = parseScenario(q(BASE))
  const b = parseScenario(new URLSearchParams(Object.entries(BASE).reverse().filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)])))
  assert.equal(scenarioKey(a), scenarioKey(b))
})

// ------------------------------------------------------------ engine params

test('engine params pin every fixed input and map the controls', () => {
  const p = engineParams({ ...BASE, glass: 'double', lb: 3, t: 65, rh: 45 })
  for (const [k, v] of Object.entries(FIXED)) if (k !== 'max_years') assert.equal(p[k], v, k)
  assert.equal(p.address, BASE.addr)
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
  assert.equal(engineParams({ ...BASE, lb: 0 }).max_years, 2)
})

test('every parameter sent to the engine is echo-checked', () => {
  const p = engineParams(BASE)
  for (const k of Object.keys(p)) assert.ok(ECHO_KEYS[k] || ECHO_EXEMPT.includes(k), `unchecked parameter ${k}`)
})

// ------------------------------------------------------------ run

test('a normal run returns the trimmed result', async () => {
  const { c, f } = client()
  const out = await c.run(BASE)
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
  await assert.rejects(c.run(BASE), (e) => e.status === 502 && e.detail.some((d) => d.startsWith('rh_in')))
})

test('an ignored fixed input is caught too', async () => {
  const { c } = client({ ignore: ['window_floor'] })
  await assert.rejects(c.run(BASE), (e) => e.status === 502 && e.detail.some((d) => d.startsWith('window_floor')))
})

test('an engine without the fog map is reported as out of date', async () => {
  const { c } = client({ noFog: true })
  await assert.rejects(c.run(BASE), (e) => e.status === 502 && e.detail.some((d) => /fog map/.test(d)))
})

test('one 503 is retried and succeeds', async () => {
  const { c, f } = client({ failFirst: 1 })
  const out = await c.run(BASE)
  assert.equal(out.result.full_hour, 3940)
  assert.equal(f.calls.lifetime, 2)
})

test('two 503s give a clean 502', async () => {
  const { c, f } = client({ failFirst: 5 })
  await assert.rejects(c.run(BASE), (e) => e.status === 502)
  assert.equal(f.calls.lifetime, 2)
})

test('an unreachable engine gives a clean 502', async () => {
  const { c } = client({ down: true })
  await assert.rejects(c.run(BASE), (e) => e instanceof HttpError && e.status === 502)
})

test('a hanging engine times out with 504 and is not retried', async () => {
  const { c, f } = client({ hang: true }, { timeoutMs: 50 })
  await assert.rejects(c.run(BASE), (e) => e.status === 504)
  assert.equal(f.calls.lifetime, 1)
})

test('presets are fetched once and reused', async () => {
  const { c, f } = client()
  await c.run(BASE)
  await c.run({ ...BASE, lb: 2 })
  assert.equal(f.calls.presets, 1)
})

test('the engine URL gets exactly the parameters built here', async () => {
  const { c, f } = client()
  await c.run({ ...BASE, rh: 42 })
  const u = f.calls.urls.find((x) => x.pathname === '/api/lifetime')
  assert.equal(u.searchParams.get('rh_in'), '42')
  assert.equal(u.searchParams.get('desorption'), 'true')
  assert.equal(u.searchParams.get('al_out'), 'wet_sealed')
})

test('a geocode far from the picked address is rejected', async () => {
  const { c } = client({ far: true })
  await assert.rejects(c.run(BASE), (e) => e.status === 502 && e.detail.some((d) => d.startsWith('location') && d.includes('not the picked address')))
})

test('a typed address (no pick) is accepted wherever the engine lands, and the match is reported', async () => {
  const { c } = client({ far: true })
  const { lat, lon, ...typed } = BASE
  const out = await c.run({ ...typed, addr: '233 South Wacker Drive, Chicago, Illinois 60606, United States', lat: null, lon: null })
  assert.match(out.engine.site, /Chicago/)
  assert.ok(out.engine.location.lat > 42, 'reports where the engine actually landed')
})

test('the matched site, location and weather cell are reported with the result', async () => {
  const { c } = client()
  const out = await c.run(BASE)
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
    assert.equal(engineParams({ ...BASE, lb: Number(lb) }).grams, g, `${lb} lb`)
  }
})

test('the default engine request is pinned', () => {
  // v2.0 (universal): compared with park277-desiccant and desiccant_life-
  // (the Odoo simulator) this request differs in the address (any building
  // now), the building height (20 floors, window on 10: still mid-height,
  // where the stack effect is near zero, so results match 50/25; checked
  // against the live engine 2026-10-15) and the per-glass U (v1.11).
  assert.deepEqual({ ...engineParams(BASE) }, {
    address: '350 Fifth Avenue, New York, New York 10118, United States', orientation: 'north',
    width_in: 60, height_in: 96, offset_in: 0.6, u_ip: 0.164, r_ip: 0.97,
    desiccant: 'ms3a', desorption: true, absorptance: 0.1, floors: 20, window_floor: 10,
    p_occ_pa: 5, p_unocc_pa: 0, occ_start_h: 7, occ_end_h: 19, weekdays_only: true,
    sealant_out: 'silicone', sealant_in: 'silicone', max_years: 2,
    f_cold: 0.014, al_out: 'wet_sealed', al_in: 'wet_sealed', grams: 0, t_in: 70, rh_in: 30,
    // v2.8: a fixed RH (as before) and the full stack pressure, so the engine
    // computes exactly what it did; the office occupants go along unused.
    room_humidity: 'fixed', stack_factor: 1.0, people_gkg: 1.2, people_fade_ach: 0.5,
    // v2.9: the existing glass, for the sun and sky share (engine 0.3.0).
    existing_glass: 'single', film_correction: true,
    trace: false, fog_map: true, years_after_full: 1,
  })
})

test('each existing + retrofit pairing sends its own U and f', () => {
  // [U, f] by existing glass, then retrofit glass. Single: WINDOW f, INOVUES U.
  // Double: f from WINDOW (2026-10-15); U still the estimate (see THERMAL).
  const expect = {
    single: { single: [0.352, 0.068], double: [0.249, 0.040], vig: [0.164, 0.014] },
    double: { single: [0.249, 0.301], double: [0.193, 0.200], vig: [0.138, 0.064] },
  }
  assert.deepEqual(EXISTING.map((x) => x.key).sort(), Object.keys(expect).sort())
  for (const [ex, row] of Object.entries(expect)) {
    assert.deepEqual(GLASSES.map((g) => g.key).sort(), Object.keys(row).sort())
    for (const [glass, [u, f]] of Object.entries(row)) {
      for (const lb of [0, 4, 8]) {
        const p = engineParams({ ...BASE, ex, glass, lb })
        assert.equal(p.u_ip, u, `${ex}/${glass} ${lb} lb U`)
        assert.equal(p.f_cold, f, `${ex}/${glass} ${lb} lb f`)
      }
    }
  }
})

test('thermal table: only the double-pane U values are flagged as estimates', () => {
  for (const g of GLASSES) {
    assert.equal(thermalOf('single', g.key).u_estimate, false)
    assert.equal(thermalOf('double', g.key).u_estimate, true)
    assert.equal('estimate' in thermalOf('double', g.key), false, 'no blanket flag: f is from WINDOW')
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

test('thermal table: the estimated double-pane U follows from the stated resistances, and the same method lands within 0.011 of the WINDOW f', () => {
  // Independent recomputation of the comment in shared/scenario.js.
  const Ro = 1 / 26 + 0.006
  const dR = 0.200 + 0.006
  for (const g of GLASSES) {
    const s1 = THERMAL.single[g.key]
    const f2 = (Ro + dR) / (Ro / s1.f_cold + dR)
    const u2 = 1 / (1 / s1.u_ip + dR * 5.678263)
    assert.ok(Math.abs(u2 - THERMAL.double[g.key].u_ip) < 0.0006, `${g.key} U ${u2}`)
    assert.ok(Math.abs(f2 - THERMAL.double[g.key].f_cold) < 0.011, `${g.key} model f ${f2} vs WINDOW ${THERMAL.double[g.key].f_cold}`)
  }
})

test('guard: U and f are never fixed', () => {
  assert.equal('u_ip' in FIXED, false, 'u_ip must not be in FIXED')
  assert.equal('f_cold' in FIXED, false, 'f_cold must not be in FIXED')
})

// ------------------------------------------------------------ typed U (v2.5)

test('typed U: optional, 3 decimals at most, 0.050 to 1.200, numbers only', () => {
  const u = (raw) => parseScenario(q({ ...BASE, ex: 'single', glass: 'vig', u: raw })).u
  assert.equal(parseScenario(q(BASE)).u, null, 'absent = the standard U')
  assert.equal(u(''), null, 'empty = the standard U')
  assert.equal(u('0.2'), 0.2)
  assert.equal(u('.25'), 0.25)
  assert.equal(u('0.050'), 0.05)
  assert.equal(u('1.200'), 1.2)
  for (const bad of ['0.049', '1.201', '0.2345', 'abc', '1e-1', '-0.2', '0x1', ' 0.2', '0.2.1']) {
    assert.throws(() => u(bad), (e) => e instanceof HttpError && e.status === 400 && /^u must/.test(e.message), bad)
  }
})

test('typed U equal to the standard value is no override', () => {
  for (const ex of EXISTING) {
    for (const g of GLASSES) {
      const std = thermalOf(ex.key, g.key).u_ip
      assert.equal(parseScenario(q({ ...BASE, ex: ex.key, glass: g.key, u: std.toFixed(3) })).u, null, `${ex.key}/${g.key}`)
    }
  }
})

test('typed U reaches the engine as u_ip; f stays the standard value', () => {
  const s = parseScenario(q({ ...BASE, ex: 'double', glass: 'double', u: '0.310' }))
  const p = engineParams(s)
  assert.equal(p.u_ip, 0.31)
  assert.equal(p.f_cold, THERMAL.double.double.f_cold)
  assert.equal(engineParams({ ...s, u: null }).u_ip, THERMAL.double.double.u_ip)
  const th = thermalOf('double', 'double', 0.31)
  assert.deepEqual(th, { f_cold: 0.2, u_ip: 0.31, u_estimate: false, u_entered: true, u_table: THERMAL.double.double.u_ip })
  assert.equal(thermalOf('double', 'double').u_entered, undefined, 'the table entries stay untouched')
})

test('cache key: unchanged without a typed U, different with one', () => {
  const a = parseScenario(q(BASE))
  assert.equal(scenarioKey(a).includes('u='), false, 'pre-v2.5 keys (and report ids) stay the same')
  const b = parseScenario(q({ ...BASE, u: '0.2' }))
  assert.notEqual(scenarioKey(a), scenarioKey(b))
  assert.match(scenarioKey(b), /&u=0\.2&/)
})

test('typed U: the engine echo check covers it', async () => {
  const { f, c } = client()
  const r = await c.run(parseScenario(q({ ...BASE, u: '0.421' })))
  assert.ok(r.result)
  const sent = f.calls.urls.find((u) => u.searchParams.has('u_ip'))
  assert.equal(sent.searchParams.get('u_ip'), '0.421')
})

// ------------------------------------------------------------ cavity depth (v2.6)

test('offset: optional (0.6 in when absent), 2 decimals at most, 0.25 to 4.00 in', () => {
  const o = (raw) => parseScenario(q({ ...BASE, offset: raw })).offset
  assert.equal(parseScenario(q({ ...BASE, offset: null })).offset, 0.6, 'absent = 0.6 in')
  assert.equal(o(''), 0.6)
  assert.equal(o('1'), 1)
  assert.equal(o('1.25'), 1.25)
  assert.equal(o('.5'), 0.5)
  assert.equal(o('0.25'), 0.25)
  assert.equal(o('4.00'), 4)
  for (const bad of ['0.24', '4.01', '10', '1.255', 'x', '-1', '1e0', ' 1']) {
    assert.throws(() => o(bad), (e) => e instanceof HttpError && e.status === 400 && /^offset must/.test(e.message), bad)
  }
})

test('offset reaches the engine as offset_in; f and U do not change with it', () => {
  const a = engineParams(parseScenario(q(BASE)))
  const b = engineParams(parseScenario(q({ ...BASE, offset: '2.5' })))
  assert.equal(a.offset_in, 0.6)
  assert.equal(b.offset_in, 2.5)
  assert.equal(b.f_cold, a.f_cold)
  assert.equal(b.u_ip, a.u_ip)
  assert.equal(b.r_ip, a.r_ip)
  assert.equal('offset_in' in FIXED, false, 'offset_in comes from the scenario, not FIXED')
})

test('cache key: unchanged at 0.6 in, different for another offset', () => {
  const a = parseScenario(q(BASE))
  const b = parseScenario(q({ ...BASE, offset: '0.6' }))
  const c = parseScenario(q({ ...BASE, offset: '1.5' }))
  assert.equal(scenarioKey(a), scenarioKey(b))
  assert.equal(scenarioKey(a).includes('offset='), false, 'pre-v2.6 keys (and report ids) stay the same')
  assert.notEqual(scenarioKey(a), scenarioKey(c))
})

test('offset: the engine echo check covers it', async () => {
  const { f, c } = client()
  await c.run(parseScenario(q({ ...BASE, offset: '1.75' })))
  const sent = f.calls.urls.find((u) => u.searchParams.has('offset_in'))
  assert.equal(sent.searchParams.get('offset_in'), '1.75')
})

// ------------------------------------------------------------ facade and window size (v2.7)

test('facade: optional (north when absent), one of the four the engine accepts', () => {
  const f = (raw) => parseScenario(q({ ...BASE, facade: raw })).facade
  assert.deepEqual(FACADES.map((x) => x.key), ['north', 'east', 'south', 'west'])
  assert.equal(parseScenario(q({ ...BASE, facade: null })).facade, 'north', 'absent = north')
  assert.equal(f(''), 'north')
  for (const x of FACADES) assert.equal(f(x.key), x.key)
  for (const bad of ['North', 'n', 'northeast', 'up', ' south']) {
    assert.throws(() => f(bad), (e) => e instanceof HttpError && e.status === 400 && /^facade must/.test(e.message), bad)
  }
})

test('window width and height: optional (60 x 96 when absent), whole inches 12 to 240', () => {
  const w = (raw) => parseScenario(q({ ...BASE, width: raw })).width
  const h = (raw) => parseScenario(q({ ...BASE, height: raw })).height
  const s = parseScenario(q({ ...BASE, width: null, height: null }))
  assert.equal(s.width, 60)
  assert.equal(s.height, 96)
  assert.equal(w(''), 60)
  assert.equal(w('12'), 12)
  assert.equal(w('240'), 240)
  assert.equal(h('48'), 48)
  for (const bad of ['11', '241', '60.5', 'x', '-60', '1e2', ' 60']) {
    assert.throws(() => w(bad), (e) => e instanceof HttpError && e.status === 400 && /^width must/.test(e.message), `width ${bad}`)
    assert.throws(() => h(bad), (e) => e instanceof HttpError && e.status === 400 && /^height must/.test(e.message), `height ${bad}`)
  }
  // the page range sits inside the engine's own limits (1 to 400 in)
  assert.ok(WINDOW_INPUT.min >= 1 && WINDOW_INPUT.max <= 400)
})

test('facade and window size reach the engine as orientation, width_in, height_in', () => {
  const a = engineParams(parseScenario(q(BASE)))
  assert.deepEqual([a.orientation, a.width_in, a.height_in], ['north', 60, 96], 'defaults = the values fixed before v2.7')
  const b = engineParams(parseScenario(q({ ...BASE, facade: 'south', width: '48', height: '120' })))
  assert.deepEqual([b.orientation, b.width_in, b.height_in], ['south', 48, 120])
  assert.equal(b.f_cold, a.f_cold)
  assert.equal(b.u_ip, a.u_ip)
  for (const k of ['orientation', 'width_in', 'height_in']) assert.equal(k in FIXED, false, `${k} comes from the scenario, not FIXED`)
})

test('cache key: unchanged at north and 60 x 96, different otherwise', () => {
  const a = parseScenario(q(BASE))
  const b = parseScenario(q({ ...BASE, facade: 'north', width: '60', height: '96' }))
  assert.equal(scenarioKey(a), scenarioKey(b))
  for (const k of ['facade=', 'width=', 'height=']) assert.equal(scenarioKey(a).includes(k), false, `pre-v2.7 keys (and report ids) stay the same: ${k}`)
  for (const change of [{ facade: 'east' }, { width: '61' }, { height: '95' }]) {
    assert.notEqual(scenarioKey(a), scenarioKey(parseScenario(q({ ...BASE, ...change }))), JSON.stringify(change))
  }
})

test('cache key: a scenario from before v2.7 (no facade, width or height at all) keeps its exact key', () => {
  // The literal key format a v2.6 scenario produced; it must not change.
  const { facade, width, height, ...old } = parseScenario(q(BASE))
  const expected = `ex=single&glass=vig&seal_out=wet_sealed&seal_in=wet_sealed&lb=0&t=70&rh=30&addr=${BASE.addr.toLowerCase()}&lat=${BASE.lat}&lon=${BASE.lon}`
  assert.equal(scenarioKey(old), expected)
  assert.equal(scenarioKey(parseScenario(q(BASE))), expected)
})

test('facade and window size: the engine echo check covers them', async () => {
  const { f, c } = client()
  await c.run(parseScenario(q({ ...BASE, facade: 'west', width: '30', height: '72' })))
  const sent = f.calls.urls.find((u) => u.pathname === '/api/lifetime')
  assert.equal(sent.searchParams.get('orientation'), 'west')
  assert.equal(sent.searchParams.get('width_in'), '30')
  assert.equal(sent.searchParams.get('height_in'), '72')
  const { c: c2 } = client({ ignore: ['orientation'] })
  await assert.rejects(c2.run(parseScenario(q({ ...BASE, facade: 'east' }))), (e) => e.status === 502 && e.detail.some((d) => d.startsWith('orientation')))
})

// ------------------------------------------------------------ v2.8: room humidity, building height

test('room humidity: optional (fixed when absent), fixed or none; anything else is a 400', () => {
  assert.equal(parseScenario(q(BASE)).hum, 'fixed')
  assert.equal(parseScenario(q({ ...BASE, hum: 'fixed' })).hum, 'fixed')
  assert.equal(parseScenario(q({ ...BASE, hum: 'none' })).hum, 'none')
  assert.equal(parseScenario(q({ ...BASE, hum: '' })).hum, 'fixed')
  for (const bad of ['unhumidified', 'None', 'dry', '1']) {
    assert.throws(() => parseScenario(q({ ...BASE, hum: bad })), (e) => e instanceof HttpError && e.status === 400 && /^hum must/.test(e.message), bad)
  }
})

test('room humidity reaches the engine as room_humidity, with the office occupants pinned', () => {
  const fixed = engineParams(parseScenario(q(BASE)))
  const none = engineParams(parseScenario(q({ ...BASE, hum: 'none' })))
  assert.equal(fixed.room_humidity, 'fixed')
  assert.equal(none.room_humidity, 'unhumidified')
  for (const p of [fixed, none]) {
    assert.equal(p.people_gkg, 1.2)
    assert.equal(p.people_fade_ach, 0.5)
    assert.equal(p.stack_factor, 1.0)
    assert.equal(p.rh_in, BASE.rh)               // still sent; the engine ignores it without a humidifier
  }
})

test('floors and window floor: optional (20 and 10), whole numbers 1 to 100, window floor at most the floors', () => {
  const s = (extra) => parseScenario(q({ ...BASE, ...extra }))
  assert.deepEqual([s({}).floors, s({}).wfloor], [20, 10])
  assert.deepEqual([s({ floors: '11' }).floors, s({ floors: '11' }).wfloor], [11, 10])
  assert.deepEqual([s({ floors: '1', wfloor: '1' }).floors, s({ floors: '1', wfloor: '1' }).wfloor], [1, 1])
  assert.deepEqual([s({ floors: '100', wfloor: '100' }).floors, s({ floors: '100', wfloor: '100' }).wfloor], [100, 100])
  for (const bad of ['0', '101', '2.5', '-3', 'ten', ' 5']) {
    assert.throws(() => s({ floors: bad }), (e) => e instanceof HttpError && e.status === 400 && /^floors must/.test(e.message), `floors ${bad}`)
    assert.throws(() => s({ floors: '100', wfloor: bad }), (e) => e instanceof HttpError && e.status === 400 && /^wfloor must/.test(e.message), `wfloor ${bad}`)
  }
  assert.throws(() => s({ floors: '8' }), (e) => e.status === 400 && /at most floors \(8\)/.test(e.message), 'default floor 10 in an 8-floor building')
  assert.throws(() => s({ floors: '11', wfloor: '12' }), (e) => e.status === 400 && /at most floors/.test(e.message))
})

test('floors and window floor reach the engine as floors and window_floor', () => {
  const p = engineParams(parseScenario(q({ ...BASE, floors: '11', wfloor: '10' })))
  assert.equal(p.floors, 11)
  assert.equal(p.window_floor, 10)
  const d = engineParams(parseScenario(q(BASE)))
  assert.deepEqual([d.floors, d.window_floor], [20, 10])
})

test('cache key: unchanged at a fixed RH and 20 / 10, different otherwise', () => {
  const k = (extra) => scenarioKey(parseScenario(q({ ...BASE, ...extra })))
  const base = k({})
  assert.equal(k({ hum: 'fixed' }), base)
  assert.equal(k({ floors: '20', wfloor: '10' }), base)
  assert.notEqual(k({ hum: 'none' }), base)
  assert.notEqual(k({ floors: '11' }), base)
  assert.notEqual(k({ wfloor: '3' }), base)
  assert.ok(k({ hum: 'none', floors: '11' }).includes('floors=11') && k({ hum: 'none', floors: '11' }).includes('hum=none'))
})

test('cache key: a scenario from before v2.8 keeps its exact key (the literal v2.7 key)', () => {
  const s = parseScenario(q(BASE))
  assert.equal(scenarioKey(s), `ex=single&glass=vig&seal_out=wet_sealed&seal_in=wet_sealed&lb=0&t=70&rh=30&addr=${BASE.addr.toLowerCase()}&lat=40.74844&lon=-73.98566`)
})

test('room humidity, floors and the occupants: the engine echo check covers them', async () => {
  for (const k of ['room_humidity', 'window_floor', 'floors', 'people_gkg', 'stack_factor', 'existing_glass']) {
    const { c } = client({ ignore: [k] })
    // ex double: the fake engine's fallback for an unechoed existing_glass is
    // 'single', so only a double pane shows the check firing.
    await assert.rejects(c.run({ ...BASE, ex: 'double', hum: 'none', floors: 11, wfloor: 10 }), (e) => e.status === 502 && e.detail.some((d) => d.startsWith(k)), k)
  }
})

test('the simulated room RH (heating season) comes back with the result', async () => {
  const { c } = client()
  const none = await c.run({ ...BASE, hum: 'none' })
  assert.deepEqual(none.result.room, { median_pct: 18.0, p10_pct: 10.0, p90_pct: 31.0 })
  const fixed = await c.run(BASE)
  assert.deepEqual(fixed.result.room, { median_pct: 30, p10_pct: 30, p90_pct: 30 })
})

test('the existing glass reaches the engine as existing_glass (v2.9, engine 0.3.0)', () => {
  assert.equal(engineParams(parseScenario(q({ ...BASE, ex: 'single' }))).existing_glass, 'single')
  assert.equal(engineParams(parseScenario(q({ ...BASE, ex: 'double' }))).existing_glass, 'double')
  // Every existing-glass key is one the engine knows.
  for (const e of EXISTING) assert.ok(['single', 'double'].includes(e.key), e.key)
})
