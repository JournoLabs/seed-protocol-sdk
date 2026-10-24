import type { AllowedBy } from './allowlist'

/** Where an upstream request was when it failed. */
export type UpstreamPhase = 'send' | 'wait' | 'body'

/**
 * Events from `serveTunnel`'s `onEvent`. Streams are `s<N>`; requests carry the id that
 * `requestIdHeader` sends upstream. Times are milliseconds; `totalMs` and `receiveMs` count
 * from the request's first byte on the stream.
 */
export type TunnelEvent =
  | {
      name: 'stream.open'
      stream: string
      /** Client public key (z32) */
      remoteKey: string
      /** UDP address the connection uses */
      host: string | null
      by: AllowedBy
    }
  | {
      name: 'stream.refused'
      remoteKey: string
      /**
       * `handshake`: refused by key in HyperDHT's firewall, before a stream exists, so the
       * client's address is unknown and `host` is null. `connection`: refused once connected.
       */
      stage: 'handshake' | 'connection'
      host: string | null
    }
  | {
      name: 'stream.close'
      stream: string
      requests: number
      bytesIn: number
      durationMs: number
      /** The request in flight when the stream closed, if any */
      inflight: string | null
    }
  | { name: 'stream.error'; stream: string; error: string; code?: string }
  | {
      name: 'req.recv'
      request: string
      stream: string
      method: string
      path: string
      bodyBytes: number
      /** From the request's first byte to its last */
      receiveMs: number
    }
  | { name: 'up.response'; request: string; status: number; upstreamMs: number }
  | { name: 'up.done'; request: string; status: number; bytes: number; upstreamMs: number }
  | {
      name: 'up.error'
      request: string
      phase: UpstreamPhase
      error: string
      code?: string
      /** True when the tunnel stream closed and the operator aborted the upstream request */
      aborted: boolean
    }
  | { name: 'up.timeout'; request: string; phase: UpstreamPhase; timeoutMs: number }
  | { name: 'res.sent'; request: string; status: number; bytes: number; totalMs: number }

export type TunnelEventName = TunnelEvent['name']

/** Called synchronously; a throw is caught and dropped so tracing can't break the tunnel. */
export type TunnelEventListener = (event: TunnelEvent) => void

export function errorFields(err: unknown): { error: string; code?: string } {
  const error = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' ? { error, code } : { error }
}

/** A run-unique prefix, so request ids from different operator runs never collide. */
export function createIdSource(): { stream: () => string; request: () => string } {
  const run = Date.now().toString(36)
  let streams = 0
  let requests = 0
  return {
    stream: () => `s${++streams}`,
    request: () => `${run}-r${++requests}`,
  }
}
