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
import { DISCLAIMER, methodItems } from '../server/report-pdf.js'
import { execFileSync } from 'node:child_process'
import { DEFAULTS, EXAMPLE_SITE } from '../shared/scenario.js'

// The page's defaults have no address (v2.4); tests add a known one.
const BASE = { ...DEFAULTS, ...EXAMPLE_SITE }
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

const qs = (o = {}) => new URLSearchParams(Object.entries({ ...BASE, ...o }).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)])).toString()

test('report data: only the picked glass (v2.10), no humidity sweeps (switched off 2026-10-17), site, a link that reopens the scenario', async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report.json?${qs({ glass: 'double' })}&project=Lobby`)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  const d = r.json
  assert.equal(d.project, 'Lobby')
  assert.deepEqual(d.options.map((o) => [o.key, o.selected]), [['double', true]], 'only the picked glass')
  assert.ok(d.options.every((o) => !('headroom' in o) && !('sweep' in o)), 'no headroom data in the report')
  assert.equal('rh_levels' in d, false)
  assert.equal(d.options[0].thermal.u_ip, 0.249)
  assert.equal(d.config.glass.product, 'SWR-IG')
  assert.equal(d.config.seal_out.cfm_ft2, 0.005)
  assert.equal(d.site.matched, BASE.addr)
  assert.deepEqual(d.year.monthly_fog_days.length, 12)
  assert.ok(!d.config.assumptions.some((a) => /hover/.test(a)), 'no screen-only wording on paper')
  const link = new URL(d.link)
  assert.equal(link.host, 'des2.example')
  assert.equal(link.searchParams.get('glass'), 'double')
  assert.equal(link.searchParams.get('addr'), BASE.addr)
  assert.equal(link.searchParams.get('project'), null)
  assert.equal(s.f.calls.lifetime, 1, 'one run: the scenario on screen, no other glasses')
  assert.equal(s.f.calls.sweep, 0, 'no humidity sweeps while the headroom is off')
  // a second report on the same inputs is all cache
  await s.get(`/api/report.json?${qs({ glass: 'double' })}&project=Lobby`)
  assert.equal(s.f.calls.lifetime, 1)
  assert.equal(s.f.calls.sweep, 0)
})

test('report with a typed U: the picked glass uses it, and no other glass is run', async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report.json?${qs({ ex: 'double', glass: 'vig', u: '0.180' })}`)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  const d = r.json
  assert.equal(d.config.thermal.u_ip, 0.18)
  assert.equal(d.config.thermal.u_entered, true)
  assert.equal(d.config.thermal.u_estimate, false)
  assert.equal(d.config.thermal.u_table, 0.138)
  assert.deepEqual(d.options.map((o) => [o.key, o.thermal.u_ip]), [['vig', 0.18]])
  // what the engine was actually sent: 0.180 only with the VIG f, never with another glass
  const vigF = '0.064'
  for (const u of s.f.calls.urls) {
    const sent = u.searchParams.get('u_ip')
    if (sent === '0.18') assert.equal(u.searchParams.get('f_cold'), vigF, `${u.pathname}: typed U only for VIG`)
  }
  assert.equal(s.f.calls.urls.filter((u) => u.searchParams.get('u_ip') === '0.18').length, 1, 'the VIG run only')
  assert.equal(s.f.calls.lifetime, 1, 'no runs for the other two glasses')
  assert.equal(new URL(d.link).searchParams.get('u'), '0.18', 'the link reopens the typed U')
})

