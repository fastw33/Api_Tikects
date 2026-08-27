import { normalizeFilename } from './url.js'

export function filenameFromContentDisposition(value) {
  const header = String(value || '').trim()
  if (!header) return null

  const star = header.match(/filename\*\s*=\s*([^;]+)/i)
  if (star?.[1]) {
    const decoded = decodeRfc5987Value(star[1])
    if (decoded) return normalizeFilename(decoded)
  }

  const regular = header.match(/filename\s*=\s*("[^"]+"|[^;]+)/i)
  if (regular?.[1]) {
    const raw = regular[1].trim().replace(/^"|"$/g, '')
    try {
      return normalizeFilename(decodeURIComponent(raw))
    } catch {
      return normalizeFilename(raw)
    }
  }

  return null
}

function decodeRfc5987Value(value) {
  const raw = String(value || '').trim().replace(/^"|"$/g, '')
  const match = raw.match(/^([^']*)'[^']*'(.*)$/)
  const encoded = match ? match[2] : raw
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}
