import { EXISTING, GLASSES, glassTip, RANGES } from '../../shared/scenario.js'

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

export function ExistingPicker({ value, onPick }) {
  return (
    <Group title="Existing glass">
      <div className="seg two" role="radiogroup" aria-label="Existing glass">
        {EXISTING.map((x) => {
          const on = value === x.key
          return (
            <button key={x.key} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''}
              data-tip={x.tip} onClick={() => onPick(x.key)}>
              {x.label}
            </button>
          )
        })}
      </div>
      {value === 'double' && (
        <p className="est-note">Glass values for an existing double pane are estimates until WINDOW simulations replace them.</p>
      )}
    </Group>
  )
}

export function GlassPicker({ value, existing, onPick }) {
  return (
    <Group title="Retrofit glass">
      <div className="seg" role="radiogroup" aria-label="Retrofit glass">
        {GLASSES.map((g) => {
          const on = value === g.key
          return (
            <button key={g.key} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''}
              data-tip={glassTip(existing, g.key)} onClick={() => onPick(g.key)}>
              {g.label}
            </button>
          )
        })}
      </div>
    </Group>
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
