// Everything the customer report shows, gathered and computed in one place.
// No drawing here (that is report-pdf.js), so it can be tested on its own.
//
// Runs behind one report (each cached like a normal page run):
//   1. the scenario on screen
//   2. the same scenario with each other retrofit glass (options table)
//   3. per retrofit glass, a room-humidity sweep without desiccant
//      (headroom: up to which room RH the pane stays clear long term)

import {
  APP_VERSION, ASSUMPTIONS, EXISTING, FIXED_DESCRIPTION, GLASSES, GRAMS_PER_LB, SEALS_EXISTING, SEALS_RETROFIT,
  thermalOf, WORKING_HOURS,
} from '../shared/scenario.js'
import {
  fogDaysPerYear, headlineCards, HOURS_PER_YEAR, MONTH_SHORT, MONTH_START_DAY, summarize, yearStats,
} from '../shared/story.js'
import { HttpError } from './engine.js'

export const RH_LEVELS = [20, 25, 30, 35, 40, 45, 50, 55, 60]
export const PROJECT_MAX = 80

/** Optional project or customer name for the cover: one line, at most 80 characters. */
export function cleanProject(raw) {
  if (raw === null || raw === undefined) return ''
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) throw new HttpError(400, 'project must be plain text')
  const v = String(raw).replace(/\s+/g, ' ').trim()
  if (v.length > PROJECT_MAX) throw new HttpError(400, `project must be at most ${PROJECT_MAX} characters`)
  return v
}

/**
 * Headroom from a sweep: the highest tested room RH at which the pane stays
 * clear, counting up from the lowest level and stopping at the first level
 * with fog. null when it fogs even at the lowest level.
 */
export function headroomOf(points) {
  let upTo = null
  for (const p of points) {
    if (p.fog_days > 0) break
    upTo = p.rh
  }
  return { clear_up_to: upTo, all_clear: points.length > 0 && points.every((p) => p.fog_days === 0) }
}

/** Days with visible fog in each calendar month of one year's fog map. */
export function monthlyFogDays(fog) {
  const out = Array(12).fill(0)
  if (!fog) return out
  for (let m = 0; m < 12; m++) {
    const d0 = MONTH_START_DAY[m]
    const d1 = m === 11 ? 365 : MONTH_START_DAY[m + 1]
    for (let d = d0; d < d1; d++) {
      for (let h = 0; h < 24; h++) {
        if (fog.charCodeAt(d * 24 + h) !== 48) { out[m]++; break }
      }
    }
  }
  return out
}

// Room dew point, Magnus formula (Sonntag constants), as on the page.
export function dewPointF(tF, rhPct) {
  const a = 17.62
  const b = 243.12
  const t = ((tF - 32) * 5) / 9
  const g = Math.log(rhPct / 100) + (a * t) / (b + t)
  return ((b * g) / (a - g)) * 9 / 5 + 32
}

/** Short report id from the inputs: the same inputs always give the same id. */
export function reportId(key) {
  let h = 2166136261                                  // FNV-1a, 32 bit
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, '0')
}

function sealInfo(list, key, meta) {
  const item = list.find((s) => s.key === key)
  const m = meta?.[key]
  return { key, label: item?.label ?? key, engine_label: m?.label ?? null, cfm_ft2: m?.al_cfm_ft2 ?? null, estimate: m?.estimate ?? null }
}

function summaryOf(r) {
  return {
    full_hour: r.full_hour,
    first_fog_hour: r.first_fog_hour,
    fog_days_per_year: fogDaysPerYear(r),
    years_run: r.years_run,
    max_years: r.max_years,
    lb: r.lb,
  }
}

/**
 * deps: { runCached(scenario), sweepCached(scenario, levels), presets(), key, appUrl, now }
 */
export async function buildReportData(scenario, { project = '', runCached, sweepCached, presets, key, appUrl, now = new Date() }) {
  const others = GLASSES.filter((g) => g.key !== scenario.glass)
  const [main, p, ...rest] = await Promise.all([
    runCached(scenario),
    presets().catch(() => null),
    ...others.map((g) => runCached({ ...scenario, glass: g.key })),
    ...GLASSES.map((g) => sweepCached({ ...scenario, glass: g.key }, RH_LEVELS)),
  ])
  const otherRuns = rest.slice(0, others.length)
  const sweeps = rest.slice(others.length)
  const runFor = (gk) => (gk === scenario.glass ? main : otherRuns[others.findIndex((g) => g.key === gk)])

  const r = main.result
  const lastYear = r.years[r.years.length - 1]
  const stats = yearStats(lastYear?.fog)
  const workStats = yearStats(lastYear?.fog, true)
  const glass = GLASSES.find((g) => g.key === scenario.glass)
  const existing = EXISTING.find((x) => x.key === scenario.ex)
  const th = thermalOf(scenario.ex, scenario.glass)

  return {
    id: reportId(key),
    generated_at: now.toISOString(),
    app_version: APP_VERSION,
    engine_version: p?.version ?? main.engine?.version ?? null,
    project,
    link: appUrl,
    site: {
      query: scenario.addr,
      matched: main.engine.site,
      picked: scenario.lat !== null,
      location: main.engine.location,
      weather: main.engine.weather,
      weather_cell: main.engine.weather_cell,
      station_id: main.engine.station_id,
      climate: main.engine.climate,
    },
    config: {
      existing: { key: existing.key, label: existing.label },
      glass: { key: glass.key, label: glass.label, product: glass.product },
      thermal: th,
      seal_out: sealInfo(SEALS_EXISTING, scenario.seal_out, p?.meta?.al_out),
      seal_in: sealInfo(SEALS_RETROFIT, scenario.seal_in, p?.meta?.al_in),
      lb: scenario.lb,
      grams: Math.round(scenario.lb * GRAMS_PER_LB),
      t: scenario.t,
      rh: scenario.rh,
      dew_f: Math.round(dewPointF(scenario.t, scenario.rh) * 10) / 10,
      fixed: FIXED_DESCRIPTION,
      // The page says "hover a glass button"; on paper the values are on page 3.
      assumptions: ASSUMPTIONS.map((a) => a.replace(' (hover a glass button to see them)', ' (page 3 lists them)')),
    },
    result: r,
    headline: {
      sentences: summarize(r),
      cards: headlineCards(r),
      working_cards: headlineCards(r, { working: true }),
    },
    year: {
      index: r.years.length - 1,
      number: r.years.length,
      stats,
      working_stats: workStats,
      monthly_fog_days: monthlyFogDays(lastYear?.fog),
      working_hours: WORKING_HOURS,
    },
    options: GLASSES.map((g, i) => {
      const run = runFor(g.key)
      return {
        key: g.key,
        label: g.label,
        product: g.product,
        selected: g.key === scenario.glass,
        thermal: thermalOf(scenario.ex, g.key),
        ...summaryOf(run.result),
        sweep: sweeps[i],
        headroom: headroomOf(sweeps[i]),
      }
    }),
    rh_levels: RH_LEVELS,
    month_names: MONTH_SHORT,
    hours_per_year: HOURS_PER_YEAR,
  }
}
