import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  calendarRows, dayToDate, formatDays, fogHoursFrom, formatClock, formatDate, formatDuration, hourParts,
  levelRangeUm, levelWord, MONTH_START_DAY, remainingOnDay, summarize,
} from '../shared/story.js'
import { coalescer, LruCache } from '../server/cache.js'

const Y = 8760
const fogYear = (from, to) => '0'.repeat(from) + '1'.repeat(to - from) + '0'.repeat(Y - to)
const run = (o) => ({ lb: 8, full_hour: null, first_fog_hour: null, capped: false, hours_run: Y, max_years: 20, years: [{ fog_hours: 0, fog: null }], ...o })

// ------------------------------------------------------------ dates

test('day of year to date, TMY without leap day', () => {
  assert.deepEqual(dayToDate(0), { month: 0, day: 1 })
  assert.deepEqual(dayToDate(31), { month: 1, day: 1 })
  assert.deepEqual(dayToDate(58), { month: 1, day: 28 })
  assert.deepEqual(dayToDate(59), { month: 2, day: 1 })
  assert.deepEqual(dayToDate(364), { month: 11, day: 31 })
  assert.throws(() => dayToDate(365))
  assert.deepEqual(MONTH_START_DAY.slice(0, 3), [0, 31, 59])
})

test('hours to dates and clock', () => {
  assert.equal(formatDate(0, false), 'January 1')
  assert.equal(formatDate(Y + 33 * 24, true), 'February 3, year 2')
  assert.equal(hourParts(Y + 5).hourOfDay, 5)
  assert.equal(formatClock(0), '12 am')
  assert.equal(formatClock(6), '6 am')
  assert.equal(formatClock(12), '12 pm')
  assert.equal(formatClock(23), '11 pm')
})

test('durations use the unit a person would', () => {
  assert.equal(formatDuration(12), '12 hours')
  assert.equal(formatDuration(24 * 21.5), '22 days')
  assert.equal(formatDuration(3940), '5.4 months')
  assert.equal(formatDuration(730 * 14), '14 months')
  assert.equal(formatDuration(Y * 3.3), '3.3 years')
  assert.equal(formatDuration(Y * 2), '2 years')
  assert.equal(formatDuration(730 * 6), '6 months')
  assert.equal(formatDuration(17420), '2 years')        // 23.9 months: never "24 months"
  assert.equal(formatDuration(730 * 23.4), '23 months')
})

// ------------------------------------------------------------ summary

test('fills, then fogs in the next winter', () => {
  const r = run({ full_hour: 3940, first_fog_hour: Y + 800, hours_run: 2 * Y, years: [{ fog_hours: 0, fog: null }, { fog_hours: 100, fog: fogYear(800, 900) }] })
  const s = summarize(r)
  assert.equal(s[0], 'The desiccant keeps the cavity dry for 5.4 months, until June 14, year 1.')
  assert.equal(s[1], 'Once it is full, the pane fogs on about 5 days a year, starting February 3, year 2.')   // hours 800-899 = days 33-37
})

test('fills, stays clear', () => {
  const s = summarize(run({ full_hour: 3940, hours_run: 2 * Y, years: [{ fog_hours: 0, fog: null }, { fog_hours: 0, fog: null }] }))
  assert.match(s[1], /still stays clear through the 19 months shown/)
})

test('fogs before full', () => {
  const s = summarize(run({ full_hour: 2000, first_fog_hour: 10, hours_run: 2 * Y, years: [{ fog_hours: 5, fog: fogYear(10, 15) }, { fog_hours: 0, fog: null }] }))
  assert.match(s[0], /first fogs on January 1, year 1, before the desiccant is full/)
  assert.equal(s.length, 2)                       // clear once settled: no "about 0 hours" sentence
  const t = summarize(run({ full_hour: 2000, first_fog_hour: 10, hours_run: 2 * Y, years: [{ fog_hours: 5, fog: fogYear(10, 15) }, { fog_hours: 40, fog: fogYear(0, 40) }] }))
  assert.equal(t[2], 'It fogs on about 2 days a year once it is full.')                 // hours 0-39 = days 0-1
})

