# SWR Condensation Assessment (des2)

Formerly "Cavity fog outlook" (renamed v2.7, 2026-10-17).

INOVUES. Owner: Stephan Ketterer, VP of Operations.

For any building address (v2.0): how long the desiccant keeps a secondary
window retrofit cavity dry, and on which days and hours the pane fogs.
Started as a copy of StephanBK/park277-desiccant; differences: any address
with autocomplete (v2.0), and each retrofit glass sends its own assembly
U-value (v1.11: SWR 0.352, SWR-IG 0.249, SWR-VIG 0.164 Btu/hr·ft²·°F).

Controls: building address, existing glass (single or double pane),
retrofit glass, assembly U, existing window seal, retrofit seal, desiccant
pounds, cavity depth, window width and height, facade orientation, room
temperature, room humidity. "Customer report" builds a 3-page PDF for the
scenario on screen (v2.2); with no desiccant it never mentions desiccant (v2.7).

Railway variables: `MAPBOX_TOKEN` (optional; turns on address suggestions,
same publishable token as the engine's), `ENGINE_URL` (optional).

## How it works

```
browser  ->  this app (server/)  ->  desiccant_life- engine (Railway)
             validates the controls   hour-by-hour physics
             adds the fixed inputs    geocodes the address (Mapbox)
             asks Mapbox for          downloads the NREL weather year
             address suggestions
             checks the engine's echo of every input
             caches results
```

- `shared/scenario.js` is the single source of truth: controls, ranges,
  every fixed engine input, the assumptions text. Change it there only.
- `shared/story.js` turns a result into the summary sentence and calendar rows.
- `server/` is plain Node (no dependencies). The browser never calls the
  engine directly, so no CORS and no way to change the hidden inputs.
- `web/` is the React page (Vite). The fog calendar is drawn on canvas.

Needs the engine with the 2026-09-23 fog-map API (`fog_map`,
`years_after_full`). An older engine is detected and reported, not guessed around.

## Run locally

```
npm install
npm run build
npm start                         # http://localhost:3000, uses the live engine
ENGINE_URL=http://127.0.0.1:5000 npm start   # or a local engine
npm run dev                       # hot-reload page on :5173, proxies /api to :3000
```

## Test

```
npm test        # 115 tests: validation, echo check, retries, timeouts, cache, server, links, report, wording
```

## Deploy (Railway)

New service from this repo. No variables required; optional `ENGINE_URL`
(defaults to the live engine). `railway.json` sets build, start and the
`/health` check. `/health/engine` reports whether the engine is reachable.
