import { useEffect, useRef, useState } from 'react'
import { queryOf } from './api.js'

// "Customer report": an optional project name, then the server builds the
// PDF (3 simulations: this scenario and the two other retrofit glasses; the
// humidity sweeps were switched off 2026-10-17) and the browser saves it.

function filenameOf(res) {
  const m = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')
  return m ? m[1] : 'INOVUES-SWR-condensation-assessment.pdf'
}

export default function ReportDialog({ open, onClose, scenario, siteLabel }) {
  const [project, setProject] = useState('')
  const [state, setState] = useState('idle')          // idle | working | done | error
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const panel = useRef(null)
  const ctl = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const prev = document.activeElement
    panel.current?.querySelector('input')?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [open, onClose])

  useEffect(() => {
    if (state !== 'working') return undefined
    const t0 = Date.now()
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500)
    return () => clearInterval(id)
  }, [state])

  // A new scenario resets a finished or failed report.
  useEffect(() => { setState('idle'); setError('') }, [scenario])

  async function create(e) {
    e.preventDefault()
    ctl.current?.abort()
    ctl.current = new AbortController()
    setState('working')
    setError('')
    setElapsed(0)
    try {
      const q = queryOf(scenario) + (project.trim() ? `&project=${encodeURIComponent(project.trim())}` : '')
      const res = await fetch(`/api/report?${q}`, { signal: ctl.current.signal })
      if (!res.ok) {
        let body = null
        try { body = await res.json() } catch { body = null }
        throw new Error(body?.error || `The server answered ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filenameOf(res)
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setState('done')
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message || String(err))
      setState('error')
    }
  }

  function close() {
    ctl.current?.abort()
    if (state === 'working') setState('idle')
    onClose()
  }

  if (!open) return null
  return (
    <div className="drawer-wrap modal-wrap" onClick={close}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="report-title" ref={panel}
        onClick={(e) => e.stopPropagation()} onSubmit={create}>
        <div className="drawer-head">
          <h2 id="report-title">Customer report</h2>
          <button type="button" className="close" onClick={close}>Close</button>
        </div>
        <p className="modal-lead">
          A 3-page PDF for <strong>{siteLabel}</strong>: the outlook, the hour-by-hour calendar, all three
          retrofit glasses compared, the site climate and how the assessment works.
        </p>
        <label className="modal-label" htmlFor="report-project">Project or customer name <span>(optional, shown on the cover)</span></label>
        <input id="report-project" type="text" maxLength={80} value={project} placeholder="e.g. Lobby retrofit, phase 2"
          onChange={(e) => setProject(e.target.value)} disabled={state === 'working'} />
        <div className="modal-actions">
          <button type="submit" className="primary" disabled={state === 'working'}>
            {state === 'working' ? `Building the report… ${elapsed} s` : state === 'done' ? 'Download again' : 'Create PDF'}
          </button>
          <span className="modal-note" aria-live="polite">
            {state === 'working' && 'Runs 3 simulations. A new address takes about 10 seconds.'}
            {state === 'done' && 'Saved to your downloads.'}
            {state === 'error' && <span className="modal-error">{error}</span>}
          </span>
        </div>
      </form>
    </div>
  )
}
