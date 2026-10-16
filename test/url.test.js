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
