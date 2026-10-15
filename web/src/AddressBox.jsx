import { useEffect, useId, useRef, useState } from 'react'
import { ADDRESS } from '../../shared/scenario.js'
import { fetchSuggestions } from './api.js'

// The building address, with suggestions as you type (a "combobox": a text
// box with a list under it). Picking a suggestion sends its full address and
// coordinates; the server checks that the engine lands on the same point.
// Without suggestions (no Mapbox key on the server) a typed address still
// runs: Enter sends it as typed and the result shows what the engine matched.

const WAIT_MS = 250          // pause after the last keystroke before asking

export default function AddressBox({ value, suggestOn, onPick }) {
  const [text, setText] = useState(value)
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [note, setNote] = useState('')
  const listId = useId()
  const input = useRef(null)
  // The address that ran, always current: the blur timer below reads it
  // after a pick has already replaced it (a plain variable would be stale).
  const ran = useRef(value)

  // A new address from outside (URL, reset) replaces what is in the box.
  useEffect(() => { ran.current = value; setText(value) }, [value])

  useEffect(() => {
    const q = text.trim()
    if (!open || suggestOn === false || q.length < 3 || q === value) { setItems([]); return undefined }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      fetchSuggestions(q, ctl.signal)
        .then((list) => { setItems(list); setActive(-1); setNote(list.length ? '' : 'No match yet: keep typing, or press Enter to use it as typed') })
        .catch((err) => { if (err.name !== 'AbortError') { setItems([]); setNote(err.message) } })
    }, WAIT_MS)
    return () => { clearTimeout(t); ctl.abort() }
  }, [text, open, suggestOn, value])

  function pick(s) {
    setOpen(false)
    setItems([])
    setNote('')
    setText(s.full)
    ran.current = s.full
    onPick({ addr: s.full, lat: s.lat, lon: s.lon })
    input.current?.blur()
  }

  function submitTyped() {
    const v = text.replace(/\s+/g, ' ').trim()
    if (v.length < ADDRESS.min) { setNote('Give a street address, city and state'); return }
    setOpen(false)
    setNote('')
    if (v !== value) { ran.current = v; setText(v); onPick({ addr: v, lat: null, lon: null }) }
    input.current?.blur()
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % items.length) }
    else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (active >= 0 && items[active]) pick(items[active])
      else if (items.length) pick(items[0])
      else submitTyped()
    } else if (e.key === 'Escape') { setOpen(false); setText(value); setNote('') }
  }

  const showList = open && items.length > 0
  return (
    <div className="addr">
      <label className="addr-label" htmlFor={`${listId}-in`}>Building address</label>
      <div className="addr-field">
        <svg className="addr-pin" viewBox="0 0 16 20" aria-hidden="true">
          <path d="M8 0.8a6.6 6.6 0 0 0-6.6 6.6c0 4.7 6.6 11.8 6.6 11.8s6.6-7.1 6.6-11.8A6.6 6.6 0 0 0 8 0.8Zm0 9.1a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />
        </svg>
        <input
          id={`${listId}-in`} ref={input} type="text" value={text} autoComplete="off" spellCheck="false"
          role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={suggestOn === false ? 'Type the full address, then press Enter' : 'Start typing a street address'}
          onChange={(e) => { setText(e.target.value); setOpen(true) }}
          onFocus={(e) => { e.target.select(); setOpen(true) }}
          // Leaving the box without picking or pressing Enter keeps the address that ran.
          onBlur={() => setTimeout(() => { setOpen(false); setText(ran.current); setNote('') }, 120)}
          onKeyDown={onKeyDown}
        />
        {showList && (
          <ul className="addr-list" id={listId} role="listbox" aria-label="Address suggestions">
            {items.map((s, i) => (
              <li key={`${s.full}-${i}`} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                className={i === active ? 'on' : ''}
                onMouseDown={(e) => { e.preventDefault(); pick(s) }}
                onMouseEnter={() => setActive(i)}>
                <span className="addr-name">{s.name}</span>
                {s.place && <span className="addr-place">{s.place}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && note && <p className="addr-note">{note}</p>}
    </div>
  )
}
