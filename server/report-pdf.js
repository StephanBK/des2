// The customer report as a PDF, drawn with @react-pdf/renderer (pure Node,
// no browser). Input: the object from report-data.js. Output: a Buffer.
//
// Plain JavaScript (no JSX build step on the server): h() is
// React.createElement. Three Letter pages (a 4th, method and limits, was
// removed at Stephan's request 2026-10-15):
//   1. summary      site, outlook, key numbers, configuration
//   2. calendar     when the pane fogs, by hour and by month; desiccant
//   3. glass        the picked retrofit glass, site climate, how it works
// Anas 2026-10-17: with 0 lb of desiccant the report never mentions
// desiccant; the ENTERED note and tags, the U asterisk, the options footnotes,
// the humidity headroom chart and every "clear up to X %" line are gone.
// Stephan 2026-10-26 (v2.10): only the glass the user picked (no three-glass
// strip or table), no "Reading the results" section, building pressure shown.
//
// The font has no arrows or comparison signs: text uses words for those.

import { createElement as h } from 'react'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  Document, Font, Image, Line, Page, Path, Rect, renderToBuffer, StyleSheet, Svg, Text, View,
} from '@react-pdf/renderer'
import {
  formatDate, formatDays, formatDuration, HOURS_PER_YEAR, MONTH_SHORT, MONTH_START_DAY, remainingOnDay,
} from '../shared/story.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(HERE, '..')
const FONT_DIR = resolve(ROOT, 'node_modules/@fontsource/archivo/files')
const MARK = resolve(ROOT, 'web/public/inovues-mark.png')
const WORDMARK = resolve(ROOT, 'web/public/inovues-wordmark.png')

let fontsReady = false
function registerFonts() {
  if (fontsReady) return
  Font.register({
    family: 'Archivo',
    fonts: [400, 500, 600, 700].map((w) => ({ src: resolve(FONT_DIR, `archivo-latin-${w}-normal.woff`), fontWeight: w })),
  })
  Font.registerHyphenationCallback((word) => [word])
  fontsReady = true
}

// ------------------------------------------------------------ palette (same as the page)
const C = {
  page: '#f7f9fa', surface: '#ffffff', line: '#d5dee4', lineSoft: '#e6ecf0',
  ink: '#13232f', ink2: '#4a5f6e', ink3: '#7e919e',
  teal: '#138fa3', tealInk: '#0c6e7e', tealSoft: '#dcf0f3', tealLine: '#b5dfe6',
  fog: '#2e62b3', fogInk: '#1d4789', fogSoft: '#e5edf9', fogLine: '#c4d4ef',
  amber: '#d9a21c', amberInk: '#6b4a07', amberSoft: '#fdf5e3',
}
const GLASS_COLOR = { single: '#7e919e', double: '#138fa3', vig: '#2e62b3' }
const CLEAR = [231, 235, 238]
const DRY_FRESH = [120, 196, 207]
const DRY_SPENT = [205, 234, 238]
const FOG_LIGHT = [150, 180, 228]
const FOG_HEAVY = [22, 58, 124]
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
const fogColor = (level) => hex(mix(FOG_LIGHT, FOG_HEAVY, (level - 1) / 8))

const W = 612            // Letter, points
const M = 44             // side margin
const CW = W - 2 * M     // content width, 524

const s = StyleSheet.create({
  page: { fontFamily: 'Archivo', fontSize: 9.5, color: C.ink, paddingTop: 40, paddingBottom: 58, paddingHorizontal: M, lineHeight: 1.4 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  brand: { flexDirection: 'row', alignItems: 'center' },
  kicker: { fontSize: 7.5, fontWeight: 600, letterSpacing: 1.4, color: C.ink3, textAlign: 'right' },
  kickerSub: { fontSize: 8, color: C.ink3, textAlign: 'right', marginTop: 2 },
  rule: { height: 2, backgroundColor: C.teal, marginBottom: 14 },
  eyebrow: { fontSize: 8.5, fontWeight: 600, letterSpacing: 1.2, color: C.tealInk, marginBottom: 4 },
  h1: { fontSize: 25, fontWeight: 600, lineHeight: 1.15, letterSpacing: -0.3 },
  h1sub: { fontSize: 11.5, color: C.ink2, marginTop: 3 },
  h2: { fontSize: 14, fontWeight: 600, marginBottom: 4, letterSpacing: -0.1 },
  h3: { fontSize: 10, fontWeight: 600, marginBottom: 5 },
  lead: { fontSize: 9.5, color: C.ink2, marginBottom: 12 },
  small: { fontSize: 8, color: C.ink3 },
  footer: { position: 'absolute', left: M, right: M, top: 792 - 44, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: C.ink3, borderTopWidth: 0.6, borderTopColor: C.line, paddingTop: 6 },
})

// ------------------------------------------------------------ small parts

function Footer({ data }) {
  const place = (data.site.matched || data.site.query).split(',').slice(0, 2).join(',')
  return h(View, { style: s.footer, fixed: true },
    h(Text, null, 'INOVUES, Inc.  ·  inovues.com  ·  SWR Condensation Assessment'),
    h(Text, null, `${place}  ·  Report ${data.id}`),
    h(Text, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }))
}

