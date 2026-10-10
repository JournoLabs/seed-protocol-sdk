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

/** Upper bound on cached body text, in UTF-16 code units (~2 bytes each). */
const BODY_CACHE_MAX_CHARS = 32_000_000

/**
 * Fetched bodies by Arweave transaction id, least recently used first. A transaction's data never
 * changes, so entries never go stale; they are only evicted for size. Failed fetches are not cached
 * (a new transaction can 404 until gateways have it).
 */
const bodyCache = new Map<string, string>()
let bodyCacheChars = 0
const bodiesInFlight = new Map<string, Promise<string | null>>()

/** Clears the Arweave body cache. For tests. */
export function resetArweaveBodyCache(): void {
  bodyCache.clear()
  bodyCacheChars = 0
  bodiesInFlight.clear()
}

function cacheBody(txId: string, text: string): void {
  if (text.length > BODY_CACHE_MAX_CHARS) return
  bodyCache.set(txId, text)
  bodyCacheChars += text.length
  for (const [oldest, oldText] of bodyCache) {
    if (bodyCacheChars <= BODY_CACHE_MAX_CHARS) break
    bodyCache.delete(oldest)
    bodyCacheChars -= oldText.length
  }
}

/** Gateway body for a transaction URL: cached by transaction id, concurrent requests shared. */
async function fetchTransactionBody(url: string): Promise<string | null> {
  const txId = new URL(url.trim()).pathname.replace(/^\//, '')
  const cached = bodyCache.get(txId)
  if (cached !== undefined) {
    // Most recently used goes last.
    bodyCache.delete(txId)
    bodyCache.set(txId, cached)
    return cached
  }
  const inFlight = bodiesInFlight.get(txId)
  if (inFlight) return inFlight

  const request = fetchGatewayPayloadAsUtf8(url)
    .then((text) => {
      if (text !== null && bodiesInFlight.get(txId) === request) cacheBody(txId, text)
      return text
    })
    .finally(() => {
      if (bodiesInFlight.get(txId) === request) bodiesInFlight.delete(txId)
    })
  bodiesInFlight.set(txId, request)
  return request
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
  return fetchTransactionBody(value)
}

/** Bodies resolved at once, across all items. */
const HYDRATE_CONCURRENCY = 8

async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      await tasks[next++]!()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
}

/**
 * After relation URL resolution, Html/File fields may be gateway URLs (or local paths).
 * Replace those with the UTF-8 body when `hydrateStorage` is enabled.
 * Up to HYDRATE_CONCURRENCY bodies are resolved at a time, across all items.
 */
export async function hydrateArweaveRichTextInItems(
  items: Record<string, unknown>[],
  options?: HydrateStorageOptions,
): Promise<void> {
  const readStorageBody = options?.readStorageBody
  const tasks: Array<() => Promise<void>> = []

  for (const item of items) {
    const keysToHydrate = new Set<string>([...RICH_TEXT_KEYS])
    const fieldModels = getFieldStorageModels(item)
    if (fieldModels) {
      for (const [k, m] of Object.entries(fieldModels)) {
        if (isRichBodyStorageSchema(m)) keysToHydrate.add(k)
      }
    }
    for (const key of keysToHydrate) {
      const v = item[key]
      if (typeof v !== 'string' || v.trim() === '') continue
      tasks.push(async () => {
        const text = await resolveHydratedBody(key, v, readStorageBody)
        if (text !== null) item[key] = text
      })
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
          tasks.push(async () => {
            const text = await resolveHydratedBody(listKey, el, readStorageBody)
            if (text !== null) arr[i] = text
          })
        }
      }
    }
  }

  await runWithConcurrency(tasks, HYDRATE_CONCURRENCY)
}

/** @deprecated Use {@link hydrateArweaveRichTextInItems} */
export const hydrateArweaveRichTextInFeedItems = hydrateArweaveRichTextInItems
