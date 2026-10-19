import { useCallback, useEffect, useRef, useState } from 'react'
import { GLASSES, SEALS_EXISTING, SEALS_RETROFIT, WORKING_HOURS } from '../../shared/scenario.js'
import { headlineCards, placeName, summarize } from '../../shared/story.js'
import AddressBox from './AddressBox.jsx'
import ReportDialog from './ReportDialog.jsx'
import { fetchConfig, peek, queryOf, readUrlHours, readUrlScenario, runScenario, writeUrlScenario } from './api.js'
import Assumptions from './Assumptions.jsx'
import Cavity from './Cavity.jsx'
import { AssemblyBar, BuildingField, DesiccantSlider, dewPointF, FacadeSwitch, OffsetField, RoomSliders, SealLadder, WindowSizeField } from './Controls.jsx'
import FogCalendar, { Legend } from './FogCalendar.jsx'

function ErrorPanel({ error, onRetry }) {
  const detail = Array.isArray(error.detail) ? error.detail : error.detail ? [String(typeof error.detail === 'object' ? JSON.stringify(error.detail) : error.detail)] : []
  return (
    <div className="error" role="alert">
      <h2>The simulation did not run</h2>
      <p>{error.message}</p>
      {detail.length > 0 && (
        <details>
          <summary>Details for INOVUES</summary>
          <ul>{detail.map((d) => <li key={d}>{d}</li>)}</ul>
        </details>
      )}
      <button type="button" className="primary" onClick={onRetry}>Try again</button>
    </div>
  )
}

// What the engine found for the address: the matched address when it differs
// from what was typed, and the weather data behind the numbers.
function SiteFacts({ data, scenario, busy }) {
  const e = data?.engine
  if (!scenario.addr) return <p className="site-facts"><span>Enter the building's address to load its weather and run the simulation.</span></p>
  // Facts belong to the result on screen; a new address shows nothing old.
  const current = data?.scenario?.addr === scenario.addr
  if (busy && !current) return <p className="site-facts"><span>Finding the address and its weather…</span></p>
  if (!e || !current) return <p className="site-facts" aria-hidden="true">&nbsp;</p>
  const typed = scenario.lat === null
  const cell = e.weather_cell && e.weather_cell.every((x) => typeof x === 'number')
    ? `${Math.abs(e.weather_cell[0]).toFixed(2)}° ${e.weather_cell[0] >= 0 ? 'N' : 'S'}, ${Math.abs(e.weather_cell[1]).toFixed(2)}° ${e.weather_cell[1] >= 0 ? 'E' : 'W'}`
    : null
  return (
    <p className="site-facts">
      {typed && e.site && <span>Matched: <strong>{e.site}</strong></span>}
      <span>Weather: typical year, NREL {e.weather || 'NSRDB'}{cell ? `, grid cell ${cell}` : ''}</span>
    </p>
  )
}

