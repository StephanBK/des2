// The scenario: every control, range and fixed engine input lives
// here, once. The server imports it to validate requests and build engine
// calls; the web page imports it to draw the controls. Change it here only.

export const APP_VERSION = '2.2.0'

// Engine: INOVUES desiccant lifetime simulator (StephanBK/desiccant_life-).
// Needs the 2026-09-23 fog-map API (fog_map, years_after_full).
export const ENGINE_DEFAULT_URL = 'https://web-production-3950a.up.railway.app'

export const GRAMS_PER_LB = 453.59237

// Existing glass on the facade (v2.1). The retrofit goes 0.6 in behind it.
export const EXISTING = [
  { key: 'single', label: 'Single pane', tip: 'Existing single-pane glass, as on most older commercial facades.' },
  { key: 'double', label: 'Double pane', tip: 'Existing double-pane insulating glass unit (1 in overall: 1/4 in clear + 1/2 in air + 1/4 in clear). Values are estimates until WINDOW simulations replace them.' },
]

// Retrofit glass options: single = SWR, double = SWR-IG, VIG = SWR-VIG.
export const GLASSES = [
  { key: 'single', label: 'Single pane', product: 'SWR' },
  { key: 'double', label: 'Double pane', product: 'SWR-IG' },
  { key: 'vig', label: 'VIG', product: 'SWR-VIG' },
]

// Per existing glass and retrofit glass:
//   f_cold  temperature factor of the cavity side of the EXISTING glass,
//           center of glass: f = (T_surface - T_out) / (T_in - T_out)
//   u_ip    whole-assembly U-factor, Btu/hr.ft2.F
// Existing single pane: f from WINDOW (the 2026-09-16 study), U given by
// INOVUES 2026-09-29.
// Existing double pane: ESTIMATES (2026-10-15) until Arnold's WINDOW runs.
// One-dimensional series resistances, m2K/W, calibrated on the single-pane
// f values above:
//   R_o = 1/26 (outside film, NFRC 100 winter) + 0.006 (6 mm glass) = 0.0445
//   R_tot = R_o / f_single                      (0.654, 1.112, 3.176)
//   the IGU adds dR = 0.200 (1/2 in air gap) + 0.006 (second pane) = 0.206
//   f_double = (R_o + dR) / (R_tot + dR)        (0.291, 0.190, 0.074)
//   U_double = 1 / (1/U_single + dR x 5.678)    (0.249, 0.193, 0.138)
// The U step adds the IGU's resistance over the whole assembly, frame
// included, so it flatters U slightly; the f step is center of glass.
export const THERMAL = {
  single: {
    single: { f_cold: 0.068, u_ip: 0.352, estimate: false },
    double: { f_cold: 0.040, u_ip: 0.249, estimate: false },
    vig: { f_cold: 0.014, u_ip: 0.164, estimate: false },
  },
  double: {
    single: { f_cold: 0.291, u_ip: 0.249, estimate: true },
    double: { f_cold: 0.190, u_ip: 0.193, estimate: true },
    vig: { f_cold: 0.074, u_ip: 0.138, estimate: true },
  },
}

export function thermalOf(existing, glass) {
  const t = THERMAL[existing]?.[glass]
  if (!t) throw new RangeError(`no thermal values for existing ${existing}, glass ${glass}`)
  return t
}

/** Tooltip for a retrofit glass over a given existing glass. */
export function glassTip(existing, glass) {
  const g = GLASSES.find((x) => x.key === glass)
  const t = thermalOf(existing, glass)
  return `${g.label} retrofit glass (${g.product}). Cavity-side temperature factor of the existing glass f = ${t.f_cold.toFixed(3)}, assembly U = ${t.u_ip.toFixed(3)} Btu/hr·ft²·°F${t.estimate ? ' (estimate)' : ''}.`
}

// Seal ladders, tightest first. Keys are the engine's preset keys; the
// leakage numbers come from the engine (/api/presets), not from here.
// "Hermetic" is deliberately absent: not reachable with a field seal.
export const SEALS_EXISTING = [
  { key: 'wet_sealed', label: 'Wet-sealed' },
  { key: 'new_fixed', label: 'New fixed window' },
  { key: 'resealed', label: 'Freshly resealed' },
  { key: 'operable', label: 'Operable, in spec' },
  { key: 'aged', label: 'Aged gaskets' },
  { key: 'baseline', label: 'Unsealed baseline' },
]
export const SEALS_RETROFIT = [
  { key: 'wet_sealed', label: 'Wet-sealed' },
  { key: 'gasketed', label: 'Well-gasketed' },
  { key: 'certified_best', label: 'Best certified insert' },
  { key: 'certified_typical', label: 'Typical certified insert' },
  { key: 'vented', label: 'Vent slots' },
]