function TopBar({ data, title }) {
  return h(View, null,
    h(View, { style: s.top },
      h(View, { style: s.brand },
        h(Image, { src: MARK, style: { width: 11, height: 18, marginRight: 7 } }),
        h(Image, { src: WORDMARK, style: { width: 74, height: 14.4 } })),
      h(View, null,
        h(Text, { style: s.kicker }, title.toUpperCase()),
        h(Text, { style: s.kickerSub }, `Report ${data.id}  ·  ${longDate(data.generated_at)}`))),
    h(View, { style: s.rule }))
}

function SectionTitle({ children, lead }) {
  return h(View, { style: { marginBottom: 8 } },
    h(Text, { style: s.h2 }, children),
    lead ? h(Text, { style: { ...s.lead, marginBottom: 0 } }, lead) : null)
}

/** Inches as typed: 0.6 -> "0.6", 1.25 -> "1.25", 2 -> "2.0". */
function fmtIn(x) {
  return Number.isInteger(x) ? x.toFixed(1) : String(x)
}

function Tag({ text, tone = 'amber' }) {
  const t = tone === 'amber' ? { bg: C.amberSoft, fg: C.amberInk, bd: C.amber } : { bg: C.tealSoft, fg: C.tealInk, bd: C.teal }
  return h(Text, { style: { fontSize: 7, fontWeight: 600, color: t.fg, backgroundColor: t.bg, borderLeftWidth: 2, borderLeftColor: t.bd, paddingHorizontal: 4, paddingVertical: 1, marginLeft: 5 } }, text)
}

function KV({ k, v, extra }) {
  return h(View, { style: { flexDirection: 'row', paddingVertical: 3.3, borderBottomWidth: 0.6, borderBottomColor: C.lineSoft } },
    h(Text, { style: { width: 80, color: C.ink3, fontSize: 8.3 } }, k),
    h(View, { style: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' } },
      h(Text, { style: { fontSize: 8.8, fontWeight: 500, lineHeight: 1.3 } }, v),
      extra || null))
}

function Card({ c }) {
  const tone = c.tone === 'dry' ? { bg: C.tealSoft, bd: C.tealLine, top: C.teal, val: C.tealInk }
    : c.tone === 'fog' ? { bg: C.fogSoft, bd: C.fogLine, top: C.fog, val: C.fogInk }
      : { bg: C.surface, bd: C.line, top: C.ink3, val: C.ink2 }
  return h(View, { style: { flex: 1, backgroundColor: tone.bg, borderWidth: 0.8, borderColor: tone.bd, borderTopWidth: 3.5, borderTopColor: tone.top, borderRadius: 2, paddingVertical: 8, paddingHorizontal: 11 } },
    h(Text, { style: { fontSize: 8, color: C.ink2, minHeight: 20, lineHeight: 1.25 } }, c.label),
    h(Text, { style: { fontSize: 22, fontWeight: 600, color: tone.val, letterSpacing: -0.4, lineHeight: 1.15, marginTop: 2 } }, c.value),
    h(Text, { style: { fontSize: 8, color: C.ink2, marginTop: 2 } }, c.detail))
}

function Tile({ label, value, sub }) {
  return h(View, { style: { flex: 1, paddingVertical: 8, paddingHorizontal: 10, borderRightWidth: 0.6, borderRightColor: C.lineSoft } },
    h(Text, { style: { fontSize: 7, color: C.ink3, letterSpacing: 0.4 } }, label),
    h(Text, { style: { fontSize: 15, fontWeight: 600, marginTop: 3, letterSpacing: -0.2, lineHeight: 1.2 } }, value),
    sub ? h(Text, { style: { fontSize: 7.3, color: C.ink3, marginTop: 2, lineHeight: 1.25 } }, sub) : null)
}

function Tiles({ items }) {
  return h(View, { style: { flexDirection: 'row', borderWidth: 0.6, borderColor: C.line, borderRadius: 2, backgroundColor: C.surface } },
    ...items.map((t, i) => h(Tile, { key: i, ...t })))
}

function Bullets({ items, size = 8.6 }) {
  return h(View, null, ...items.map((t, i) => h(View, { key: i, style: { flexDirection: 'row', marginBottom: 2.6 } },
    h(Text, { style: { width: 10, fontSize: size, color: C.teal } }, '•'),
    h(Text, { style: { flex: 1, fontSize: size, color: C.ink2, lineHeight: 1.33 } }, t))))
}

// ------------------------------------------------------------ formatting

function longDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}
const fmt1 = (x) => (x === null || x === undefined ? 'n/a' : (Math.round(x * 10) / 10).toLocaleString('en-US'))
const fmt0 = (x) => (x === null || x === undefined ? 'n/a' : Math.round(x).toLocaleString('en-US'))
function cellText(cell) {
  if (!cell || !cell.every((x) => typeof x === 'number')) return 'n/a'
  return `${Math.abs(cell[0]).toFixed(2)}° ${cell[0] >= 0 ? 'N' : 'S'}, ${Math.abs(cell[1]).toFixed(2)}° ${cell[1] >= 0 ? 'E' : 'W'}`
}
function splitAddress(full) {
  const parts = String(full || '').split(',').map((x) => x.trim()).filter(Boolean)
  if (parts.length <= 1) return [parts[0] || '', '']
  return [parts[0], parts.slice(1).join(', ')]
}
/** "single pane", "double pane", "VIG": a label as it reads mid-sentence. */
const inSentence = (label) => (label === label.toUpperCase() ? label : label.toLowerCase())