export default function App() {
  const [scenario, setScenario] = useState(readUrlScenario)
  const [config, setConfig] = useState(null)
  const [data, setData] = useState(() => peek(scenario) ?? null)
  const [busy, setBusy] = useState(() => Boolean(scenario.addr))
  const [error, setError] = useState(null)
  const [drawer, setDrawer] = useState(false)
  const [report, setReport] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [hours, setHours] = useState(readUrlHours)
  const kind = useRef('button')

  useEffect(() => { writeUrlScenario(scenario, hours) }, [scenario, hours])

  useEffect(() => { fetchConfig().then(setConfig).catch(() => setConfig(null)) }, [])

  useEffect(() => {
    // Nothing to simulate until there is an address.
    if (!scenario.addr) { setData(null); setBusy(false); setError(null); return undefined }
    const hit = peek(scenario)
    if (hit) { setData(hit); setBusy(false); setError(null); return undefined }
    const ctl = new AbortController()
    setBusy(true)
    // Sliders fire on every step while dragging; wait until the hand rests.
    const t = setTimeout(() => {
      runScenario(scenario, ctl.signal)
        .then((d) => { setData(d); setError(null); setBusy(false) })
        .catch((err) => { if (err.name !== 'AbortError') { setError(err); setBusy(false) } })
    }, kind.current === 'slider' ? 300 : 0)
    return () => { clearTimeout(t); ctl.abort() }
  }, [scenario, attempt])

  const update = useCallback((patch, source = 'button') => {
    kind.current = source
    setScenario((s) => ({ ...s, ...patch }))
  }, [])
  const closeDrawer = useCallback(() => setDrawer(false), [])
  const closeReport = useCallback(() => setReport(false), [])

  const r = error ? null : data?.result
  const workingView = hours === 'working'
  const sentences = r ? summarize(r, { working: workingView }) : []
  const years = r?.years_run ?? 0
  const ranks = {
    out: SEALS_EXISTING.findIndex((s) => s.key === scenario.seal_out),
    in: SEALS_RETROFIT.findIndex((s) => s.key === scenario.seal_in),
  }
  const glassLabel = GLASSES.find((g) => g.key === scenario.glass).label
  // The simulated room RH belongs to the run on screen; none while a run in the other humidity mode is shown.
  const roomNow = r && data?.scenario?.hum === scenario.hum ? r.room : null
  const dim = busy && data ? ' busy' : ''

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <img className="mark" src="/inovues-mark.png" alt="" width="20" height="32" />
          <img className="word" src="/inovues-wordmark.png" alt="INOVUES" width="118" height="23" />
        </div>
        <div className="title">
          <h1>SWR Condensation Assessment</h1>
          <p>Secondary window retrofit: when and how often the existing glass fogs</p>
        </div>
        <div className="head-actions">
          <button type="button" className="report-btn" onClick={() => setReport(true)} disabled={!!error || !data} aria-label="Customer report (PDF)">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.5L13 5v9.5H4z M9.5 1.5V5H13 M6.5 9.5 8.5 11.5 10.5 9.5 M8.5 7v4.3" /></svg>
            <span className="report-label">Customer report</span>
          </button>
          <button type="button" className="ghost" onClick={() => setDrawer(true)}>Assumptions</button>
        </div>
      </header>

      <section className="sitebar" aria-label="Site">
        <div className="sitebar-in">
          <AddressBox value={scenario.addr} suggestOn={config ? config.suggest : undefined}
            onPick={(site) => update(site)} />
          <SiteFacts data={error ? null : data} scenario={scenario} busy={busy} />
          <AssemblyBar ex={scenario.ex} glass={scenario.glass} u={scenario.u}
            onEx={(k) => update({ ex: k, u: null })} onGlass={(k) => update({ glass: k, u: null })}
            onU={(v) => update({ u: v })} />
        </div>
      </section>

      <main className="page" aria-busy={busy}>
        <div className="progress" aria-hidden="true" data-on={busy ? '1' : '0'} />

        <section className={`answer-block${dim}`}>
          {error && <ErrorPanel error={error} onRetry={() => setAttempt((a) => a + 1)} />}
          {scenario.addr && !error && !r && <div className="sk-line wide" aria-hidden="true" />}
          {r && (
            <>
              <p className="sr-only" aria-live="polite">{sentences.join(' ')}</p>
              <div className="cards" aria-hidden="true">
                {headlineCards(r, { working: workingView }).map((c) => (
                  <div key={c.key} className={`card ${c.tone}`}>
                    <span className="card-label">{c.label}</span>
                    <span className="card-value">{c.value}</span>
                    <span className="card-detail">{c.detail}</span>
                  </div>
                ))}
              </div>
              <p className="basis">Simulated hour by hour over {years === 1 ? 'one year' : `${years} years`} of typical weather at the site.</p>
            </>
          )}
        </section>

        <section className="rig" aria-label="Scenario">
          <div className="side outside-side">
            <SealLadder title="Existing window seal" items={SEALS_EXISTING} value={scenario.seal_out}
              engineValues={config?.seals_existing} onPick={(k) => update({ seal_out: k })} />
          </div>

          <div className="center">
            <Cavity scenario={scenario} sealRanks={ranks} result={r} room={roomNow} busy={busy} glassLabel={glassLabel} working={workingView}
              place={placeName(data?.engine?.site || scenario.addr)}
              dewF={dewPointF(scenario.t, scenario.rh)} />
            <div className="under">
              <DesiccantSlider value={scenario.lb} onChange={(v) => update({ lb: v }, 'slider')} />
              <OffsetField value={scenario.offset} onChange={(v) => update({ offset: v })} />
              <WindowSizeField width={scenario.width} height={scenario.height} onChange={(patch) => update(patch)} />
              <FacadeSwitch value={scenario.facade} onChange={(k) => update({ facade: k })} />
              <BuildingField floors={scenario.floors} wfloor={scenario.wfloor} onChange={(patch) => update(patch)} />
            </div>
          </div>

          <div className="side room-side">
            <SealLadder title="Retrofit seal" items={SEALS_RETROFIT} value={scenario.seal_in}
              engineValues={config?.seals_retrofit} onPick={(k) => update({ seal_in: k })} />
            <RoomSliders t={scenario.t} rh={scenario.rh} hum={scenario.hum} room={roomNow}
              onT={(v) => update({ t: v }, 'slider')} onRh={(v) => update({ rh: v }, 'slider')}
              onHum={(k) => update({ hum: k })} />
          </div>
        </section>

        <section className={`results${dim}`} aria-label="Fog calendar">
          <div className="results-head">
            <h2 className="results-title">When the pane fogs, hour by hour</h2>
            <div className="hours-toggle">
              <div className="seg seg-small" role="radiogroup" aria-label="Hours shown in the calendar">
                {[['all', 'All hours'], ['working', 'Working hours']].map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={hours === k} className={hours === k ? 'on' : ''}
                    onClick={() => setHours(k)}>{label}</button>
                ))}
              </div>
              <p className="hours-note">
                {hours === 'working'
                  ? `Working hours: ${WORKING_HOURS.label} (${WORKING_HOURS.hours.toLocaleString('en-US')} hours a year). The first-fog and fog-days boxes at the top follow this setting.`
                  : 'Every hour of the year counts.'}
              </p>
            </div>
          </div>
          {r ? (
            <>
              <FogCalendar result={r} runKey={queryOf(data.scenario)} working={hours === 'working'} />
              <Legend working={hours === 'working'} />
            </>
          ) : !error && (scenario.addr ? <div className="sk-strip" aria-hidden="true" /> : <p className="empty-strip">The hour-by-hour fog calendar appears here once an address is entered.</p>)}
        </section>
      </main>

      <Assumptions open={drawer} onClose={closeDrawer} engineVersion={config?.engine_version} />
      <ReportDialog open={report} onClose={closeReport} scenario={scenario}
        siteLabel={(data?.engine?.site || scenario.addr).split(',').slice(0, 2).join(',')} />
    </div>
  )
}