test('never fills in 20 years', () => {
  const s = summarize(run({ capped: true, hours_run: 20 * Y }))
  assert.deepEqual(s, ['The desiccant is still working after 20 years.', 'The pane stays clear.'])
})

test('no desiccant', () => {
  assert.deepEqual(summarize(run({ lb: 0 })), ['Without desiccant, the pane stays clear all year.'])
  const s = summarize(run({ lb: 0, first_fog_hour: 40 * 24, hours_run: 2 * Y, years: [{ fog_hours: 1, fog: fogYear(960, 961) }, { fog_hours: 3, fog: fogYear(900, 903) }] }))
  assert.deepEqual(s, ['Without desiccant, the pane fogs on about 1 day a year.', 'The first fog comes on February 10, year 1.'])
})

test('fog hours after full count only from the fill hour', () => {
  const years = [{ fog: fogYear(0, 10), fog_hours: 10 }, { fog: fogYear(0, 20), fog_hours: 20 }]
  assert.equal(fogHoursFrom(years, 5), 25)
  assert.equal(fogHoursFrom(years, Y), 20)
  assert.equal(fogHoursFrom(years, 0), 30)
})

// ------------------------------------------------------------ calendar rows

test('short runs show every year', () => {
  const r = run({ full_hour: 3940, hours_run: 2 * Y, years: [{ fog_hours: 0 }, { fog_hours: 3 }] })
  assert.deepEqual(calendarRows(r), [{ kind: 'year', index: 0 }, { kind: 'year', index: 1 }])
})

test('a 20-year quiet life folds into first, band, last', () => {
  const r = run({ capped: true, hours_run: 20 * Y, years: Array.from({ length: 20 }, () => ({ fog_hours: 0 })) })
  assert.deepEqual(calendarRows(r), [{ kind: 'year', index: 0 }, { kind: 'band', from: 1, to: 18 }, { kind: 'year', index: 19 }])
})

test('quiet years before the fill fold; the fill year and aftermath stay', () => {
  const years = Array.from({ length: 6 }, (_, i) => ({ fog_hours: i === 5 ? 50 : 0 }))
  const r = run({ full_hour: 4 * Y + 100, hours_run: 6 * Y, years })
  assert.deepEqual(calendarRows(r), [
    { kind: 'year', index: 0 }, { kind: 'band', from: 1, to: 2 }, { kind: 'year', index: 3 },
    { kind: 'year', index: 4 }, { kind: 'year', index: 5 },
  ])
})

test('two quiet years are not folded', () => {
  const years = [{ fog_hours: 0 }, { fog_hours: 0 }, { fog_hours: 9 }]
  const r = run({ full_hour: 2 * Y + 5, hours_run: 3 * Y, years })
  assert.equal(calendarRows(r).filter((x) => x.kind === 'band').length, 0)
})

// ------------------------------------------------------------ fog scale

test('fog level ranges tile the log scale', () => {
  const sc = { visible_um: 5, max_um: 100, levels: 9 }
  const [a0, a1] = levelRangeUm(1, sc)
  assert.equal(a0, 5)
  assert.ok(Math.abs(a1 - 5 * 20 ** (1 / 9)) < 1e-9)
  assert.ok(Math.abs(levelRangeUm(9, sc)[1] - 100) < 1e-9)
  assert.equal(levelWord(1), 'Light fog')
  assert.equal(levelWord(5), 'Fog')
  assert.equal(levelWord(9), 'Heavy fog')
})

test('remaining capacity is clamped', () => {
  assert.equal(remainingOnDay(0), 1)
  assert.equal(remainingOnDay(95), 0)
  assert.equal(remainingOnDay(120), 0)
  assert.equal(remainingOnDay(undefined), 0)
})

// ------------------------------------------------------------ cache

test('LRU evicts the oldest and refreshes on read', () => {
  const c = new LruCache({ max: 2 })
  c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3)
  assert.equal(c.get('b'), undefined)
  assert.equal(c.get('a'), 1)
  assert.equal(c.get('c'), 3)
})

test('LRU entries expire', () => {
  let t = 0
  const c = new LruCache({ ttlMs: 10, now: () => t })
  c.set('a', 1); t = 11
  assert.equal(c.get('a'), undefined)
})

