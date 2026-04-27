import { BaseArweaveClient, isKnownArweaveGatewayHostname } from '@seedprotocol/sdk'
import {
  getFeedFieldStorageModels,
  getFeedListElementStorageModels,
  isFeedRichBodyStorageSchema,
} from './feedFieldStorageModel'

/** Same logical fields as legacy `pickFeedItemRichText` primary keys — inline HTML for feeds. */
const RICH_TEXT_KEYS = ['html', 'Html', 'body', 'Body', 'content', 'Content'] as const

/** Max UTF-8 bytes for a single rich-body fetch (HTML/JSON on Arweave can exceed 2MB with embeds). */
const MAX_BODY_BYTES = 8_000_000

/**
 * True for a single-path gateway URL whose path looks like an Arweave transaction id
 * (e.g. `https://arweave.net/<43-char tx id>`), matching {@link getArweaveUrlForTransaction}.
 */
export function isArweaveTransactionGatewayUrl(raw: string): boolean {
  const s = raw.trim()
  if (!s.startsWith('http://') && !s.startsWith('https://')) return false
  try {
    const u = new URL(s)
    const host = u.hostname.toLowerCase()
    const expected = BaseArweaveClient.getHost().toLowerCase()
    if (host !== expected && !isKnownArweaveGatewayHostname(host)) return false
    const segments = u.pathname.replace(/^\//, '').split('/').filter(Boolean)
    if (segments.length !== 1) return false
    const id = segments[0]!
    return /^[A-Za-z0-9_-]{43}$/.test(id)
  } catch {
    return false
  }
}

async function fetchGatewayPayloadAsUtf8(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/html, text/plain, text/markdown, application/json, */*' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (/^(image|video|audio)\//i.test(ct)) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_BODY_BYTES) return null
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    if (text.length === 0 || text.includes('\0')) return null
    return text
  } catch {
    return null
  }
}

async function hydrateStringFieldIfGateway(
  item: Record<string, unknown>,
  key: string
): Promise<void> {
  const v = item[key]
  if (typeof v !== 'string' || v.trim() === '') return
  if (!isArweaveTransactionGatewayUrl(v)) return
  const text = await fetchGatewayPayloadAsUtf8(v)
  if (text === null) return
  item[key] = text
}

/**
 * After {@link resolveRelationPropertiesToUrls}, Html/File relation fields may be gateway URLs.
 * For RSS/Atom `content:encoded`, replace those with the fetched UTF-8 body (typically HTML).
 */
export async function hydrateArweaveRichTextInFeedItems(
  items: Record<string, unknown>[]
): Promise<void> {
  for (const item of items) {
    const keysToHydrate = new Set<string>([...RICH_TEXT_KEYS])
    const fieldModels = getFeedFieldStorageModels(item)
    if (fieldModels) {
      for (const [k, m] of Object.entries(fieldModels)) {
        if (isFeedRichBodyStorageSchema(m)) keysToHydrate.add(k)
      }
    }
    for (const key of keysToHydrate) {
      await hydrateStringFieldIfGateway(item, key)
    }

    const listModels = getFeedListElementStorageModels(item)
    if (listModels) {
      for (const [listKey, models] of Object.entries(listModels)) {
        const arr = item[listKey]
        if (!Array.isArray(arr)) continue
        const n = Math.min(models.length, arr.length)
        for (let i = 0; i < n; i++) {
          if (!isFeedRichBodyStorageSchema(models[i]!)) continue
          const el = arr[i]
          if (typeof el !== 'string' || !isArweaveTransactionGatewayUrl(el)) continue
          const text = await fetchGatewayPayloadAsUtf8(el)
          if (text === null) continue
          arr[i] = text
        }
      }
    }
  }
}
