import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { request } from 'node:http'

import { createApp } from '../server/index.js'
import { createEngineClient } from '../server/engine.js'
import { createSuggester } from '../server/suggest.js'
import { DEFAULTS } from '../shared/scenario.js'
import { fakeEngine } from './fake-engine.js'

let dist
before(async () => {
  dist = await mkdtemp(join(tmpdir(), 'p277-dist-'))
  await mkdir(join(dist, 'assets'))
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>t</title>')
  await writeFile(join(dist, 'assets', 'app-abc.js'), 'console.log(1)')
})
after(async () => { await rm(dist, { recursive: true, force: true }) })

async function start(t, opts = {}) {
  const f = fakeEngine(opts)
  const engine = createEngineClient({ baseUrl: 'http://engine.test', fetchImpl: f.fetchImpl, retryDelayMs: 1 })
  const app = createApp({ engine, distDir: dist, log: () => {}, suggester: opts.suggester ?? createSuggester({ token: '' }) })
  await new Promise((r) => app.listen(0, r))
  const port = app.address().port
  const get = (path, headers = {}) => new Promise((resolve, reject) => {
    request({ port, path, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        let body = Buffer.concat(chunks)
        if (res.headers['content-encoding'] === 'gzip') body = gunzipSync(body)
        const text = body.toString()
        let json = null
        try { json = JSON.parse(text) } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json })
      })
    }).on('error', reject).end()
  })
  const close = () => new Promise((r) => { app.closeAllConnections?.(); app.close(() => r()) })
  t.after(close)                       // always runs, even when an assertion fails
  return { app, get, f }
}

const runPath = (o = {}) => `/api/run?${new URLSearchParams(Object.entries({ ...DEFAULTS, ...o }).map(([k, v]) => [k, String(v)]))}`

test('run, then the same run is served from cache', async (t) => {
  const s = await start(t)
  const a = await s.get(runPath())
  assert.equal(a.status, 200)
  assert.equal(a.json.cached, false)
  assert.equal(a.json.result.full_hour, 3940)
  const b = await s.get(runPath())
  assert.equal(b.json.cached, true)
  assert.equal(s.f.calls.lifetime, 1)
})

test('identical requests in flight share one engine call', async (t) => {
  const s = await start(t, { delayMs: 60 })
  const rs = await Promise.all([s.get(runPath({ lb: 3 })), s.get(runPath({ lb: 3 })), s.get(runPath({ lb: 3 }))])
  assert.ok(rs.every((r) => r.status === 200))
  assert.equal(s.f.calls.lifetime, 1)
})

test('bad input gives 400 with a readable message and never reaches the engine', async (t) => {
  const s = await start(t)
  const r = await s.get(runPath({ lb: 12 }))
  assert.equal(r.status, 400)
  assert.match(r.json.error, /lb must be between 0 and 8/)
  assert.equal(s.f.calls.lifetime, 0)
})

test('an echo mismatch is a 502 with the details, not a wrong picture', async (t) => {
  const s = await start(t, { ignore: ['rh_in'] })
  const r = await s.get(runPath())
  assert.equal(r.status, 502)
  assert.ok(r.json.detail.some((d) => d.startsWith('rh_in')))
  assert.equal(r.json.result, undefined)
})

test('errors are not cached', async (t) => {
  const s = await start(t, { failFirst: 2 })
  assert.equal((await s.get(runPath())).status, 502)
  assert.equal((await s.get(runPath())).status, 200)
})

test('config carries controls and the engine leakage values', async (t) => {
  const s = await start(t)
  const r = await s.get('/api/config')
  assert.equal(r.status, 200)
  assert.equal(r.json.glasses.length, 3)
  assert.equal(r.json.seals_existing[0].engine.al_cfm_ft2, 0.005)
  assert.ok(!r.json.seals_existing.some((x) => x.key === 'hermetic'))
  assert.equal(r.json.presets_error, null)
})

test('config still answers when the engine is down', async (t) => {
  const s = await start(t, { down: true })
  const r = await s.get('/api/config')
  assert.equal(r.status, 200)
  assert.ok(r.json.presets_error)
  assert.equal(r.json.seals_existing[0].engine, undefined)
})