/** The page-1 verdict: what a customer should take away, in one line. */
function verdictOf(data) {
  const r = data.result
  const n = data.options.find((o) => o.selected).fog_days_per_year
  if (n === 0 && r.first_fog_hour === null) return { clear: true, text: 'No visible condensation expected' }
  if (n === 0) return { clear: true, text: 'Clear in the settled year after early fog' }
  const days = `${n} ${n === 1 ? 'day' : 'days'} a year`
  if (r.lb > 0 && r.full_hour !== null && (r.first_fog_hour === null || r.first_fog_hour >= r.full_hour)) {
    return { clear: false, text: `Visible condensation on about ${days} once the desiccant is full` }
  }
  return { clear: false, text: `Visible condensation on about ${days}` }
}

function lifeText(o) {
  if (o.lb === 0) return 'No desiccant'
  if (o.full_hour === null) return `Over ${o.max_years} years`
  return `${formatDays(o.full_hour)} (${formatDuration(o.full_hour)})`
}
function firstFogText(o) {
  if (o.first_fog_hour === null) return 'None'
  return formatDate(o.first_fog_hour, true)
}

// ------------------------------------------------------------ page 1: summary

function SummaryPage({ data }) {
  const [street, rest] = splitAddress(data.site.matched || data.site.query)
  const cfg = data.config
  const v = verdictOf(data)
  const tone = v.clear ? { bg: C.tealSoft, bd: C.teal, ink: C.tealInk } : { bg: C.fogSoft, bd: C.fog, ink: C.fogInk }
  const verdict = v.text
  const est = cfg.thermal.u_estimate
  const seal = (x) => `${x.label}${x.cfm_ft2 !== null ? `, ${x.cfm_ft2} cfm/ft² at 75 Pa` : ''}`

  return h(Page, { size: 'LETTER', style: s.page },
    h(TopBar, { data, title: 'SWR Condensation Assessment' }),
    data.project ? h(Text, { style: s.eyebrow }, data.project.toUpperCase()) : null,
    h(Text, { style: s.h1 }, street),
    rest ? h(Text, { style: s.h1sub }, rest) : null,
    h(Text, { style: { fontSize: 9.5, color: C.ink2, marginTop: 8 } },
      // \u00a0 (no-break space) keeps each number on the same line as its unit.
      `Secondary window retrofit: existing ${inSentence(cfg.existing.label)} with an INOVUES ${cfg.glass.product} (${inSentence(cfg.glass.label)}) retrofit, ${cfg.lb ? `${cfg.lb}\u00a0lb of desiccant, ` : ''}room at ${cfg.t}\u00a0°F ${cfg.hum?.key === 'none' ? 'without humidification' : `and ${cfg.rh}\u00a0% RH`}.`),

    h(View, { style: { marginTop: 13, backgroundColor: tone.bg, borderLeftWidth: 4, borderLeftColor: tone.bd, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 2 } },
      h(Text, { style: { fontSize: 7.5, fontWeight: 600, letterSpacing: 1.2, color: tone.ink } }, 'OUTLOOK FOR A TYPICAL YEAR'),
      h(Text, { style: { fontSize: 15, fontWeight: 600, color: tone.ink, marginTop: 3, letterSpacing: -0.2, lineHeight: 1.22 } }, verdict),
      h(Text, { style: { fontSize: 9.5, color: C.ink, marginTop: 5 } }, data.headline.sentences.join(' '))),

    h(View, { style: { flexDirection: 'row', gap: 10, marginTop: 12 } }, ...data.headline.cards.map((c) => h(Card, { key: c.key, c }))),
    h(Text, { style: { ...s.small, marginTop: 6 } },
      `Simulated hour by hour over ${data.result.years_run === 1 ? 'one year' : `${data.result.years_run} years`} of the site's typical weather, from installation on January 1. "Per year" figures are year ${data.year.number} of the run.`),

    h(View, { style: { marginTop: 14, flexDirection: 'row', gap: 22 } },
      h(View, { style: { flex: 1 } },
        h(Text, { style: s.h3 }, 'Site'),
        h(KV, { k: 'Location', v: data.site.location ? cellText([data.site.location.lat, data.site.location.lon]) : 'n/a' }),
        h(KV, { k: 'Weather data', v: 'NREL NSRDB typical year' }),
        h(KV, { k: 'Weather cell', v: cellText(data.site.weather_cell) }),
        h(KV, { k: 'Facade', v: `${cfg.facade.label}-facing` }),
        h(KV, { k: 'Window', v: `${cfg.window.width} × ${cfg.window.height} in, ${cfg.building?.changed ? `floor ${cfg.building.wfloor} of ${cfg.building.floors}` : 'at mid-height'}` }),
        h(KV, { k: 'Building pressure', v: `${cfg.pressure.text} HVAC, ${cfg.pressure.hours}` })),
      h(View, { style: { flex: 1 } },
        h(Text, { style: s.h3 }, 'Window assembly'),
        h(KV, { k: 'Existing glass', v: cfg.existing.label }),
        h(KV, { k: 'Retrofit glass', v: `${cfg.glass.product} (${cfg.glass.label})` }),
        // U last, so the ESTIMATE tag sits right after the value it qualifies.
        h(KV, { k: 'Thermal values', v: `f ${cfg.thermal.f_cold.toFixed(3)}, U ${cfg.thermal.u_ip.toFixed(3)} Btu/hr·ft²·°F`, extra: est ? h(Tag, { text: 'ESTIMATE' }) : null }),
        h(KV, { k: 'Cavity', v: cfg.offset.changed ? `${fmtIn(cfg.offset.inches)} in; f and U as for ${fmtIn(cfg.offset.standard)} in` : `${fmtIn(cfg.offset.inches)} in between existing glass and retrofit` }),
        h(KV, { k: 'Existing seal', v: seal(cfg.seal_out) }),
        h(KV, { k: 'Retrofit seal', v: seal(cfg.seal_in) }),
        cfg.lb ? h(KV, { k: 'Desiccant', v: `${cfg.lb} lb (${cfg.grams.toLocaleString('en-US')} g) 3A molecular sieve` }) : null,
        h(KV, { k: 'Room air', v: roomAirText(cfg) }))),

    h(Glance, { data }),
    est ? h(View, { style: { marginTop: 9, backgroundColor: C.amberSoft, borderLeftWidth: 3, borderLeftColor: C.amber, paddingVertical: 4, paddingHorizontal: 8 } },
      h(Text, { style: { fontSize: 7.6, color: C.amberInk } },
        'ESTIMATE: the assembly U-value for an existing double pane is a heat-flow model estimate until a WINDOW result replaces it.'))
      : null,
    h(Footer, { data }))
}

