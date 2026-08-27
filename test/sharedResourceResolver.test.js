import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearSharedResourceCache,
  resolveSharedResource,
  resolveSharedResourcesFromText,
} from '../src/modules/sharedResources/resolver.js'
import { filenameFromContentDisposition } from '../src/modules/sharedResources/contentDisposition.js'
import { parseHtmlMetadata } from '../src/modules/sharedResources/htmlMetadata.js'
import { isUnsafeIp } from '../src/modules/sharedResources/security.js'
import { detectProvider, extractUrlsFromText } from '../src/modules/sharedResources/url.js'

const safeLookup = async () => [{ address: '8.8.8.8', family: 4 }]

test.beforeEach(() => {
  clearSharedResourceCache()
})

test('detecta una o varias URLs dentro del texto sin romper query ni puntuacion', () => {
  assert.deepEqual(
    extractUrlsFromText(
      'mira https://example.com/files/report.pdf?x=1&y=2, y https://drive.google.com/file/d/abc.'
    ),
    [
      'https://example.com/files/report.pdf?x=1&y=2',
      'https://drive.google.com/file/d/abc',
    ]
  )
})

test('detecta proveedores iniciales', () => {
  assert.equal(detectProvider('https://1drv.ms/x/c/abc'), 'onedrive')
  assert.equal(detectProvider('https://onedrive.live.com/edit?id=abc'), 'onedrive')
  assert.equal(detectProvider('https://empresa.sharepoint.com/:x:/r/doc'), 'sharepoint')
  assert.equal(detectProvider('https://drive.google.com/file/d/abc'), 'google-drive')
  assert.equal(detectProvider('https://www.dropbox.com/s/abc/foto.png'), 'dropbox')
  assert.equal(detectProvider('https://example.com/files/report.pdf'), 'direct')
  assert.equal(detectProvider('https://example.com/view/opaque'), 'unknown')
})

test('parsea Content-Disposition filename y filename* con espacios y unicode', () => {
  assert.equal(
    filenameFromContentDisposition('attachment; filename="reporte final.xlsx"'),
    'reporte final.xlsx'
  )
  assert.equal(
    filenameFromContentDisposition(
      "attachment; filename=bad.xlsx; filename*=UTF-8''informe%20a%C3%B1o%20%C3%B1.xlsx"
    ),
    'informe año ñ.xlsx'
  )
})

test('parsea metadatos HTML og:title y title', () => {
  assert.deepEqual(
    parseHtmlMetadata(
      '<html><head><meta property="og:title" content="Presupuesto.xlsx"><meta property="og:url" content="https://cdn.test/f.xlsx"></head></html>'
    ),
    {
      title: 'Presupuesto.xlsx',
      type: null,
      url: 'https://cdn.test/f.xlsx',
      description: null,
    }
  )
  assert.equal(parseHtmlMetadata('<title>Manual.pdf</title>').title, 'Manual.pdf')
})

test('identifica rangos privados, loopback, link-local y metadata cloud', () => {
  for (const ip of [
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '::1',
    'fc00::1',
    'fd12::1',
    'fe80::1',
  ]) {
    assert.equal(isUnsafeIp(ip), true, ip)
  }
  assert.equal(isUnsafeIp('8.8.8.8'), false)
})

test('resuelve URL directa desde path, extension y MIME', async () => {
  const result = await resolveSharedResource('https://example.com/files/report.pdf', {
    lookup: safeLookup,
    fetchImpl: mockFetch({
      'HEAD https://example.com/files/report.pdf': response('', {
        headers: { 'content-type': 'application/pdf' },
      }),
      'GET https://example.com/files/report.pdf': response('', {
        headers: { 'content-type': 'application/pdf' },
      }),
    }),
  })

  assert.equal(result.provider, 'direct')
  assert.equal(result.name, 'report.pdf')
  assert.equal(result.extension, 'pdf')
  assert.equal(result.mimeType, 'application/pdf')
  assert.equal(result.resourceType, 'pdf')
  assert.equal(result.success, true)
})

