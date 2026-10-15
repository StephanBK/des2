// The customer report as a PDF, drawn with @react-pdf/renderer (pure Node,
// no browser). Input: the object from report-data.js. Output: a Buffer.
//
// Plain JavaScript (no JSX build step on the server): h() is
// React.createElement. Four Letter pages:
//   1. summary      site, outlook, three key numbers, configuration
//   2. calendar     when the pane fogs, by hour and by month; desiccant
//   3. options      the three retrofit glasses, humidity headroom, climate
//   4. method       how it works, data, assumptions, limits, reproduce
//
// The font has no arrows or comparison signs: text uses words for those.

import { createElement as h } from 'react'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  Circle, Document, Font, Image, Line, Link, Page, Path, Rect, renderToBuffer, StyleSheet, Svg, Text, View,
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
    h(Text, null, 'INOVUES, Inc.  ·  inovues.com  ·  Cavity condensation assessment'),
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
function headroomText(o) {
  if (o.headroom.all_clear) return 'Clear at every level tested (to 60 %)'
  if (o.headroom.clear_up_to === null) return 'Fogs even at 20 %'
  return `Clear up to ${o.headroom.clear_up_to} %`
}

// ------------------------------------------------------------ page 1: summary

function SummaryPage({ data }) {
  const [street, rest] = splitAddress(data.site.matched || data.site.query)
  const cfg = data.config
  const v = verdictOf(data)
  const tone = v.clear ? { bg: C.tealSoft, bd: C.teal, ink: C.tealInk } : { bg: C.fogSoft, bd: C.fog, ink: C.fogInk }
  const verdict = v.text
  const est = cfg.thermal.estimate
  const seal = (x) => `${x.label}${x.cfm_ft2 !== null ? `, ${x.cfm_ft2} cfm/ft² at 75 Pa` : ''}`

  return h(Page, { size: 'LETTER', style: s.page },
    h(TopBar, { data, title: 'Cavity condensation assessment' }),
    data.project ? h(Text, { style: s.eyebrow }, data.project.toUpperCase()) : null,
    h(Text, { style: s.h1 }, street),
    rest ? h(Text, { style: s.h1sub }, rest) : null,
    h(Text, { style: { fontSize: 9.5, color: C.ink2, marginTop: 8 } },
      // \u00a0 (no-break space) keeps each number on the same line as its unit.
      `Secondary window retrofit: existing ${inSentence(cfg.existing.label)} with an INOVUES ${cfg.glass.product} (${inSentence(cfg.glass.label)}) retrofit, ${cfg.lb ? `${cfg.lb}\u00a0lb of desiccant` : 'no desiccant'}, room at ${cfg.t}\u00a0°F and ${cfg.rh}\u00a0% RH.`),

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
        h(KV, { k: 'Facade', v: 'North, no sun on the glass' }),
        h(KV, { k: 'Window', v: '60 × 96 in, at mid-height' })),
      h(View, { style: { flex: 1 } },
        h(Text, { style: s.h3 }, 'Window assembly'),
        h(KV, { k: 'Existing glass', v: cfg.existing.label }),
        h(KV, { k: 'Retrofit glass', v: `${cfg.glass.product} (${cfg.glass.label})` }),
        h(KV, { k: 'Thermal values', v: `U ${cfg.thermal.u_ip.toFixed(3)} Btu/hr·ft²·°F, f ${cfg.thermal.f_cold.toFixed(3)}`, extra: est ? h(Tag, { text: 'ESTIMATE' }) : null }),
        h(KV, { k: 'Cavity', v: '0.6 in between existing glass and retrofit' }),
        h(KV, { k: 'Existing seal', v: seal(cfg.seal_out) }),
        h(KV, { k: 'Retrofit seal', v: seal(cfg.seal_in) }),
        h(KV, { k: 'Desiccant', v: cfg.lb ? `${cfg.lb} lb (${cfg.grams.toLocaleString('en-US')} g) 3A molecular sieve` : 'None' }),
        h(KV, { k: 'Room air', v: `${cfg.t} °F, ${cfg.rh} % RH, dew point ${fmt0(cfg.dew_f)} °F` }))),

    h(Glance, { data }),
    est ? h(View, { style: { marginTop: 9, backgroundColor: C.amberSoft, borderLeftWidth: 3, borderLeftColor: C.amber, paddingVertical: 4, paddingHorizontal: 8 } },
      h(Text, { style: { fontSize: 7.6, color: C.amberInk } },
        'ESTIMATE: thermal values for an existing double pane come from a heat-flow model until LBNL WINDOW simulations replace them (page 4).'))
      : null,
    h(Footer, { data }))
}

