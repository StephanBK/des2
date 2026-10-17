// Pure functions that turn an engine result into words and calendar rows.
// No DOM, no network: everything here is unit-tested (test/story.test.js).

import { WORKING_HOURS } from './scenario.js'

export const HOURS_PER_YEAR = 8760
export const HOURS_PER_MONTH = HOURS_PER_YEAR / 12      // 730, a calendar-average month

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]   // TMY: no leap day
export const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3))
export const MONTH_START_DAY = MONTH_DAYS.reduce((acc, d, i) => { acc.push(i === 0 ? 0 : acc[i - 1] + MONTH_DAYS[i - 1]); return acc }, [])

/**
 * Short place name from a full address, for labels: the city.
 * "233 South Wacker Drive, Chicago, Illinois 60606, United States" -> "Chicago".
 * Mapbox full addresses run street, city, state + ZIP, country.
 */
export function placeName(full) {
  const parts = String(full || '').split(',').map((x) => x.trim()).filter(Boolean)
  if (parts.length >= 3) return parts[1]
  return parts[0] || ''
}

/** Day of year (0..364) to { month (0..11), day (1..31) }. */
export function dayToDate(dayOfYear) {
  let d = dayOfYear
  for (let m = 0; m < 12; m++) {
    if (d < MONTH_DAYS[m]) return { month: m, day: d + 1 }
    d -= MONTH_DAYS[m]
  }
  throw new RangeError(`day of year out of range: ${dayOfYear}`)
}

/** Hour since installation to its parts. */
export function hourParts(h) {
  const year = Math.floor(h / HOURS_PER_YEAR) + 1
  const hoy = h % HOURS_PER_YEAR
  const doy = Math.floor(hoy / 24)
  return { year, hourOfYear: hoy, dayOfYear: doy, hourOfDay: hoy % 24, ...dayToDate(doy) }
}

/** "February 3" or "February 3, year 2" when the run spans more than one year. */
export function formatDate(h, withYear) {
  const p = hourParts(h)
  const base = `${MONTHS[p.month]} ${p.day}`
  return withYear ? `${base}, year ${p.year}` : base
}

/** "6 am", "12 pm", "12 am". */
export function formatClock(hourOfDay) {
  const h = ((hourOfDay % 24) + 24) % 24
  const suffix = h < 12 ? 'am' : 'pm'
  const twelve = h % 12 === 0 ? 12 : h % 12
  return `${twelve} ${suffix}`
}

/** A span of hours in the unit a person would use. */
export function formatDuration(hours) {
  if (hours < 48) return `${Math.round(hours)} hours`
  const days = hours / 24
  if (days < 45) return `${Math.round(days)} days`
  const months = hours / HOURS_PER_MONTH
  // Switch to years before rounding could print "24 months".
  if (months < 23.5) return `${months < 9.95 ? oneDecimal(months) : Math.round(months)} months`
  return `${oneDecimal(hours / HOURS_PER_YEAR)} years`
}

/** 5.4 -> "5.4", 6.0 -> "6". */
function oneDecimal(x) {
  const s = x.toFixed(1)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** Elapsed time in days (hours below one day), e.g. "390 days". */
export function formatDays(hours) {
  if (hours < 24) return `${Math.round(hours)} ${Math.round(hours) === 1 ? 'hour' : 'hours'}`
  const d = Math.round(hours / 24)
  return `${d.toLocaleString('en-US')} ${d === 1 ? 'day' : 'days'}`
}

export function formatHours(n) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'hour' : 'hours'}`
}

/** Fog hours in the run at or after hour h0. */
export function fogHoursFrom(years, h0) {
  let n = 0
  years.forEach((y, i) => {
    if (!y.fog) return
    const start = i * HOURS_PER_YEAR
    if (start + HOURS_PER_YEAR <= h0) return
    const from = Math.max(0, h0 - start)
    for (let k = from; k < y.fog.length; k++) if (y.fog.charCodeAt(k) !== 48) n++
  })
  return n
}

/**
 * Fog hours in ONE year, the unit every headline number uses: the last
 * simulated year. Without desiccant that is year 2 (year 1 is a start-up
 * year from a clean pane); with desiccant it is the first full year after
 * the fill (or the last year of a run that never fills).
 */
export function fogPerYear(r) {
  return r.years.length ? r.years[r.years.length - 1].fog_hours : 0
}

/** Days with at least one hour of visible fog, in the same year as fogPerYear.
 *  working = true counts only working days with fog in working hours. */
export function fogDaysPerYear(r, working = false) {
  return r.years.length ? yearStats(r.years[r.years.length - 1].fog, working).days : 0
}

export function formatDayCount(n) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'day' : 'days'}`
}

/**
 * The one-paragraph answer, as a list of sentences.
 * r: { lb, full_hour, first_fog_hour, capped, hours_run, max_years, years: [{ fog_hours, fog }] }
 * quiet = true (the customer report, Anas 2026-10-17): with no desiccant the
 * sentences do not mention desiccant at all. The page leaves it off.
 */
