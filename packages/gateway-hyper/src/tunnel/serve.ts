import type { Duplex } from 'node:stream'
import HyperDHT from 'hyperdht'
import { readTunnelRequest, writeTunnelResponse } from './protocol'
import { UpstreamTimeoutError } from './errors'
import { proxyTunnelRequest } from './proxy'
import { createAllowlist } from './allowlist'
import {
  createIdSource,
  errorFields,
  safeEmitter,
  type TunnelEventListener,
  type UpstreamPhase,
} from './events'
import { encodePublicKeyZ32, loadOrCreateOperatorKeypair } from '../keys'
import type { ServeTunnelOptions, ServeTunnelResult } from '../types'

export type TunnelConnectionOptions = {
  /** Idle limit on each upstream request. Default 30 000; 0 disables. */
  upstreamTimeoutMs?: number
  /** Receives this stream's events; see `TunnelEvent`. */
  onEvent?: TunnelEventListener
  /** Send each request's id upstream under this header. */
  requestIdHeader?: string
  /** Id for this stream in events. Default `s0`. */
  streamId?: string
  /** Makes request ids. Default: run-unique ids from `createIdSource`. */
  nextRequestId?: () => string
}

function errorResponse(
  status: number,
  message: string,
): { status: number; headers: Record<string, string>; body: Buffer } {
  return {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: Buffer.from(message, 'utf8'),
  }
}

/**
 * Answer framed requests on one tunnel stream, in order, until it closes. Upstream timeouts
 * become 504 and other upstream failures 502, so the stream stays usable; only a broken
 * stream ends the loop. The stream ending or closing aborts the upstream request in flight.
 *
 * Without `onEvent` or `requestIdHeader`, no tracing state is kept and no listeners are added.
 */
export async function serveTunnelConnection(
  socket: Duplex,
  upstream: string,
  options: TunnelConnectionOptions = {},
): Promise<void> {
  const emit = safeEmitter(options.onEvent)
  const { requestIdHeader } = options
  const streamId = options.streamId ?? 's0'
  const nextRequestId =
    emit || requestIdHeader ? (options.nextRequestId ?? createIdSource().request) : null

  // Clients never half-close, so `end` means the peer is gone, same as `close` or `error`.
  const closed = new AbortController()
  const onGone = () => closed.abort()
  socket.once('end', onGone)
  socket.once('close', onGone)
  socket.on('error', onGone)

  // Tracing state, kept only when someone listens.
  const opened = performance.now()
  let requests = 0
  let bytesIn = 0
  let firstByteAt: number | null = null
  let inflight: string | null = null
  if (emit) {
    // A second data listener beside the frame reader's: byte counts, and when each request's
    // first byte arrived, so receive time leaves out idle time between requests.
    socket.on('data', (chunk: Buffer) => {
      bytesIn += chunk.length
      firstByteAt ??= performance.now()
    })
    socket.on('error', (err: unknown) => emit({ name: 'stream.error', stream: streamId, ...errorFields(err) }))
    socket.once('close', () =>
      emit({
        name: 'stream.close',
        stream: streamId,
        requests,
        bytesIn,
        durationMs: Math.round(performance.now() - opened),
        inflight,
      }),
    )
  }

  // Attach framed readers synchronously so HyperDHT early bytes are not lost.
  let pendingRequest = readTunnelRequest(socket)
  try {
    while (true) {
      const { meta, body } = await pendingRequest
      const requestId = nextRequestId?.() ?? null
      const t0 = firstByteAt ?? performance.now()
      firstByteAt = null
      let upstreamStart = 0
      let phase: UpstreamPhase = 'send'
      if (emit && requestId) {
        requests++
        inflight = requestId
        emit({
          name: 'req.recv',
          request: requestId,
          stream: streamId,
          method: meta.method,
          path: meta.path,
          bodyBytes: body.length,
          receiveMs: Math.round(performance.now() - t0),
        })
        upstreamStart = performance.now()
      }
      const upstreamMs = () => Math.round(performance.now() - upstreamStart)

      let result: { status: number; headers: Record<string, string>; body: Buffer }
      try {
        result = await proxyTunnelRequest(upstream, meta, body, {
          timeoutMs: options.upstreamTimeoutMs,
          signal: closed.signal,
          extraHeaders:
            requestIdHeader && requestId ? { [requestIdHeader]: requestId } : undefined,
          observer:
            emit && requestId
              ? {
                  onPhase: (next) => {
                    // `finish` can land after the response started; keep the later phase.
                    if (!(next === 'wait' && phase === 'body')) phase = next
                  },
                  onResponse: (status) =>
                    emit({ name: 'up.response', request: requestId, status, upstreamMs: upstreamMs() }),
                  onDone: (status, bytes) =>
                    emit({ name: 'up.done', request: requestId, status, bytes, upstreamMs: upstreamMs() }),
                }
              : undefined,
        })
      } catch (err) {
        if (emit && requestId) {
          emit(
            err instanceof UpstreamTimeoutError && !closed.signal.aborted
              ? { name: 'up.timeout', request: requestId, phase, timeoutMs: err.timeoutMs }
              : {
                  name: 'up.error',
                  request: requestId,
                  phase,
                  ...errorFields(err),
                  aborted: closed.signal.aborted,
                },
          )
        }
        if (closed.signal.aborted) return
        const message = err instanceof Error ? err.message : String(err)
        result =
          err instanceof UpstreamTimeoutError
            ? errorResponse(504, `Gateway Hyper upstream timeout: ${message}`)
            : errorResponse(502, `Gateway Hyper upstream error: ${message}`)
      }
      await writeTunnelResponse(
        socket,
        { status: result.status, headers: result.headers },
        result.body,
      )
      if (emit && requestId) {
        inflight = null
        emit({
          name: 'res.sent',
          request: requestId,
          status: result.status,
          bytes: result.body.length,
          totalMs: Math.round(performance.now() - t0),
        })
      }
      pendingRequest = readTunnelRequest(socket)
    }
  } catch {
    socket.destroy()
  }
}

