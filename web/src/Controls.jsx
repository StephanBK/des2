import { useEffect, useRef, useState } from 'react'
import { EXISTING, GLASSES, glassTip, normalizeU, RANGES, thermalOf, U_INPUT } from '../../shared/scenario.js'
import { parseU } from './api.js'

// Leak bar length on a log scale: the ladders span 0.005 to 2.0 cfm/ft2,
// a factor of 400, so a linear bar would show everything but the last rung
// as empty.
const LEAK_LO = 0.005
const LEAK_HI = 2.0
function leakFraction(al) {
  if (typeof al !== 'number' || al <= 0) return null
  const x = Math.log(al / LEAK_LO) / Math.log(LEAK_HI / LEAK_LO)
  return 0.06 + 0.94 * Math.max(0, Math.min(1, x))
}

// Room dew point, Magnus formula (Sonntag constants), shown in degF.
//   gamma = ln(RH) + a.T / (b + T);   Td = b.gamma / (a - gamma)
export function dewPointF(tF, rhPct) {
  const a = 17.62
  const b = 243.12
  const t = ((tF - 32) * 5) / 9
  const g = Math.log(rhPct / 100) + (a * t) / (b + t)
  const td = (b * g) / (a - g)
  return (td * 9) / 5 + 32
}

function Group({ title, hint, children }) {
  return (
    <section className="ctl">
      <div className="ctl-head">
        <h2>{title}</h2>
        {hint && <span className="ctl-hint">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

export function SealLadder({ title, items, value, onPick, engineValues }) {
  return (
    <Group title={title} hint="Tightest first">
      <div className="ladder" role="radiogroup" aria-label={title}>
        {items.map((it) => {
          const eng = engineValues?.find((e) => e.key === it.key)?.engine
          const frac = leakFraction(eng?.al_cfm_ft2)
          const tip = eng
            ? `${eng.label}. Rated air leakage ${eng.al_cfm_ft2} cfm/ft² at 75 Pa${eng.estimate ? ' (estimate)' : ''}.`
            : it.label
          const on = value === it.key
          return (
            <button key={it.key} type="button" role="radio" aria-checked={on}
              className={`rung${on ? ' on' : ''}`} data-tip={tip} onClick={() => onPick(it.key)}>
              <span className="rung-label">{it.label}</span>
              <span className="leak" aria-hidden="true">
                {frac !== null && <span className="leak-fill" style={{ width: `${frac * 100}%` }} />}
              </span>
            </button>
          )
        })}
      </div>
    </Group>
  )
}

function Slider({ id, label, value, unit, range, onChange, ticks }) {
  return (
    <div className="slider">
      <label htmlFor={id} className="slider-top">
        <span>{label}</span>
        <output htmlFor={id} className="slider-val">{value}{unit}</output>
      </label>
      <input id={id} type="range" min={range.min} max={range.max} step={range.step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--pos': `${((value - range.min) / (range.max - range.min)) * 100}%` }} />
      {ticks && (
        <div className="ticks" aria-hidden="true">
          {ticks.map((t) => <span key={t}>{t}</span>)}
        </div>
      )}
    </div>
  )
}

// Small section icons for the assembly bar: lites as bars, gaps as space.
//   existing single: one lite; existing double: two lites with an air gap
//   retrofit single / double / VIG: one lite; two with a gap; two close with pillar dots
const ICON = {
  'ex-single': [[9, 4]],
  'ex-double': [[5, 3.5], [13.5, 3.5]],
  'rt-single': [[9, 4]],
  'rt-double': [[5, 3.5], [13.5, 3.5]],
  'rt-vig': [[7, 3.5], [12, 3.5]],
}
function PaneIcon({ kind }) {
  const lites = ICON[kind]
  return (
    <svg className="pane-icon" viewBox="0 0 22 30" aria-hidden="true">
      {kind === 'ex-double' || kind === 'rt-double' ? <rect x="8.5" y="3" width="5" height="24" className="pane-gap" /> : null}
      {lites.map(([x, w]) => <rect key={x} x={x} y="3" width={w} height="24" rx="0.8" className="pane-lite" />)}
      {kind === 'rt-vig' && [8, 13, 18, 23].map((y) => <rect key={y} x="10.6" y={y} width="1.2" height="1.2" className="pane-dot" />)}
      <rect x="2" y="1" width="18" height="2.2" rx="1" className="pane-frame" />
      <rect x="2" y="26.8" width="18" height="2.2" rx="1" className="pane-frame" />
    </svg>
  )
}

/** One pill switch (a segmented control): the chosen option sits on a white pill. */
function Switch({ label, options, value, onPick, detail, note }) {
  return (
    <div className="asm-group">
      <h2 className="asm-title">{label}</h2>
      <div className="asm-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => {
          const on = value === o.key
          return (
            <button key={o.key} type="button" role="radio" aria-checked={on} className={`asm-opt${on ? ' on' : ''}`}
              title={o.tip} onClick={() => onPick(o.key)}>
              <PaneIcon kind={o.icon} />
              <span>{o.name}</span>
            </button>
          )
        })}
      </div>
      <p className="asm-detail">{detail}</p>
      {note && <p className="asm-note">{note}</p>}
    </div>
  )
}

/**
 * The assembly U-value box (v2.5): shows the U in use for the chosen pairing.
 * Typing a number and pressing Enter (or leaving the box) runs it; an empty
 * box or "Reset" goes back to the standard value. The draft text lives here,
 * so the simulation runs once per value, not once per keystroke.
 */
function UField({ ex, glass, u, onU }) {
  const std = thermalOf(ex, glass)
  const shown = u ?? std.u_ip
  const [text, setText] = useState(shown.toFixed(3))
  const [bad, setBad] = useState(false)
  const box = useRef(null)
  // A new value from outside (reset, switching glass, a link) replaces the draft.
  useEffect(() => { setText(shown.toFixed(3)); setBad(false) }, [shown])

  const commit = () => {
    if (text.trim() === '') { setBad(false); setText(std.u_ip.toFixed(3)); if (u !== null) onU(null); return }
    const v = parseU(text)
    if (v === null) { setBad(true); return }
    setBad(false)
    setText(v.toFixed(3))
    const next = normalizeU(ex, glass, v)
    if (next !== u) onU(next)
  }
  const entered = u !== null
  const g = GLASSES.find((x) => x.key === glass)
  return (
    <div className="asm-group asm-u">
      <h2 className="asm-title"><label htmlFor="u-in">Assembly U-value</label></h2>
      <div className={`u-box${entered ? ' entered' : ''}${bad ? ' bad' : ''}`} onClick={() => box.current?.focus()}>
        <input id="u-in" ref={box} type="text" inputMode="decimal" autoComplete="off" spellCheck="false"
          value={text} aria-invalid={bad} aria-describedby="u-help"
          onChange={(e) => { setText(e.target.value); setBad(false) }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { setText(shown.toFixed(3)); setBad(false); e.currentTarget.blur() }
          }} />
        <span className="u-unit">Btu/hr·ft²·°F</span>
      </div>
      <p id="u-help" className="asm-detail">
        {bad
          ? <span className="u-err">Enter a value from {U_INPUT.min.toFixed(3)} to {U_INPUT.max.toFixed(3)}</span>
          : entered
            ? <>Entered<span className="asm-dot">·</span>standard {std.u_ip.toFixed(3)}{std.u_estimate ? '*' : ''}<button type="button" className="u-reset" onClick={() => onU(null)}>Reset</button></>
            : <>Standard for {g.product}{std.u_estimate ? '*' : ''}<span className="asm-dot">·</span>type a value and press Enter</>}
      </p>
      {std.u_estimate && !entered && <p className="asm-note">* Estimate until the WINDOW U-value for an existing double pane is in.</p>}
    </div>
  )
}

