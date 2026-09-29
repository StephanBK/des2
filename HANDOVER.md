# HANDOVER: 277 Park cavity fog outlook (des2: U per glass)

Last session: 2026-09-29. State: v1.11.0. Repo StephanBK/des2 (Stephan's
personal account), a copy of StephanBK/park277-desiccant with full history
(up to v1.10.0, main ad19a79). des2 is identical to park277-desiccant in
every aspect except ONE: the assembly U-value is per glass instead of held
at 0.16. Both apps call the same desiccant_life- engine.

## Deploy order (matters)

1. Engine first: desiccant_life- needs the fog-map API (main 0d79ef6) and
   the air relaxation fix (main c20a557), both live 2026-09-23. After any
   engine change, RESTART this app's Railway service: it caches results for
   24 h and would keep serving the old numbers.
2. This repo: Railway service from StephanBK/des2, no variables needed.
If the engine lacks the fog map, the page shows "The simulation did not
run" with the detail "engine returned no fog map": by design, not a crash.

## v1.11.0 (des2, 2026-09-29): U per glass

- Stephan: clone the 277 Park app, identical except U is not constant:
  0.352 for SWR, 0.249 for SWR-IG, 0.164 for SWR-VIG (Btu/hr.ft2.F,
  whole assembly). Mapping confirmed: Single pane = SWR, Double pane =
  SWR-IG, VIG = SWR-VIG. On-screen labels kept identical.
- shared/scenario.js: u_ip on each GLASSES entry, u_ip removed from FIXED,
  tooltips show U, assumption text updated. server/engine.js engineParams
  sends glass.u_ip next to glass.f_cold.
- Tests 63 -> 65: parity test now pins des2's default request (u_ip 0.164,
  the only difference from park277-desiccant and desiccant_life-); new test
  that each glass sends its own U and f; guard test that u_ip never
  returns to FIXED.
- Verified against the live engine: echo u_ip 0.352 / 0.249 / 0.164,
  engine f_warm 0.4094 / 0.2815 / 0.1731 = f_cold + 0.97 x U by hand.
- Default scenario (8 lb, wet/wet, 70 F / 30 %), U 0.16 -> per glass:
  single full 256.0 -> 242.2 d, fog 0 -> 0 d/yr; double full 256.1 -> 255.9 d,
  fog 8 -> 4 d/yr; VIG unchanged (256.2 d, 63 d/yr).
- Parity with desiccant_life- (Odoo) no longer holds for U by design.

## v1.10.0: first visible fog follows the working-hours toggle

- Stephan: yes, box 2 follows the toggle too. Working view: "First visible
  fog in working hours" = first hour with visible fog on a weekday 08:00 to
  18:00 (story.js firstFogHour); a night or weekend fog that is gone by
  08:00 does not count. The sentence and the calendar's first-fog marker
  follow as well. Box 1 (desiccant life) stays all hours.
- Year-boundary report ("no fog end of year 1, fog right at the start of
  year 2"): not reproduced; recommended a permanent engine guard test for
  state continuity at year boundaries, plus the exact link when it recurs.

## v1.9.0 (same day): parity with the old simulator in Odoo

- The old simulator (desiccant_life-, embedded in Odoo) now starts on this
  app's default scenario and uses the same definitions (first visible fog,
  fog days per year, one whole year past saturation). Proven: identical
  inputs give byte-identical engine results; engine HANDOVER session 7.
- test/engine.test.js "parity" pins this app's default engine request to
  the literal values that desiccant_life- tests/test_parity.py pins too.
  Change the default scenario here AND in desiccant_life-
  frontend/src/defaults.json, or one suite fails.
- Next (Stephan: "both"): one front end later, this app plus an Advanced
  mode with the old app's inputs, so the two cannot drift at all.

## v1.8.0 (same day): the fog-days box follows the working-hours toggle

- Stephan: with working hours selected, the top number should show working
  days too, to match the panels. Third box, sentence and drawing chip now
  follow the toggle: "Working days with fog per year once full, N days,
  out of 261 working days". Boxes 1 (desiccant life) and 2 (first visible
  fog) stay all hours.
- NOTE for reading: the box is always the LAST simulated year (year 2 for a
  run that fills in year 1), so it matches the Year 2 panel, not Year 1.
  Stephan's check scenario (VIG, freshly resealed / best certified insert,
  8 lb, 70 F / 30 %): year 1 88 fog days (62 working), year 2 109 (77).
- Box 1 detail adds "(8.4 months)" only when months say something the days
  do not (no more "13 days ... (13 days)").

## v1.7.0 (same day): fog days instead of fog hours