// The picked retrofit glass in one strip (v2.10: only that one), details on page 3.
function Glance({ data }) {
  const o = data.options.find((x) => x.selected)
  return h(View, { style: { marginTop: 13 }, wrap: false },
    h(View, { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 } },
      h(Text, { style: s.h3 }, 'INOVUES retrofit glass at this site'),
      h(Text, { style: s.small }, 'Details on page 3')),
    h(View, { style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.2, borderColor: C.teal, borderRadius: 2, paddingVertical: 7, paddingHorizontal: 11, backgroundColor: C.tealSoft } },
      h(View, { style: { flexDirection: 'row', alignItems: 'center' } },
        h(View, { style: { width: 7, height: 7, borderRadius: 4, backgroundColor: GLASS_COLOR[o.key], marginRight: 6 } }),
        h(Text, { style: { fontSize: 10, fontWeight: 600 } }, o.product),
        h(Text, { style: { fontSize: 8.5, color: C.ink2, marginLeft: 5 } }, o.label)),
      h(Text, { style: { fontSize: 13, fontWeight: 600, color: o.fog_days_per_year ? C.fogInk : C.tealInk } },
        `${o.fog_days_per_year} fog ${o.fog_days_per_year === 1 ? 'day' : 'days'} a year`)))
}

// ------------------------------------------------------------ page 2: calendar

