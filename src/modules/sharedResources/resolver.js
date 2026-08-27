import {
  CONFIDENCE,
  DEFAULT_RESOLVE_OPTIONS,
  PROVIDERS,
  RESOURCE_TYPES,
  SOURCES,
} from './constants.js'
import { filenameFromContentDisposition } from './contentDisposition.js'
import { parseHtmlMetadata } from './htmlMetadata.js'
import { fetchResourceMetadata } from './httpClient.js'
import {
  applyUrlHints,
  detectProvider,
  detectResourceType,
  extractExtension,
  extractUrlsFromText,
  filenameFromUrlPath,
  normalizeFilename,
  normalizeMimeType,
} from './url.js'

const cache = new Map()

export async function resolveSharedResourcesFromText(text, options = {}) {
  const opts = { ...DEFAULT_RESOLVE_OPTIONS, ...options }
  const urls = extractUrlsFromText(text, { max: opts.maxUrlsPerMessage })
  if (!urls.length) return []

  const results = []
  for (let index = 0; index < urls.length; index += opts.concurrency) {
    const batch = urls.slice(index, index + opts.concurrency)
    const resolved = await Promise.all(
      batch.map(url => resolveSharedResource(url, opts))
    )
    results.push(...resolved)
  }
  return results
}

export async function resolveSharedResource(originalUrl, options = {}) {
  const opts = { ...DEFAULT_RESOLVE_OPTIONS, ...options }
  const provider = detectProvider(originalUrl)
  const cacheKey = normalizeCacheKey(originalUrl)
  const cached = readCache(cacheKey, opts.cacheTtlMs)
  if (cached) return { ...cached }

  const startedAt = Date.now()

  try {
    let metadata = await resolveByHttp(originalUrl, provider, opts)
    metadata = applyUrlHints(metadata, originalUrl)
    metadata = finalizeMetadata(metadata)
    writeCache(cacheKey, metadata)
    logResolution(metadata, Date.now() - startedAt)
    return metadata
  } catch (error) {
    let metadata = finalizeMetadata(
      applyUrlHints(
        {
          originalUrl,
          provider,
          success: false,
          error: error?.code || error?.message || 'metadata_resolution_failed',
        },
        originalUrl
      )
    )
    writeCache(cacheKey, metadata)
    logResolution(metadata, Date.now() - startedAt)
    return metadata
  }
}

export function clearSharedResourceCache() {
  cache.clear()
}

async function resolveByHttp(originalUrl, provider, opts) {
  const head = await fetchResourceMetadata(originalUrl, {
    ...opts,
    method: 'HEAD',
  }).catch(async error => {
    if (shouldAbortHeadFallback(error)) throw error
    return null
  })

  let metadata = buildMetadataFromHttp({
    originalUrl,
    provider,
    response: head,
    sourceFallback: SOURCES.PROVIDER_METADATA,
  })

  const shouldGet =
    !head ||
    [403, 405].includes(Number(head.status)) ||
    !metadata.name ||
    isHtmlMime(metadata.mimeType)

  if (shouldGet) {
    const get = await fetchResourceMetadata(originalUrl, {
      ...opts,
      method: 'GET',
    })
    metadata = mergeMetadata(
      metadata,
      buildMetadataFromHttp({
        originalUrl,
        provider,
        response: get,
        sourceFallback: SOURCES.HTML_METADATA,
      })
    )

    if (isHtmlMime(get.headers.get('content-type')) || looksLikeHtml(get.body)) {
      metadata = mergeMetadata(
        metadata,
        buildMetadataFromHtml({ originalUrl, provider, response: get })
      )
    }
  }

  if (!metadata.name && provider === PROVIDERS.DIRECT) {
    const name = filenameFromUrlPath(metadata.resolvedUrl || originalUrl)
    if (name) {
      metadata.name = name
      metadata.source = metadata.source || SOURCES.URL
      metadata.confidence = metadata.confidence || CONFIDENCE.CONFIRMED
    }
  }

  if (metadata.status && !String(metadata.status).startsWith('2')) {
    metadata.error = `http_${metadata.status}`
    metadata.success = false
  }

  return metadata
}

