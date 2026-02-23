// src/config/rateLimit.js
import rateLimit from 'express-rate-limit'

function parseWindow(v = '15m') {
  const m = /^(\d+)(ms|s|m|h)$/.exec(v)
  const n = Number(m?.[1] || 15)
  const u = m?.[2] || 'm'
  return { ms: { ms: 1, s: 1000, m: 60000, h: 3600000 }[u] * n }
}

const { ms } = parseWindow(process.env.RATE_LIMIT_WINDOW)

export const apiLimiter = rateLimit({
  windowMs: ms,
  max: Number(process.env.RATE_LIMIT_MAX || 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later.' },
})
