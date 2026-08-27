export function parseHtmlMetadata(html) {
  const value = String(html || '')
  if (!value) return {}

  return {
    title:
      readMeta(value, 'property', 'og:title') ||
      readMeta(value, 'name', 'title') ||
      readTitle(value),
    type: readMeta(value, 'property', 'og:type'),
    url: readMeta(value, 'property', 'og:url'),
    description: readMeta(value, 'name', 'description'),
  }
}

function readMeta(html, attrName, attrValue) {
  const tags = html.match(/<meta\b[^>]*>/gi) || []
  for (const tag of tags) {
    const attr = readAttr(tag, attrName)
    if (String(attr || '').toLowerCase() !== attrValue.toLowerCase()) continue
    const content = readAttr(tag, 'content')
    if (content) return decodeHtml(content.trim())
  }
  return null
}

function readTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)
  if (!match?.[1]) return null
  return decodeHtml(match[1].replace(/\s+/g, ' ').trim())
}

function readAttr(tag, name) {
  const regex = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = tag.match(regex)
  return match?.[2] || match?.[3] || match?.[4] || null
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