test('report PDF with a typed U still fits on 3 pages', async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report?${qs({ ex: 'double', glass: 'vig', u: '0.180' })}&project=${encodeURIComponent('Long project name '.repeat(4).trim())}`)
  assert.equal(r.status, 200)
  const pages = (r.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length
  assert.equal(pages, 3)
})

test('report with a changed offset: the run uses it, the report says so', async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report.json?${qs({ offset: '1.5' })}`)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.deepEqual(r.json.config.offset, { inches: 1.5, standard: 0.6, changed: true })
  const engineCalls = s.f.calls.urls.filter((u) => u.searchParams.has('offset_in'))
  assert.equal(engineCalls.length, 1, '1 run, no sweeps')
  assert.ok(engineCalls.every((u) => u.searchParams.get('offset_in') === '1.5'))
  assert.equal(new URL(r.json.link).searchParams.get('offset'), '1.5')
  const std = await s.get(`/api/report.json?${qs()}`)
  assert.equal(std.json.config.offset.changed, false)
  assert.equal(new URL(std.json.link).searchParams.has('offset'), false)
})

test('report with a facade and window size (v2.7): the run uses them, the report shows them, the link reopens them', async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report.json?${qs({ facade: 'south', width: '48', height: '120' })}`)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.deepEqual(r.json.config.facade, { key: 'south', label: 'South' })
  assert.deepEqual(r.json.config.window, { width: 48, height: 120 })
  const runs = s.f.calls.urls.filter((u) => u.pathname === '/api/lifetime')
  assert.equal(runs.length, 1)
  assert.ok(runs.every((u) => u.searchParams.get('orientation') === 'south' && u.searchParams.get('width_in') === '48' && u.searchParams.get('height_in') === '120'))
  const link = new URL(r.json.link).searchParams
  assert.deepEqual([link.get('facade'), link.get('width'), link.get('height')], ['south', '48', '120'])
  const std = await s.get(`/api/report.json?${qs()}`)
  assert.deepEqual(std.json.config.facade, { key: 'north', label: 'North' })
  assert.deepEqual(std.json.config.window, { width: 60, height: 96 })
  for (const k of ['facade', 'width', 'height']) assert.equal(new URL(std.json.link).searchParams.has(k), false, k)
})

test('report PDF with a typed U and a changed offset still fits on 3 pages', async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report?${qs({ ex: 'double', glass: 'vig', u: '0.180', offset: '2.25' })}&project=${encodeURIComponent('Long project name '.repeat(4).trim())}`)
  assert.equal(r.status, 200)
  const pages = (r.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length
  assert.equal(pages, 3)
})

// The humidity sweep is off in the report (2026-10-17) but kept in the engine
// client for when the headroom returns; these keep it known-good.
test('dormant humidity sweep: runs without desiccant, settled year, the requested points', async () => {
  const f = fakeEngine()
  const c = createEngineClient({ baseUrl: 'http://engine.test', fetchImpl: f.fetchImpl, retryDelayMs: 1 })
  const pts = await c.sweepRh({ ...BASE, lb: 4 }, RH_LEVELS)
  assert.deepEqual(pts.map((p) => p.rh), RH_LEVELS)
  assert.equal(headroomOf(pts).clear_up_to, 25)
  const sw = f.calls.urls.find((u) => u.pathname === '/api/sweep')
  assert.equal(sw.searchParams.get('grams'), '0')
  assert.equal(sw.searchParams.get('x_key'), 'rh_room')
  assert.equal(sw.searchParams.get('sweep_max_years'), '2')
})

test('dormant humidity sweep: a sweep for the wrong input is refused', async () => {
  const f = fakeEngine({ sweepKey: 'al_out' })
  const c = createEngineClient({ baseUrl: 'http://engine.test', fetchImpl: f.fetchImpl, retryDelayMs: 1 })
  await assert.rejects(c.sweepRh(BASE, RH_LEVELS), (e) => e.status === 502 && e.detail.some((d) => /humidity points/.test(d)))
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
  assert.match(cd, /^attachment; filename="INOVUES-SWR-condensation-assessment-350-Fifth-Avenue-[0-9A-Z]{7}\.pdf"$/)
  const pages = (r.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length
  assert.equal(pages, 3)
})

test('the report carries a liability disclaimer', () => {
  for (const phrase of ['estimates', 'may differ', 'not a warranty', 'guarantee', 'written warranty', 'accepts no liability']) {
    assert.ok(DISCLAIMER.includes(phrase), phrase)
  }
})

// ---- Anas 2026-10-17: at 0 lb the customer report never mentions desiccant

// Text of a PDF via pdftotext (poppler). The PDF's text is font-encoded, so a
// plain byte search cannot see it. Tests skip where pdftotext is missing.
let hasPdftotext = true
try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }) } catch { hasPdftotext = false }
const pdfText = (buf) => execFileSync('pdftotext', ['-layout', '-', '-'], { input: buf }).toString()

