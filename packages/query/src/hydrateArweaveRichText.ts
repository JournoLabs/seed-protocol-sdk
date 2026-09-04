import { BaseArweaveClient, isKnownArweaveGatewayHostname } from '@seedprotocol/arweave'
import {
  getFieldStorageModels,
  getListElementStorageModels,
  isRichBodyStorageSchema,
} from './fieldStorageModel.js'

/** Same logical fields as legacy rich-text primary keys — inline HTML/body for consumers. */
const RICH_TEXT_KEYS = ['html', 'Html', 'body', 'Body', 'content', 'Content'] as const

/** Max UTF-8 bytes for a single rich-body fetch. */
const MAX_BODY_BYTES = 8_000_000

export type HydrateStorageOptions = {
  /** Prefer local file body when available; fall back to Arweave gateway fetch. */
  readStorageBody?: (ref: {
    propertyName: string
    value: unknown
    localPathHint?: string
  }) => Promise<string | null>
}

/**
 * True for a single-path gateway URL whose path looks like an Arweave transaction id.
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

async function resolveHydratedBody(
  propertyName: string,
  value: string,
  readStorageBody?: HydrateStorageOptions['readStorageBody'],
): Promise<string | null> {
  if (readStorageBody) {
    try {
      const local = await readStorageBody({ propertyName, value })
      if (local != null && local.length > 0) return local
    } catch {
      // fall through to gateway
    }
  }
  if (!isArweaveTransactionGatewayUrl(value)) return null
  return fetchGatewayPayloadAsUtf8(value)
}

async function hydrateStringField(
  item: Record<string, unknown>,
  key: string,
  readStorageBody?: HydrateStorageOptions['readStorageBody'],
): Promise<void> {
  const v = item[key]
  if (typeof v !== 'string' || v.trim() === '') return
  const text = await resolveHydratedBody(key, v, readStorageBody)
  if (text === null) return
  item[key] = text
}

/**
 * After relation URL resolution, Html/File fields may be gateway URLs (or local paths).
 * Replace those with the UTF-8 body when `hydrateStorage` is enabled.
 */
export async function hydrateArweaveRichTextInItems(
  items: Record<string, unknown>[],
  options?: HydrateStorageOptions,
): Promise<void> {
  const readStorageBody = options?.readStorageBody
  for (const item of items) {
    const keysToHydrate = new Set<string>([...RICH_TEXT_KEYS])
    const fieldModels = getFieldStorageModels(item)
    if (fieldModels) {
      for (const [k, m] of Object.entries(fieldModels)) {
        if (isRichBodyStorageSchema(m)) keysToHydrate.add(k)
      }
    }
    for (const key of keysToHydrate) {
      await hydrateStringField(item, key, readStorageBody)
    }

    const listModels = getListElementStorageModels(item)
    if (listModels) {
      for (const [listKey, models] of Object.entries(listModels)) {
        const arr = item[listKey]
        if (!Array.isArray(arr)) continue
        const n = Math.min(models.length, arr.length)
        for (let i = 0; i < n; i++) {
          if (!isRichBodyStorageSchema(models[i]!)) continue
          const el = arr[i]
          if (typeof el !== 'string') continue
          const text = await resolveHydratedBody(listKey, el, readStorageBody)
          if (text === null) continue
          arr[i] = text
        }
      }
    }
  }
}

/** @deprecated Use {@link hydrateArweaveRichTextInItems} */
export const hydrateArweaveRichTextInFeedItems = hydrateArweaveRichTextInItems
