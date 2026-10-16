// Cavity fog outlook (des2): web server.
//
// Serves the built page from dist/ and these API routes:
//   GET /api/run?ex=&glass=[&u=]&seal_out=&seal_in=&lb=&t=&rh=&addr=[&lat=&lon=]   one simulation
//   GET /api/suggest?q=                                 address suggestions (Mapbox)
//   GET /api/report?<run params>[&project=]             customer report, PDF
//   GET /api/report.json?<run params>[&project=]        the same report's data
//   GET /api/config                                     controls + preset values
//   GET /health                                         always 200 while the app runs
//   GET /health/engine                                  engine reachability
//
// No dependencies beyond Node itself (>= 20): nothing to go stale.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { coalescer, LruCache } from './cache.js'
import { createEngineClient, HttpError, parseScenario, scenarioKey } from './engine.js'
import { buildReportData, cleanProject } from './report-data.js'
import { renderReportPdf } from './report-pdf.js'
import { createSuggester } from './suggest.js'
import {
  APP_VERSION, ASSUMPTIONS, DEFAULTS, ENGINE_DEFAULT_URL, EXISTING, FIXED_DESCRIPTION, GLASSES, RANGES, THERMAL,
  SEALS_EXISTING, SEALS_RETROFIT,
} from '../shared/scenario.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'SAMEORIGIN',
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'self'",
}

function send(req, res, status, body, type, extra = {}) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const headers = { ...SECURITY_HEADERS, 'content-type': type, ...extra }
  const compressible = /json|text|javascript|svg/.test(type) && buf.length > 1024
  if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    buf = gzipSync(buf)
    headers['content-encoding'] = 'gzip'
    headers.vary = 'accept-encoding'
  }
  headers['content-length'] = buf.length
  res.writeHead(status, headers)
  res.end(req.method === 'HEAD' ? undefined : buf)
}

function sendJson(req, res, status, obj, extra = {}) {
  send(req, res, status, JSON.stringify(obj), MIME['.json'], { 'cache-control': 'no-store', ...extra })
}

