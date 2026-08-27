import { DEFAULT_RESOLVE_OPTIONS } from './constants.js'
import { assertSafeUrl } from './security.js'

export async function fetchResourceMetadata(
  url,
  {
    fetchImpl = fetch,
    lookup,
    method = 'HEAD',
    redirectLimit = DEFAULT_RESOLVE_OPTIONS.redirectLimit,
    timeoutMs = DEFAULT_RESOLVE_OPTIONS.timeoutMs,
    maxHtmlBytes = DEFAULT_RESOLVE_OPTIONS.maxHtmlBytes,
  } = {}
) {
  let currentUrl = url
  const visited = new Set()
  const redirects = []

  for (let i = 0; i <= redirectLimit; i += 1) {
    await assertSafeUrl(currentUrl, { lookup })

    if (visited.has(currentUrl)) {
      const err = new Error('redirect_loop')
      err.code = 'redirect_loop'
      throw err
    }
    visited.add(currentUrl)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response

    try {
      response = await fetchImpl(currentUrl, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers:
          method === 'GET'
            ? { Range: `bytes=0-${Math.max(maxHtmlBytes - 1, 0)}` }
            : {},
      })
    } catch (error) {
      if (error?.name === 'AbortError') {
        const err = new Error('timeout')
        err.code = 'timeout'
        throw err
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    const location = response.headers.get('location')
    if (isRedirect(response.status) && location) {
      if (i >= redirectLimit) {
        const err = new Error('max_redirects_exceeded')
        err.code = 'max_redirects_exceeded'
        throw err
      }
      const nextUrl = new URL(location, currentUrl).toString()
      await assertSafeUrl(nextUrl, { lookup })
      redirects.push({ from: currentUrl, to: nextUrl, status: response.status })
      currentUrl = nextUrl
      continue
    }

    const body =
      method === 'GET' && response.body
        ? await readLimitedBody(response, maxHtmlBytes)
        : ''

    return {
      url: currentUrl,
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      body,
      redirects,
    }
  }

  const err = new Error('max_redirects_exceeded')
  err.code = 'max_redirects_exceeded'
  throw err
}

async function readLimitedBody(response, maxBytes) {
  const reader = response.body?.getReader?.()
  if (!reader) return ''

  const chunks = []
  let total = 0

  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    const slice = value.slice(0, Math.max(maxBytes - total, 0))
    chunks.push(slice)
    total += slice.length
    if (slice.length < value.length) break
  }

  try {
    await reader.cancel()
  } catch {
    // Best-effort cancel after collecting the metadata window.
  }

  return Buffer.concat(chunks).toString('utf8')
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(Number(status))
}
