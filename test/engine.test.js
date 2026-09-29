import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createEngineClient, ECHO_EXEMPT, ECHO_KEYS, engineParams, HttpError, parseScenario, scenarioKey,
} from '../server/engine.js'
import { DEFAULTS, FIXED, GLASSES, GRAMS_PER_LB, RANGES, SEALS_EXISTING, SEALS_RETROFIT } from '../shared/scenario.js'
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

test('cache key ignores parameter order', () => {
  const a = parseScenario(q(DEFAULTS))
  const b = parseScenario(new URLSearchParams(Object.entries(DEFAULTS).reverse().map(([k, v]) => [k, String(v)])))
  assert.equal(scenarioKey(a), scenarioKey(b))
})

// ------------------------------------------------------------ engine params

test('engine params pin every fixed input and map the controls', () => {
  const p = engineParams({ ...DEFAULTS, glass: 'double', lb: 3, t: 65, rh: 45 })
  for (const [k, v] of Object.entries(FIXED)) if (k !== 'max_years') assert.equal(p[k], v, k)
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

test('a geocode to the wrong building (Brooklyn) is rejected', async () => {
  const { c } = client({ brooklyn: true })
  await assert.rejects(c.run(DEFAULTS), (e) => e.status === 502 && e.detail.some((d) => d.startsWith('location') && d.includes('Brooklyn')))
})

test('the matched site is reported with the result', async () => {
  const { c } = client()
  const out = await c.run(DEFAULTS)
  assert.match(out.engine.site, /10172/)
})

test('pounds to grams against independent literal values', () => {
  // 1 lb = 453.59237 g exactly (international pound, 1959)
  const expect = { 0: 0, 1: 453.592, 3: 1360.777, 4: 1814.369, 8: 3628.739 }
  for (const [lb, g] of Object.entries(expect)) {
    assert.equal(engineParams({ ...DEFAULTS, lb: Number(lb) }).grams, g, `${lb} lb`)
  }
})

test('parity: the default engine request is pinned (des2: U per glass)', () => {
  // park277-desiccant and desiccant_life- (the Odoo simulator) pin this same
  // request with u_ip 0.16. des2 deliberately differs in ONE value only: the
  // default glass (VIG) sends its own U, 0.164. Everything else is identical.
  assert.deepEqual({ ...engineParams(DEFAULTS) }, {
    address: '277 Park Avenue, New York, NY 10172', orientation: 'north',
    width_in: 60, height_in: 96, offset_in: 0.6, u_ip: 0.164, r_ip: 0.97,
    desiccant: 'ms3a', desorption: true, absorptance: 0.1, floors: 50, window_floor: 25,
    p_occ_pa: 5, p_unocc_pa: 0, occ_start_h: 7, occ_end_h: 19, weekdays_only: true,
    sealant_out: 'silicone', sealant_in: 'silicone', max_years: 20,
    f_cold: 0.014, al_out: 'wet_sealed', al_in: 'wet_sealed', grams: 3628.739, t_in: 70, rh_in: 30,
    trace: false, fog_map: true, years_after_full: 1,
  })
})

test('des2: each glass sends its own U and f (SWR, SWR-IG, SWR-VIG)', () => {
  const expect = { single: [0.352, 0.068], double: [0.249, 0.040], vig: [0.164, 0.014] }
  assert.deepEqual(GLASSES.map((g) => g.key).sort(), Object.keys(expect).sort())
  for (const [glass, [u, f]] of Object.entries(expect)) {
    for (const lb of [0, 4, 8]) {
      const p = engineParams({ ...DEFAULTS, glass, lb })
      assert.equal(p.u_ip, u, `${glass} ${lb} lb U`)
      assert.equal(p.f_cold, f, `${glass} ${lb} lb f`)
    }
  }
})

test('des2 guard: U is per glass, never fixed', () => {
  assert.equal('u_ip' in FIXED, false, 'u_ip must not be in FIXED')
  for (const g of GLASSES) assert.ok(typeof g.u_ip === 'number' && g.u_ip > 0, `${g.key} has a positive u_ip`)
})