function Heatmap({ data, width }) {
  const r = data.result
  const yi = data.year.index
  const fog = r.years[yi].fog
  const left = 26
  const top = 5
  const mapW = width - left
  const rowH = 4.3
  const mapH = 24 * rowH
  const dw = mapW / 365
  const y0h = yi * HOURS_PER_YEAR
  const working = (gh) => r.lb > 0 && (r.full_hour === null || gh < r.full_hour)
  const els = []
  for (let d = 0; d < 365; d++) {
    const rem = remainingOnDay(r.daily_loading_pct[yi * 365 + d])
    const base = working(y0h + d * 24 + 12) ? hex(mix(DRY_SPENT, DRY_FRESH, rem)) : hex(CLEAR)
    els.push(h(Rect, { key: `b${d}`, x: left + d * dw, y: top, width: dw + 0.05, height: mapH, fill: base }))
    if (!fog) continue
    let hr = 0
    while (hr < 24) {
      const l = fog.charCodeAt(d * 24 + hr) - 48
      if (l <= 0) { hr++; continue }
      let e = hr
      while (e + 1 < 24 && fog.charCodeAt(d * 24 + e + 1) - 48 === l) e++
      els.push(h(Rect, { key: `f${d}-${hr}`, x: left + d * dw, y: top + hr * rowH, width: dw + 0.05, height: (e - hr + 1) * rowH, fill: fogColor(l) }))
      hr = e + 1
    }
  }
  // month dividers and labels, hour labels, working-hours guides
  for (let m = 1; m < 12; m++) {
    const x = left + MONTH_START_DAY[m] * dw
    els.push(h(Line, { key: `m${m}`, x1: x, y1: top, x2: x, y2: top + mapH, stroke: '#ffffff', strokeWidth: 0.7 }))
  }
  for (const hh of [8, 18]) {
    els.push(h(Line, { key: `w${hh}`, x1: left, y1: top + hh * rowH, x2: left + mapW, y2: top + hh * rowH, stroke: C.ink, strokeWidth: 0.4, strokeDasharray: '1.5 1.5', strokeOpacity: 0.45 }))
  }
  const labels = []
  for (const hh of [0, 6, 12, 18]) labels.push(h(Text, { key: `h${hh}`, x: left - 4, y: top + hh * rowH + 3.2, style: { fontSize: 6.5 }, fill: C.ink3, textAnchor: 'end' }, `${String(hh).padStart(2, '0')}:00`))
  for (let m = 0; m < 12; m++) {
    const d1 = m === 11 ? 365 : MONTH_START_DAY[m + 1]
    labels.push(h(Text, { key: `ml${m}`, x: left + ((MONTH_START_DAY[m] + d1) / 2) * dw, y: top + mapH + 10, style: { fontSize: 7 }, fill: C.ink2, textAnchor: 'middle' }, MONTH_SHORT[m]))
  }
  return h(Svg, { width, height: top + mapH + 14, viewBox: `0 0 ${width} ${top + mapH + 14}` }, ...els, ...labels)
}

function LegendRow({ lb }) {
  const sw = (fill, key) => h(View, { key, style: { width: 14, height: 8, backgroundColor: fill, marginRight: 4 } })
  const item = (swatches, text, key) => h(View, { key, style: { flexDirection: 'row', alignItems: 'center', marginRight: 16 } }, ...swatches, h(Text, { style: { fontSize: 7.5, color: C.ink2 } }, text))
  return h(View, { style: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 } },
    item([sw(hex(CLEAR), 'c')], 'Clear', 'a'),
    lb > 0 ? item([sw(hex(DRY_FRESH), 'd1'), sw(hex(DRY_SPENT), 'd2')], 'Clear, desiccant working (fresh to nearly full)', 'b') : null,
    item([sw(fogColor(1), 'f1'), sw(fogColor(5), 'f5'), sw(fogColor(9), 'f9')], 'Visible fog, light to heavy', 'c'),
    item([h(View, { key: 'l', style: { width: 14, borderTopWidth: 0.8, borderTopColor: C.ink3, borderStyle: 'dashed', marginRight: 4 } })], 'Working hours 08:00 to 18:00', 'd'))
}

function MonthBars({ values, width, height }) {
  const left = 18
  const bottom = 14
  const max = Math.max(31, ...values)
  const bw = (width - left) / 12
  const els = [
    h(Line, { key: 'ax', x1: left, y1: height - bottom, x2: width, y2: height - bottom, stroke: C.line, strokeWidth: 0.8 }),
  ]
  for (const t of [0, 10, 20, 30]) {
    const y = height - bottom - (t / max) * (height - bottom - 8)
    els.push(h(Line, { key: `g${t}`, x1: left, y1: y, x2: width, y2: y, stroke: C.lineSoft, strokeWidth: 0.6 }))
    els.push(h(Text, { key: `gt${t}`, x: left - 3, y: y + 2.3, style: { fontSize: 6.5 }, fill: C.ink3, textAnchor: 'end' }, String(t)))
  }
  values.forEach((v, m) => {
    const bh = (v / max) * (height - bottom - 8)
    const x = left + m * bw + bw * 0.18
    if (v > 0) els.push(h(Rect, { key: `b${m}`, x, y: height - bottom - bh, width: bw * 0.64, height: bh, fill: C.fog }))
    els.push(h(Text, { key: `l${m}`, x: left + m * bw + bw / 2, y: height - 3, style: { fontSize: 6.8 }, fill: C.ink2, textAnchor: 'middle' }, MONTH_SHORT[m]))
    if (v > 0) els.push(h(Text, { key: `v${m}`, x: left + m * bw + bw / 2, y: height - bottom - bh - 2.5, style: { fontSize: 6.5 }, fill: C.fogInk, textAnchor: 'middle' }, String(v)))
  })
  return h(Svg, { width, height, viewBox: `0 0 ${width} ${height}` }, ...els)
}