export function createApp({
  engineUrl = process.env.ENGINE_URL || ENGINE_DEFAULT_URL,
  distDir = resolve(HERE, '..', 'dist'),
  engine = createEngineClient({ baseUrl: engineUrl }),
  cache = new LruCache({ max: 500 }),
  suggester = createSuggester(),
  renderPdf = renderReportPdf,
  log = (...a) => console.log(new Date().toISOString(), ...a),
} = {}) {
  const once = coalescer()
  const root = resolve(distDir)

  // One simulation, cached and shared by identical requests in flight.
  async function runCached(scenario) {
    const key = scenarioKey(scenario)
    const hit = cache.get(key)
    if (hit) return hit
    return once(key, async () => {
      const t0 = Date.now()
      const r = await engine.run(scenario)
      cache.set(key, r)
      log('run', key, `${Date.now() - t0} ms`)
      return r
    })
  }

  // Humidity sweeps ignore the desiccant (they run without it).
  async function sweepCached(scenario, levels) {
    const key = `sweep|${levels.join(',')}|${scenarioKey({ ...scenario, lb: 0 })}`
    const hit = cache.get(key)
    if (hit) return hit
    return once(key, async () => {
      const t0 = Date.now()
      const r = await engine.sweepRh(scenario, levels)
      cache.set(key, r)
      log('sweep', key, `${Date.now() - t0} ms`)
      return r
    })
  }

  async function runRoute(req, res, url) {
    const scenario = parseScenario(url.searchParams)
    const was = cache.get(scenarioKey(scenario))
    const t0 = Date.now()
    const out = was ?? await runCached(scenario)
    sendJson(req, res, 200, was ? { ...out, cached: true } : { ...out, cached: false, ms: Date.now() - t0 })
  }

  // The report takes the run parameters plus an optional project name.
  function reportInputs(req, url) {
    const params = new URLSearchParams(url.searchParams)
    const project = cleanProject(params.get('project'))
    params.delete('project')
    const scenario = parseScenario(params)
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
    const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https')
    const q = new URLSearchParams()
    for (const k of ['ex', 'glass', 'u', 'seal_out', 'seal_in', 'lb', 't', 'rh', 'addr', 'lat', 'lon']) {
      if (scenario[k] !== null && scenario[k] !== undefined) q.set(k, String(scenario[k]))
    }
    return { scenario, project, key: `${scenarioKey(scenario)}|${project}`, appUrl: `${proto}://${host}/?${q}` }
  }

  async function reportData(req, url) {
    const { scenario, project, key, appUrl } = reportInputs(req, url)
    const data = await buildReportData(scenario, {
      project, key, appUrl, runCached, sweepCached, presets: () => engine.presets(),
    })
    return { data, key }
  }

  async function reportJsonRoute(req, res, url) {
    const { data } = await reportData(req, url)
    sendJson(req, res, 200, data)
  }

  async function reportPdfRoute(req, res, url) {
    const t0 = Date.now()
    const { data, key } = await reportData(req, url)
    const pkey = `pdf|${key}`
    let pdf = cache.get(pkey)
    if (!pdf) {
      pdf = await renderPdf(data)
      cache.set(pkey, pdf)
    }
    log('report', key, `${Date.now() - t0} ms`, `${pdf.length} bytes`)
    const place = (data.site.matched || data.site.query).split(',')[0].replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    send(req, res, 200, pdf, 'application/pdf', {
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="INOVUES-cavity-assessment-${place || 'site'}-${data.id}.pdf"`,
    })
  }

  async function suggestRoute(req, res, url) {
    const suggestions = await suggester.suggest(url.searchParams.get('q'))
    sendJson(req, res, 200, { suggestions })
  }

  async function configRoute(req, res) {
    let presets = null
    let presetsError = null
    try { presets = await engine.presets() } catch (err) { presetsError = err.message }
    const withValues = (list, side) => list.map((s) => ({ ...s, ...(presets?.meta?.[side]?.[s.key] ? { engine: presets.meta[side][s.key] } : {}) }))
    sendJson(req, res, 200, {
      version: APP_VERSION,
      existing: EXISTING,
      glasses: GLASSES,
      thermal: THERMAL,
      seals_existing: withValues(SEALS_EXISTING, 'al_out'),
      seals_retrofit: withValues(SEALS_RETROFIT, 'al_in'),
      ranges: RANGES,
      defaults: DEFAULTS,
      fixed: FIXED_DESCRIPTION,
      assumptions: ASSUMPTIONS,
      engine_version: presets?.version ?? null,
      presets_error: presetsError,
      suggest: suggester.available,
    })
  }

  async function staticRoute(req, res, url) {
    let rel
    try { rel = decodeURIComponent(url.pathname) } catch { return sendJson(req, res, 400, { error: 'Bad path' }) }
    if (rel === '/' || rel === '') rel = '/index.html'
    const file = resolve(join(root, rel))
    if (file !== root && !file.startsWith(root + sep)) return sendJson(req, res, 403, { error: 'Forbidden' })
    let info
    try { info = await stat(file) } catch { info = null }
    if (!info || !info.isFile()) {
      if (rel === '/index.html') return send(req, res, 503, 'The page has not been built. Run npm run build.', MIME['.txt'])
      return send(req, res, 404, 'Not found', MIME['.txt'])
    }
    const body = await readFile(file)
    const immutable = rel.startsWith('/assets/')
    send(req, res, 200, body, MIME[extname(file).toLowerCase()] || 'application/octet-stream', {
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(req, res, 405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' })
      if (url.pathname === '/api/run') return await runRoute(req, res, url)
      if (url.pathname === '/api/config') return await configRoute(req, res)
      if (url.pathname === '/api/suggest') return await suggestRoute(req, res, url)
      if (url.pathname === '/api/report') return await reportPdfRoute(req, res, url)
      if (url.pathname === '/api/report.json') return await reportJsonRoute(req, res, url)
      if (url.pathname === '/health') return sendJson(req, res, 200, { ok: true, version: APP_VERSION, cached_results: cache.size })
      if (url.pathname === '/health/engine') {
        try { const p = await engine.presets(); return sendJson(req, res, 200, { ok: true, engine_version: p.version }) }
        catch (err) { return sendJson(req, res, 503, { ok: false, error: err.message }) }
      }
      if (url.pathname.startsWith('/api/')) return sendJson(req, res, 404, { error: 'Unknown API route' })
      return await staticRoute(req, res, url)
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500
      if (status >= 500) log('error', req.url, err.message, err.detail ? JSON.stringify(err.detail) : '')
      if (!res.headersSent) sendJson(req, res, status, { error: err.message, detail: err.detail ?? null })
    }
  })
}

// Started directly (npm start), not imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000
  const app = createApp()
  app.requestTimeout = 180_000
  app.listen(port, () => console.log(`Cavity fog outlook on :${port}, engine ${process.env.ENGINE_URL || ENGINE_DEFAULT_URL}, address suggestions ${process.env.MAPBOX_TOKEN ? 'on' : 'off (no MAPBOX_TOKEN)'}`))
}
