import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createSeedMcpServer, type SeedMcpServerOptions } from './server.js'

export interface SeedMcpHttpOptions extends SeedMcpServerOptions {
  /**
   * Browser origins allowed to call the endpoint, such as `'https://inspector.example'`. A request
   * whose `Origin` header names any other origin gets 403. Requests without an `Origin` header,
   * which is how hosted connectors call, are accepted.
   */
  allowedOrigins?: readonly string[]
  /**
   * Requests each client address may make per minute, with bursts up to the same number. Requests
   * whose context gives no `clientAddress` are not limited. Absent or 0: no limit.
   */
  rateLimit?: number
}

export interface SeedMcpRequestContext {
  /** The caller's address, which the rate limit is keyed on. */
  clientAddress?: string
}

export type SeedMcpHttpHandler = (request: Request, context?: SeedMcpRequestContext) => Promise<Response>

const MAX_TRACKED_CLIENTS = 10_000

/** A per-address token bucket: `perMinute` tokens, refilled continuously. */
function createRateLimiter(perMinute: number): (key: string) => number {
  const buckets = new Map<string, { tokens: number; at: number }>()
  const perMs = perMinute / 60_000
  /** Returns 0 when the request may go ahead, else the seconds until it may. */
  return (key) => {
    const now = Date.now()
    if (buckets.size >= MAX_TRACKED_CLIENTS) {
      for (const [k, b] of buckets) if (b.tokens + (now - b.at) * perMs >= perMinute) buckets.delete(k)
    }
    const bucket = buckets.get(key) ?? { tokens: perMinute, at: now }
    bucket.tokens = Math.min(perMinute, bucket.tokens + (now - bucket.at) * perMs)
    bucket.at = now
    buckets.set(key, bucket)
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return 0
    }
    return Math.ceil((1 - bucket.tokens) / perMs / 1000)
  }
}

const plain = (status: number, body: string, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } })

/**
 * The Seed MCP server as a Streamable HTTP handler: a web-standard `Request` in, a `Response` out.
 * It is stateless and answers with JSON rather than SSE streams, so any number of instances can
 * serve one URL. Only `POST` carries MCP messages; `GET` and `DELETE` get 405, as the spec allows
 * for a server without sessions. Mount it at the endpoint's path, conventionally `/mcp`.
 */
export function createSeedMcpHttpHandler(options: SeedMcpHttpOptions = {}): SeedMcpHttpHandler {
  const { allowedOrigins = [], rateLimit = 0, ...serverOptions } = options
  const origins = new Set(allowedOrigins)
  const limit = rateLimit > 0 ? createRateLimiter(rateLimit) : undefined

  return async (request, context = {}) => {
    const origin = request.headers.get('origin')
    if (origin !== null && !origins.has(origin)) return plain(403, `Origin ${origin} is not allowed.`)
    const cors: Record<string, string> = origin
      ? {
          'access-control-allow-origin': origin,
          'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
          vary: 'Origin',
        }
      : {}

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
          'access-control-max-age': '86400',
        },
      })
    }
    if (request.method !== 'POST') {
      return plain(405, 'This MCP endpoint is stateless and takes POST only.', { ...cors, allow: 'POST, OPTIONS' })
    }
    if (limit && context.clientAddress) {
      const wait = limit(context.clientAddress)
      if (wait > 0) return plain(429, `Too many requests. Retry in ${wait} s.`, { ...cors, 'retry-after': String(wait) })
    }

    const server = createSeedMcpServer(serverOptions)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    try {
      await server.connect(transport)
      const response = await transport.handleRequest(request)
      const headers = new Headers(response.headers)
      for (const [name, value] of Object.entries(cors)) headers.set(name, value)
      // With JSON responses the body is complete once handleRequest resolves, so the server can close.
      const body = response.body ? await response.arrayBuffer() : null
      return new Response(body, { status: response.status, statusText: response.statusText, headers })
    } finally {
      await server.close()
    }
  }
}