function LoadingChart({ data, width, height }) {
  const r = data.result
  const pts = r.daily_loading_pct
  const left = 22
  const bottom = 14
  const n = pts.length
  const xOf = (d) => left + (d / Math.max(1, n - 1)) * (width - left - 4)
  const yOf = (p) => (height - bottom) - (Math.min(100, Math.max(0, p)) / 100) * (height - bottom - 6)
  const step = Math.max(1, Math.floor(n / 600))
  let line = ''
  for (let d = 0; d < n; d += step) line += `${line ? 'L' : 'M'}${xOf(d).toFixed(2)} ${yOf(pts[d]).toFixed(2)} `
  line += `L${xOf(n - 1).toFixed(2)} ${yOf(pts[n - 1]).toFixed(2)}`
  const area = `${line} L${xOf(n - 1).toFixed(2)} ${yOf(0).toFixed(2)} L${xOf(0).toFixed(2)} ${yOf(0).toFixed(2)} Z`
  const els = []
  for (const t of [0, 50, 95]) {
    els.push(h(Line, { key: `g${t}`, x1: left, y1: yOf(t), x2: width - 4, y2: yOf(t), stroke: t === 95 ? C.teal : C.lineSoft, strokeWidth: t === 95 ? 0.7 : 0.6, strokeDasharray: t === 95 ? '2 2' : undefined }))
    els.push(h(Text, { key: `gt${t}`, x: left - 3, y: yOf(t) + 2.3, style: { fontSize: 6.5 }, fill: C.ink3, textAnchor: 'end' }, `${t}%`))
  }
  els.push(h(Path, { key: 'area', d: area, fill: C.tealSoft }))
  els.push(h(Path, { key: 'line', d: line, stroke: C.teal, strokeWidth: 1.3, fill: 'none' }))
  const years = Math.round(n / 365)
  for (let y = 0; y <= years; y++) {
    const x = xOf(Math.min(n - 1, y * 365))
    els.push(h(Text, { key: `yl${y}`, x, y: height - 3, style: { fontSize: 6.5 }, fill: C.ink3, textAnchor: y === 0 ? 'start' : y === years ? 'end' : 'middle' }, y === 0 ? 'Install' : `Year ${y}`))
  }
  if (r.first_fog_hour !== null) {
    const x = xOf(Math.min(n - 1, r.first_fog_hour / 24))
    els.push(h(Line, { key: 'ff', x1: x, y1: 6, x2: x, y2: height - bottom, stroke: C.fog, strokeWidth: 0.8 }))
    const leftSide = x > width * 0.55
    els.push(h(Text, { key: 'fft', x: leftSide ? x - 3 : x + 3, y: yOf(22), style: { fontSize: 6.5 }, fill: C.fogInk, textAnchor: leftSide ? 'end' : 'start' }, 'First visible fog'))
  }
  return h(Svg, { width, height, viewBox: `0 0 ${width} ${height}` }, ...els)
}

function CalendarPage({ data }) {
  const amount = data.headline.cards.find((c) => c.key === 'amount')
  const st = data.year.stats
  const ws = data.year.working_stats
  const lb = data.result.lb
  // The card detail goes mid-sentence here, so its first letter is lowered
  // ("(the pane stays clear)", not "(The pane stays clear)").
  const basis = amount.detail.replace(/^Year \d+, /, '').replace(/, out of.*$/, '') || 'the reported year'
  const basisText = basis.charAt(0).toLowerCase() + basis.slice(1)
  return h(Page, { size: 'LETTER', style: s.page },
    h(TopBar, { data, title: 'When the pane fogs' }),
    h(SectionTitle, { lead: `Every hour of year ${data.year.number} of the simulation (${basisText}). Columns are days, rows are hours of the day, midnight at the top. Fog means a water film on the cavity side of the existing glass thick enough to see.` }, 'Hour by hour, through the year'),
    h(Heatmap, { data, width: CW }),
    h(LegendRow, { lb }),

    h(View, { style: { marginTop: 14 } },
      h(Tiles, {
        items: [
          { label: 'DAYS WITH VISIBLE FOG', value: fmt0(st.days), sub: `${fmt0(ws.days)} of them in working hours` },
          { label: 'HOURS OF VISIBLE FOG', value: fmt0(st.hours), sub: `${fmt0(ws.hours)} in working hours` },
          { label: 'SEPARATE FOG EVENTS', value: fmt0(st.events), sub: 'unbroken runs of fog hours' },
          { label: 'LONGEST EVENT', value: st.longest ? `${fmt0(st.longest)} h` : 'None', sub: st.longest ? 'hours in a row' : 'the pane stays clear' },
        ],
      })),

    // With desiccant: fog by month and desiccant loading side by side. Without
    // (Anas 2026-10-17): fog by month alone, full width, no desiccant panel.
    lb > 0
      ? h(View, { style: { flexDirection: 'row', gap: 20, marginTop: 18 } },
        h(View, { style: { flex: 1 } },
          h(Text, { style: s.h3 }, 'Fog days by month'),
          h(MonthBars, { values: data.year.monthly_fog_days, width: (CW - 20) / 2, height: 120 }),
          h(Text, { style: { ...s.small, marginTop: 4 } }, 'Days with at least one hour of visible fog, same year as above.')),
        h(View, { style: { flex: 1 } },
          h(Text, { style: s.h3 }, 'Desiccant loading'),
          h(LoadingChart, { data, width: (CW - 20) / 2, height: 120 }),
          h(Text, { style: { ...s.small, marginTop: 4 } }, 'Share of the desiccant\'s capacity used, day by day since installation. It counts as full at 95 %.')))
      : h(View, { style: { marginTop: 18 } },
        h(Text, { style: s.h3 }, 'Fog days by month'),
        h(MonthBars, { values: data.year.monthly_fog_days, width: CW, height: 120 }),
        h(Text, { style: { ...s.small, marginTop: 4 } }, 'Days with at least one hour of visible fog, same year as above.')),

    // "Reading the results" (heading and bullets) removed in v2.10 (Stephan 2026-10-26).
    h(Footer, { data }))
}