test('report PDF at 0 lb: no desiccant, ENTERED, asterisk, clear-up-to or headroom anywhere; 3 pages', { skip: !hasPdftotext && 'pdftotext not installed' }, async (t) => {
  const s = await start(t)
  for (const extra of [{ ex: 'double', glass: 'double', u: '0.196', seal_out: 'aged', seal_in: 'certified_best' }, { ex: 'double', glass: 'vig' }, { facade: 'east', width: '30', height: '48' }]) {
    const r = await s.get(`/api/report?${qs({ lb: 0, ...extra })}&project=Falchi`)
    assert.equal(r.status, 200)
    const text = pdfText(r.body)
    assert.doesNotMatch(text, /desiccant/i, JSON.stringify(extra))
    assert.doesNotMatch(text, /ENTERED|clear up to|headroom|typed in|Why a better/i, JSON.stringify(extra))
    assert.doesNotMatch(text, /\d\*/, 'no estimate asterisk')
    assert.match(text, /How this assessment works/)
    assert.match(text, /SWR Condensation Assessment/)
    assert.equal((r.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 3)
  }
})

test('report PDF with desiccant: the desiccant content is still there; 3 pages', { skip: !hasPdftotext && 'pdftotext not installed' }, async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report?${qs({ lb: 4, facade: 'south', width: '48', height: '120' })}&project=${encodeURIComponent('Long project name '.repeat(4).trim())}`)
  assert.equal(r.status, 200)
  const text = pdfText(r.body)
  for (const phrase of [/Desiccant loading/, /Desiccant keeps/, /desiccant takes up water/, /South-facing/, /48 × 120 in/]) assert.match(text, phrase)
  assert.equal((r.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 3)
})

test('method note: no desiccant at 0 lb, right article for each facade, 20-year cap with desiccant', () => {
  const data = (lb, facade) => ({ config: { lb, facade }, result: { max_years: 20 } })
  assert.doesNotMatch(methodItems(data(0, { key: 'north', label: 'North' })).join(' '), /desiccant/i)
  assert.match(methodItems(data(0, { key: 'north', label: 'North' })).join(' '), /north-facing window gets little direct sun/)
  assert.match(methodItems(data(0, { key: 'east', label: 'East' })).join(' '), /plus the sun on an east-facing window/)
  assert.match(methodItems(data(0, { key: 'west', label: 'West' })).join(' '), /plus the sun on a west-facing window/)
  assert.match(methodItems(data(4, { key: 'south', label: 'South' })).join(' '), /at most 20 years/)
  assert.match(methodItems(data(0, { key: 'north', label: 'North' })).join(' '), /estimated visibility threshold/)
})

// ------------------------------------------------------------ v2.8: room humidity and building

test('report with no humidification and a real building height: the run uses them, the report and link carry them', async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report.json?${qs({ hum: 'none', floors: '11', wfloor: '10' })}`)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.config.hum.key, 'none')
  assert.deepEqual(r.json.config.building, { floors: 11, wfloor: 10, changed: true, above_mid_ft: 47 })
  assert.deepEqual(r.json.config.room, { median_pct: 18.0, p10_pct: 10.0, p90_pct: 31.0 })
  const runs = s.f.calls.urls.filter((u) => u.pathname === '/api/lifetime')
  assert.equal(runs.length, 1)
  assert.ok(runs.every((u) => u.searchParams.get('room_humidity') === 'unhumidified' && u.searchParams.get('floors') === '11' && u.searchParams.get('window_floor') === '10'))
  const link = new URL(r.json.link).searchParams
  assert.deepEqual([link.get('hum'), link.get('floors'), link.has('wfloor')], ['none', '11', false], 'floor 10 is the standard window floor')
  const std = await s.get(`/api/report.json?${qs()}`)
  assert.equal(std.json.config.hum.key, 'fixed')
  assert.deepEqual(std.json.config.building, { floors: 20, wfloor: 10, changed: false, above_mid_ft: -6 })
  for (const k of ['hum', 'floors', 'wfloor']) assert.equal(new URL(std.json.link).searchParams.has(k), false, k)
})

