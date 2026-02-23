// src/config/corsOptions.js
import cors from 'cors'

export function buildCors() {
  const origins = process.env.CORS_ORIGIN.split(',')
    .map(s => s.trim())
    .filter(Boolean)

  // si no hay orígenes configurados → abierto (dev)
  if (!origins.length) return cors()

  return cors({
    origin: (origin, cb) =>
      !origin || origins.includes(origin)
        ? cb(null, true)
        : cb(new Error('CORS blocked')),
    credentials: true,
  })
}