export function summarize(r, { working = false, quiet = false } = {}) {
  const multi = r.hours_run > HOURS_PER_YEAR
  const date = (h) => formatDate(h, multi)
  const total = r.years.reduce((s, y) => s + y.fog_hours, 0)

  const perYear = fogDaysPerYear(r, working)
  const days = (n) => (working ? `${formatDayCount(n).replace('day', 'working day')}` : formatDayCount(n))
  if (r.lb === 0) {
    const f0 = firstFogHour(r, working)
    const lead = quiet ? 'The pane' : 'Without desiccant, the pane'
    if (f0 === null) return [working ? `${lead} stays clear in working hours.` : `${lead} stays clear all year.`]
    return [`${lead} fogs on about ${days(perYear)} a year.`, `The first fog${working ? ' in working hours' : ''} comes on ${date(f0)}.`]
  }

  const full = r.full_hour
  const fog = firstFogHour(r, working)
  const life = full === null
    ? `The desiccant is still working after ${r.max_years} years.`
    : `The desiccant keeps the cavity dry for ${formatDuration(full)}, until ${date(full)}.`

  if (fog !== null && (full === null || fog < full)) {
    const out = [`The pane first fogs on ${date(fog)}, before the desiccant is full.`, life]
    if (perYear) out.push(`It fogs on about ${days(perYear)} a year ${full === null ? 'while the desiccant works' : 'once it is full'}.`)
    return out
  }
  if (full === null) return [life, 'The pane stays clear.']
  const after = r.hours_run - full
  if (fog === null) return [life, `After that the pane still stays clear through the ${formatDuration(after)} shown.`]
  return [life, `Once it is full, the pane fogs on about ${days(perYear)} a year, starting ${date(fog)}.`]
}

/**
 * Calendar rows. Runs of 3+ "quiet" years (desiccant working all year, no
 * fog) keep their first and last year as strips and fold the middle into
 * one band, so a 20-year life does not become 20 identical strips.
 */
export function calendarRows(r) {
  const n = r.years.length
  const quiet = r.years.map((y, i) => y.fog_hours === 0 && r.lb > 0 &&
    (r.full_hour === null || (i + 1) * HOURS_PER_YEAR <= r.full_hour))
  const rows = []
  let i = 0
  while (i < n) {
    if (!quiet[i]) { rows.push({ kind: 'year', index: i }); i++; continue }
    let j = i
    while (j + 1 < n && quiet[j + 1]) j++
    const len = j - i + 1
    if (len >= 3) {
      rows.push({ kind: 'year', index: i })
      rows.push({ kind: 'band', from: i + 1, to: j - 1 })
      rows.push({ kind: 'year', index: j })
    } else {
      for (let k = i; k <= j; k++) rows.push({ kind: 'year', index: k })
    }
    i = j + 1
  }
  return rows
}

/** Film thickness range of a fog level, µm, on the engine's log scale. */
export function levelRangeUm(level, scale) {
  const { visible_um: lo, max_um: hi, levels } = scale
  const at = (x) => lo * Math.pow(hi / lo, x / levels)
  return [at(level - 1), at(level)]
}

export function levelWord(level, levels = 9) {
  if (level <= levels / 3) return 'Light fog'
  if (level <= (2 * levels) / 3) return 'Fog'
  return 'Heavy fog'
}

/** Remaining desiccant capacity 0..1 on a given day (for the teal tint). */
export function remainingOnDay(loadingPct, fullPct = 95) {
  if (loadingPct === undefined || loadingPct === null) return 0
  return Math.max(0, Math.min(1, 1 - loadingPct / fullPct))
}

/**
 * The three result boxes at the top of the page:
 *   1. how long the desiccant keeps the cavity dry   (teal)
 *   2. first visible fog                             (amber, or neutral if none)
 *   3. how much fog                                  (amber, or neutral if none)
 * Each: { key, tone: 'dry' | 'fog' | 'none', label, value, detail }.
 */