/**
 * Operator: accept Hyperswarm/DHT connections and proxy framed HTTP to the upstream.
 */
export async function serveTunnel(options: ServeTunnelOptions): Promise<ServeTunnelResult> {
  const upstream = options.upstream.replace(/\/$/, '')
  const keyFile = options.keyFile ?? '.seed/gateway-tunnel/operator.key.json'
  const allowlist = createAllowlist(options.allowlist)
  const keypair = loadOrCreateOperatorKeypair(keyFile)
  const emit = safeEmitter(options.onEvent)
  const ids = createIdSource()

  const dht = new HyperDHT(options.bootstrap ? { bootstrap: options.bootstrap } : {})
  const server = dht.createServer(
    {
      firewall: (remotePublicKey) => {
        const refuse = allowlist.firewall(remotePublicKey)
        if (refuse && emit) {
          emit({
            name: 'stream.refused',
            remoteKey: encodePublicKeyZ32(remotePublicKey),
            stage: 'handshake',
            host: null,
          })
        }
        return refuse
      },
    },
    (socket) => {
      const verdict = allowlist.check(socket)
      // Refuse before serveTunnelConnection attaches a reader, so nothing is read.
      if (!verdict.ok) {
        emit?.({
          name: 'stream.refused',
          remoteKey: encodePublicKeyZ32(socket.remotePublicKey),
          stage: 'connection',
          host: verdict.host,
        })
        socket.on('error', () => {})
        socket.destroy()
        return
      }
      const streamId = ids.stream()
      emit?.({
        name: 'stream.open',
        stream: streamId,
        remoteKey: encodePublicKeyZ32(socket.remotePublicKey),
        host: verdict.host,
        by: verdict.by,
      })
      void serveTunnelConnection(socket, upstream, {
        upstreamTimeoutMs: options.upstreamTimeoutMs,
        onEvent: options.onEvent,
        requestIdHeader: options.requestIdHeader,
        streamId,
        nextRequestId: ids.request,
      })
    },
  )

  await server.listen(keypair)

  return {
    key: keypair.z32,
    upstream,
    close: async () => {
      await server.close()
      await dht.destroy()
    },
  }
}