test('coalescer shares one promise and forgets it afterwards, even on failure', async () => {
  const once = coalescer()
  let n = 0
  const fn = () => new Promise((r) => setTimeout(() => r(++n), 5))
  const [a, b] = await Promise.all([once('k', fn), once('k', fn)])
  assert.equal(a, 1); assert.equal(b, 1)
  assert.equal(await once('k', fn), 2)
  await assert.rejects(once('x', async () => { throw new Error('boom') }))
  assert.equal(await once('x', async () => 7), 7)
})

// ------------------------------------------------------------ headline boxes

import { headlineCards } from '../shared/story.js'

test('boxes: fills, then fogs', () => {
  const r = run({ full_hour: 3940, first_fog_hour: Y + 800, hours_run: 2 * Y, years: [{ fog_hours: 0, fog: null }, { fog_hours: 100, fog: fogYear(800, 900) }] })
  const [a, b, c] = headlineCards(r)
  assert.deepEqual(a, { key: 'life', tone: 'dry', label: 'Desiccant keeps the cavity dry for', value: '164 days', detail: 'Full on June 14, year 1 (5.4 months)' })
  assert.deepEqual(b, { key: 'first', tone: 'fog', label: 'First visible fog', value: '398 days', detail: 'February 3, year 2' })
  assert.deepEqual(c, { key: 'amount', tone: 'fog', label: 'Fog days per year once full', value: '5 days', detail: 'Year 2, the first full year after it fills' })
})

test('boxes: fills, stays clear', () => {
  const [, b, c] = headlineCards(run({ full_hour: 3940, hours_run: 2 * Y, years: [{ fog_hours: 0 }, { fog_hours: 0 }] }))
  assert.equal(b.tone, 'none'); assert.equal(b.value, 'None'); assert.equal(b.detail, 'Clear through the 2 years shown')
  assert.equal(c.tone, 'none'); assert.equal(c.value, '0 days')
})

test('boxes: fogs before full', () => {
  const [, b, c] = headlineCards(run({ full_hour: 2000, first_fog_hour: 10, hours_run: 2 * Y, years: [{ fog_hours: 5, fog: fogYear(10, 15) }, { fog_hours: 0, fog: null }] }))
  assert.equal(b.label, 'First visible fog, before the desiccant is full'); assert.equal(b.value, '10 hours'); assert.equal(b.detail, 'January 1, year 1')
  assert.equal(c.label, 'Fog days per year once full'); assert.equal(c.value, '0 days'); assert.equal(c.tone, 'none')
})

test('boxes: never full', () => {
  const [a, b, c] = headlineCards(run({ capped: true, hours_run: 20 * Y, years: Array.from({ length: 20 }, () => ({ fog_hours: 0 })) }))
  assert.equal(a.value, '7,300+ days'); assert.equal(a.detail, 'Still working after 20 years'); assert.equal(b.value, 'None'); assert.equal(c.tone, 'none')
})

test('boxes: no desiccant, single year wording', () => {
  const [a, b, c] = headlineCards(run({ lb: 0, first_fog_hour: 40 * 24, hours_run: 2 * Y, years: [{ fog_hours: 12, fog: fogYear(960, 972) }, { fog_hours: 15, fog: fogYear(900, 915) }] }))
  assert.equal(a.value, 'None'); assert.equal(a.tone, 'none')
  assert.equal(b.value, '40 days'); assert.equal(b.detail, 'February 10, year 1')
  assert.equal(c.label, 'Fog days per year'); assert.equal(c.value, '2 days')   // year 2, hours 900-914 = days 37-38
  assert.equal(c.detail, 'Year 2, a settled year without desiccant')
  const clear = headlineCards(run({ lb: 0 }))
  assert.equal(clear[1].detail, 'Clear all year'); assert.equal(clear[2].detail, 'The pane stays clear')
})

test('days formatting', async () => {
  const { formatDays } = await import('../shared/story.js')
  assert.equal(formatDays(9349), '390 days')          // 389.5 days rounds up
  assert.equal(formatDays(6149), '256 days')
  assert.equal(formatDays(24), '1 day')
  assert.equal(formatDays(10), '10 hours')
})