test('report PDF without humidification: says so on every page that mentions room air, shows the floor; 3 pages', { skip: !hasPdftotext && 'pdftotext not installed' }, async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report?${qs({ lb: 0, hum: 'none', floors: '11', wfloor: '10', width: '30', height: '14', seal_out: 'aged', seal_in: 'certified_best' })}&project=CU%20Gamow%20Tower`)
  assert.equal(r.status, 200)
  const text = pdfText(r.body).replace(/\s+/g, ' ')
  assert.match(text, /room at 70 °F without humidification/)
  assert.match(text, /no humidification; heating season about 18 % RH \(10 to 31 %\)/)
  assert.match(text, /30 × 14 in, floor 10 of 11/)
  assert.match(text, /Room air: the building has no humidifier/)
  assert.doesNotMatch(text, /Reading the results/, 'section removed in v2.10')
  assert.doesNotMatch(text, /dew point \d+ °F/, 'no fixed-RH dew point')
  assert.doesNotMatch(text, /desiccant/i)
  assert.equal((r.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 3)
})

test('report PDF at the defaults: wording unchanged (fixed RH with its dew point, window at mid-height, no humidifier text)', { skip: !hasPdftotext && 'pdftotext not installed' }, async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report?${qs({ lb: 0 })}`)
  const text = pdfText(r.body).replace(/\s+/g, ' ')
  assert.match(text, /room at 70 °F and 30 % RH/)
  assert.match(text, /70 °F, 30 % RH, dew point \d+ °F/)
  assert.match(text, /60 × 96 in, at mid-height/)
  assert.doesNotMatch(text, /humidifier|humidification/i)
})

test('method note: a room-air line only without humidification', () => {
  const data = (hum) => ({ config: { lb: 0, facade: { key: 'north', label: 'North' }, hum: { key: hum }, people_gkg: 1.2 }, result: { max_years: 20 } })
  assert.doesNotMatch(methodItems(data('fixed')).join(' '), /humidifier/)
  assert.match(methodItems(data('none')).join(' '), /Room air: the building has no humidifier.*about 1\.2 g of water per kg/)
})

// ------------------------------------------------------------ v2.10: building pressure, one glass

test('report with a building pressure (v2.10): the run uses it, the report shows it, the link reopens it; 0 Pa by default', async (t) => {
  const s = await start(t)
  const r = await s.get(`/api/report.json?${qs({ pa: '-6' })}`)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.deepEqual(r.json.config.pressure, { pa: -6, text: '−6 Pa', changed: true, hours: 'weekdays 7 am to 7 pm' })
  const runs = s.f.calls.urls.filter((u) => u.pathname === '/api/lifetime')
  assert.equal(runs.length, 1)
  assert.equal(runs[0].searchParams.get('p_occ_pa'), '-6')
  assert.equal(runs[0].searchParams.get('p_unocc_pa'), '0')
  assert.equal(new URL(r.json.link).searchParams.get('pa'), '-6')
  const std = await s.get(`/api/report.json?${qs()}`)
  assert.deepEqual(std.json.config.pressure, { pa: 0, text: '0 Pa', changed: false, hours: 'weekdays 7 am to 7 pm' })
  assert.equal(new URL(std.json.link).searchParams.has('pa'), false, '0 Pa stays out of the link')
  const sent0 = s.f.calls.urls.filter((u) => u.pathname === '/api/lifetime').at(-1)
  assert.equal(sent0.searchParams.get('p_occ_pa'), '0')
})

