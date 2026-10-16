// The page's side of the typed U (v2.5): reading it from a link or the U box.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseU, queryOf, readUrlScenario } from '../web/src/api.js'
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