- Stephan: fog DAYS at the top, fog hours removed from the year panels.
  Third box: "Fog days per year (once full)" = days with at least one hour
  of visible fog in the last simulated year (story.js fogDaysPerYear);
  sentence and drawing chip in days too. All three boxes are now days:
  default 256 days dry, first fog 390 days, 63 fog days a year once full
  (matches the Year 2 panel's "Days with fog 63").
- Year panels: 4 stats (days with fog, fog events, longest event,
  desiccant); 2 x 2 below 900 px.

## v1.6.0 (same day): working-hours toggle on the calendar

- Stephan: toggle between working hours and all hours for the calendar,
  "like before". Same definition as the earlier condensation calculator:
  Monday to Friday, 08:00 to 18:00 (2,610 h, 261 days), January 1 a Monday,
  the engine's own HVAC convention. shared/scenario.js WORKING_HOURS,
  story.js isWorkingHour / yearStats(fog, working).
- Working view: off-hours cells faded out and not counted; stats become
  "% of 2,610 working hours" / "% of 261 working days"; an off hour ends a
  fog event (so no event exceeds 10 h). (From v1.8 the fog-days box at the
  top follows the toggle; the other two boxes count all hours.) View kept in the
  link as &hours=working; never sent to the API.
- Default, year 2: all hours 1,446 h (16.5 %); working hours 420 h (16.1 %),
  43 working days. Near-equal shares: the winter fog is one long spell.

## v1.5.0 (same day): design pass for Anas

- Boxes 1 and 2 in the same unit, days, with the date smaller below
  (Stephan: first visible fog in days). Default: 256 days (full September
  14, 8.4 months), first fog 390 days (January 25, year 2).
- Fog is water blue everywhere (boxes, drawing, calendar); amber read as
  heat or danger. Teal stays "desiccant working", light grey "no fog".
- Calendar redesigned after the reference Stephan posted (study PDF page):
  one numbered panel per year, a stat row (fog hours, days with fog, fog
  events = unbroken runs, longest event, desiccant status), a 365 x 24
  cell grid with 1 px gaps, months on top, 00:00 to 18:00 on the left,
  square legend. Cell gaps drop on phones (under 3 device px per day);
  month initials under 520 px; marker labels flip by their own width.
- Finding shown by the stats: the VIG winter fog is few, very long events
  (default year 2: 3 events, longest 1,306 h, about 54 days).
- Pound conversion verified: 1 lb = 453.59237 g exactly; 8 lb = 3,628.739 g
  (engine echo identical, 762 g water capacity); literal-value test added.
- FLAG, not acted on: 8 lb of 3A is 5.2 L (bulk 0.70 g/mL). A 0.6 x 0.6 in
  channel around the whole 60 x 96 in perimeter holds 312 in x 0.36 in2 =
  112 in3 = 1.84 L, about 2.8 lb. Above ~3 lb may not physically fit a
  0.6 in cavity. DECIDED (Stephan): do not cap; the slider stays 0 to 8 lb.

## v1.4.0 (same day): drawer text after the engine fix

- The engine's with-desiccant step made the cavity air jump to balance
  even when the desiccant was full, inflating fog after saturation
  (desiccant_life- HANDOVER session 6; fixed, main c20a557). Live, VIG,
  wet-sealed both, 70 F / 30 %, fog in a settled year:
    no desiccant                1,564 h
    4 lb, desorption off        1,544 h   (-1.3 %)   was 1,625
    4 lb, desorption on         1,457 h   (-6.8 %)   was 1,732
    8 lb, desorption off        1,514 h   (-3.2 %)
    8 lb, desorption on         1,446 h   (-7.5 %)   was 1,738
  A full desiccant never adds fog; desorption is a small seasonal buffer
  and lengthens life (8 lb: 8.4 months on, 7.1 off).
- Default page (8 lb): dry for 8.4 months (full September 14, year 1);
  first visible fog January 25, year 2; 1,446 h of fog a year once full.
- Drawer: the "full desiccant releases water and causes fog" caveat is
  replaced by the buffer description plus: after the desiccant is full the
  pane fogs about as much as with none; the unmeasured wet-seal leakage is
  what decides how much.
- Message for stakeholders: the desiccant buys a clear first winter. After
  that, fog depends on the seal, so the measurement that matters is a
  pressure-decay test on an installed cavity.

## v1.3.0 (same day): fair per-year numbers, location check

- Stephan asked why 4 lb showed more fog (1,732 h) than no desiccant
  (1,336 h). Mostly an unfair comparison in the app: 0 lb ran one year, and
  year 1 is a start-up year (clean pane, fresh cavity air). Live, VIG,
  wet-sealed both, 70 F / 30 %, typical (second) winter:
    no desiccant                    1,564 h
    4 lb full, desorption off       1,625 h   (+61, +3.9 %)
    4 lb full, desorption on        1,732 h   (+168; desorption = 107 of it)
  The +61 h with desorption off was not physical: an engine bug, fixed the
  same day (see v1.4.0 for the corrected numbers).
- Now: 0 lb runs 2 years; the third box, the sentence and the drawing chip
  all use fog in ONE year = the last simulated year (story.js fogPerYear).
- Server checks the engine's geocoded location: matched address must contain
  10172 and lie within 0.01 deg of 40.7555, -73.975 (scenario.js
  EXPECTED_SITE). "277 Park Avenue, New York, NY" without the ZIP geocodes
  to 277 Park Avenue, Brooklyn 11205; the old desiccant app's default
  address has no ZIP, so its first-load scenario uses Brooklyn weather
  (fix proposed for desiccant_life-).
- Numbers I showed during the build (5.4 months, 886 h, February 4) came
  from the engine's test weather file, which has no wind direction (the
  engine then treats every windy hour as windward). Live default (8 lb):
  full after 8.4 months (September 14, year 1), first fog January 23,
  year 2, 1,738 h in year 2 (pre-fix engine; see v1.4.0). Same NSRDB cell
  (station 1245244).

