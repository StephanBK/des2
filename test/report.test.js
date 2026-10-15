import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'

import { createApp } from '../server/index.js'
import { createEngineClient } from '../server/engine.js'
import { createSuggester } from '../server/suggest.js'
import { cleanProject, headroomOf, monthlyFogDays, reportId, RH_LEVELS } from '../server/report-data.js'
import { DISCLAIMER } from '../server/report-pdf.js'
import { DEFAULTS } from '../shared/scenario.js'
import { fakeEngine } from './fake-engine.js'

// ------------------------------------------------------------ pure parts

test('headroom: highest clear level counting up, null when it fogs at the lowest', () => {
  const pts = (days) => days.map((d, i) => ({ rh: RH_LEVELS[i], fog_days: d }))
  assert.deepEqual(headroomOf(pts([0, 0, 5, 9, 20, 30, 40, 50, 60])), { clear_up_to: 25, all_clear: false })
  assert.deepEqual(headroomOf(pts([0, 0, 0, 0, 0, 0, 0, 0, 0])), { clear_up_to: 60, all_clear: true })
  assert.deepEqual(headroomOf(pts([3, 0, 0, 0, 0, 0, 0, 0, 0])), { clear_up_to: null, all_clear: false })
  // a clear level above a foggy one does not count (fog rises with RH; a dip is noise)
  assert.deepEqual(headroomOf(pts([0, 4, 0, 9, 9, 9, 9, 9, 9])), { clear_up_to: 20, all_clear: false })
})

test('monthly fog days: a day counts once however many hours fog, months split right', () => {
  const fog = Array(8760).fill('0')
  const at = (day, hour, level = '3') => { fog[day * 24 + hour] = level }
  at(0, 3); at(0, 4); at(0, 23)            // Jan 1, three hours: one day
  at(40, 5)                                 // Feb 10
  at(58, 0); at(59, 0)                      // Feb 28 and Mar 1 (TMY: no leap day)
  at(364, 23, '9')                          // Dec 31, last hour of the year
  assert.deepEqual(monthlyFogDays(fog.join('')), [1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1])
  assert.deepEqual(monthlyFogDays(null), Array(12).fill(0))
})

test('report id: same inputs, same id; different inputs, different id', () => {
  assert.equal(reportId('a|b'), reportId('a|b'))
  assert.notEqual(reportId('a|b'), reportId('a|c'))
  assert.match(reportId('anything'), /^[0-9A-Z]{7}$/)
})

test('project name: optional, one line, at most 80 characters', () => {
  assert.equal(cleanProject(null), '')
  assert.equal(cleanProject('  Lobby   retrofit \n phase 2 '), 'Lobby retrofit phase 2')
  assert.throws(() => cleanProject('x'.repeat(81)), (e) => e.status === 400)
  assert.throws(() => cleanProject('bell\u0007'), (e) => e.status === 400)
})

// ------------------------------------------------------------ routes

let dist
before(async () => {
  dist = await mkdtemp(join(tmpdir(), 'des2-report-'))
  await mkdir(join(dist, 'assets'))
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>t</title>')
})
after(async () => { await rm(dist, { recursive: true, force: true }) })

async function start(t, opts = {}) {
  const f = fakeEngine(opts)
  const engine = createEngineClient({ baseUrl: 'http://engine.test', fetchImpl: f.fetchImpl, retryDelayMs: 1 })
  const app = createApp({ engine, distDir: dist, log: () => {}, suggester: createSuggester({ token: '' }) })
  await new Promise((r) => app.listen(0, r))
  const port = app.address().port
  const get = (path) => new Promise((resolve, reject) => {
    request({ port, path, headers: { host: 'des2.example' } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks)
        let json = null
        try { json = JSON.parse(body.toString()) } catch { /* pdf */ }
        resolve({ status: res.statusCode, headers: res.headers, body, json })
      })
    }).on('error', reject).end()
  })
  t.after(() => new Promise((r) => { app.closeAllConnections?.(); app.close(() => r()) }))
  return { get, f }
}

const qs = (o = {}) => new URLSearchParams(Object.entries({ ...DEFAULTS, ...o }).map(([k, v]) => [k, String(v)])).toString()

test('report data: three glasses, three sweeps, headroom, site, a link that reopens the scenario', async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report.json?${qs({ glass: 'double' })}&project=Lobby`)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  const d = r.json
  assert.equal(d.project, 'Lobby')
  assert.deepEqual(d.options.map((o) => [o.key, o.selected]), [['single', false], ['double', true], ['vig', false]])
  assert.ok(d.options.every((o) => o.headroom.clear_up_to === 25 && o.sweep.length === RH_LEVELS.length))
  assert.equal(d.options[1].thermal.u_ip, 0.249)
  assert.equal(d.config.glass.product, 'SWR-IG')
  assert.equal(d.config.seal_out.cfm_ft2, 0.005)
  assert.equal(d.site.matched, DEFAULTS.addr)
  assert.deepEqual(d.year.monthly_fog_days.length, 12)
  assert.ok(!d.config.assumptions.some((a) => /hover/.test(a)), 'no screen-only wording on paper')
  const link = new URL(d.link)
  assert.equal(link.host, 'des2.example')
  assert.equal(link.searchParams.get('glass'), 'double')
  assert.equal(link.searchParams.get('addr'), DEFAULTS.addr)
  assert.equal(link.searchParams.get('project'), null)
  assert.equal(s.f.calls.lifetime, 3)
  assert.equal(s.f.calls.sweep, 3)
  // the sweeps run without desiccant and report the settled year
  const sw = s.f.calls.urls.find((u) => u.pathname === '/api/sweep')
  assert.equal(sw.searchParams.get('grams'), '0')
  assert.equal(sw.searchParams.get('x_key'), 'rh_room')
  assert.equal(sw.searchParams.get('sweep_max_years'), '2')
  // a second report on the same inputs is all cache
  await s.get(`/api/report.json?${qs({ glass: 'double' })}&project=Lobby`)
  assert.equal(s.f.calls.lifetime, 3)
  assert.equal(s.f.calls.sweep, 3)
})

test('report: a sweep for the wrong input is refused, not drawn', async (t) => {
  const s = await start(t, { sweepKey: 'al_out' })
  const r = await s.get(`/api/report.json?${qs()}`)
  assert.equal(r.status, 502)
  assert.ok(r.json.detail.some((d) => /humidity points/.test(d)))
})

test('report: bad project name is a 400 before any engine call', async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report?${qs()}&project=${'x'.repeat(81)}`)
  assert.equal(r.status, 400)
  assert.equal(s.f.calls.lifetime, 0)
})

test('report PDF: a 3-page PDF, downloadable, named after the site and report id', async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report?${qs()}&project=Sample`)
  assert.equal(r.status, 200)
  assert.equal(r.headers['content-type'], 'application/pdf')
  assert.equal(r.body.subarray(0, 5).toString(), '%PDF-')
  const cd = r.headers['content-disposition']
  assert.match(cd, /^attachment; filename="INOVUES-cavity-assessment-350-Fifth-Avenue-[0-9A-Z]{7}\.pdf"$/)
  const pages = (r.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length
  assert.equal(pages, 3)
})

test('the report carries a liability disclaimer', () => {
  for (const phrase of ['estimates', 'may differ', 'not a warranty', 'guarantee', 'written warranty', 'accepts no liability']) {
    assert.ok(DISCLAIMER.includes(phrase), phrase)
  }
})
