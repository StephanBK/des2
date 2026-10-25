// The scenario: every control, range and fixed engine input lives
// here, once. The server imports it to validate requests and build engine
// calls; the web page imports it to draw the controls. Change it here only.

export const APP_VERSION = '2.9.0'

// Engine: INOVUES desiccant lifetime simulator (StephanBK/desiccant_life-).
// Needs the 2026-09-23 fog-map API (fog_map, years_after_full) and, since
// v2.9, engine 0.3.0 (existing_glass, 2026-10-25).
export const ENGINE_DEFAULT_URL = 'https://web-production-3950a.up.railway.app'

export const GRAMS_PER_LB = 453.59237

// Existing glass on the facade (v2.1). The retrofit goes 0.6 in behind it.
export const EXISTING = [
  { key: 'single', label: 'Single pane', tip: 'Existing single-pane glass, as on most older commercial facades.' },
  { key: 'double', label: 'Double pane', tip: 'Existing double-pane insulating glass unit (1 in overall: 1/4 in clear + 1/2 in air + 1/4 in clear). f values from WINDOW; U values are estimates until WINDOW results replace them.' },
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
// Existing double pane:
//   f from WINDOW (Arnold, given by Stephan 2026-10-15): 0.301, 0.200, 0.064.
//   U still an ESTIMATE (u_estimate: true) until Arnold's WINDOW U arrives.
// Estimate method, one-dimensional series resistances, m2K/W, calibrated on
// the single-pane f values above:
//   R_o = 1/26 (outside film, NFRC 100 winter) + 0.006 (6 mm glass) = 0.0445
//   R_tot = R_o / f_single                      (0.654, 1.112, 3.176)
//   the IGU adds dR = 0.200 (1/2 in air gap) + 0.006 (second pane) = 0.206
//   f_double = (R_o + dR) / (R_tot + dR)        (0.291, 0.190, 0.074)
//   U_double = 1 / (1/U_single + dR x 5.678)    (0.249, 0.193, 0.138)
// The estimated f came within 0.010 of WINDOW for all three glasses
// (0.291 vs 0.301, 0.190 vs 0.200, 0.074 vs 0.064), so the same method's
// U values are a fair stand-in. The U step adds the IGU's resistance over
// the whole assembly, frame included, so it flatters U slightly.
export const THERMAL = {
  single: {
    single: { f_cold: 0.068, u_ip: 0.352, u_estimate: false },
    double: { f_cold: 0.040, u_ip: 0.249, u_estimate: false },
    vig: { f_cold: 0.014, u_ip: 0.164, u_estimate: false },
  },
  double: {
    single: { f_cold: 0.301, u_ip: 0.249, u_estimate: true },
    double: { f_cold: 0.200, u_ip: 0.193, u_estimate: true },
    vig: { f_cold: 0.064, u_ip: 0.138, u_estimate: true },
  },
}

// v2.5 (Stephan 2026-10-16): the assembly U is a prominent input. Empty =
// the table value above for the chosen pairing; a typed U replaces it for
// the chosen retrofit glass only (the report's other two glasses keep their
// table values). f stays from the table. Switching the existing window or
// the retrofit glass clears a typed U.
export const U_INPUT = { min: 0.05, max: 1.2, decimals: 3 }

/** f and U for a pairing; with a typed U (a number), that U replaces the table value. */
export function thermalOf(existing, glass, u = null) {
  const t = THERMAL[existing]?.[glass]
  if (!t) throw new RangeError(`no thermal values for existing ${existing}, glass ${glass}`)
  if (u === null || u === undefined) return t
  return { f_cold: t.f_cold, u_ip: u, u_estimate: false, u_entered: true, u_table: t.u_ip }
}

// v2.6 (Stephan 2026-10-16): cavity depth (offset) between the existing
// glass and the retrofit is an input, 0.6 in by default (the value every f
// and U above was computed for). In the engine the offset sets only the
// cavity air volume; f, U and r_ip stay the 0.6 in values (said on the page
// and in the report).
export const OFFSET_INPUT = { min: 0.25, max: 4, decimals: 2, default: 0.6 }

// v2.7 (Anas 2026-10-17): facade orientation and window width and height are
// inputs again (fixed since v2.0). North is the default but NOT always the
// worst case: the facade also sets the wind pressure, so at 31-00 47th Ave,
// Long Island City (existing double, VIG, aged / tight dry seal, 0 lb,
// 70 F / 30 %) the live engine gave north 38, east 50, south 38, west 6 fog
// days a year; window 30 x 48 / 60 x 96 / 120 x 120 gave 39 / 38 / 34. The engine accepts these four orientations
// and 1 to 400 in for each side; the page allows 12 to 240 in, whole inches.
// At their defaults (north, 60 x 96 in) they stay out of links, cache keys and
// report ids, so everything from before v2.7 keeps working unchanged.
export const FACADES = [
  { key: 'north', label: 'North' },
  { key: 'east', label: 'East' },
  { key: 'south', label: 'South' },
  { key: 'west', label: 'West' },
]
export const WINDOW_INPUT = { min: 12, max: 240, width: 60, height: 96 }

// v2.8 (Stephan 2026-10-19, after 2000 Colorado Avenue, Boulder showed no fog
// where a report at a fixed 20 % RH predicted it): the room air can be a
// fixed RH (as before, the default) or a building without humidification,
// where the engine (room_humidity=unhumidified) uses the outdoor air's
// moisture plus what the occupants add. Office occupants, from the sources:
//   36 to 44 W latent per seated office worker = 36 x 3600 / 2450 = 53 to 65 g/h
//   ASHRAE 62.1 office air 17 cfm/person = 28.9 m3/h x 1.20 kg/m3 = 34.7 kg/h
//   53 to 65 / 34.7 = 1.5 to 1.9 g/kg at full design occupancy; 1.2 at about 70 %
// fading after hours at 0.5 air changes per hour. Both ESTIMATES. Over 8
// cities x 3 assemblies this mode gave 18 % fewer fog days than a fixed 30 %
// in total, but MORE in humid winters (Seattle): it is the right room air
// for an unhumidified building, not a "less fog" switch.
export const HUMIDITY = [
  { key: 'fixed', label: 'Fixed RH', engine: 'fixed', tip: 'The room is held at the relative humidity set below, every hour of the year (a humidified building, or a cautious assumption).' },
  { key: 'none', label: 'No humidification', engine: 'unhumidified', tip: 'No humidifier: the room air carries the outdoor air\'s moisture plus what the occupants add (office). Drier than a fixed RH in cold, dry climates; can be wetter in humid winters.' },
]
export const PEOPLE = { gkg: 1.2, fade_ach: 0.5 }

// v2.8: building height and the window's floor are inputs (fixed at 20 / 10
// since v2.0: mid-height, stack effect near zero). Floor height stays the
// engine's 3.6 m (11.8 ft). In a heated building the room air pushes OUT
// through windows above mid-height (and outdoor air comes in below it), so
// a window near the top of a short building fogs more: at 2000 Colorado Ave
// (11 floors, floor 10) the same report inputs give 53 fog days, not 7.
export const BUILDING_INPUT = { min: 1, max: 100, floors: 20, wfloor: 10, floor_height_ft: 11.81 }

/** Height of the window above the building's neutral plane (mid-height), in feet; negative below it. */
export function heightAboveMidFt(floors, wfloor) {
  return (wfloor - 0.5 - floors / 2) * BUILDING_INPUT.floor_height_ft
}

/** A typed U that equals the table value is no override: null, so links and caches stay clean. */
export function normalizeU(existing, glass, u) {
  if (u === null || u === undefined) return null
  return Math.abs(u - thermalOf(existing, glass).u_ip) < 0.0005 ? null : u
}

/** Tooltip for a retrofit glass over a given existing glass. */
export function glassTip(existing, glass) {
  const g = GLASSES.find((x) => x.key === glass)
  const t = thermalOf(existing, glass)
  return `${g.label} retrofit glass (${g.product}). Cavity-side temperature factor of the existing glass f = ${t.f_cold.toFixed(3)}, assembly U = ${t.u_ip.toFixed(3)} Btu/hr·ft²·°F${t.u_estimate ? ' (estimate)' : ''}.`
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
// Retrofit labels renamed by Anas 2026-10-17 (keys unchanged, so links and
// the engine presets still match): well-gasketed, best certified insert,
// typical certified insert and vent slots became the dry-seal names below.
export const SEALS_RETROFIT = [
  { key: 'wet_sealed', label: 'Wet-sealed' },
  { key: 'gasketed', label: 'Dry-seal, max compression' },
  { key: 'certified_best', label: 'Dry-seal, tight' },
  { key: 'certified_typical', label: 'Dry-seal, good' },
  { key: 'vented', label: 'Vented' },
]

export const RANGES = {
  lb: { min: 0, max: 8, step: 1 },
  t: { min: 60, max: 80, step: 1 },
  rh: { min: 10, max: 60, step: 1 },
}

// The address is free text (v2.0): any building the engine's geocoder and
// the NREL weather set can reach (the Americas). lat/lon are where the
// address box's suggestion put it; when present, the engine's own geocode
// must land within SITE_TOL_DEG of it.
// v2.4 (Stephan 2026-10-15): the page starts with an EMPTY address box and
// runs nothing until an address is entered; desiccant starts at 0 lb.
export const ADDRESS = { min: 5, max: 200 }
export const SITE_TOL_DEG = 0.02            // about 2 km, the size of one weather cell
// A known address for tests and examples only; never pre-filled on the page.
export const EXAMPLE_SITE = { addr: '350 Fifth Avenue, New York, New York 10118, United States', lat: 40.74844, lon: -73.98566 }

export const DEFAULTS = { ex: 'single', glass: 'vig', u: null, offset: OFFSET_INPUT.default, facade: 'north', width: WINDOW_INPUT.width, height: WINDOW_INPUT.height, floors: BUILDING_INPUT.floors, wfloor: BUILDING_INPUT.wfloor, seal_out: 'wet_sealed', seal_in: 'wet_sealed', lb: 0, t: 70, rh: 30, hum: 'fixed', addr: '', lat: null, lon: null }

// Every hidden engine input is pinned explicitly (not left to engine
// defaults), so an engine default change cannot move these results, and
// every one of them is checked against the engine's echo.
// orientation, width_in, height_in (v2.7), offset_in (v2.6), floors,
// window_floor and room_humidity (v2.8) come from the scenario, not from here.
export const FIXED = {
  r_ip: 0.97,                 // f_cold and u_ip come from THERMAL, not fixed
  desiccant: 'ms3a',
  desorption: true,
  absorptance: 0.1,
  p_occ_pa: 5, p_unocc_pa: 0, occ_start_h: 7, occ_end_h: 19, weekdays_only: true,
  sealant_out: 'silicone', sealant_in: 'silicone',
  max_years: 20,
  // v2.8: the full theoretical stack pressure (as before), and the office
  // occupants for "No humidification" (sent always; the engine ignores them
  // for a fixed RH).
  stack_factor: 1.0,
  people_gkg: PEOPLE.gkg, people_fade_ach: PEOPLE.fade_ach,
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
  ['Building', 'Building height and the window\'s floor are inputs, 20 floors and floor 10 unless changed: mid-height, where the stack effect is close to zero. In winter the warm room air pushes out through windows above mid-height, so a window near the top of a building fogs more. Floors are 11.8 ft. The facade orientation is an input, north unless changed. It sets how much sun reaches the glass and which winds press on the facade; because of the wind, north is not always the facade that fogs most.'],
  ['Window', 'Width and height are inputs, 60 × 96 in unless changed. The cavity depth between the existing glass and the retrofit is an input too, 0.6 in unless changed.'],
  ['Weather', 'Typical meteorological year for the site (NREL NSRDB), repeated every year.'],
  ['Start', 'Installation on January 1 with a fresh desiccant.'],
  ['Desiccant', '3A molecular sieve. It can release water again when warm (desorption on).'],
  ['Sealant', 'Silicone beads on both layers; water vapor slowly diffuses through them.'],
  ['Building pressure', '+5 Pa on weekdays 7 am to 7 pm, 0 Pa otherwise, plus stack and wind.'],
  ['Room air', 'Fixed RH: the set relative humidity every hour. No humidification: the outdoor air\'s moisture plus the occupants\' (office: 1.2 g of water per kg of air while occupied, weekdays 7 am to 7 pm, fading after hours), at most 60 % RH when it is warm outdoors.'],
]

export const ASSUMPTIONS = [
  'Fog means a water film thicker than 5 µm on the cavity side of the existing glass. That visibility threshold is an estimate; no optical measurement exists yet.',
  '"Wet-sealed" is the ASTM E283 detection floor (0.005 cfm/ft² at 75 Pa), not a measurement of an installed INOVUES seal. A pressure test on an installed cavity would replace it.',
  'With desorption on, the desiccant gives some water back when warm and takes it up again when cold, a small seasonal buffer: slightly less fog after it is full, and a longer life. The engine gives 3A no extra capacity below 25 °C; real 3A holds a few percent more when cold, so the results are on the cautious side here.',
  'After the desiccant is full, the pane fogs about as much as with no desiccant. What decides how much is the real air leakage of the wet seals, which has not been measured on an installed cavity.',
  'Each pairing of existing glass and retrofit glass has its own cavity-side temperature factor and assembly U-value (hover a glass button to see them). Over an existing single pane: from WINDOW and INOVUES. Over an existing double pane: f from WINDOW; U estimated from a layer-by-layer heat-flow model until WINDOW results replace it. A U typed into the U-value box replaces the table value for the chosen glass; f stays as listed, although in a real window the two move together.',
  'Sun and sky act on the outer surface of the existing window. The cavity side gets its share through the existing glass (a 1/4 in pane, or the whole insulating unit of an existing double pane), with part of the heat flowing on to the room. The weather file\'s wind is measured at 2 m and converted to the 10 m wind the pressure and surface formulas assume.',
  'The cavity depth changes only the cavity air volume in the simulation. The glass factor f, the U-value and the air-gap resistance are the values for a 0.6 in cavity, so a deeper or shallower cavity does not yet change the glass temperatures. Because air leaks in per square foot of window, not per cubic foot of cavity, depth alone has a small effect on fog.',
  '"Desiccant full" means 95 % of its capacity at 25 °C.',
  'The same typical weather year repeats; no climate trend or unusual years.',
  '"No humidification" adds 1.2 g of water per kg of room air while the office is occupied: 36 to 44 W of latent heat per seated worker (53 to 65 g of water an hour) into the ASHRAE 62.1 office ventilation of 17 cfm per person gives 1.5 to 1.9 g/kg at full occupancy; 1.2 is about 70 %. After hours it fades at 0.5 air changes per hour. Both are estimates; a building that ventilates more, or holds fewer people, is drier.',
]
