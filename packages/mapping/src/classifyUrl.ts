import type { UrlMediaClass } from './types'

export type ClassifyUrlInput = {
  url: string
  contentType?: string | null
}

function normalizeMime(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? ''
}

function classFromMime(mime: string): UrlMediaClass | null {
  if (!mime) return null
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  if (
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    mime === 'application/xhtml'
  ) {
    return 'html'
  }
  return null
}

function pathFromUrl(url: string): string {
  const trimmed = url.trim()
  try {
    const u = new URL(trimmed)
    return u.pathname.toLowerCase()
  } catch {
    const noQuery = trimmed.split('?')[0]?.split('#')[0] ?? trimmed
    return noQuery.toLowerCase()
  }
}

function classFromPath(pathname: string): UrlMediaClass {
  if (/\.(html?|xhtml|php|asp|aspx|jsp)$/i.test(pathname)) return 'html'
  if (/\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|tiff?)$/i.test(pathname)) {
    return 'image'
  }
  if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|aiff?)$/i.test(pathname)) {
    return 'audio'
  }
  if (/\.(mp4|m4v|webm|ogv|mov|avi|mkv)$/i.test(pathname)) return 'video'
  return 'unknown'
}

/**
 * Pure MIME / URL-shape classifier for import mapping.
 * Prefer `contentType` when present; fall back to path extension.
 * No I/O. Distinct from `@seedprotocol/sdk` `classifyMediaRef` (Seed ref identity).
 */
export function classifyUrl(input: ClassifyUrlInput): UrlMediaClass {
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  if (!url) return 'unknown'

  if (input.contentType) {
    const fromMime = classFromMime(normalizeMime(String(input.contentType)))
    if (fromMime) return fromMime
  }

  return classFromPath(pathFromUrl(url))
}

/** True when the string looks like an absolute http(s) / blob / data URL. */
export function looksLikeUrl(value: string): boolean {
  const v = value.trim().toLowerCase()
  return (
    v.startsWith('http://') ||
    v.startsWith('https://') ||
    v.startsWith('blob:') ||
    v.startsWith('data:')
  )
}