// ------------------------------------------------------------ page 3: options

function OptionsTable({ data }) {
  // Anas 2026-10-17: no "long term by room humidity" column, no ENTERED tag or
  // estimate asterisk, and no desiccant column when there is no desiccant.
  // The columns that remain share the full content width.
  const withDesiccant = data.config.lb > 0
  const base = [
    { k: 'glass', label: 'Retrofit glass', w: 100 },
    { k: 'u', label: 'Assembly U\nBtu/hr·ft²·°F', w: 70 },
    { k: 'f', label: 'Glass\nfactor f', w: 56 },
    ...(withDesiccant ? [{ k: 'life', label: 'Desiccant keeps\nthe cavity dry for', w: 100 }] : []),
    { k: 'first', label: 'First visible\nfog', w: 100 },
    { k: 'days', label: 'Fog days\nper year', w: 60 },
  ]
  const total = base.reduce((a, c) => a + c.w, 0)
  const cols = base.map((c) => ({ ...c, w: (c.w * CW) / total }))
  const W = Object.fromEntries(cols.map((c) => [c.k, c.w]))
  const head = h(View, { style: { flexDirection: 'row', borderBottomWidth: 0.8, borderBottomColor: C.ink3, paddingBottom: 4 } },
    ...cols.map((c) => h(Text, { key: c.k, style: { width: c.w, fontSize: 7.2, color: C.ink3, fontWeight: 500, paddingRight: 6 } }, c.label)))
  const rows = data.options.map((o) => {
    const cell = (k, txt, extra = {}) => h(Text, { key: k, style: { width: W[k], fontSize: 8.6, paddingRight: 6, lineHeight: 1.3, ...extra } }, txt)
    return h(View, { key: o.key, style: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 0.6, borderBottomColor: C.lineSoft, backgroundColor: o.selected ? C.tealSoft : undefined } },
      h(View, { style: { width: W.glass, flexDirection: 'row', alignItems: 'center' } },
        h(View, { style: { width: 3, height: 22, backgroundColor: o.selected ? C.teal : 'transparent', marginRight: 6 } }),
        h(View, { style: { width: 7, height: 7, borderRadius: 4, backgroundColor: GLASS_COLOR[o.key], marginRight: 5 } }),
        h(View, null,
          h(Text, { style: { fontSize: 8.8, fontWeight: 600 } }, o.product),
          h(Text, { style: { fontSize: 7, color: C.ink3 } }, o.label))),
      cell('u', o.thermal.u_ip.toFixed(3)),
      cell('f', o.thermal.f_cold.toFixed(3)),
      withDesiccant ? cell('life', lifeText(o)) : null,
      cell('first', firstFogText(o)),
      cell('days', String(o.fog_days_per_year), { fontWeight: 600, color: o.fog_days_per_year ? C.fogInk : C.tealInk }))
  })
  return h(View, null, head, ...rows)
}

/**
 * How the assessment works (Anas 2026-10-17): a short note on the method and
 * the reasoning behind it, before the disclaimer. Without desiccant it says
 * nothing about desiccant.
 */
/** Room air row on page 1: the set RH and its dew point, or (no humidification) the simulated heating-season RH. */
export function roomAirText(cfg) {
  if (cfg.hum?.key !== 'none') return `${cfg.t} °F, ${cfg.rh} % RH, dew point ${fmt0(cfg.dew_f)} °F`
  const r = cfg.room
  return r && r.median_pct != null
    ? `${cfg.t} °F, no humidification; heating season about ${Math.round(r.median_pct)} % RH (${Math.round(r.p10_pct)} to ${Math.round(r.p90_pct)} %)`
    : `${cfg.t} °F, no humidification (outdoor moisture plus occupants)`
}