test('report PDF (v2.10): only the picked glass, no "Reading the results", building pressure shown; 3 pages', { skip: !hasPdftotext && 'pdftotext not installed' }, async (t) => {
  const s = await start(t)
  // A product name on its own: "SWR" but not "SWR-IG", "SWR-VIG" or the title "SWR Condensation Assessment".
  const named = (text, product) => new RegExp(`(^|[^-\\w])${product}(?![-\\w]| Condensation)`).test(text)
  for (const [glass, product, others] of [['vig', 'SWR-VIG', ['SWR-IG', 'SWR']], ['double', 'SWR-IG', ['SWR-VIG', 'SWR']], ['single', 'SWR', ['SWR-IG', 'SWR-VIG']]]) {
    const r = await s.get(`/api/report?${qs({ glass, pa: '4' })}`)
    assert.equal(r.status, 200)
    const text = pdfText(r.body).replace(/\s+/g, ' ')
    assert.doesNotMatch(text, /retrofit glass at this site|Details on page 3/, 'page-1 glass strip removed')
    assert.doesNotMatch(text, /SWR-VIG \(VIG\)|SWR-VIG VIG\b/, 'no VIG after SWR-VIG')
    assert.ok(named(text, product), `${glass}: ${product} named`)
    for (const o of others) assert.ok(!named(text, o), `${glass}: no ${o} anywhere in the report`)
    assert.doesNotMatch(text, /All three/i)
    assert.doesNotMatch(text, /Reading the results/)
    assert.doesNotMatch(text, /, this report|SWR[-A-Z]* this report/, 'no "this report" glass marker with only one glass')
    assert.match(text, /Building pressure \+4 Pa HVAC, weekdays 7 am to 7 pm/)
    assert.equal((r.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 3)
  }
})

test('glass names (2026-10-26): the type only where the product name does not already say it', async () => {
  const { glassName, typeInName } = await import('../server/report-pdf.js')
  const { GLASSES } = await import('../shared/scenario.js')
  const by = Object.fromEntries(GLASSES.map((g) => [g.key, g]))
  assert.equal(typeInName(by.vig), true)
  assert.equal(glassName(by.vig), 'SWR-VIG')
  assert.equal(glassName(by.vig, { midSentence: true }), 'SWR-VIG')
  assert.equal(glassName(by.double), 'SWR-IG (Double pane)')
  assert.equal(glassName(by.double, { midSentence: true }), 'SWR-IG (double pane)')
  assert.equal(glassName(by.single), 'SWR (Single pane)')
  assert.equal(glassName(by.single, { midSentence: true }), 'SWR (single pane)')
})

test('report PDF glass naming: "SWR-VIG" alone, the others with their type', { skip: !hasPdftotext && 'pdftotext not installed' }, async (t) => {
  const s = await start(t)
  const vig = pdfText((await s.get(`/api/report?${qs({ glass: 'vig' })}`)).body).replace(/\s+/g, ' ')
  assert.match(vig, /with an INOVUES SWR-VIG retrofit/)
  assert.match(vig, /Retrofit glass SWR-VIG /)
  assert.doesNotMatch(vig, /\(VIG\)/)
  const dbl = pdfText((await s.get(`/api/report?${qs({ glass: 'double' })}`)).body).replace(/\s+/g, ' ')
  assert.match(dbl, /with an INOVUES SWR-IG \(double pane\) retrofit/)
  assert.match(dbl, /SWR-IG Double pane/, 'page 3 row keeps the type under SWR-IG')
})
