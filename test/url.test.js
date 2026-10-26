// The page's side of the typed U (v2.5): reading it from a link or the U box.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseFloor, parseU, queryOf, readUrlScenario } from '../web/src/api.js'
import { DEFAULTS, EXAMPLE_SITE } from '../shared/scenario.js'

test('U box text: lenient, rounded to 3 decimals, null outside 0.050 to 1.200', () => {
  assert.equal(parseU('0.2'), 0.2)
  assert.equal(parseU(' 0.25 '), 0.25)
  assert.equal(parseU('.3'), 0.3)
  assert.equal(parseU('0.2346'), 0.235)
  assert.equal(parseU('0.05'), 0.05)
  assert.equal(parseU('1.2'), 1.2)
  for (const bad of ['', null, undefined, '0.04', '1.21', 'abc', '-0.2', '1e-1', '0,2']) assert.equal(parseU(bad), null, String(bad))
})

test('link: a typed U is read back; invalid or standard values fall back to none', () => {
  const site = `&addr=${encodeURIComponent(EXAMPLE_SITE.addr)}`
  assert.equal(readUrlScenario(`?ex=single&glass=vig&u=0.300${site}`).u, 0.3)
  assert.equal(readUrlScenario(`?ex=single&glass=vig&u=0.164${site}`).u, null, 'VIG over single pane: 0.164 is the standard')
  assert.equal(readUrlScenario(`?ex=single&glass=vig&u=9${site}`).u, null)
  assert.equal(readUrlScenario(`?ex=single&glass=vig${site}`).u, null)
})

test('link: u sits after the glass and is left out when empty', () => {
  const s = { ...DEFAULTS, ...EXAMPLE_SITE }
  assert.equal(new URLSearchParams(queryOf(s)).has('u'), false)
  const q = queryOf({ ...s, u: 0.3 })
  assert.match(q, /^ex=single&glass=vig&u=0\.3&seal_out=/)
})

test('cavity depth text: lenient, 2 decimals, null outside 0.25 to 4.00 in', async () => {
  const { parseOffset } = await import('../web/src/api.js')
  assert.equal(parseOffset('1'), 1)
  assert.equal(parseOffset(' 1.5 '), 1.5)
  assert.equal(parseOffset('.75'), 0.75)
  assert.equal(parseOffset('1.256'), 1.26)
  for (const bad of ['', null, '0.2', '4.1', 'x', '-1', '1,5']) assert.equal(parseOffset(bad), null, String(bad))
})

test('link: offset read back, 0.6 in left out, invalid falls back to 0.6', () => {
  const site = `&addr=${encodeURIComponent(EXAMPLE_SITE.addr)}`
  assert.equal(readUrlScenario(`?offset=1.25${site}`).offset, 1.25)
  assert.equal(readUrlScenario(`?offset=9${site}`).offset, 0.6)
  assert.equal(readUrlScenario(`?${site.slice(1)}`).offset, 0.6)
  const s = { ...DEFAULTS, ...EXAMPLE_SITE }
  assert.equal(new URLSearchParams(queryOf(s)).has('offset'), false, 'old links stay identical')
  assert.match(queryOf({ ...s, offset: 2 }), /&glass=vig&offset=2&seal_out=/)
})

// ---- v2.7: facade and window size in the link

test('window size text: whole inches, null outside 12 to 240', async () => {
  const { parseWindowSide } = await import('../web/src/api.js')
  assert.equal(parseWindowSide('60'), 60)
  assert.equal(parseWindowSide(' 48 '), 48)
  assert.equal(parseWindowSide('12'), 12)
  assert.equal(parseWindowSide('240'), 240)
  for (const bad of ['', null, '11', '241', '60.5', 'x', '-60', '6O', '1e2']) assert.equal(parseWindowSide(bad), null, String(bad))
})

test('link: facade and window size read back; defaults and invalid values fall back to north, 60 x 96', () => {
  const site = `&addr=${encodeURIComponent(EXAMPLE_SITE.addr)}`
  const a = readUrlScenario(`?facade=south&width=48&height=120${site}`)
  assert.deepEqual([a.facade, a.width, a.height], ['south', 48, 120])
  const b = readUrlScenario(`?facade=up&width=5&height=abc${site}`)
  assert.deepEqual([b.facade, b.width, b.height], ['north', 60, 96])
  const old = readUrlScenario(`?ex=single&glass=vig${site}`)
  assert.deepEqual([old.facade, old.width, old.height], ['north', 60, 96], 'a pre-v2.7 link opens with the old fixed values')
})

