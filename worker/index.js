// Streams mp4 objects out of the private R2 bucket, honoring Range requests
// so the <video> element can seek/scrub instead of downloading the whole file.
// Access is restricted to the site itself via Origin/Referer so other sites
// can't hotlink these URLs and scripts can't just loop through every episode.
function allowedOrigin(request, env) {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())

  const origin = request.headers.get('origin')
  if (origin && allowed.includes(origin)) return origin

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin
      if (allowed.includes(refererOrigin)) return refererOrigin
    } catch {
      // malformed referer header, fall through to rejection
    }
  }

  return null
}

function parseRange(rangeHeader) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
  if (!match) return null
  const [, startStr, endStr] = match
  if (startStr === '' && endStr === '') return null

  if (startStr === '') {
    return { suffix: parseInt(endStr, 10) }
  }
  const offset = parseInt(startStr, 10)
  if (endStr === '') {
    return { offset }
  }
  return { offset, length: parseInt(endStr, 10) - offset + 1 }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const key = decodeURIComponent(url.pathname.slice(1))
    if (!key) {
      return new Response('Not found', { status: 404 })
    }

    const origin = allowedOrigin(request, env)
    if (!origin) {
      return new Response('Forbidden', { status: 403 })
    }

    // The <video crossorigin> attribute (needed so WebGL can read frames
    // into a texture) makes the browser send a CORS preflight ahead of
    // ranged requests, since Range isn't a CORS-safelisted header.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, HEAD, OPTIONS',
          'access-control-allow-headers': 'Range',
          'access-control-max-age': '86400',
          vary: 'origin',
        },
      })
    }

    const rangeHeader = request.headers.get('range')
    const range = rangeHeader ? parseRange(rangeHeader) : undefined

    const object = await env.VIDEOS.get(key, range ? { range } : undefined)
    if (!object) {
      return new Response('Not found', { status: 404 })
    }

    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('etag', object.httpEtag)
    headers.set('accept-ranges', 'bytes')
    headers.set('access-control-allow-origin', origin)
    headers.set('vary', 'origin')

    if (range && object.range) {
      const { offset, length } = object.range
      const end = offset + length - 1
      headers.set('content-range', `bytes ${offset}-${end}/${object.size}`)
      headers.set('content-length', String(length))
      return new Response(object.body, { status: 206, headers })
    }

    headers.set('content-length', String(object.size))
    return new Response(object.body, { status: 200, headers })
  },
}
