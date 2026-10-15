import { fogDaysPerYear, formatDays, yearStats } from '../../shared/story.js'

// Section through the window, outside on the left, room on the right.
// Not to scale: the 0.6 in cavity is drawn wide so its contents read.
const W = 600
const H = 400
const HEAD = [30, 46]            // frame head, y
const SILL = [354, 370]          // frame sill, y
const PANE_X = 196               // existing pane, 8 px thick
const RETRO_X = 390              // cavity side of the retrofit glass

// Retrofit glass build-ups: [x0, x1] of each pane, and what fills the gap.
const BUILD = {
  single: { panes: [[0, 8]], gap: null },
  double: { panes: [[0, 7], [15, 22]], gap: 'air' },
  vig: { panes: [[0, 7], [9, 16]], gap: 'vacuum' },
}

function Arrow({ x1, x2, y, w, o }) {
  const dir = Math.sign(x2 - x1)
  return (
    <g stroke="var(--air)" strokeWidth={w} strokeLinecap="round" fill="none" opacity={o}>
      <path d={`M${x1} ${y} C ${(x1 + x2) / 2} ${y - 5}, ${(x1 + x2) / 2} ${y + 5}, ${x2} ${y}`} />
      <path d={`M${x2 - dir * 6} ${y - 4} L${x2} ${y} L${x2 - dir * 6} ${y + 4}`} />
    </g>
  )
}

/** Air arrows through one layer's joints; none for the tightest rung. */
function Leaks({ rank, from, to }) {
  if (rank <= 0) return null
  const n = Math.min(3, Math.ceil(rank / 2))
  const w = 1.3 + 0.28 * rank
  const o = 0.5 + 0.09 * rank
  const rows = []
  for (const base of [HEAD[1] + 10, SILL[0] - 10]) {
    for (let k = 0; k < n; k++) {
      const y = base + (base < H / 2 ? 1 : -1) * k * 10
      rows.push(<Arrow key={`${base}-${k}`} x1={from} x2={to} y={y} w={w} o={o} />)
    }
  }
  return <g>{rows}</g>
}

function Bead({ cx, cy, tight }) {
  return tight
    ? <circle cx={cx} cy={cy} r="5" fill="var(--seal)" />
    : <circle cx={cx} cy={cy} r="5" fill="none" stroke="var(--seal)" strokeWidth="2" strokeDasharray="3 3" />
}

function Chip({ x, y, text, tone, anchor = 'start' }) {
  // Width estimated from the text: 6.7 px per character at 12.5 px Archivo.
  const w = Math.round(text.length * 6.7) + 18
  const x0 = anchor === 'middle' ? x - w / 2 : x
  return (
    <g className={`chip ${tone}`}>
      <rect x={x0} y={y - 13} width={w} height={24} rx="12" />
      <text x={x0 + w / 2} y={y + 3.5} textAnchor="middle">{text}</text>
    </g>
  )
}

export function fogChip(r, working = false) {
  if (!r) return null
  const perYear = fogDaysPerYear(r, working)
  const total = r.years.reduce((s, y) => s + yearStats(y.fog, working).days, 0)
  const noun = working ? 'working fog days' : 'fog days'
  if (total === 0) return working ? 'Clear in working hours' : 'Pane stays clear'
  if (perYear === 0) return `${total.toLocaleString('en-US')} ${noun}, then clear`
  const n = perYear.toLocaleString('en-US')
  if (working) return `${n} ${noun}/yr`                       // shorter: the box carries "once full"
  if (r.lb > 0 && r.full_hour !== null) return `${n} ${noun}/yr once full`
  return `${n} ${noun}/yr`
}

export function dryChip(r) {
  if (!r || r.lb === 0) return null
  if (r.full_hour === null) return `Still dry after ${r.max_years} years`
  return `Dry for ${formatDays(r.full_hour)}`
}