export function headlineCards(r, { working = false, quiet = false } = {}) {
  const multi = r.hours_run > HOURS_PER_YEAR
  const total = r.years.reduce((s, y) => s + y.fog_hours, 0)
  const fog = firstFogHour(r, working)          // follows the working-hours view
  const full = r.full_hour

  // 1. Desiccant life, in days (same unit as box 2), date below
  let life
  if (r.lb === 0) life = { tone: 'none', label: 'Desiccant', value: 'None', detail: 'Seals and room air alone' }
  else if (full === null) life = { tone: 'dry', label: 'Desiccant keeps the cavity dry for', value: `${(r.max_years * 365).toLocaleString('en-US')}+ days`, detail: `Still working after ${r.max_years} years` }
  else {
    // add months or years in brackets only when that says something the days do not
    const dur = formatDuration(full)
    const extra = /days|hours/.test(dur) ? '' : ` (${dur})`
    life = { tone: 'dry', label: 'Desiccant keeps the cavity dry for', value: formatDays(full), detail: `Full on ${formatDate(full, multi)}${extra}` }
  }

  // 2. First visible fog, in days after installation, date below
  let first
  const firstLabel = working ? 'First visible fog in working hours' : 'First visible fog'
  if (fog === null) {
    first = { tone: 'none', label: firstLabel, value: 'None', detail: r.lb === 0 ? 'Clear all year' : `Clear through the ${formatDuration(r.hours_run)} shown` }
  } else {
    let label = firstLabel
    if (r.lb > 0 && (full === null || fog < full)) label = `${firstLabel}, before the desiccant is full`
    first = { tone: 'fog', label, value: formatDays(fog), detail: formatDate(fog, multi) }
  }

  // 3. Fog DAYS in one year (days with at least one hour of visible fog),
  // always the last simulated year, so cases compare fairly
  // With the working-hours view on, this box counts working days with fog
  // in working hours, matching the calendar panels below.
  const perYear = fogDaysPerYear(r, working)
  const lastYear = r.years.length
  const tone = perYear ? 'fog' : 'none'
  const noun = working ? 'Working days with fog' : 'Fog days'
  const of = working ? `, out of ${WORKING_HOURS.days} working days` : ''
  let amount
  if (r.lb === 0) {
    amount = { tone, label: `${noun} per year`, value: formatDayCount(perYear), detail: perYear ? `Year ${lastYear}, a settled year${quiet ? '' : ' without desiccant'}${of}` : 'The pane stays clear' }
  } else if (full !== null) {
    amount = { tone, label: `${noun} per year once full`, value: formatDayCount(perYear), detail: perYear ? `Year ${lastYear}, the first full year after it fills${of}` : 'The pane stays clear' }
  } else {
    amount = { tone, label: `${noun} per year`, value: formatDayCount(perYear), detail: perYear ? `While the desiccant still works${of}` : 'The pane stays clear' }
  }

  // quiet (the customer report) with no desiccant: no desiccant box at all.
  if (quiet && r.lb === 0) return [{ key: 'first', ...first }, { key: 'amount', ...amount }]
  return [{ key: 'life', ...life }, { key: 'first', ...first }, { key: 'amount', ...amount }]
}

/**
 * First hour of visible fog since installation. With working = true, the
 * first one inside working hours (a fog that starts at night and is gone
 * by 08:00 does not count). null when there is none.
 */
export function firstFogHour(r, working = false) {
  if (!working) return r.first_fog_hour
  for (let yi = 0; yi < r.years.length; yi++) {
    const s = r.years[yi].fog
    if (!s) continue
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) !== 48 && isWorkingHour(i)) return yi * HOURS_PER_YEAR + i
    }
  }
  return null
}

/** Is this hour of the year a working hour? Day 0 (January 1) is a Monday. */
export function isWorkingHour(hourOfYear) {
  const day = Math.floor(hourOfYear / 24)
  const h = hourOfYear % 24
  return day % 7 < 5 && h >= WORKING_HOURS.start && h < WORKING_HOURS.end
}

/**
 * Statistics of one year's fog map (8,760 digits, '0' = clear):
 *   hours    visible fog hours
 *   days     days with at least one fog hour
 *   events   unbroken runs of fog hours
 *   longest  longest run, hours
 * With working = true only working hours count, and an off-hour ends a
 * run (as in the earlier calculator), so no event exceeds one working day.
 */
export function yearStats(fog, working = false) {
  if (!fog) return { hours: 0, days: 0, events: 0, longest: 0 }
  let hours = 0, days = 0, events = 0, longest = 0, run = 0, dayHas = false
  for (let i = 0; i < fog.length; i++) {
    if (working && !isWorkingHour(i)) {
      run = 0
      if (i % 24 === 23) { if (dayHas) days++; dayHas = false }
      continue
    }
    const on = fog.charCodeAt(i) !== 48
    if (on) {
      hours++
      if (run === 0) events++
      run++
      if (run > longest) longest = run
      dayHas = true
    } else run = 0
    if (i % 24 === 23) { if (dayHas) days++; dayHas = false }
  }
  return { hours, days, events, longest }
}

/** Desiccant status for one calendar year, for the stat row. */
export function desiccantStatus(r, yearIndex) {
  const y0 = yearIndex * HOURS_PER_YEAR
  const y1 = y0 + HOURS_PER_YEAR
  if (r.lb === 0) return { value: 'None', sub: 'no desiccant fitted' }
  if (r.full_hour === null || r.full_hour >= y1) return { value: 'Working', sub: 'all year' }
  if (r.full_hour >= y0) {
    const p = hourParts(r.full_hour)
    return { value: `Full ${MONTH_SHORT[p.month]} ${p.day}`, sub: `after ${formatDays(r.full_hour)}` }
  }
  return { value: 'Full', sub: `since year ${hourParts(r.full_hour).year}` }
}
