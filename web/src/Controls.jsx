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

/**
 * The window assembly, prominent at the top: existing window (single or
 * double pane) and the INOVUES retrofit glass (SWR, SWR-IG, SWR-VIG).
 * 2 x 3 = 6 pairings, each with its own f and U (shared/scenario.js THERMAL).
 */
export function AssemblyBar({ ex, glass, onEx, onGlass }) {
  const anyEstimate = GLASSES.some((g) => thermalOf(ex, g.key).u_estimate)
  return (
    <div className="assembly" role="group" aria-label="Window assembly">
      <div className="asm-group">
        <h2 className="asm-title">Existing window</h2>
        <div className="asm-seg" role="radiogroup" aria-label="Existing window">
          {EXISTING.map((x) => {
            const on = ex === x.key
            return (
              <button key={x.key} type="button" role="radio" aria-checked={on} className={`asm-opt${on ? ' on' : ''}`}
                data-tip={x.tip} onClick={() => onEx(x.key)}>
                <PaneIcon kind={`ex-${x.key}`} />
                <span className="asm-text">
                  <span className="asm-name">{x.label}</span>
                  <span className="asm-sub">{x.key === 'single' ? 'One lite of glass' : 'Insulating glass unit'}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="asm-plus" aria-hidden="true">+</div>
      <div className="asm-group asm-grow">
        <h2 className="asm-title">INOVUES retrofit glass</h2>
        <div className="asm-seg" role="radiogroup" aria-label="INOVUES retrofit glass">
          {GLASSES.map((g) => {
            const on = glass === g.key
            const t = thermalOf(ex, g.key)
            return (
              <button key={g.key} type="button" role="radio" aria-checked={on} className={`asm-opt${on ? ' on' : ''}`}
                data-tip={glassTip(ex, g.key)} onClick={() => onGlass(g.key)}>
                <PaneIcon kind={`rt-${g.key}`} />
                <span className="asm-text">
                  <span className="asm-name">{g.product}</span>
                  <span className="asm-sub">{g.label} · U {t.u_ip.toFixed(3)}{t.u_estimate ? '*' : ''}</span>
                </span>
              </button>
            )
          })}
        </div>
        {anyEstimate && <p className="asm-note">* U over an existing double pane is an estimate until WINDOW results replace it.</p>}
      </div>
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