export const RANGES = {
  lb: { min: 0, max: 8, step: 1 },
  t: { min: 60, max: 80, step: 1 },
  rh: { min: 10, max: 60, step: 1 },
}

// The address is free text (v2.0): any building the engine's geocoder and
// the NREL weather set can reach (the Americas). lat/lon are where the
// address box's suggestion put it; when present, the engine's own geocode
// must land within SITE_TOL_DEG of it. The default is only a first-load
// example.
export const ADDRESS = { min: 5, max: 200 }
export const SITE_TOL_DEG = 0.02            // about 2 km, the size of one weather cell
export const DEFAULT_SITE = { addr: '350 Fifth Avenue, New York, New York 10118, United States', lat: 40.74844, lon: -73.98566 }

export const DEFAULTS = { ex: 'single', glass: 'vig', seal_out: 'wet_sealed', seal_in: 'wet_sealed', lb: 8, t: 70, rh: 30, ...DEFAULT_SITE }

// Every hidden engine input is pinned explicitly (not left to engine
// defaults), so an engine default change cannot move these results, and
// every one of them is checked against the engine's echo.
export const FIXED = {
  orientation: 'north',
  width_in: 60, height_in: 96, offset_in: 0.6,
  r_ip: 0.97,                 // f_cold and u_ip come from THERMAL, not fixed
  desiccant: 'ms3a',
  desorption: true,
  absorptance: 0.1,
  floors: 20, window_floor: 10,
  p_occ_pa: 5, p_unocc_pa: 0, occ_start_h: 7, occ_end_h: 19, weekdays_only: true,
  sealant_out: 'silicone', sealant_in: 'silicone',
  max_years: 20,
}

// Whole years simulated after the desiccant fills, so the first winter
// with a full desiccant is always in the picture.
export const YEARS_AFTER_FULL = 1

// Working hours for the calendar toggle, as in the earlier condensation
// calculator: Monday to Friday, 08:00 to 18:00. January 1 is a Monday, the
// same convention the engine uses for its HVAC schedule. 261 weekdays x 10 h.
export const WORKING_HOURS = { start: 8, end: 18, days: 261, hours: 2610, label: 'Monday to Friday, 08:00 to 18:00' }

// Plain-language list of what is fixed, for the assumptions drawer.
export const FIXED_DESCRIPTION = [
  ['Building', 'North facade, so no sun warms the glass (the cautious case). Window at mid-height of a 20-story building, where the stack effect is close to zero.'],
  ['Window', '60 × 96 in, 0.6 in cavity between the existing glass and the retrofit.'],
  ['Weather', 'Typical meteorological year for the site (NREL NSRDB), repeated every year.'],
  ['Start', 'Installation on January 1 with a fresh desiccant.'],
  ['Desiccant', '3A molecular sieve. It can release water again when warm (desorption on).'],
  ['Sealant', 'Silicone beads on both layers; water vapor slowly diffuses through them.'],
  ['Building pressure', '+5 Pa on weekdays 7 am to 7 pm, 0 Pa otherwise, plus stack and wind.'],
]

export const ASSUMPTIONS = [
  'Fog means a water film thicker than 5 µm on the cavity side of the existing glass. That visibility threshold is an estimate; no optical measurement exists yet.',
  '"Wet-sealed" is the ASTM E283 detection floor (0.005 cfm/ft² at 75 Pa), not a measurement of an installed INOVUES seal. A pressure test on an installed cavity would replace it.',
  'With desorption on, the desiccant gives some water back when warm and takes it up again when cold, a small seasonal buffer: slightly less fog after it is full, and a longer life. The engine gives 3A no extra capacity below 25 °C; real 3A holds a few percent more when cold, so the results are on the cautious side here.',
  'After the desiccant is full, the pane fogs about as much as with no desiccant. What decides how much is the real air leakage of the wet seals, which has not been measured on an installed cavity.',
  'Each pairing of existing glass and retrofit glass has its own cavity-side temperature factor and assembly U-value (hover a glass button to see them). Over an existing single pane: from WINDOW and INOVUES. Over an existing double pane: estimates from a layer-by-layer heat-flow model until WINDOW simulations replace them.',
  '"Desiccant full" means 95 % of its capacity at 25 °C.',
  'The same typical weather year repeats; no climate trend or unusual years.',
]