test('year statistics: hours, days, events, longest', async () => {
  const { yearStats } = await import('../shared/story.js')
  assert.deepEqual(yearStats(null), { hours: 0, days: 0, events: 0, longest: 0 })
  // two events: hours 22..25 (spans a midnight, 4 h) and 100..101 (2 h)
  const s = '0'.repeat(22) + '1111' + '0'.repeat(74) + '11' + '0'.repeat(8760 - 102)
  assert.deepEqual(yearStats(s), { hours: 6, days: 3, events: 2, longest: 4 })
})

test('desiccant status per year', async () => {
  const { desiccantStatus } = await import('../shared/story.js')
  const r = run({ full_hour: 3940, hours_run: 2 * Y, years: [{ fog_hours: 0 }, { fog_hours: 0 }] })
  assert.deepEqual(desiccantStatus(r, 0), { value: 'Full Jun 14', sub: 'after 164 days' })
  assert.deepEqual(desiccantStatus(r, 1), { value: 'Full', sub: 'since year 1' })
  assert.deepEqual(desiccantStatus(run({ capped: true }), 0), { value: 'Working', sub: 'all year' })
  assert.equal(desiccantStatus(run({ lb: 0 }), 0).value, 'None')
})

test('working hours: Monday to Friday 08:00 to 18:00, January 1 a Monday', async () => {
  const { isWorkingHour } = await import('../shared/story.js')
  let n = 0
  for (let i = 0; i < 8760; i++) if (isWorkingHour(i)) n++
  assert.equal(n, 2610)                               // 261 weekdays x 10 h
  assert.equal(isWorkingHour(8), true)                // Mon Jan 1, 08:00
  assert.equal(isWorkingHour(7), false)
  assert.equal(isWorkingHour(18), false)              // 18:00 is off
  assert.equal(isWorkingHour(5 * 24 + 10), false)     // Saturday Jan 6
  assert.equal(isWorkingHour(7 * 24 + 10), true)      // Monday Jan 8
})

test('year statistics in working hours only', async () => {
  const { yearStats } = await import('../shared/story.js')
  // fog all of Monday Jan 1 (24 h) and all of Saturday Jan 6
  const s = '1'.repeat(24) + '0'.repeat(4 * 24) + '1'.repeat(24) + '0'.repeat(8760 - 6 * 24)
  assert.deepEqual(yearStats(s), { hours: 48, days: 2, events: 2, longest: 24 })
  assert.deepEqual(yearStats(s, true), { hours: 10, days: 1, events: 1, longest: 10 })   // Saturday excluded
})

test('fog-days box and sentence follow the working-hours view', () => {
  // year 2: fog all of Monday Jan 1 and all of Saturday Jan 6 -> 2 fog days, 1 working day
  const y2 = '1'.repeat(24) + '0'.repeat(4 * 24) + '1'.repeat(24) + '0'.repeat(8760 - 6 * 24)
  const r = run({ full_hour: 3940, first_fog_hour: Y, hours_run: 2 * Y, years: [{ fog_hours: 0, fog: null }, { fog_hours: 48, fog: y2 }] })
  const all = headlineCards(r)[2]
  const work = headlineCards(r, { working: true })[2]
  assert.equal(all.label, 'Fog days per year once full'); assert.equal(all.value, '2 days')
  assert.equal(work.label, 'Working days with fog per year once full'); assert.equal(work.value, '1 day')
  assert.equal(work.detail, 'Year 2, the first full year after it fills, out of 261 working days')
  assert.match(summarize(r, { working: true })[1], /about 1 working day a year/)
  assert.match(summarize(r)[1], /about 2 days a year/)
})

test('box 1 adds months only when they add information', () => {
  const short = headlineCards(run({ full_hour: 13 * 24, hours_run: 2 * Y, years: [{ fog_hours: 0 }, { fog_hours: 0 }] }))[0]
  assert.equal(short.value, '13 days'); assert.equal(short.detail, 'Full on January 14, year 1')
  const long = headlineCards(run({ full_hour: 6149, hours_run: 2 * Y, years: [{ fog_hours: 0 }, { fog_hours: 0 }] }))[0]
  assert.equal(long.detail, 'Full on September 14, year 1 (8.4 months)')
})

