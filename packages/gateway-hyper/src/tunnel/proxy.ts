import http from 'node:http'
import { URL } from 'node:url'
import { UpstreamTimeoutError } from './errors'
import { filterResponseHeaders, MAX_FRAME_BYTES } from './protocol'
import type { UpstreamPhase } from './events'
import type { TunnelMeta } from '../types'

/** Default idle limit on the operator's upstream socket. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000

export type ProxyTunnelRequestOptions = {
  /** Fail with `UpstreamTimeoutError` once the upstream socket is idle this long. 0 disables. */
  timeoutMs?: number
  /** Abort the upstream request, e.g. when the tunnel stream closes. */
  signal?: AbortSignal
  /** Headers set on the upstream request, replacing any the client sent under the same name. */
  extraHeaders?: Record<string, string>
  /** Progress callbacks, for tracing. */
  observer?: ProxyObserver
}

export type ProxyObserver = {
  /** The request moved to `phase`: `send` from the start, `wait` once the body is sent, `body` on headers. */
  onPhase?: (phase: UpstreamPhase) => void
  onResponse?: (status: number) => void
  onDone?: (status: number, bytes: number) => void
}

function withHeaders(
  headers: Record<string, string>,
  extra: Record<string, string> | undefined,
): Record<string, string> {
  if (!extra) return headers
  const names = new Set(Object.keys(extra).map((key) => key.toLowerCase()))
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (!names.has(key.toLowerCase())) out[key] = value
  }
  return { ...out, ...extra }
}

/** Headers that describe one hop and must not be forwarded (RFC 9110 section 7.6.1). */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/**
 * Drop hop-by-hop headers and the client's `host`, which names the app server rather than
 * the upstream; it is passed on as `x-forwarded-host`. `content-length` is dropped because
 * Node sets it from the buffered body.
 */
export function upstreamRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const named = new Set(
    (Object.entries(headers).find(([key]) => key.toLowerCase() === 'connection')?.[1] ?? '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  )
  const out: Record<string, string> = {}
  let host: string | undefined
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (lower === 'host') {
      host = value
      continue
    }
    if (lower === 'content-length' || HOP_BY_HOP_HEADERS.has(lower) || named.has(lower)) continue
    out[key] = value
  }
  if (host && !Object.keys(out).some((key) => key.toLowerCase() === 'x-forwarded-host')) {
    out['x-forwarded-host'] = host
  }
  return out
}

export async function proxyTunnelRequest(
  upstreamBase: string,
  meta: TunnelMeta,
  body: Buffer,
  options: ProxyTunnelRequestOptions = {},
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const base = upstreamBase.replace(/\/$/, '')
  const targetUrl = new URL(meta.path, `${base}/`)
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
  const { observer } = options

  return new Promise((resolve, reject) => {
    observer?.onPhase?.('send')
    const req = http.request(
      targetUrl,
      {
        method: meta.method,
        headers: withHeaders(upstreamRequestHeaders(meta.headers), options.extraHeaders),
        signal: options.signal,
      },
      (res) => {
        if (observer) {
          observer.onPhase?.('body')
          observer.onResponse?.(res.statusCode ?? 502)
        }
        const chunks: Buffer[] = []
        let received = 0
        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (received > MAX_FRAME_BYTES) {
            req.destroy(
              new Error(`Upstream response exceeds ${MAX_FRAME_BYTES} bytes, the tunnel's limit`),
            )
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          observer?.onDone?.(res.statusCode ?? 502, received)
          resolve({
            status: res.statusCode ?? 502,
            headers: filterResponseHeaders(res.headers as Record<string, string | string[] | undefined>),
            body: Buffer.concat(chunks),
          })
        })
        res.on('error', reject)
      },
    )
    if (timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => req.destroy(new UpstreamTimeoutError(timeoutMs)))
    }
    req.on('error', reject)
    if (observer?.onPhase) req.once('finish', () => observer.onPhase?.('wait'))
    if (body.length > 0) {
      req.end(body)
    } else {
      req.end()
    }
  })
}