test('link: facade and window size left out at their defaults, in order after the offset when set', () => {
  const s = { ...DEFAULTS, ...EXAMPLE_SITE }
  const p = new URLSearchParams(queryOf(s))
  for (const k of ['facade', 'width', 'height']) assert.equal(p.has(k), false, `old links stay identical: ${k}`)
  assert.match(queryOf({ ...s, facade: 'east', width: 30, height: 72 }), /&glass=vig&facade=east&width=30&height=72&seal_out=/)
})

// v2.8: room humidity mode and building height in links

test('floor box text: whole numbers 1 to the limit, null otherwise', () => {
  assert.equal(parseFloor('11'), 11)
  assert.equal(parseFloor(' 7 '), 7)
  assert.equal(parseFloor('100'), 100)
  assert.equal(parseFloor('10', 11), 10)
  assert.equal(parseFloor('12', 11), null, 'window floor above the floors')
  for (const bad of ['', null, '0', '101', '2.5', '-3', 'x', '1e1']) assert.equal(parseFloor(bad), null, String(bad))
})

test('link: humidity mode and building read back; invalid values fall back to a fixed RH and 20 / 10', () => {
  const site = `&addr=${encodeURIComponent(EXAMPLE_SITE.addr)}`
  const a = readUrlScenario(`?hum=none&floors=11&wfloor=10${site}`)
  assert.deepEqual([a.hum, a.floors, a.wfloor], ['none', 11, 10])
  const b = readUrlScenario(`?hum=wet&floors=0&wfloor=abc${site}`)
  assert.deepEqual([b.hum, b.floors, b.wfloor], ['fixed', 20, 10])
  const c = readUrlScenario(`?floors=11&wfloor=12${site}`)
  assert.deepEqual([c.floors, c.wfloor], [20, 10], 'a window floor above the floors falls back to the standard pair')
  const old = readUrlScenario(`?ex=single&glass=vig${site}`)
  assert.deepEqual([old.hum, old.floors, old.wfloor], ['fixed', 20, 10], 'a pre-v2.8 link opens as before')
})

test('link: humidity mode and building left out at their defaults, in their places when set', () => {
  const s = { ...DEFAULTS, ...EXAMPLE_SITE }
  const p = new URLSearchParams(queryOf(s))
  for (const k of ['hum', 'floors', 'wfloor']) assert.equal(p.has(k), false, `old links stay identical: ${k}`)
  const q = queryOf({ ...s, hum: 'none', floors: 11, wfloor: 10 })
  assert.match(q, /&floors=11&seal_out=/, 'floors after the window size; wfloor 10 is the standard and left out')
  assert.match(q, /&rh=30&hum=none&addr=/)
  assert.match(queryOf({ ...s, floors: 11, wfloor: 3 }), /&floors=11&wfloor=3&seal_out=/)
})

test('link: building pressure (v2.10) read back; 0 left out; invalid falls back to 0', async () => {
  const { parsePa } = await import('../web/src/api.js')
  for (let pa = -10; pa <= 10; pa += 2) assert.equal(parsePa(String(pa)), pa)
  assert.ok(Object.is(parsePa('-0'), 0))
  for (const bad of [null, '', '12', '-12', '3', '-1', '2.0', 'x', '+4']) assert.equal(parsePa(bad), 0, String(bad))
  const site = `&addr=${encodeURIComponent(EXAMPLE_SITE.addr)}`
  assert.equal(readUrlScenario(`?ex=single&glass=vig&pa=-6${site}`).pa, -6)
  assert.equal(readUrlScenario(`?ex=single&glass=vig${site}`).pa, 0, 'old links (no pa) read as 0 Pa')
  const s = { ...DEFAULTS, ...EXAMPLE_SITE }
  assert.equal(new URLSearchParams(queryOf(s)).has('pa'), false, '0 Pa stays out of the link')
  assert.match(queryOf({ ...s, pa: -4 }), /^ex=single&glass=vig&pa=-4&seal_out=/)
  assert.match(queryOf({ ...s, floors: 30, pa: 6 }), /&floors=30&pa=6&seal_out=/)
})
