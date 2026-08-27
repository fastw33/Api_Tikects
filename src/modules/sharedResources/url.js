import path from 'path'
import {
  CONFIDENCE,
  EXTENSION_RESOURCE_TYPE,
  MIME_RESOURCE_TYPE,
  PROVIDERS,
  RESOURCE_TYPES,
  SOURCES,
} from './constants.js'

const URL_REGEX = /https?:\/\/[^\s<>"']+/gi

export function splitUrlToken(token) {
  let url = String(token || '')
  let suffix = ''

  while (/[.,;:!?]$/.test(url)) {
    suffix = `${url.slice(-1)}${suffix}`
    url = url.slice(0, -1)
  }

  while (url.endsWith(')') && countChar(url, '(') < countChar(url, ')')) {
    suffix = `)${suffix}`
    url = url.slice(0, -1)
  }

  return { url, suffix }
}

export function extractUrlsFromText(text, { max = 5 } = {}) {
  const value = String(text || '')
  const seen = new Set()
  const urls = []

  for (const match of value.matchAll(URL_REGEX)) {
    const { url } = splitUrlToken(match[0])
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
    if (urls.length >= max) break
  }

  return urls
}

export function normalizeFilename(value) {
  const raw = String(value || '').trim()
  if (!raw) return null

  const normalized = raw
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop()
    ?.trim()

  return normalized || null
}

export function extractExtension(name) {
  const filename = normalizeFilename(name)
  if (!filename || filename.startsWith('.')) return null
  const ext = path.extname(filename).replace(/^\./, '').toLowerCase()
  return ext || null
}

export function normalizeMimeType(value) {
  const mime = String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  return mime || null
}

export function detectResourceType({ extension, mimeType, fallback }) {
  const mime = normalizeMimeType(mimeType)
  const ext = String(extension || '').toLowerCase()
  const extType = ext ? EXTENSION_RESOURCE_TYPE[ext] : null

  if (mime) {
    if (mime === 'text/plain' && extType && extType !== RESOURCE_TYPES.DOCUMENT) {
      return extType
    }
    if (
      mime === 'text/plain' &&
      fallback &&
      fallback !== RESOURCE_TYPES.UNKNOWN
    ) {
      return fallback
    }
    if (MIME_RESOURCE_TYPE[mime]) return MIME_RESOURCE_TYPE[mime]
    if (mime.startsWith('image/')) return RESOURCE_TYPES.IMAGE
    if (mime.startsWith('video/')) return RESOURCE_TYPES.VIDEO
    if (mime.startsWith('audio/')) return RESOURCE_TYPES.AUDIO
    if (mime === 'text/html') return fallback || RESOURCE_TYPES.UNKNOWN
  }

  if (extType) return extType

  return fallback || RESOURCE_TYPES.UNKNOWN
}

export function detectProvider(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return PROVIDERS.UNKNOWN
  }

  const host = parsed.hostname.toLowerCase()

  if (host === '1drv.ms' || host.endsWith('.1drv.ms')) return PROVIDERS.ONEDRIVE
  if (host === 'onedrive.live.com' || host.endsWith('.onedrive.live.com')) {
    return PROVIDERS.ONEDRIVE
  }
  if (host === 'sharepoint.com' || host.endsWith('.sharepoint.com')) {
    return PROVIDERS.SHAREPOINT
  }
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    return PROVIDERS.GOOGLE_DRIVE
  }
  if (host === 'dropbox.com' || host.endsWith('.dropbox.com')) {
    return PROVIDERS.DROPBOX
  }
  if (host === 'dropboxusercontent.com' || host.endsWith('.dropboxusercontent.com')) {
    return PROVIDERS.DROPBOX
  }

  const name = filenameFromUrlPath(parsed)
  return extractExtension(name) ? PROVIDERS.DIRECT : PROVIDERS.UNKNOWN
}

export function filenameFromUrlPath(url) {
  const parsed = typeof url === 'string' ? new URL(url) : url
  const segment = decodeURIComponent(
    String(parsed.pathname || '').split('/').filter(Boolean).pop() || ''
  )
  return normalizeFilename(segment)
}

export function applyUrlHints(metadata, url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return metadata
  }

  const pathName = parsed.pathname.toLowerCase()
  const next = { ...metadata }

  if (
    (next.provider === PROVIDERS.ONEDRIVE ||
      next.provider === PROVIDERS.SHAREPOINT) &&
    (!next.resourceType ||
      next.resourceType === RESOURCE_TYPES.UNKNOWN ||
      (!next.name &&
        next.resourceType === RESOURCE_TYPES.DOCUMENT &&
        normalizeMimeType(next.mimeType) === 'text/plain'))
  ) {
    if (/\/x\//.test(pathName)) next.resourceType = RESOURCE_TYPES.SPREADSHEET
    else if (/\/w\//.test(pathName)) next.resourceType = RESOURCE_TYPES.DOCUMENT
    else if (/\/p\//.test(pathName)) next.resourceType = RESOURCE_TYPES.PRESENTATION

    if (next.resourceType) {
      next.source = SOURCES.URL_HINT
      next.confidence = CONFIDENCE.PROBABLE
    }
  }

  return next
}

function countChar(value, char) {
  return String(value || '')
    .split('')
    .filter(item => item === char).length
}
