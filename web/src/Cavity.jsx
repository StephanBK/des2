import { OFFSET_INPUT } from '../../shared/scenario.js'
import { fogDaysPerYear, formatDays, yearStats } from '../../shared/story.js'

// Section through the window, outside on the left, room on the right.
// Not to scale: the 0.6 in cavity is drawn wide so its contents read.
// v2.6: the cavity width follows the offset on a compressed scale (every
// doubling of the offset adds GAP_PER_DOUBLING), so 0.25 in still shows the
// desiccant and 4 in still fits. The free space is uneven (outside labels on
// the left, room readings on the right), so LEFT_SHARE of any change goes to
// the outside, the rest to the room side: at 4 in the frame stays clear of
// the site label and the retrofit glass clear of the room temperature.
const W = 600
const H = 400
const HEAD = [30, 46]            // frame head, y
const SILL = [354, 370]          // frame sill, y
const PANE_X = 196               // existing pane, 8 px thick
const RETRO_X = 390              // cavity side of the retrofit glass (at 0.6 in)
const GAP_AT_STD = RETRO_X - (PANE_X + 8)   // 186 px for the standard 0.6 in
const GAP_PER_DOUBLING = 33
const LEFT_SHARE = 0.28

/** Drawn cavity width for an offset in inches: 0.25 in -> 144 px, 0.6 -> 186, 4 -> 276. */
export function gapPx(offsetIn) {
  return GAP_AT_STD + GAP_PER_DOUBLING * Math.log2(offsetIn / OFFSET_INPUT.default)
}

/** Dimension line across the cavity, above the head: |<---->| */
function Dimension({ x1, x2, y }) {
  return (
    <g className="dim-line" stroke="var(--ink-3)" strokeWidth="1" fill="none">
      <path d={`M${x1} ${y - 4} V${y + 4} M${x2} ${y - 4} V${y + 4}`} />
      <path d={`M${x1 + 1} ${y} H${x2 - 1}`} />
      <path d={`M${x1 + 6} ${y - 3} L${x1 + 1} ${y} L${x1 + 6} ${y + 3} M${x2 - 6} ${y - 3} L${x2 - 1} ${y} L${x2 - 6} ${y + 3}`} />
    </g>
  )
}

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

export default function Cavity({ scenario, sealRanks, result, room = null, busy, dewF, glassLabel, working = false, place = '' }) {
  const build = BUILD[scenario.glass]
  // v2.8: without a humidifier the room RH is not the slider's; show the
  // heating-season median the engine simulated (once a run is on screen).
  const noHum = scenario.hum === 'none'
  const roomRh = noHum ? (room?.median_pct ?? null) : null
  const offset = scenario.offset ?? OFFSET_INPUT.default
  const grow = gapPx(offset) - GAP_AT_STD
  const paneX = PANE_X - LEFT_SHARE * grow          // existing pane moves out a little,
  const retroX = RETRO_X + (1 - LEFT_SHARE) * grow  // the retrofit moves toward the room
  const retroEnd = retroX + build.panes[build.panes.length - 1][1]
  // An existing double pane: its outer lite sits 28 px outboard, with the
  // unit's air gap and edge spacers between (drawn wide so it reads at a glance).
  const igu = scenario.ex === 'double'
  const frameL = paneX - (igu ? 40 : 12)
  const frameR = retroEnd + 12
  const cavL = paneX + 8
  const cavR = retroX

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
        aria-label={`Section through the window: existing ${igu ? 'double-pane unit' : 'single pane'}, ${offset} inch cavity with ${lb} lb of desiccant, ${glassLabel} retrofit, room at ${scenario.t} °F and ${noHum ? 'no humidification' : `${scenario.rh} % relative humidity`}.`}>
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
        <text className="zone" x={(cavL + cavR) / 2} y="16" textAnchor="middle">Cavity, {offset} in</text>
        <Dimension x1={cavL} x2={cavR} y={24} />
        <text className="zone" x={W - 20} y="24" textAnchor="end">Room</text>
        <text className="room-t" x={W - 20} y="190" textAnchor="end">{scenario.t} °F</text>
        {noHum ? (
          <>
            <text className="room-rh" x={W - 20} y="218" textAnchor="end">{roomRh != null ? `~${Math.round(roomRh)} % RH` : 'No humidifier'}</text>
            <text className="zone-sub" x={W - 20} y="240" textAnchor="end">{roomRh != null ? 'Winter median, no humidifier' : 'Outdoor moisture + people'}</text>
          </>
        ) : (
          <>
            <text className="room-rh" x={W - 20} y="218" textAnchor="end">{scenario.rh} % RH</text>
            <text className="zone-sub" x={W - 20} y="240" textAnchor="end">Dew point {Math.round(dewF)} °F</text>
          </>
        )}

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
            <rect x={paneX - 20} y={HEAD[1]} width="20" height={SILL[0] - HEAD[1]} fill="var(--vacuum)" />
            <rect x={paneX - 28} y={HEAD[1]} width="8" height={SILL[0] - HEAD[1]} fill="url(#glass)" stroke="var(--pane-edge)" strokeWidth="1" />
            <rect x={paneX - 20} y={HEAD[1]} width="20" height="7" fill="var(--seal)" />
            <rect x={paneX - 20} y={SILL[0] - 7} width="20" height="7" fill="var(--seal)" />
            <text className="part" x={paneX - 10} y={(HEAD[1] + SILL[0]) / 2} textAnchor="middle"
              transform={`rotate(-90 ${paneX - 10} ${(HEAD[1] + SILL[0]) / 2})`}>air</text>
          </g>
        )}
        <rect x={paneX} y={HEAD[1]} width="8" height={SILL[0] - HEAD[1]} fill="url(#glass)" stroke="var(--pane-edge)" strokeWidth="1" />
        <text className="part" x={paneX + (igu ? -10 : 4)} y={H - 8} textAnchor="middle">{igu ? 'Existing double pane' : 'Existing single pane'}</text>

        {/* retrofit glass */}
        {build.gap && (
          <rect x={retroX + build.panes[0][1]} y={HEAD[1]} width={build.panes[1][0] - build.panes[0][1]} height={SILL[0] - HEAD[1]}
            fill={build.gap === 'vacuum' ? 'var(--vacuum)' : 'var(--cavity)'} />
        )}
        {build.gap === 'vacuum' && Array.from({ length: 14 }, (_, i) => (
          <rect key={i} x={retroX + 7} y={HEAD[1] + 12 + i * 21} width="2" height="2" fill="var(--seal)" />
        ))}
        {build.panes.map(([a, b]) => (
          <rect key={a} x={retroX + a} y={HEAD[1]} width={b - a} height={SILL[0] - HEAD[1]} fill="url(#glass)" stroke="var(--pane-edge)" strokeWidth="1" />
        ))}
        <text className="part" x={(retroX + retroEnd) / 2} y={H - 8} textAnchor="middle">{glassLabel}</text>

        {/* seals and the air they let through */}
        <Bead cx={cavL + 5} cy={HEAD[1] + 5} tight={sealRanks.out === 0} />
        <Bead cx={cavL + 5} cy={SILL[0] - 5} tight={sealRanks.out === 0} />
        <Bead cx={cavR - 5} cy={HEAD[1] + 5} tight={sealRanks.in === 0} />
        <Bead cx={cavR - 5} cy={SILL[0] - 5} tight={sealRanks.in === 0} />
        <Leaks rank={sealRanks.out} from={paneX - 34} to={cavL + 24} />
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
