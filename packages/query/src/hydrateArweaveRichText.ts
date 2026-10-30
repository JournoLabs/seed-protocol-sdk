import {
  type ArweaveTransactionLink,
  buildArweaveTransactionLink,
  getArweaveReadBaseUrls,
  isGatewayHostCircuitOpen,
  parseArweaveTransactionLink,
  readArweaveContentResponse,
  recordGatewayHostFailure,
  recordGatewayHostSuccess,
  rehostArweaveLinksInHtml,
} from '@seedprotocol/arweave'
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
 * True for a gateway URL of an Arweave transaction: `/raw/<id>` or a gateway's `/<id>`, with nothing
 * after the id (see `parseArweaveTransactionLink`).
 */
export function isArweaveTransactionGatewayUrl(raw: string): boolean {
  const s = raw.trim()
  if (!s.startsWith('http://') && !s.startsWith('https://')) return false
  return parseArweaveTransactionLink(s)?.rest === ''
}

type GatewayPayload =
  | { kind: 'text'; text: string }
  /** Media or a body that isn't text: no other gateway would answer differently. */
  | { kind: 'skip' }
  /** The gateway answered but doesn't have the body (a 4xx other than 429). Another may. */
  | { kind: 'miss' }
  /** Timeout, network error, 5xx or 429: says something about the gateway, not the body. */
  | { kind: 'failure' }

/** A 4xx other than 429 is about the request, not the gateway's health. */
const isMissStatus = (status: number) => status >= 400 && status < 500 && status !== 429

/**
 * `GET` the transaction on `baseUrl` in the stored link's form (`/raw/<id>` or `/<id>`) as UTF-8
 * text. The body goes through `transformArweaveContent` (`@seedprotocol/arweave`,
 * `content/arweaveContent.ts`).
 */
async function fetchGatewayPayloadAsUtf8(baseUrl: string, link: ArweaveTransactionLink): Promise<GatewayPayload> {
  try {
    const res = await fetch(buildArweaveTransactionLink(link, baseUrl), {
      headers: { Accept: 'text/html, text/plain, text/markdown, application/json, */*' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return isMissStatus(res.status) ? { kind: 'miss' } : { kind: 'failure' }
    const ct = res.headers.get('content-type') ?? ''
    if (/^(image|video|audio)\//i.test(ct)) return { kind: 'skip' }
    const { bytes } = await readArweaveContentResponse(res, { transactionId: link.transactionId })
    if (bytes.byteLength > MAX_BODY_BYTES) return { kind: 'skip' }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    if (text.length === 0 || text.includes('\0')) return { kind: 'skip' }
    return { kind: 'text', text }
  } catch {
    return { kind: 'failure' }
  }
}

/**
 * The body from the first read gateway that has it, skipping gateways whose circuit is open. Only a
 * failure counts against a gateway's circuit; a gateway that doesn't have the body is passed over.
 */
async function fetchBodyAcrossGateways(link: ArweaveTransactionLink): Promise<string | null> {
  const baseUrls = getArweaveReadBaseUrls()
  const open = baseUrls.filter((url) => !isGatewayHostCircuitOpen(url))
  for (const baseUrl of open.length > 0 ? open : baseUrls) {
    const result = await fetchGatewayPayloadAsUtf8(baseUrl, link)
    if (result.kind === 'failure') {
      recordGatewayHostFailure(baseUrl)
      continue
    }
    if (result.kind === 'miss') continue
    recordGatewayHostSuccess(baseUrl)
    return result.kind === 'text' ? result.text : null
  }
  return null
}

/** Upper bound on cached body text, in UTF-16 code units (~2 bytes each). */
const BODY_CACHE_MAX_CHARS = 32_000_000

/**
 * Fetched bodies by Arweave transaction id and link form (a manifest's `/raw/<id>` and `/<id>` differ),
 * least recently used first. A transaction's data never
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

function cacheBody(key: string, text: string): void {
  if (text.length > BODY_CACHE_MAX_CHARS) return
  bodyCache.set(key, text)
  bodyCacheChars += text.length
  for (const [oldest, oldText] of bodyCache) {
    if (bodyCacheChars <= BODY_CACHE_MAX_CHARS) break
    bodyCache.delete(oldest)
    bodyCacheChars -= oldText.length
  }
}

/**
 * Gateway body for a transaction URL (`isArweaveTransactionGatewayUrl`), from whichever read gateway
 * has it: cached by transaction id and link form, concurrent requests shared.
 */
async function fetchTransactionBody(url: string): Promise<string | null> {
  const link = parseArweaveTransactionLink(url)!
  const key = `${link.form}:${link.transactionId}`
  const cached = bodyCache.get(key)
  if (cached !== undefined) {
    // Most recently used goes last.
    bodyCache.delete(key)
    bodyCache.set(key, cached)
    return cached
  }
  const inFlight = bodiesInFlight.get(key)
  if (inFlight) return inFlight

  const request = fetchBodyAcrossGateways(link)
    .then((text) => {
      if (text !== null && bodiesInFlight.get(key) === request) cacheBody(key, text)
      return text
    })
    .finally(() => {
      if (bodiesInFlight.get(key) === request) bodiesInFlight.delete(key)
    })
  bodiesInFlight.set(key, request)
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
 * Replace those with the UTF-8 body when `hydrateStorage` is enabled, its Arweave links moved onto
 * this reader's gateways (ADR 0025).
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
        if (text !== null) item[key] = rehostArweaveLinksInHtml(text)
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
            if (text !== null) arr[i] = rehostArweaveLinksInHtml(text)
          })
        }
      }
    }
  }

  await runWithConcurrency(tasks, HYDRATE_CONCURRENCY)
}