test('first visible fog follows the working-hours view', async () => {
  const { firstFogHour } = await import('../shared/story.js')
  // year 2: Saturday Jan 6 all day (not working), Monday Jan 8 at 06:00 (too early),
  // Tuesday Jan 9 at 10:00 (working) -> the working first fog is Jan 9, 10:00
  const y2 = Array(8760).fill('0')
  for (let h = 5 * 24; h < 6 * 24; h++) y2[h] = '1'
  y2[7 * 24 + 6] = '1'
  y2[8 * 24 + 10] = '1'
  const fog = y2.join('')
  const r = run({ full_hour: 3940, first_fog_hour: Y + 5 * 24, hours_run: 2 * Y, years: [{ fog_hours: 0, fog: null }, { fog_hours: 26, fog }] })
  assert.equal(firstFogHour(r), Y + 5 * 24)
  assert.equal(firstFogHour(r, true), Y + 8 * 24 + 10)
  const b = headlineCards(r, { working: true })[1]
  assert.equal(b.label, 'First visible fog in working hours')
  assert.equal(b.value, formatDays(Y + 8 * 24 + 10))
  assert.equal(b.detail, 'January 9, year 2')
  assert.equal(headlineCards(r)[1].detail, 'January 6, year 2')
  assert.match(summarize(r, { working: true })[1], /starting January 9, year 2/)
  // no working-hours fog at all
  const night = run({ full_hour: 3940, first_fog_hour: Y + 5 * 24, hours_run: 2 * Y,
    years: [{ fog_hours: 0, fog: null }, { fog_hours: 24, fog: '0'.repeat(120) + '1'.repeat(24) + '0'.repeat(8760 - 144) }] })
  assert.equal(firstFogHour(night, true), null)
  assert.equal(headlineCards(night, { working: true })[1].value, 'None')
})

// ---- quiet wording for the customer report (Anas 2026-10-17)

test('quiet (report): with 0 lb nothing mentions desiccant, and there is no desiccant box', () => {
  const fogging = run({ lb: 0, first_fog_hour: 40 * 24, hours_run: 2 * Y, years: [{ fog_hours: 12, fog: fogYear(960, 972) }, { fog_hours: 15, fog: fogYear(900, 915) }] })
  for (const r of [run({ lb: 0 }), fogging]) {
    for (const working of [false, true]) {
      const text = JSON.stringify([summarize(r, { quiet: true, working }), headlineCards(r, { quiet: true, working })])
      assert.doesNotMatch(text, /desiccant/i, `working=${working}`)
      assert.deepEqual(headlineCards(r, { quiet: true, working }).map((c) => c.key), ['first', 'amount'])
    }
  }
  assert.deepEqual(summarize(fogging, { quiet: true }).slice(0, 1), ['The pane fogs on about 2 days a year.'])  // hours 900 to 915 cross midnight: 2 days
  assert.equal(headlineCards(fogging, { quiet: true })[1].detail, 'Year 2, a settled year')
})

test('quiet is report-only: without it the page wording and three boxes are unchanged', () => {
  assert.deepEqual(summarize(run({ lb: 0 })), ['Without desiccant, the pane stays clear all year.'])
  assert.deepEqual(headlineCards(run({ lb: 0 })).map((c) => c.key), ['life', 'first', 'amount'])
  // with desiccant, quiet changes nothing
  const r = run({ lb: 4 })
  assert.deepEqual(summarize(r, { quiet: true }), summarize(r))
  assert.deepEqual(headlineCards(r, { quiet: true }), headlineCards(r))
})

test('0 lb, fog only in year 1: says clear in the settled year, never "about 0 days a year"', () => {
  const r = run({ lb: 0, first_fog_hour: 40 * 24, hours_run: 2 * Y, years: [{ fog_hours: 3, fog: fogYear(960, 963) }, { fog_hours: 0, fog: fogYear(0, 0) }] })
  for (const quiet of [false, true]) {
    const s = summarize(r, { quiet })
    assert.doesNotMatch(s.join(' '), /about 0 days/)
    assert.match(s[0], /stays clear in the settled year 2\.$/)
    assert.equal(s[1], 'It fogs only early in the run, first on February 10, year 1.')
  }
})