export function methodItems(data) {
  const lb = data.config.lb
  const facing = data.config.facade.label.toLowerCase()
  const article = /^[aeiou]/.test(facing) ? 'an' : 'a'
  return [
    `Weather: the site's typical meteorological year from NREL's National Solar Radiation Database for the nearest grid cell, repeated each year.`,
    `Glass temperature: every hour, the cavity side of the existing glass is set by the outdoor and room temperatures and the glass factor f of this pairing of existing and retrofit glass (from WINDOW thermal analysis)${data.config.facade.key === 'north' ? '; a north-facing window gets little direct sun' : `, plus the sun on ${article} ${facing}-facing window`}.`,
    `Moisture: air reaches the cavity through the existing window seal and the retrofit seal, driven by building pressurization, stack effect and wind, and water vapor diffuses through the sealant beads.${lb > 0 ? ' The desiccant takes up water until it is full.' : ''} An hourly moisture balance gives the dew point of the cavity air.`,
    ...(data.config.hum?.key === 'none'
      ? [`Room air: the building has no humidifier, so every hour the room air carries the outdoor air's moisture plus what office occupants add (about ${data.config.people_gkg} g of water per kg of air while occupied, fading after hours).`]
      : []),
    'Fog: when the glass is colder than that dew point, water condenses on it. A film thicker than an estimated visibility threshold of about 5 µm counts as visible fog; it clears as the glass warms and the water evaporates.',
    lb > 0
      ? `Run: hour by hour from installation on January 1 until the desiccant is full, plus one more year (at most ${data.result.max_years} years); the per-year figures come from the last simulated year.`
      : 'Run: hour by hour for two years from installation on January 1. Year 1 starts from a clean pane, so the per-year figures come from year 2, the settled year.',
  ]
}

function MethodNote({ data }) {
  return h(View, { style: { marginTop: 14 }, wrap: false },
    h(SectionTitle, null, 'How this assessment works'),
    h(Bullets, { items: methodItems(data), size: 8.2 }))
}

function OptionsPage({ data }) {
  const cl = data.site.climate || {}
  const lb = data.config.lb
  return h(Page, { size: 'LETTER', style: s.page },
    h(TopBar, { data, title: 'Retrofit glass and site climate' }),
    h(SectionTitle, { lead: `The INOVUES retrofit glass in this report, over the existing ${data.config.existing.label.toLowerCase()}, with the seals${lb > 0 ? ', desiccant' : ''} and room air on page 1.` }, 'Retrofit glass'),
    h(OptionsTable, { data }),

    h(View, { style: { marginTop: 18 }, wrap: false },
      h(SectionTitle, { lead: `From the typical weather year the simulation uses: NREL ${data.site.weather || 'NSRDB'}, grid cell ${cellText(data.site.weather_cell)}.` }, 'Site climate'),
      h(Tiles, {
        items: [
          { label: 'COLDEST HOUR', value: `${fmt0(cl.coldest_f)} °F`, sub: 'of the typical year' },
          { label: 'WARMEST HOUR', value: `${fmt0(cl.warmest_f)} °F`, sub: 'of the typical year' },
          { label: 'ANNUAL MEAN', value: `${fmt1(cl.mean_f)} °F`, sub: 'outdoor air' },
          { label: 'DEGREE DAYS', value: fmt0(cl.hdd65), sub: 'heating, base 65 °F' },
          { label: 'FREEZING DAYS', value: fmt0(cl.freezing_days), sub: 'daily mean under 32 °F' },
        ],
      })),
    h(MethodNote, { data }),
    h(Disclaimer),
    h(Footer, { data }))
}

// Liability disclaimer, last thing in the report (2026-10-15, after the
// method page was removed). Wording to be reviewed by INOVUES counsel.
export const DISCLAIMER = 'Disclaimer: Computer-model estimates for a typical weather year, based on the inputs and assumptions shown, some of them estimated. Actual performance depends on weather, installation, building operation and maintenance, and may differ. For planning and comparison only; not a warranty, guarantee or certified engineering analysis. Product warranties are governed solely by INOVUES\' written warranty and contract terms. INOVUES, Inc. accepts no liability for decisions made or losses incurred in reliance on this report.'

function Disclaimer() {
  return h(View, { style: { marginTop: 10, borderTopWidth: 0.6, borderTopColor: C.line, paddingTop: 5 }, wrap: false },
    h(Text, { style: { fontSize: 6.8, color: C.ink3, lineHeight: 1.35 } }, DISCLAIMER))
}

export async function renderReportPdf(data) {
  registerFonts()
  const doc = h(Document, {
    title: `SWR Condensation Assessment: ${data.site.matched || data.site.query}`,
    author: 'INOVUES, Inc.',
    subject: 'SWR Condensation Assessment: secondary window retrofit cavity condensation',
    creator: `INOVUES SWR Condensation Assessment ${data.app_version}`,
    producer: 'INOVUES',
  },
  h(SummaryPage, { data }),
  h(CalendarPage, { data }),
  h(OptionsPage, { data }))
  return renderToBuffer(doc)
}