/**
 * The window assembly, prominent at the top: existing window (single or
 * double pane) and the INOVUES retrofit glass (SWR, SWR-IG, SWR-VIG), as two
 * separate switches. 2 x 3 = 6 pairings, each with its own f and U
 * (shared/scenario.js THERMAL); f shows under the retrofit switch, U in its
 * own box beside it (v2.5), where a different U can be typed in.
 */
export function AssemblyBar({ ex, glass, u, onEx, onGlass, onU }) {
  const existing = EXISTING.find((x) => x.key === ex)
  const g = GLASSES.find((x) => x.key === glass)
  const t = thermalOf(ex, glass)
  return (
    <div className="assembly" role="group" aria-label="Window assembly">
      <Switch label="Existing window" value={ex} onPick={onEx}
        options={EXISTING.map((x) => ({ key: x.key, name: x.label, icon: `ex-${x.key}`, tip: x.tip }))}
        detail={existing.key === 'single' ? 'One lite of glass' : 'Insulating glass unit, 1 in overall'} />
      <Switch label="INOVUES retrofit glass" value={glass} onPick={onGlass}
        options={GLASSES.map((x) => ({ key: x.key, name: x.product, icon: `rt-${x.key}`, tip: glassTip(ex, x.key) }))}
        detail={<>{g.label} retrofit<span className="asm-dot">·</span>glass factor f {t.f_cold.toFixed(3)}</>} />
      <UField ex={ex} glass={glass} u={u} onU={onU} />
    </div>
  )
}

export function DesiccantSlider({ value, onChange }) {
  const ticks = []
  for (let v = RANGES.lb.min; v <= RANGES.lb.max; v += 2) ticks.push(v)
  return (
    <Group title="Desiccant">
      <Slider id="lb" label="Per window" value={value} unit=" lb" range={RANGES.lb} ticks={ticks} onChange={onChange} />
    </Group>
  )
}

export function RoomSliders({ t, rh, onT, onRh }) {
  return (
    <Group title="Room air">
      <Slider id="t" label="Temperature" value={t} unit=" °F" range={RANGES.t} onChange={onT} />
      <Slider id="rh" label="Relative humidity" value={rh} unit=" %" range={RANGES.rh} onChange={onRh} />
    </Group>
  )
}
