import dns from 'dns/promises'
import net from 'net'

const IPV4_PRIVATE_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

export async function assertSafeUrl(url, { lookup = dns.lookup } = {}) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw securityError('invalid_url')
  }

  if (parsed.protocol !== 'https:') throw securityError('unsupported_scheme')

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw securityError('unsafe_host')
  }

  if (isUnsafeIp(hostname)) throw securityError('unsafe_ip')

  const records = await lookup(hostname, { all: true, verbatim: true })
  const resolved = Array.isArray(records) ? records : [records]
  if (!resolved.length) throw securityError('dns_resolution_failed')

  for (const record of resolved) {
    if (isUnsafeIp(record.address)) throw securityError('unsafe_dns_target')
  }

  return parsed
}

export function isUnsafeIp(value) {
  const raw = String(value || '').replace(/^\[|\]$/g, '')
  const version = net.isIP(raw)
  if (!version) return false

  if (version === 4) return isUnsafeIpv4(raw)
  return isUnsafeIpv6(raw)
}

function isUnsafeIpv4(value) {
  const ip = ipv4ToInt(value)
  if (ip === null) return true
  return IPV4_PRIVATE_RANGES.some(([base, prefix]) =>
    ipv4InRange(ip, ipv4ToInt(base), prefix)
  )
}

function isUnsafeIpv6(value) {
  const normalized = value.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  if (/^fe[89ab]/.test(normalized)) return true
  if (normalized.includes('169.254.169.254')) return true
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.replace('::ffff:', '')
    return isUnsafeIp(mapped)
  }
  return false
}

function ipv4ToInt(value) {
  const parts = String(value || '').split('.').map(Number)
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null
  }
  return parts.reduce((acc, part) => (acc << 8) + part, 0) >>> 0
}

function ipv4InRange(ip, base, prefix) {
  if (base === null) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (ip & mask) === (base & mask)
}

function securityError(message) {
  const err = new Error(message)
  err.code = message
  return err
}