// All three retrofit glasses in one strip, details on page 3.
function Glance({ data }) {
  return h(View, { style: { marginTop: 13 }, wrap: false },
    h(View, { style: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 } },
      h(Text, { style: s.h3 }, 'All three INOVUES retrofit glasses at this site'),
      h(Text, { style: s.small }, 'Details on page 3')),
    h(View, { style: { flexDirection: 'row', gap: 8 } },
      ...data.options.map((o) => h(View, { key: o.key, style: { flex: 1, borderWidth: o.selected ? 1.2 : 0.6, borderColor: o.selected ? C.teal : C.line, borderRadius: 2, paddingVertical: 7, paddingHorizontal: 9, backgroundColor: o.selected ? C.tealSoft : C.surface } },
        h(View, { style: { flexDirection: 'row', alignItems: 'center' } },
          h(View, { style: { width: 7, height: 7, borderRadius: 4, backgroundColor: GLASS_COLOR[o.key], marginRight: 5 } }),
          h(Text, { style: { fontSize: 9, fontWeight: 600 } }, o.product),
          h(Text, { style: { fontSize: 7.5, color: C.ink3, marginLeft: 4 } }, o.selected ? 'this report' : o.label)),
        h(Text, { style: { fontSize: 13, fontWeight: 600, marginTop: 3, color: o.fog_days_per_year ? C.fogInk : C.tealInk } },
          `${o.fog_days_per_year} fog ${o.fog_days_per_year === 1 ? 'day' : 'days'} a year`),
        h(Text, { style: { fontSize: 7.6, color: C.ink2, marginTop: 1 } }, `${headroomText(o)} room RH, long term`)))))
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

// What this year's fog looks like, in words that match the data above.
function fogPattern(st, ws) {
  const base = 'Fog forms when the cavity side of the existing glass is colder than the dew point of the air in the cavity, and clears as the glass warms.'
  if (st.hours === 0) return 'In this year the cavity side of the existing glass never stays below the cavity air\'s dew point long enough to fog.'
  if (st.longest >= 72) return `${base} Here, once it forms in winter it tends to stay: the longest unbroken event lasts ${formatDuration(st.longest)}, because the glass stays below that dew point for weeks.`
  const share = ws.hours / st.hours
  if (share < 0.25) return `${base} Most of it comes at night and early in the morning: only ${Math.round(share * 100)} % of fog hours fall in working hours.`
  return `${base} ${Math.round(share * 100)} % of fog hours fall in working hours (which are 30 % of all hours).`
}

