import { useEffect, useRef } from 'react'
import { ASSUMPTIONS, FIXED_DESCRIPTION } from '../../shared/scenario.js'

export default function Assumptions({ open, onClose, engineVersion }) {
  const panel = useRef(null)

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement
    panel.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="drawer-wrap" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabIndex={-1}
        ref={panel} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2 id="drawer-title">Assumptions</h2>
          <button type="button" className="close" onClick={onClose} aria-label="Close assumptions">Close</button>
        </div>

        <h3>Fixed in this tool</h3>
        <dl className="fixed">
          {FIXED_DESCRIPTION.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>

        <h3>What the results rest on</h3>
        <ul className="caveats">
          {ASSUMPTIONS.map((a) => <li key={a}>{a}</li>)}
        </ul>

        <p className="drawer-foot">
          Hour-by-hour simulation by the INOVUES desiccant lifetime engine{engineVersion ? ` (version ${engineVersion})` : ''}.
        </p>
      </div>
    </div>
  )
}
