# 277 Park Avenue: cavity fog outlook (des2)

des2 is a copy of StephanBK/park277-desiccant with one change: each retrofit
glass sends its own assembly U-value (single pane / SWR 0.352, double pane /
SWR-IG 0.249, VIG / SWR-VIG 0.164 Btu/hr·ft²·°F) instead of 0.16 for all three.

INOVUES. Owner: Stephan Ketterer, VP of Operations.

A stakeholder-facing page for 277 Park Avenue. Six controls (retrofit glass,
existing window seal, retrofit seal, desiccant pounds, room temperature, room
humidity) and one answer: how long the desiccant keeps the window cavity dry,
and on which days and hours the pane fogs afterwards.

## How it works

```
browser  ->  this app (server/)  ->  desiccant_life- engine (Railway)
             validates 6 controls     hour-by-hour physics
             adds fixed 277 Park inputs
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
npm test        # 63 tests: validation, echo check, retries, timeouts, cache, server, wording
```

## Deploy (Railway)

New service from this repo. No variables required; optional `ENGINE_URL`
(defaults to the live engine). `railway.json` sets build, start and the
`/health` check. `/health/engine` reports whether the engine is reachable.
