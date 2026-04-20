import os from 'os'
import { Router } from 'express'

let totalErrors = 0
let lastCpuUsage = process.cpuUsage()
let lastHrTime = process.hrtime.bigint()
const MAX_RECENT_LOGS = 5000
const recentLogs = []
let consoleCaptureInstalled = false
const GENERIC_MESSAGES = new Set([
  'internal error',
  'internal server error',
  'error interno del servidor',
])

function isGenericMessage(value) {
  return GENERIC_MESSAGES.has(
    String(value || '')
      .trim()
      .toLowerCase()
  )
}

function pickErrorMessage(error) {
  const candidates = [
    error?.message,
    error?.cause?.message,
    error?.original?.message,
    error?.originalError?.message,
    error?.parent?.message,
    error?.errors?.[0]?.message,
  ]

  for (const candidate of candidates) {
    if (candidate && !isGenericMessage(candidate)) {
      return String(candidate)
    }
  }

  if (error?.stack) {
    const stackLines = String(error.stack)
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)

    const meaningful = stackLines.find(
      line =>
        !line.toLowerCase().startsWith('at ') &&
        !isGenericMessage(line.replace(/^error:\s*/i, ''))
    )
    if (meaningful) return meaningful

    const firstLine = stackLines[0]
    if (firstLine) return firstLine
  }

  return String(error?.message || 'Internal error')
}

function pushLog(level, source, message, meta = {}) {
  recentLogs.unshift({
    at: new Date().toISOString(),
    level,
    source,
    message,
    meta,
  })

  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.length = MAX_RECENT_LOGS
  }
}

function serializeError(error) {
  if (!error) return null
  return {
    name: error?.name,
    message: error?.message,
    cause: error?.cause?.message,
    original: error?.original?.message,
    parent: error?.parent?.message,
    firstValidation: error?.errors?.[0]?.message,
    stack: error?.stack,
  }
}

function isInternalMonitoringPath(path) {
  const value = String(path || '')
  return /\/monitoring(\/|$)/i.test(value) || /\/health(\/|$)/i.test(value)
}

function sanitizeConsoleArg(arg) {
  if (arg instanceof Error) return arg.stack || arg.message || String(arg)
  if (typeof arg === 'string') return arg
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

export function installConsoleCapture() {
  if (consoleCaptureInstalled) return
  consoleCaptureInstalled = true

  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }

  console.log = (...args) => {
    pushLog('info', 'console', args.map(sanitizeConsoleArg).join(' '))
    originals.log(...args)
  }

  console.info = (...args) => {
    pushLog('info', 'console', args.map(sanitizeConsoleArg).join(' '))
    originals.info(...args)
  }

  console.warn = (...args) => {
    pushLog('warn', 'console', args.map(sanitizeConsoleArg).join(' '))
    originals.warn(...args)
  }

  console.error = (...args) => {
    pushLog('error', 'console', args.map(sanitizeConsoleArg).join(' '))
    originals.error(...args)
  }
}

function sampleCpuPercent() {
  const currentCpuUsage = process.cpuUsage()
  const currentHrTime = process.hrtime.bigint()

  const cpuDeltaMicros =
    currentCpuUsage.user +
    currentCpuUsage.system -
    (lastCpuUsage.user + lastCpuUsage.system)
  const elapsedMicros = Number(currentHrTime - lastHrTime) / 1000
  const cores = Math.max(os.cpus()?.length || 1, 1)

  lastCpuUsage = currentCpuUsage
  lastHrTime = currentHrTime

  if (elapsedMicros <= 0) return 0

  const rawPercent = (cpuDeltaMicros / elapsedMicros / cores) * 100
  return Number(Math.max(0, Math.min(100, rawPercent)).toFixed(2))
}

export function getMonitoringSummary() {
  const memory = process.memoryUsage()

  return {
    status: 'up',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Number(process.uptime().toFixed(0)),
    cpu: {
      processPercent: sampleCpuPercent(),
      loadAverage: os.loadavg(),
    },
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
      systemFree: os.freemem(),
      systemTotal: os.totalmem(),
    },
    errors: {
      total: totalErrors,
    },
  }
}

