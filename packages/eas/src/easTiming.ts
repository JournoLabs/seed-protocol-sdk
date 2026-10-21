import debug from 'debug'
import type { FetchQueryOptions, IQueryClient } from './QueryClient/IQueryClient.js'

/**
 * Per-request EAS timings under `DEBUG=seedEas:timing`. Two kinds of line:
 *
 * - `request <operation> <filters> rows=<n> bytes=<n> <ms>ms`, one per indexer request, timed from
 *   send until the response body is read and parsed. `<filters>` gives the length of each
 *   `id: { in }` / `refUID: { in }` list in the `where`; `bytes` is the decoded body size.
 * - `fetchQuery <key> network|cache|deduped <ms>ms`, one per call of the api.ts helpers that go
 *   through the query client: `network` when this call ran the request, `deduped` when it waited
 *   on the same request already in flight, `cache` when the query client answered from its cache.
 */
export const easTimingLogger = debug('seedEas:timing')

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

type FetchInit = Parameters<typeof fetch>[1]

const uidListLengths = (where: unknown, out: string[] = []): string[] => {
  if (Array.isArray(where)) {
    for (const entry of where) uidListLengths(entry, out)
  } else if (where && typeof where === 'object') {
    for (const [key, value] of Object.entries(where)) {
      const list = (value as { in?: unknown } | null)?.in
      if ((key === 'id' || key === 'refUID') && Array.isArray(list)) {
        out.push(`${key}.in=${list.length}`)
      } else {
        uidListLengths(value, out)
      }
    }
  }
  return out
}

const describeRequestBody = (body: unknown): { operation: string; filters: string[] } => {
  if (typeof body !== 'string') return { operation: '(unnamed)', filters: [] }
  try {
    const parsed = JSON.parse(body) as { operationName?: string; variables?: { where?: unknown } }
    return { operation: parsed.operationName || '(unnamed)', filters: uidListLengths(parsed.variables?.where) }
  } catch {
    return { operation: '(unnamed)', filters: [] }
  }
}

const countRows = (text: string): number | undefined => {
  try {
    const data = (JSON.parse(text) as { data?: Record<string, unknown> }).data
    if (!data) return undefined
    return Object.values(data).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : value ? 1 : 0), 0)
  } catch {
    return undefined
  }
}

/**
 * `fetch` that logs a request line when timing is on. The body is read here so the time covers
 * the whole response, then handed on as a new Response. When timing is off it is `doFetch`.
 */
export async function timedEasFetch(
  doFetch: () => Promise<Response>,
  init: FetchInit,
): Promise<Response> {
  if (!easTimingLogger.enabled) return doFetch()
  const start = now()
  const { operation, filters } = describeRequestBody(init?.body)
  const label = ['request', operation, ...filters].join(' ')
  let response: Response
  try {
    response = await doFetch()
  } catch (error) {
    easTimingLogger(`${label} ${Math.round(now() - start)}ms (failed: ${(error as Error)?.name ?? 'error'})`)
    throw error
  }
  const text = await response.text()
  const rows = countRows(text)
  const bytes = new TextEncoder().encode(text).length
  const status = response.ok ? '' : ` status=${response.status}`
  easTimingLogger(`${label} rows=${rows ?? '?'} bytes=${bytes}${status} ${Math.round(now() - start)}ms`)
  return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers })
}

/** Keys of query functions started by `timedFetchQuery` and not yet settled. */
const inFlightKeys = new Map<string, number>()

/**
 * `queryClient.fetchQuery(options)`, logging whether the result came from this call's request, a
 * request already in flight for the same key, or the query client's cache. When timing is off it
 * is `fetchQuery` unchanged.
 */
export async function timedFetchQuery<T>(queryClient: IQueryClient, options: FetchQueryOptions<T>): Promise<T> {
  if (!easTimingLogger.enabled) return queryClient.fetchQuery(options)
  const key = JSON.stringify(options.queryKey)
  const wasInFlight = inFlightKeys.has(key)
  let ran = false
  const queryFn = async () => {
    ran = true
    inFlightKeys.set(key, (inFlightKeys.get(key) ?? 0) + 1)
    try {
      return await options.queryFn()
    } finally {
      const left = (inFlightKeys.get(key) ?? 1) - 1
      if (left > 0) inFlightKeys.set(key, left)
      else inFlightKeys.delete(key)
    }
  }
  const start = now()
  let failed = false
  try {
    return await queryClient.fetchQuery({ ...options, queryFn })
  } catch (error) {
    failed = true
    throw error
  } finally {
    const source = ran ? 'network' : wasInFlight ? 'deduped' : 'cache'
    easTimingLogger(
      `fetchQuery ${String(options.queryKey[0])} ${source} ${Math.round(now() - start)}ms${failed ? ' (failed)' : ''}`,
    )
  }
}