function CalendarPage({ data }) {
  const amount = data.headline.cards.find((c) => c.key === 'amount')
  const st = data.year.stats
  const ws = data.year.working_stats
  const lb = data.result.lb
  return h(Page, { size: 'LETTER', style: s.page },
    h(TopBar, { data, title: 'When the pane fogs' }),
    h(SectionTitle, { lead: `Every hour of year ${data.year.number} of the simulation (${amount.detail.replace(/^Year \d+, /, '').replace(/, out of.*$/, '') || 'the reported year'}). Columns are days, rows are hours of the day, midnight at the top. Fog means a water film on the cavity side of the existing glass thick enough to see.` }, 'Hour by hour, through the year'),
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

    h(View, { style: { flexDirection: 'row', gap: 20, marginTop: 18 } },
      h(View, { style: { flex: 1 } },
        h(Text, { style: s.h3 }, 'Fog days by month'),
        h(MonthBars, { values: data.year.monthly_fog_days, width: (CW - 20) / 2, height: 120 }),
        h(Text, { style: { ...s.small, marginTop: 4 } }, 'Days with at least one hour of visible fog, same year as above.')),
      h(View, { style: { flex: 1 } },
        h(Text, { style: s.h3 }, 'Desiccant loading'),
        lb > 0
          ? h(LoadingChart, { data, width: (CW - 20) / 2, height: 120 })
          : h(View, { style: { height: 120, borderWidth: 0.6, borderColor: C.line, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', borderRadius: 2 } },
            h(Text, { style: { fontSize: 8.5, color: C.ink3 } }, 'No desiccant in this scenario')),
        h(Text, { style: { ...s.small, marginTop: 4 } }, lb > 0
          ? 'Share of the desiccant\'s capacity used, day by day since installation. It counts as full at 95 %.'
          : 'The cavity relies on its seals and the room air alone.'))),

    h(View, { style: { marginTop: 18, borderTopWidth: 0.6, borderTopColor: C.line, paddingTop: 10 } },
      h(Text, { style: s.h3 }, 'Reading the results'),
      h(Bullets, {
        items: [
          fogPattern(st, ws),
          lb > 0
            ? 'While the desiccant works, it keeps the cavity air dry. Once it is full, the cavity follows the outdoor and room air that leaks in through the seals, and the yearly pattern above repeats.'
            : 'Without desiccant, the cavity follows the outdoor and room air that leaks in through the seals. Year 1 starts from a clean pane and dry air, so the settled year 2 is reported.',
          'Room humidity matters most: page 3 shows how fog changes with room RH for each retrofit glass.',
        ],
      })),
    h(Footer, { data }))
}

// ------------------------------------------------------------ page 3: options

function HeadroomChart({ data, width, height }) {
  const left = 30
  const bottom = 20
  const top = 8
  const right = 6
  const levels = data.rh_levels
  const maxDays = Math.max(10, ...data.options.flatMap((o) => o.sweep.map((p) => p.fog_days)))
  const nice = maxDays <= 30 ? Math.ceil(maxDays / 5) * 5 : maxDays <= 120 ? Math.ceil(maxDays / 20) * 20 : Math.ceil(maxDays / 50) * 50
  const xOf = (rh) => left + ((rh - levels[0]) / (levels[levels.length - 1] - levels[0])) * (width - left - right)
  const yOf = (d) => top + (1 - d / nice) * (height - top - bottom)
  const els = []
  const ticks = nice <= 30 ? [0, nice / 2, nice] : [0, nice / 4, nice / 2, (3 * nice) / 4, nice]
  for (const t of ticks) {
    els.push(h(Line, { key: `g${t}`, x1: left, y1: yOf(t), x2: width - right, y2: yOf(t), stroke: t === 0 ? C.line : C.lineSoft, strokeWidth: 0.6 }))
    els.push(h(Text, { key: `gt${t}`, x: left - 4, y: yOf(t) + 2.3, style: { fontSize: 6.8 }, fill: C.ink3, textAnchor: 'end' }, String(Math.round(t))))
  }
  for (const rh of levels) {
    els.push(h(Text, { key: `x${rh}`, x: xOf(rh), y: height - 8, style: { fontSize: 6.8 }, fill: C.ink2, textAnchor: 'middle' }, `${rh}%`))
  }
  const chosen = data.config.rh
  if (chosen >= levels[0] && chosen <= levels[levels.length - 1]) {
    els.push(h(Line, { key: 'chosen', x1: xOf(chosen), y1: top, x2: xOf(chosen), y2: height - bottom, stroke: C.ink, strokeWidth: 0.7, strokeDasharray: '2 2' }))
    els.push(h(Text, { key: 'chosent', x: xOf(chosen) + 3, y: top + 7, style: { fontSize: 6.8 }, fill: C.ink }, `This room: ${chosen}%`))
  }
  const order = [...data.options].sort((a, b) => Number(a.selected) - Number(b.selected))
  for (const o of order) {
    const col = GLASS_COLOR[o.key]
    const d = o.sweep.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.rh).toFixed(2)} ${yOf(p.fog_days).toFixed(2)}`).join(' ')
    els.push(h(Path, { key: `l${o.key}`, d, stroke: col, strokeWidth: o.selected ? 2 : 1.1, fill: 'none', strokeOpacity: o.selected ? 1 : 0.75 }))
    o.sweep.forEach((p, i) => els.push(h(Circle, { key: `c${o.key}${i}`, cx: xOf(p.rh), cy: yOf(p.fog_days), r: o.selected ? 2 : 1.4, fill: col })))
  }
  els.push(h(Text, { key: 'xl', x: (left + width - right) / 2, y: height + 2, style: { fontSize: 6.8 }, fill: C.ink3, textAnchor: 'middle' }, ''))
  return h(Svg, { width, height, viewBox: `0 0 ${width} ${height}` }, ...els)
}

function OptionsTable({ data }) {
  const cols = [
    { k: 'glass', label: 'Retrofit glass', w: 90 },
    { k: 'u', label: 'Assembly U\nBtu/hr·ft²·°F', w: 58 },
    { k: 'f', label: 'Glass\nfactor f', w: 44 },
    { k: 'life', label: 'Desiccant keeps\nthe cavity dry for', w: 88 },
    { k: 'first', label: 'First visible\nfog', w: 84 },
    { k: 'days', label: 'Fog days\nper year', w: 44 },
    { k: 'head', label: 'Long term, by\nroom humidity', w: 116 },
  ]
  const head = h(View, { style: { flexDirection: 'row', borderBottomWidth: 0.8, borderBottomColor: C.ink3, paddingBottom: 4 } },
    ...cols.map((c) => h(Text, { key: c.k, style: { width: c.w, fontSize: 7.2, color: C.ink3, fontWeight: 500, paddingRight: 6 } }, c.label)))
  const rows = data.options.map((o) => {
    const cell = (k, txt, w, extra = {}) => h(Text, { key: k, style: { width: w, fontSize: 8.6, paddingRight: 6, lineHeight: 1.3, ...extra } }, txt)
    return h(View, { key: o.key, style: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 0.6, borderBottomColor: C.lineSoft, backgroundColor: o.selected ? C.tealSoft : undefined } },
      h(View, { style: { width: cols[0].w, flexDirection: 'row', alignItems: 'center' } },
        h(View, { style: { width: 3, height: 22, backgroundColor: o.selected ? C.teal : 'transparent', marginRight: 6 } }),
        h(View, { style: { width: 7, height: 7, borderRadius: 4, backgroundColor: GLASS_COLOR[o.key], marginRight: 5 } }),
        h(View, null,
          h(Text, { style: { fontSize: 8.8, fontWeight: 600 } }, o.product),
          h(Text, { style: { fontSize: 7, color: C.ink3 } }, o.selected ? `${o.label}, this report` : o.label))),
      cell('u', `${o.thermal.u_ip.toFixed(3)}${o.thermal.estimate ? '*' : ''}`, cols[1].w),
      cell('f', `${o.thermal.f_cold.toFixed(3)}${o.thermal.estimate ? '*' : ''}`, cols[2].w),
      cell('life', lifeText(o), cols[3].w),
      cell('first', firstFogText(o), cols[4].w),
      cell('days', String(o.fog_days_per_year), cols[5].w, { fontWeight: 600, color: o.fog_days_per_year ? C.fogInk : C.tealInk }),
      cell('head', headroomText(o), cols[6].w))
  })
  return h(View, null, head, ...rows)
}

function OptionsPage({ data }) {
  const cl = data.site.climate || {}
  const est = data.options.some((o) => o.thermal.estimate)
  const best = [...data.options].sort((a, b) => a.fog_days_per_year - b.fog_days_per_year || (b.headroom.clear_up_to ?? 0) - (a.headroom.clear_up_to ?? 0))[0]
  return h(Page, { size: 'LETTER', style: s.page },
    h(TopBar, { data, title: 'Options and humidity headroom' }),
    h(SectionTitle, { lead: `The same site, existing ${data.config.existing.label.toLowerCase()}, seals, desiccant and room air, with each INOVUES retrofit glass.` }, 'Retrofit glass options'),
    h(OptionsTable, { data }),
    h(Text, { style: { ...s.small, marginTop: 5 } },
      `Fog days per year are counted in the same simulation year as on page 1 for each option. ${est ? '* Estimate (existing double pane), pending WINDOW simulation. ' : ''}Fewest fog days in this comparison: ${best.product}.`),
    h(Text, { style: { ...s.small, marginTop: 3 } },
      'Why a better-insulating retrofit can fog more: it keeps more heat in the room, so the existing glass in front of it runs colder. That is expected physics, not a defect; the seals and desiccant decide how much moisture reaches that cold glass.'),

    h(View, { style: { marginTop: 14 }, wrap: false },
      h(SectionTitle, { lead: 'Visible fog days per year against room relative humidity, long term: without desiccant, which is also where any desiccant ends up once it is full. Each point is a full hour-by-hour simulation at the site.' }, 'Humidity headroom'),
      h(HeadroomChart, { data, width: CW, height: 150 }),
      h(View, { style: { flexDirection: 'row', marginTop: 6 } },
        ...data.options.map((o) => h(View, { key: o.key, style: { flexDirection: 'row', alignItems: 'center', marginRight: 16 } },
          h(View, { style: { width: 14, height: o.selected ? 2 : 1.2, backgroundColor: GLASS_COLOR[o.key], marginRight: 5 } }),
          h(Text, { style: { fontSize: 7.8, color: C.ink2, fontWeight: o.selected ? 600 : 400 } }, `${o.product}: ${headroomText(o).toLowerCase()}`)))),
      h(Text, { style: { ...s.small, marginTop: 4 } }, `Room temperature ${data.config.t} °F throughout. "Clear up to" is the highest tested humidity, in 5 % steps, below which the pane shows no visible fog in the settled year.`)),

    h(View, { style: { marginTop: 14 }, wrap: false },
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
    h(Footer, { data }))
}

// ------------------------------------------------------------ page 4: method

function MethodPage({ data }) {
  const est = data.config.thermal.estimate || data.options.some((o) => o.thermal.estimate)
  const steps = [
    ['Weather', `8,760 hourly values of temperature, humidity, pressure, sun and wind for the site's NREL grid cell (typical meteorological year).`],
    ['Glass temperature', 'Each hour the cavity side of the existing glass sits at T_out + f × (T_room - T_out), with f from LBNL WINDOW at NFRC 100 winter conditions.'],
    ['Air exchange', 'Air reaches the cavity through both seals, driven by building pressure (+5 Pa weekdays 7 am to 7 pm), stack and wind. Leakage in cfm/ft² at 75 Pa.'],
    ['Vapor diffusion', 'Water vapor also diffuses through the silicone sealant beads of both layers, in whichever direction the vapor pressure pushes it.'],
    ['Desiccant', '3A molecular sieve, fresh at installation on January 1, takes up water along its sorption curve and gives some back when warm.'],
    ['Condensation', 'Below the cavity air dew point a water film grows on the glass; it evaporates as the glass warms. Fog is visible once the film passes 5 µm.'],
  ]
  const refs = [
    `Weather: NREL National Solar Radiation Database, ${data.site.weather || 'NSRDB'} typical meteorological year, grid cell ${cellText(data.site.weather_cell)}.`,
    'Glass temperature factors: LBNL WINDOW, NFRC 100 winter conditions (0 °F outside, 70 °F inside).',
    'Air leakage: ASTM E283 (cfm/ft² at 75 Pa); seal ladder from AERC certified product ratings and ASTM E283 detection limits.',
    'Temperature-factor method for surface condensation, as in ISO 13788. Psychrometrics: Magnus formula, Sonntag constants.',
  ]
  const limits = [
    'A typical weather year is a composite of real months, not a forecast. Neighboring weather cells can differ noticeably when a scenario is close to the fog threshold.',
    'Seal leakage values are rated or estimated, not measured on an installed INOVUES cavity. A pressure-decay test on an installed unit would replace them.',
    ...(est ? ['Thermal values for an existing double pane are estimates until LBNL WINDOW simulations of the exact assembly replace them.'] : []),
    'Summer heat build-up in the cavity, and its effect on an existing insulating glass unit (thermal stress, edge seal), is not modeled.',
    'Fog inside an existing double-pane unit, between its own panes, is outside this assessment. A retrofit does not repair a failed unit.',
    'Results are model predictions for planning and comparison, not a warranty of performance.',
  ]
  return h(Page, { size: 'LETTER', style: s.page },
    h(TopBar, { data, title: 'Method, assumptions and limits' }),
    h(SectionTitle, { lead: `Hour-by-hour heat and moisture balance of the cavity, from installation until the desiccant is full plus one year (at most ${data.result.max_years} years).` }, 'How the simulation works'),
    h(View, { style: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } },
      ...steps.map(([t, d], i) => h(View, { key: t, style: { width: (CW - 16) / 3, borderWidth: 0.6, borderColor: C.line, borderTopWidth: 2.5, borderTopColor: C.teal, borderRadius: 2, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: C.surface } },
        h(Text, { style: { fontSize: 7.5, color: C.tealInk, fontWeight: 600, letterSpacing: 0.8 } }, `STEP ${i + 1}`),
        h(Text, { style: { fontSize: 9.2, fontWeight: 600, marginTop: 1, marginBottom: 3 } }, t),
        h(Text, { style: { fontSize: 7.6, color: C.ink2, lineHeight: 1.33 } }, d)))),

    h(View, { style: { flexDirection: 'row', gap: 20, marginTop: 14 } },
      h(View, { style: { flex: 1 } },
        h(Text, { style: s.h3 }, 'Data and references'),
        h(Bullets, { size: 7.6, items: refs }),
        h(Text, { style: { ...s.h3, marginTop: 8 } }, 'Limits of this assessment'),
        h(Bullets, { size: 7.6, items: limits })),
      h(View, { style: { flex: 1 } },
        h(Text, { style: s.h3 }, 'Assumptions behind the numbers'),
        h(Bullets, { size: 7.6, items: data.config.assumptions }))),

    h(View, { style: { marginTop: 10, borderTopWidth: 0.6, borderTopColor: C.line, paddingTop: 7, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, wrap: false },
      h(View, { style: { flex: 1, paddingRight: 16 } },
        h(Text, { style: { fontSize: 8.2, fontWeight: 600 } }, 'Reproduce this result'),
        h(Text, { style: { fontSize: 7.4, color: C.ink2, marginTop: 1, lineHeight: 1.3 } },
          `Report ${data.id}, ${new Date(data.generated_at).toISOString().replace('T', ' ').slice(0, 16)} UTC. Cavity fog outlook ${data.app_version}, simulation engine ${data.engine_version ?? 'n/a'}. The same inputs always give the same report number.`)),
      h(Link, { src: data.link, style: { fontSize: 8, fontWeight: 600, color: C.tealInk, textDecoration: 'none', marginTop: 9 } }, 'Open this exact scenario online')),
    h(Footer, { data }))
}

export async function renderReportPdf(data) {
  registerFonts()
  const doc = h(Document, {
    title: `Cavity condensation assessment: ${data.site.matched || data.site.query}`,
    author: 'INOVUES, Inc.',
    subject: 'Secondary window retrofit cavity condensation assessment',
    creator: `INOVUES cavity fog outlook ${data.app_version}`,
    producer: 'INOVUES',
  },
  h(SummaryPage, { data }),
  h(CalendarPage, { data }),
  h(OptionsPage, { data }),
  h(MethodPage, { data }))
  return renderToBuffer(doc)
}