export function monitoringMiddleware(req, res, next) {
  const startAt = Date.now()
  res.on('finish', () => {
    const reqPath = req.originalUrl || req.url
    if (isInternalMonitoringPath(reqPath)) return

    if (res.statusCode >= 500 && !res.locals?.monitoringAppErrorLogged) {
      totalErrors += 1
    }

    const level =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'

    pushLog(level, 'http', `${req.method} ${reqPath}`, {
      method: req.method,
      path: reqPath,
      status: res.statusCode,
      responseTimeMs: Date.now() - startAt,
    })
  })
  next()
}

export function recordProcessError(error, type = 'process') {
  totalErrors += 1
  pushLog('error', type, error?.message || String(error || 'Unknown error'), {
    stack: error?.stack,
  })
}

export function recordAppError(err, req) {
  totalErrors += 1
  pushLog('error', 'app', pickErrorMessage(err), {
    name: err?.name,
    code: err?.code,
    status: err?.status,
    method: req?.method,
    path: req?.originalUrl || req?.url,
    stack: err?.stack,
    error: serializeError(err),
  })
}

export function getRecentLogs(limit = 50) {
  const parsed = Number(limit)
  const safeLimit = Number.isFinite(parsed)
    ? Math.max(1, Math.min(300, Math.floor(parsed)))
    : 50
  return recentLogs.slice(0, safeLimit)
}

function filterLogsByLevel(items, level) {
  const normalized = String(level || '')
    .trim()
    .toLowerCase()
  if (!normalized || normalized === 'all') return items
  return items.filter(
    item => String(item.level || '').toLowerCase() === normalized
  )
}

export function createMonitoringRouter(basePath = '/monitoring') {
  const router = Router()

  router.get('/summary', (req, res) => {
    res.status(200).json(getMonitoringSummary())
  })

  router.get('/logs', (req, res) => {
    const source = getRecentLogs(req.query?.limit)
    const items = filterLogsByLevel(source, req.query?.level)

    res.status(200).json({
      items,
      totalBuffered: recentLogs.length,
    })
  })

  router.get('/', (req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Monitoreo Tareas y Proyectos</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: Segoe UI, Arial, sans-serif; margin: 0; background: #f3f6fb; color: #14213d; }
    .wrap { max-width: 960px; margin: 0 auto; padding: 24px; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .card { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    .label { font-size: 13px; color: #415a77; margin-bottom: 8px; }
    .value { font-size: 24px; font-weight: 700; }
    .ok { color: #1b8a5a; }
    .bad { color: #c1121f; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Dashboard de Monitoreo</h1>
    <p>Actualización automática cada 5 segundos.</p>
    <div class="grid">
      <div class="card"><div class="label">Sistema</div><div id="status" class="value">-</div></div>
      <div class="card"><div class="label">CPU proceso</div><div id="cpu" class="value">-</div></div>
      <div class="card"><div class="label">Memoria heap usada</div><div id="heap" class="value">-</div></div>
      <div class="card"><div class="label">Errores acumulados</div><div id="errors" class="value">-</div></div>
    </div>
  </div>
  <script>
    const fmtMB = bytes => (bytes / 1024 / 1024).toFixed(1) + ' MB'
    const setText = (id, value, cls) => {
      const el = document.getElementById(id)
      el.textContent = value
      if (cls) el.className = 'value ' + cls
    }

    async function refresh() {
      try {
        const res = await fetch('${basePath}/summary', { cache: 'no-store' })
        const data = await res.json()
        setText('status', data.status === 'up' ? 'Activo' : 'Caido', data.status === 'up' ? 'ok' : 'bad')
        setText('cpu', data.cpu.processPercent.toFixed(2) + ' %')
        setText('heap', fmtMB(data.memory.heapUsed))
        setText('errors', String(data.errors.total), data.errors.total > 0 ? 'bad' : 'ok')
      } catch {
        setText('status', 'Sin respuesta', 'bad')
      }
    }

    refresh()
    setInterval(refresh, 5000)
  </script>
</body>
</html>`)
  })

  return router
}
