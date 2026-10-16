import { EXISTING, GLASSES, glassTip, RANGES, thermalOf } from '../../shared/scenario.js'

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
 * The window assembly, prominent at the top: existing window (single or
 * double pane) and the INOVUES retrofit glass (SWR, SWR-IG, SWR-VIG), as two
 * separate switches. 2 x 3 = 6 pairings, each with its own f and U
 * (shared/scenario.js THERMAL); the chosen pairing's values show under the
 * retrofit switch.
 */
export function AssemblyBar({ ex, glass, onEx, onGlass }) {
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
        detail={<>{g.label} retrofit<span className="asm-dot">·</span>U {t.u_ip.toFixed(3)} Btu/hr·ft²·°F{t.u_estimate ? '*' : ''}<span className="asm-dot">·</span>f {t.f_cold.toFixed(3)}</>}
        note={t.u_estimate ? '* Estimate until the WINDOW U-value for an existing double pane is in.' : null} />
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