function buildMetadataFromHttp({ originalUrl, provider, response, sourceFallback }) {
  if (!response) {
    return { originalUrl, provider, success: true }
  }

  const contentType = response.headers.get('content-type')
  const disposition = response.headers.get('content-disposition')
  const name = filenameFromContentDisposition(disposition)
  const mimeType = normalizeMimeType(contentType)
  const extension = extractExtension(name)

  return {
    originalUrl,
    resolvedUrl: response.url && response.url !== originalUrl ? response.url : undefined,
    provider,
    name,
    extension,
    mimeType,
    resourceType: detectResourceType({ extension, mimeType }),
    source: name ? SOURCES.CONTENT_DISPOSITION : sourceFallback,
    confidence: name || mimeType ? CONFIDENCE.CONFIRMED : CONFIDENCE.PROBABLE,
    success: true,
    status: response.status,
  }
}

function buildMetadataFromHtml({ originalUrl, provider, response }) {
  const html = parseHtmlMetadata(response.body)
  const name = normalizeFilename(html.title)
  const extension = extractExtension(name)

  return {
    originalUrl,
    resolvedUrl: html.url || response.url || undefined,
    provider,
    name,
    extension,
    resourceType: detectResourceType({ extension, mimeType: null }),
    source: name ? SOURCES.HTML_METADATA : undefined,
    confidence: name ? CONFIDENCE.PROBABLE : undefined,
    success: true,
  }
}

function mergeMetadata(base, next) {
  const merged = { ...base }

  for (const [key, value] of Object.entries(next || {})) {
    if (value === undefined || value === null || value === '') continue
    if (key === 'success') {
      merged.success = value
      continue
    }
    if (['source', 'confidence'].includes(key) && next?.name && !base?.name) {
      merged[key] = value
      continue
    }
    if (!merged[key] || merged[key] === RESOURCE_TYPES.UNKNOWN) merged[key] = value
  }

  return merged
}

function shouldAbortHeadFallback(error) {
  return [
    'timeout',
    'unsupported_scheme',
    'invalid_url',
    'unsafe_host',
    'unsafe_ip',
    'unsafe_dns_target',
    'dns_resolution_failed',
    'redirect_loop',
    'max_redirects_exceeded',
  ].includes(error?.code)
}

function finalizeMetadata(metadata) {
  const name = normalizeFilename(metadata.name)
  const extension = metadata.extension || extractExtension(name)
  const mimeType = normalizeMimeType(metadata.mimeType)
  const resourceType = detectResourceType({
    extension,
    mimeType,
    fallback: metadata.resourceType || RESOURCE_TYPES.UNKNOWN,
  })

  return {
    originalUrl: metadata.originalUrl,
    resolvedUrl: metadata.resolvedUrl || undefined,
    provider: metadata.provider || PROVIDERS.UNKNOWN,
    name: name || null,
    extension: extension || undefined,
    mimeType: mimeType || undefined,
    resourceType,
    source: metadata.source || SOURCES.URL_HINT,
    confidence: metadata.confidence || CONFIDENCE.PROBABLE,
    success: Boolean(metadata.success),
    error: metadata.error || undefined,
  }
}

function normalizeCacheKey(url) {
  return String(url || '').trim()
}

function readCache(key, ttlMs) {
  const item = cache.get(key)
  if (!item) return null
  if (Date.now() - item.at > ttlMs) {
    cache.delete(key)
    return null
  }
  return item.value
}

function writeCache(key, value) {
  cache.set(key, { at: Date.now(), value })
}

function isHtmlMime(value) {
  return normalizeMimeType(value) === 'text/html'
}

function looksLikeHtml(value) {
  return /^\s*<!doctype html|^\s*<html[\s>]/i.test(String(value || ''))
}

function redactUrl(url) {
  try {
    const parsed = new URL(url)
    parsed.search = parsed.search ? '?...' : ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function logResolution(metadata, durationMs) {
  console.info('shared-resource:resolution', {
    provider: metadata.provider,
    success: metadata.success,
    source: metadata.source,
    confidence: metadata.confidence,
    durationMs,
    url: redactUrl(metadata.originalUrl),
  })
}