test('OneDrive usa metadata real de headers sin hardcodear nombres', async () => {
  const url = 'https://1drv.ms/x/c/opaque?e=test'
  const result = await resolveSharedResource(url, {
    lookup: safeLookup,
    fetchImpl: mockFetch({
      [`HEAD ${url}`]: response('', {
        headers: {
          'content-disposition':
            "attachment; filename*=UTF-8''matriz%20real%20%C3%B1.xlsx",
          'content-type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      }),
    }),
  })

  assert.equal(result.provider, 'onedrive')
  assert.equal(result.name, 'matriz real ñ.xlsx')
  assert.equal(result.resourceType, 'spreadsheet')
  assert.equal(result.source, 'content-disposition')
  assert.equal(result.confidence, 'confirmed')
})

test('OneDrive sin nombre no inventa metadata y conserva señal probable /x/', async () => {
  const url = 'https://1drv.ms/x/c/opaque?e=test'
  const result = await resolveSharedResource(url, {
    lookup: safeLookup,
    fetchImpl: mockFetch({
      [`HEAD ${url}`]: response('', { headers: {} }),
      [`GET ${url}`]: response('', { headers: {} }),
    }),
  })

  assert.equal(result.provider, 'onedrive')
  assert.equal(result.name, null)
  assert.equal(result.resourceType, 'spreadsheet')
  assert.equal(result.confidence, 'probable')
})

test('resuelve metadata HTML con nombre probable', async () => {
  const url = 'https://example.com/share/abc'
  const result = await resolveSharedResource(url, {
    lookup: safeLookup,
    fetchImpl: mockFetch({
      [`HEAD ${url}`]: response('', {
        headers: { 'content-type': 'text/html' },
      }),
      [`GET ${url}`]: response(
        '<html><head><meta property="og:title" content="manual usuario.pdf"></head></html>',
        { headers: { 'content-type': 'text/html' } }
      ),
    }),
  })

  assert.equal(result.provider, 'unknown')
  assert.equal(result.name, 'manual usuario.pdf')
  assert.equal(result.resourceType, 'pdf')
  assert.equal(result.source, 'html-metadata')
})

test('sigue redirects validando cada salto', async () => {
  const start = 'https://1drv.ms/u/s!abc'
  const middle = 'https://onedrive.live.com/redir'
  const final = 'https://cdn.example.com/file.docx'

  const result = await resolveSharedResource(start, {
    lookup: safeLookup,
    fetchImpl: mockFetch({
      [`HEAD ${start}`]: response('', {
        status: 302,
        headers: { location: middle },
      }),
      [`HEAD ${middle}`]: response('', {
        status: 302,
        headers: { location: final },
      }),
      [`HEAD ${final}`]: response('', {
        headers: {
          'content-disposition': 'attachment; filename="contrato.docx"',
          'content-type':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
      }),
    }),
  })

  assert.equal(result.resolvedUrl, final)
  assert.equal(result.name, 'contrato.docx')
  assert.equal(result.resourceType, 'document')
})

test('detecta loop y limite de redirects', async () => {
  const url = 'https://example.com/a'

  const loop = await resolveSharedResource(url, {
    lookup: safeLookup,
    fetchImpl: mockFetch({
      [`HEAD ${url}`]: response('', {
        status: 302,
        headers: { location: url },
      }),
    }),
  })
  assert.equal(loop.success, false)
  assert.equal(loop.error, 'redirect_loop')

  clearSharedResourceCache()
  const maxed = await resolveSharedResource(url, {
    lookup: safeLookup,
    redirectLimit: 1,
    fetchImpl: mockFetch({
      [`HEAD ${url}`]: response('', {
        status: 302,
        headers: { location: 'https://example.com/b' },
      }),
      'HEAD https://example.com/b': response('', {
        status: 302,
        headers: { location: 'https://example.com/c' },
      }),
    }),
  })
  assert.equal(maxed.success, false)
  assert.equal(maxed.error, 'max_redirects_exceeded')
})

test('rechaza HTTP, localhost, IPv4 privada, DNS privado y redirect privado', async () => {
  assert.equal(
    (
      await resolveSharedResource('http://example.com/file.pdf', {
        lookup: safeLookup,
        fetchImpl: mockFetch({}),
      })
    ).error,
    'unsupported_scheme'
  )

  assert.equal(
    (
      await resolveSharedResource('https://localhost/file.pdf', {
        lookup: safeLookup,
        fetchImpl: mockFetch({}),
      })
    ).error,
    'unsafe_host'
  )

  assert.equal(
    (
      await resolveSharedResource('https://192.168.1.10/file.pdf', {
        lookup: safeLookup,
        fetchImpl: mockFetch({}),
      })
    ).error,
    'unsafe_ip'
  )

  assert.equal(
    (
      await resolveSharedResource('https://example.com/file.pdf', {
        lookup: async () => [{ address: '10.0.0.4', family: 4 }],
        fetchImpl: mockFetch({}),
      })
    ).error,
    'unsafe_dns_target'
  )

  clearSharedResourceCache()
  assert.equal(
    (
      await resolveSharedResource('https://example.com/file.pdf', {
        lookup: safeLookup,
        fetchImpl: mockFetch({
          'HEAD https://example.com/file.pdf': response('', {
            status: 302,
            headers: { location: 'https://127.0.0.1/private' },
          }),
        }),
      })
    ).error,
    'unsafe_ip'
  )
})

test('timeout y estados HTTP fallan sin bloquear el flujo', async () => {
  const timeout = await resolveSharedResource('https://example.com/slow.pdf', {
    lookup: safeLookup,
    timeoutMs: 1,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      }),
  })
  assert.equal(timeout.success, false)
  assert.equal(timeout.error, 'timeout')

  for (const status of [403, 404, 500]) {
    clearSharedResourceCache()
    const url = `https://example.com/${status}.pdf`
    const result = await resolveSharedResource(url, {
      lookup: safeLookup,
      fetchImpl: mockFetch({
        [`HEAD ${url}`]: response('', { status }),
        [`GET ${url}`]: response('', { status }),
      }),
    })
    assert.equal(result.success, false)
    assert.equal(result.error, `http_${status}`)
  }
})

test('soporta MIME sin extension y extension sin MIME', async () => {
  const image = await resolveSharedResource('https://example.com/resource', {
    lookup: safeLookup,
    fetchImpl: mockFetch({
      'HEAD https://example.com/resource': response('', {
        headers: { 'content-type': 'image/png' },
      }),
      'GET https://example.com/resource': response('', {
        headers: { 'content-type': 'image/png' },
      }),
    }),
  })
  assert.equal(image.resourceType, 'image')
  assert.equal(image.extension, undefined)

  clearSharedResourceCache()
  const csv = await resolveSharedResource('https://example.com/data/dataset.csv', {
    lookup: safeLookup,
    fetchImpl: mockFetch({
      'HEAD https://example.com/data/dataset.csv': response('', { headers: {} }),
      'GET https://example.com/data/dataset.csv': response('', { headers: {} }),
    }),
  })
  assert.equal(csv.resourceType, 'spreadsheet')
  assert.equal(csv.extension, 'csv')
})

test('resuelve multiples URLs del mensaje de forma independiente', async () => {
  const text =
    'uno https://example.com/a.pdf dos https://drive.google.com/file/d/abc'
  const results = await resolveSharedResourcesFromText(text, {
    lookup: safeLookup,
    fetchImpl: mockFetch({
      'HEAD https://example.com/a.pdf': response('', {
        headers: { 'content-type': 'application/pdf' },
      }),
      'GET https://example.com/a.pdf': response('', {
        headers: { 'content-type': 'application/pdf' },
      }),
      'HEAD https://drive.google.com/file/d/abc': response('', {
        headers: { 'content-type': 'text/html' },
      }),
      'GET https://drive.google.com/file/d/abc': response(
        '<title>documento.pdf</title>',
        { headers: { 'content-type': 'text/html' } }
      ),
    }),
  })

  assert.equal(results.length, 2)
  assert.equal(results[0].name, 'a.pdf')
  assert.equal(results[1].provider, 'google-drive')
  assert.equal(results[1].name, 'documento.pdf')
})

function response(body = '', { status = 200, headers = {} } = {}) {
  return new Response(body, { status, headers })
}

function mockFetch(routes) {
  return async (url, init = {}) => {
    const key = `${String(init.method || 'GET').toUpperCase()} ${url}`
    const route = routes[key]
    if (!route) {
      throw new Error(`No mock for ${key}`)
    }
    return route
  }
}
