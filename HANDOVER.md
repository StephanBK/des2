# HANDOVER: cavity fog outlook (des2)

Last session: 2026-10-16. State: v2.5.0 (assembly U as a typed input, plus
everything below: empty start, window assembly bar, existing single or
double pane with WINDOW f values, customer PDF report, 3 pages with a
disclaimer). Before that: 2026-10-15, v2.4.1. Before that:
2026-09-29, v1.11.0. Repo StephanBK/des2 (Stephan's
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

## v2.5.0 (2026-10-16): assembly U-value as a prominent input

- Stephan: while Arnold's double-pane U values are pending, make U a
  prominent input field in general. Decisions: a typed U resets when the
  existing window or retrofit glass is switched; range 0.050 to 1.200
  Btu/hr.ft2.F, 3 decimals; in the report the typed U applies to the chosen
  glass only, the other two keep their table U, and it is marked "entered".
- Page: third group "Assembly U-value" in the assembly bar (UField in
  web/src/Controls.jsx), a large number box pre-filled with the table U for
  the pairing; Enter or leaving the box runs it, Escape reverts, empty or
  "Reset" returns to the table value. Teal box = entered; red = out of
  range (nothing runs). The retrofit switch's detail line now shows f only.
  The three groups sit on one line from 970 px; below 960 px they stack.
- Model: scenario field u (null = table value). URL/API param u, optional,
  server-validated (U_INPUT in shared/scenario.js); a typed U equal to the
  table value normalizes to null (normalizeU). thermalOf(ex, glass, u)
  returns { f_cold, u_ip: u, u_estimate: false, u_entered: true, u_table }.
  f is never changed by a typed U (simplification: in reality f and U move
  together; the assumptions drawer says so).
- scenarioKey leaves u out when null, so pre-v2.5 cache keys and report ids
  are unchanged.
- Report: "ENTERED" tag after U on page 1 plus a one-line teal note with
  the standard value; options table shows "ENTERED" under the chosen
  glass's U and a footnote. Other glasses' runs and sweeps are sent u null
  (tested against what the fake engine actually received).
- Live check, Boston 2 Liberty Sq, existing double, VIG, 4 lb, 70 F / 35 %:
  U 0.138 (standard) -> 0.300 typed: fog days/yr 157 -> 154, desiccant life
  84 -> 85 days. U moves the retrofit side of the cavity, not the existing
  glass where fog forms (f), so its effect on fog is small.
- PDF page-1 room: a two-line note pushed real-data page 1 to 2 pages (the
  fake-engine test still showed 3); the note is one line now. Checked on
  real data: Boston and Chicago with a long project name, 3 pages each.
- Tests 85 -> 95 (test/url.test.js new). Test helpers now leave null values
  out of query strings, as the page does.
- When Arnold's U values arrive: v2.3.0's "To finish" steps still apply;
  the U box then simply pre-fills with the WINDOW values.

## v2.4.0 (2026-10-15 evening): empty start, window assembly bar

- v2.4.1 (same evening): Stephan had the "Start with the building's
  address" card removed (the small hint beside the address box stays) and
  the assembly made sleeker and more separated: two pill switches
  (segmented controls) with a divider between them, names only on the
  buttons; the chosen option's details on one line under each switch
  (existing: one lite / IGU; retrofit: label, U, f, with "*" and a note
  while U is an estimate). On phones the switches go full width.

- Stephan: no default address; desiccant default 0; an easy, prominent
  single/double toggle for the existing window that changes the drawing;
  the 3 retrofit glasses as a toggle, each with its own U; 6 combinations
  (double-pane U values to follow "tomorrow", i.e. 2026-10-16).
- DEFAULTS: addr '' (lat/lon null), lb 0. Nothing runs until an address is
  entered: empty-state card where the results go, calendar placeholder,
  "Customer report" disabled. EXAMPLE_SITE (350 Fifth Ave) is for tests
  only; tests use BASE = { ...DEFAULTS, ...EXAMPLE_SITE }.
- AssemblyBar (web/src/Controls.jsx) in the top band under the address:
  "Existing window" (Single pane / Double pane) + "INOVUES retrofit glass"
  (SWR / SWR-IG / SWR-VIG) as large buttons with small section icons; each
  retrofit button shows its U for the chosen existing window, "*" and a
  note while that U is an estimate. Old side and under-drawing pickers
  removed. Drawing: existing double pane now has a wide air gap with edge
  spacers and an "air" label; labels read "Existing single/double pane".
- Live engine, Chicago 233 S Wacker, existing double, VIG, no desiccant,
  70 F / 30 %: 104 fog days/yr (was 87 with the estimated f 0.074; WINDOW
  f 0.064 runs the old glass a little colder).
- Tests 84 -> 85.

## v2.3.0 (2026-10-15): WINDOW f values for an existing double pane

- Stephan (from Arnold's WINDOW runs): f for an existing double pane with
  SWR 0.301, SWR-IG 0.200, SWR-VIG 0.064. U values still to come.
- THERMAL.double f replaced; the blanket `estimate` flag became
  `u_estimate` (true only for the double-pane U). App note, tooltips,
  assumptions text, report tag (now right after U), report note and the
  options-table asterisk (U column only) all say "U estimated".
- My 1-D estimates were 0.291 / 0.190 / 0.074: off by +0.010, +0.010,
  -0.010 versus WINDOW. A test keeps that agreement within 0.011 and
  still recomputes the estimated U.
- Effect, Boston 2 Liberty Sq, existing double, 4 lb, 70 F / 35 % RH:
  fog days/yr SWR 0 -> 0, SWR-IG 39 -> 1, SWR-VIG 154 -> 157; headroom
  unchanged (40 / 30 / 25 %); desiccant life unchanged. SWR-IG at 35 %
  sits on the fog threshold, so +0.010 in f removed almost all its fog.
- To finish when Arnold sends U: replace THERMAL.double u_ip, set
  u_estimate: false, update the expected U in the test "each existing +
  retrofit pairing...", drop the U recomputation test.

## v2.2.0 (2026-10-15): customer report (PDF)

- Later the same day: Stephan had page 4 (method, references, limits,
  assumptions, reproduce link) taken out. The report is 3 pages now; the
  page-4 description below is history. Note what left with it: the
  "not a warranty" line, the typical-year / neighbouring-cell caveat, the
  unmeasured-seal caveat and the reopen-this-scenario link. The page-1
  ESTIMATE note for an existing double pane stays.
- v2.2.2: a liability disclaimer closes page 3 (DISCLAIMER in
  server/report-pdf.js, tested for its key phrases): model estimates for a
  typical year, may differ, planning only, not a warranty / guarantee /
  certified engineering analysis, product warranties per INOVUES' written
  terms, no liability for reliance. To make room the headroom chart is
  118 pt tall and its notes are one line each. Counsel should review the
  wording.

- Stephan: an export that summarizes the findings for a customer, highly
  polished, with the address and the condensation days, plus anything that
  makes INOVUES more credible. Decisions: PDF built on the server; include
  the comparison of all 3 retrofit glasses AND humidity headroom.
- Button "Customer report" in the header -> dialog with an optional project
  or customer name (max 80 chars, on the cover) -> GET /api/report?<run
  params>&project= -> PDF download. /api/report.json gives the same data.
- 5 engine calls per report, all cached like page runs: the scenario, the
  two other retrofit glasses, and per glass a room-RH sweep (/api/sweep,
  x_key rh_room, 20..60 % in 5 % steps, no desiccant, 2 years, fog days in
  year 2 = long term once any desiccant is spent). Sweep inputs are
  echo-checked too. First report for a new address: about 15 to 20 s.
- PDF: @react-pdf/renderer (pure Node, no browser on Railway), Archivo from
  @fontsource/archivo (woff). server/report-data.js gathers and computes
  (testable), server/report-pdf.js draws. 4 Letter pages:
  1. summary: address, verdict, the 3 page cards, site and assembly tables,
     all three glasses at a glance, ESTIMATE note for an existing double pane
  2. calendar: 365 x 24 fog map of the reported year (same colours as the
     page), fog stats incl. working hours, fog days by month, desiccant
     loading curve, a fog-pattern sentence that follows the data
  3. options table (U, f, life, first fog, fog days/yr, headroom), headroom
     chart (3 glasses, this room's RH marked), site climate tiles
  4. method in 6 steps, data and references, limits (incl. typical-year and
     neighbouring-cell caveat, unmeasured seals, double-pane estimates,
     summer heat on an existing IGU not modelled, failed IGUs out of scope,
     not a warranty), assumptions, reproduce: report id (FNV-1a hash of the
     inputs) + versions + a link that reopens the exact scenario
- The font has no arrows or comparison signs: the PDF text uses words.
- Layout headroom checked: worst case (estimates + long project name) still
  4 pages; a test asserts 4 pages for the fake-engine report.
- Live-engine examples (2026-10-15):
  Chicago 233 S Wacker, existing single, VIG, 8 lb, 70 F / 30 %: dry
  114 days, 119 fog days/yr once full; options SWR 84 / SWR-IG 113 /
  SWR-VIG 119; all clear only up to 20 % RH. HDD65 6,059.
  Boston 2 Liberty Sq, existing double, VIG, 4 lb, 70 F / 35 %: dry 84
  days, 154 fog days/yr once full; options SWR 0 (clear up to 40 % RH) /
  SWR-IG 39 (30 %) / SWR-VIG 154 (25 %).
- Tests 75 -> 83.

## v2.1.0 (2026-10-15): existing double pane as a standard option

- Stephan: besides upgrading an old single pane, offer an existing double
  pane as the starting point. Arnold will run WINDOW for the real values;
  until then estimates, labeled as such in the app (note under the picker,
  "(estimate)" in the glass tooltips) and later in the report.
- New control "Existing glass" (URL ex=single|double, default single).
  f_cold and u_ip now come from THERMAL[existing][retrofit] in
  shared/scenario.js; the comment there carries the full derivation.
- Spec sent to Arnold (2026-10-15): each retrofit 0.6 in behind an existing
  IGU (1 in: 1/4 clear + 1/2 air + 1/4 clear, no low-e, unless he knows our
  typical one); NFRC 100 winter; report f at the cavity side of the IGU's
  inner pane, center of glass, and whole-assembly U on the same basis as
  0.352/0.249/0.164; ideally rerun the 3 single-pane cases the same way.
  To apply: replace THERMAL.double, set estimate: false, update the test
  "each existing + retrofit pairing..." and delete the derivation test.
- Estimates: f 0.291 / 0.190 / 0.074, U 0.249 / 0.193 / 0.138 (single /
  double / VIG retrofit). Tested: physical ordering, and an independent
  recomputation from the stated resistances.
- Live engine, Chicago (233 S Wacker), wet/wet, no desiccant, 70 F / 30 %,
  existing double pane: SWR 0 fog days/yr, SWR-IG 8, SWR-VIG 87 (VIG over
  an existing single pane there: about 119 once the desiccant is full).
- Drawing shows the existing unit as two lites with an air gap.
- Tests 72 -> 75.

## v2.0.0 (2026-10-15): any address, with autocomplete

- Stephan: make the app universal, not 277 Park: an address box with
  autocomplete, the weather pulled for that site. (Next in the same
  session: existing double-pane option, customer PDF report.)
- Address box (web/src/AddressBox.jsx): suggestions from /api/suggest, a
  server proxy to Mapbox Geocoding v6 forward (server/suggest.js), the same
  API the engine geocodes with. Countries us,ca,mx,pr (NREL weather covers
  the Americas). Needs Railway variable MAPBOX_TOKEN on des2; without it the
  box still runs a typed address and shows what the engine matched.
- URL carries addr (+ lat/lon when picked). Server: addr cleaned (whitespace
  collapsed, 5 to 200 characters, no control characters); lat/lon a pair,
  rounded to 5 decimals. The engine's geocode must land within 0.02 deg of
  the picked point, else 502 (replaces the 277 Park ZIP check). Typed
  addresses run wherever the engine lands; the page shows "Matched: ...".
- Fixed building inputs: 20 floors, window on floor 10 (was 50/25). Both
  are mid-height, where stack is near zero: checked live 2026-10-15, same
  fog for 50/25 and 20/10 at two NYC addresses.
- FINDING: neighbouring NREL weather cells can disagree a lot near the fog
  threshold. VIG over single pane, wet/wet, no desiccant, 70 F / 30 %:
  350 Fifth Ave (cell 40.73, -73.98) 0 fog days; 277 Park (cell 40.77,
  -73.98) 66 fog days/yr. Each cell's typical year picks different months.
- Default example: 350 Fifth Avenue, New York (first load only).
- Site climate from the engine (coldest/warmest hour, annual mean, HDD65
  from daily means, days with a mean below freezing) is now in each result
  (engine.climate) for the report.
- Tests 65 -> 72.

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

- Arnold's WINDOW U for an existing double pane (f done in v2.3.0; steps in
  v2.3.0 "To finish"). Until then a U can be typed in (v2.5.0).
- MAPBOX_TOKEN on the des2 Railway service (copy from the engine service)
  turns on address suggestions.
- Possible report extras: a location map (Mapbox static image), the
  existing-single vs existing-double comparison, a cost line per option.

- Desorption / cold-capacity: after the engine fix it no longer creates
  fog; kept on. Vendor 3A isotherm at 0 to 10 C would still sharpen it.
- U per glass: done in des2 v1.11.0 (values from INOVUES, not yet from a
  WINDOW run per glass).
- Odoo embed if wanted (the server sets X-Frame-Options SAMEORIGIN and
  frame-ancestors 'self'; loosen both for the Odoo domain).