export default function Cavity({ scenario, sealRanks, result, busy, dewF, glassLabel, working = false, place = '' }) {
  const build = BUILD[scenario.glass]
  const retroEnd = RETRO_X + build.panes[build.panes.length - 1][1]
  // An existing double pane: its outer lite sits 16 px outboard, air between.
  const igu = scenario.ex === 'double'
  const frameL = PANE_X - (igu ? 28 : 12)
  const frameR = retroEnd + 12
  const cavL = PANE_X + 8
  const cavR = RETRO_X

  // Desiccant cartridge on the sill: height follows the pounds.
  const lb = scenario.lb
  const cartH = lb === 0 ? 20 : 12 + lb * 8
  const cartX = cavL + 36          // clear of the leak arrows at the sill joints
  const cartW = cavR - cavL - 72
  const cartY = SILL[0] - cartH

  const fogHours = result ? result.years.reduce((s, y) => s + y.fog_hours, 0) : 0
  const fogStrength = Math.min(1, fogHours / 1500)
  const fogText = fogChip(result, working)
  const dryText = dryChip(result)

  return (
    <figure className="cavity">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Section through the window: existing ${igu ? 'double-pane unit' : 'single pane'}, 0.6 inch cavity with ${lb} lb of desiccant, ${glassLabel} retrofit, room at ${scenario.t} °F and ${scenario.rh} % relative humidity.`}>
        <defs>
          <pattern id="beads" width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="3.5" cy="3.5" r="2.3" fill="var(--teal)" opacity="0.85" />
          </pattern>
          <linearGradient id="fogband" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--fog)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--fog)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="glass" x1="0" x2="1">
            <stop offset="0" stopColor="var(--pane)" />
            <stop offset="1" stopColor="var(--pane-2)" />
          </linearGradient>
        </defs>

        {/* zones */}
        <rect x="0" y="0" width={frameL} height={H} fill="var(--outside)" />
        <rect x={cavL} y={HEAD[1]} width={cavR - cavL} height={SILL[0] - HEAD[1]} fill="var(--cavity)" />
        <rect x={frameR} y="0" width={W - frameR} height={H} fill="var(--room)" />

        {/* zone text */}
        <text className="zone" x="20" y="24">Outside</text>
        <text className="zone-sub" x="20" y="42">{place ? `${place.length > 24 ? `${place.slice(0, 23)}…` : place}, typical year` : 'Typical year'}</text>
        <text className="zone" x={(cavL + cavR) / 2} y="20" textAnchor="middle">Cavity, 0.6 in</text>
        <text className="zone" x={W - 20} y="24" textAnchor="end">Room</text>
        <text className="room-t" x={W - 20} y="190" textAnchor="end">{scenario.t} °F</text>
        <text className="room-rh" x={W - 20} y="218" textAnchor="end">{scenario.rh} % RH</text>
        <text className="zone-sub" x={W - 20} y="240" textAnchor="end">Dew point {Math.round(dewF)} °F</text>

        {/* frame */}
        <rect x={frameL} y={HEAD[0]} width={frameR - frameL} height={HEAD[1] - HEAD[0]} fill="var(--frame)" rx="2" />
        <rect x={frameL} y={SILL[0]} width={frameR - frameL} height={SILL[1] - SILL[0]} fill="var(--frame)" rx="2" />

        {/* fog on the cavity face of the existing pane */}
        {fogHours > 0 && (
          <g className={busy ? 'dim' : ''}>
            <rect x={cavL} y={HEAD[1]} width={26} height={SILL[0] - HEAD[1]} fill="url(#fogband)" opacity={0.35 + 0.65 * fogStrength} />
            {Array.from({ length: Math.round(8 + 26 * fogStrength) }, (_, i) => (
              <circle key={i} cx={cavL + 2.5 + ((i * 7) % 9)} cy={HEAD[1] + 14 + ((i * 53) % (SILL[0] - HEAD[1] - 28))}
                r={1.3 + ((i * 3) % 4) * 0.45} fill="var(--fog)" opacity="0.8" />
            ))}
          </g>
        )}

        {/* existing glass: one pane, or an insulating unit with its air gap */}
        {igu && (
          <g>
            <rect x={PANE_X - 9} y={HEAD[1]} width="9" height={SILL[0] - HEAD[1]} fill="var(--cavity)" />
            <rect x={PANE_X - 16} y={HEAD[1]} width="7" height={SILL[0] - HEAD[1]} fill="url(#glass)" stroke="var(--pane-edge)" strokeWidth="1" />
            <rect x={PANE_X - 9} y={HEAD[1]} width="9" height="5" fill="var(--seal)" />
            <rect x={PANE_X - 9} y={SILL[0] - 5} width="9" height="5" fill="var(--seal)" />
          </g>
        )}
        <rect x={PANE_X} y={HEAD[1]} width="8" height={SILL[0] - HEAD[1]} fill="url(#glass)" stroke="var(--pane-edge)" strokeWidth="1" />
        <text className="part" x={PANE_X + (igu ? -4 : 4)} y={H - 8} textAnchor="middle">{igu ? 'Existing double pane' : 'Existing pane'}</text>

        {/* retrofit glass */}
        {build.gap && (
          <rect x={RETRO_X + build.panes[0][1]} y={HEAD[1]} width={build.panes[1][0] - build.panes[0][1]} height={SILL[0] - HEAD[1]}
            fill={build.gap === 'vacuum' ? 'var(--vacuum)' : 'var(--cavity)'} />
        )}
        {build.gap === 'vacuum' && Array.from({ length: 14 }, (_, i) => (
          <rect key={i} x={RETRO_X + 7} y={HEAD[1] + 12 + i * 21} width="2" height="2" fill="var(--seal)" />
        ))}
        {build.panes.map(([a, b]) => (
          <rect key={a} x={RETRO_X + a} y={HEAD[1]} width={b - a} height={SILL[0] - HEAD[1]} fill="url(#glass)" stroke="var(--pane-edge)" strokeWidth="1" />
        ))}
        <text className="part" x={(RETRO_X + retroEnd) / 2} y={H - 8} textAnchor="middle">{glassLabel}</text>

        {/* seals and the air they let through */}
        <Bead cx={cavL + 5} cy={HEAD[1] + 5} tight={sealRanks.out === 0} />
        <Bead cx={cavL + 5} cy={SILL[0] - 5} tight={sealRanks.out === 0} />
        <Bead cx={cavR - 5} cy={HEAD[1] + 5} tight={sealRanks.in === 0} />
        <Bead cx={cavR - 5} cy={SILL[0] - 5} tight={sealRanks.in === 0} />
        <Leaks rank={sealRanks.out} from={PANE_X - 34} to={cavL + 24} />
        <Leaks rank={sealRanks.in} from={retroEnd + 34} to={cavR - 24} />

        {/* desiccant */}
        {lb > 0 ? (
          <g>
            <rect x={cartX} y={cartY} width={cartW} height={cartH} rx="4" fill="var(--surface)" stroke="var(--teal)" strokeWidth="1.5" />
            <rect x={cartX + 3} y={cartY + 3} width={cartW - 6} height={cartH - 6} rx="2" fill="url(#beads)" />
          </g>
        ) : (
          <g>
            <rect x={cartX} y={cartY} width={cartW} height={cartH} rx="4" fill="none" stroke="var(--ink-3)" strokeDasharray="4 4" />
            <text className="part" x={cartX + cartW / 2} y={cartY + 14} textAnchor="middle">No desiccant</text>
          </g>
        )}
        {lb > 0 && <text className="part strong" x={cartX + cartW / 2} y={cartY - 10} textAnchor="middle">{lb} lb desiccant</text>}

        {/* results */}
        <g className={busy ? 'dim' : ''}>
          {dryText && <Chip x={(cavL + cavR) / 2} y={cartY - 40} text={dryText} tone="dry" anchor="middle" />}
          {fogText && <Chip x={(cavL + cavR) / 2} y={118} text={fogText} tone={fogHours > 0 ? 'fog' : 'clear'} anchor="middle" />}
        </g>
      </svg>
    </figure>
  )
}