test('health is 200 even when the engine is down; engine health says so', async (t) => {
  const s = await start(t, { down: true })
  assert.equal((await s.get('/health')).status, 200)
  assert.equal((await s.get('/health/engine')).status, 503)
})

test('static files, cache headers, security headers, gzip', async (t) => {
  const s = await start(t)
  const idx = await s.get('/')
  assert.equal(idx.status, 200)
  assert.equal(idx.headers['cache-control'], 'no-cache')
  assert.match(idx.headers['content-security-policy'], /default-src 'self'/)
  const asset = await s.get('/assets/app-abc.js')
  assert.match(asset.headers['cache-control'], /immutable/)
  const big = await s.get(runPath(), { 'accept-encoding': 'gzip' })
  assert.equal(big.headers['content-encoding'], 'gzip')
  assert.equal(big.json.result.years.length, 2)
})

test('path traversal is refused and unknown files are 404', async (t) => {
  const s = await start(t)
  // The URL parser already folds /../ and %2e%2e: those land on 404.
  assert.notEqual((await s.get('/../package.json')).status, 200)
  assert.notEqual((await s.get('/%2e%2e/%2e%2e/etc/passwd')).status, 200)
  // An encoded slash survives the parser; the resolve() guard must stop it.
  assert.equal((await s.get('/..%2f..%2fpackage.json')).status, 403)
  assert.equal((await s.get('/assets/..%2f..%2f..%2fetc%2fpasswd')).status, 403)
  assert.equal((await s.get('/nope.js')).status, 404)
  assert.equal((await s.get('/api/nope')).status, 404)
})

// ------------------------------------------------------------ address suggestions

function fakeMapbox({ status = 200, features } = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(new URL(url))
    return { status, json: async () => ({ features: features ?? [
      { geometry: { coordinates: [-87.635955, 41.878687] }, properties: {
        full_address: '233 South Wacker Drive, Chicago, Illinois 60606, United States', name: '233 South Wacker Drive',
        place_formatted: 'Chicago, Illinois 60606, United States', feature_type: 'address',
        coordinates: { longitude: -87.635955, latitude: 41.878687 } } },
      { geometry: { coordinates: [0, 0] }, properties: {} },          // unusable: no address
    ] }) }
  }
  return { fetchImpl, calls }
}

test('suggest: maps Mapbox features, drops unusable ones, caches, keeps the token server-side', async (t) => {
  const m = fakeMapbox()
  const s = await start(t, { suggester: createSuggester({ token: 'pk.test', fetchImpl: m.fetchImpl }) })
  const r = await s.get('/api/suggest?q=233%20s%20wacker')
  assert.equal(r.status, 200)
  assert.deepEqual(r.json.suggestions, [{
    full: '233 South Wacker Drive, Chicago, Illinois 60606, United States', name: '233 South Wacker Drive',
    place: 'Chicago, Illinois 60606, United States', type: 'address', lat: 41.87869, lon: -87.63595,
  }])
  assert.ok(!r.text.includes('pk.test'), 'token never sent to the browser')
  const u = m.calls[0]
  assert.equal(u.searchParams.get('autocomplete'), 'true')
  assert.equal(u.searchParams.get('country'), 'us,ca,mx,pr')
  await s.get('/api/suggest?q=233%20S%20WACKER')                     // same query, other case
  assert.equal(m.calls.length, 1)
})

test('suggest: off without a token, short queries refused, upstream errors are clean', async (t) => {
  const off = await start(t)
  const r = await off.get('/api/suggest?q=233%20s%20wacker')
  assert.equal(r.status, 503)
  assert.equal((await off.get('/api/config')).json.suggest, false)

  const m = fakeMapbox()
  const on = await start(t, { suggester: createSuggester({ token: 'pk.test', fetchImpl: m.fetchImpl }) })
  assert.equal((await on.get('/api/suggest?q=ab')).status, 400)
  assert.equal(m.calls.length, 0)
  assert.equal((await on.get('/api/config')).json.suggest, true)

  const bad = await start(t, { suggester: createSuggester({ token: 'pk.test', fetchImpl: fakeMapbox({ status: 401 }).fetchImpl }) })
  const e = await bad.get('/api/suggest?q=233%20s%20wacker')
  assert.equal(e.status, 502)
  assert.ok(!e.text.includes('pk.test'))
})