## v1.2.0 (same day): result boxes on top

- Stephan: make the callouts on top more pronounced, in a box. The answer
  sentence became three boxes (shared/story.js headlineCards, tested for
  every case): desiccant life (teal), first visible fog (amber), fog hours
  once full (amber); boxes turn neutral grey when there is no fog. The
  sentence stays as a screen-reader live region. Stephan: "overall we are
  moving in the right direction".

## v1.1.0 (same day): cavity in the middle, light theme

- Stephan asked for the cavity in the middle with the values set left and
  right of it, and a light theme.
- Layout: answer sentence on top; then [existing window seal | live cavity
  section | retrofit seal + room temperature + RH]; glass and desiccant
  directly under the drawing; fog calendar full width below.
- web/src/Cavity.jsx: SVG section, not to scale. Outside, existing pane,
  cavity with the desiccant cartridge (height follows lb), retrofit glass by
  type (VIG with pillars), seal beads (solid = wet-sealed, dashed + air
  arrows for leakier rungs, more arrows further down the ladder), room
  T/RH/dew point, and result chips (dry for X, fog hours once full), fog
  band and droplets on the pane when the run fogs.
- Light theme: fog is amber (#d9731c) because white mist does not show on
  a light page; teal (#138fa3) still means desiccant working.

## Decisions (Stephan, 2026-09-23)

- Controls: glass (Single 0.068, Double 0.040, VIG 0.014 cavity-side f),
  existing-window seal ladder and retrofit seal ladder (engine presets,
  hermetic removed on both), desiccant 0 to 8 lb in 1 lb steps (default 8),
  room 60 to 80 F (70), RH 10 to 60 % (30).
- U held at 0.16 for all three glasses "for now".
- Desorption ON.
- Visual: fog calendar per year (days across, hours down), teal while the
  desiccant works, white mist for fog, one year simulated after the fill.
- Dark, cinematic look. One assumptions drawer, closed by default.
- Architecture: frontend plus own server that proxies the engine
  (validation, fixed inputs, echo check, location check, cache, retry, timeout).

## Findings to carry

- The engine reads room conditions as `t_in` / `rh_in`. The Sep 16 study
  sent `rh_in_pct=30`, silently ignored: those runs used 35 % RH. This app
  checks every input against the engine's echo, so that cannot recur here.
- Default (VIG, wet-sealed both, 8 lb, 70 F / 30 %), LIVE weather, fixed
  engine: full after 8.4 months, first fog January 25 of year 2, 1,446 h
  in year 2. (Earlier figures, 5.4 months / 886 h from the test weather
  file and 1,738 h from the pre-fix engine, are superseded.)
- Superseded: the earlier finding that a full sieve with desorption on
  CAUSES fog was mostly the engine bug fixed in desiccant_life- session 6.
  With the fix, desorption slightly REDUCES fog (seasonal buffer).

## Design notes

- Palette (v1.1): page #f7f9fa, ink #13232f, clear cell #e3ecf1, teal
  #138fa3 (working), amber #d9731c (fog). Archivo variable, self-hosted;
  wide cut for headings. (v1.0 was dark: night glass with white mist.)
- Fog opacity 0.5 + 0.055 x level; teal 0.16 + 0.5 x remaining capacity.
- Runs of 3+ quiet years fold into one band (tested; rare with 8 lb max).
- Class names: header is `.masthead`; calendar lanes are `.lane-top` /
  `.lane-bottom` (a shared `.top` once inflated the lanes).

## Open items

- Desorption / cold-capacity: after the engine fix it no longer creates
  fog; kept on. Vendor 3A isotherm at 0 to 10 C would still sharpen it.
- U per glass: done in des2 v1.11.0 (values from INOVUES, not yet from a
  WINDOW run per glass).
- Odoo embed if wanted (the server sets X-Frame-Options SAMEORIGIN and
  frame-ancestors 'self'; loosen both for the Odoo domain).
