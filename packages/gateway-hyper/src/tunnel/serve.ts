import type { Duplex } from 'node:stream'
import HyperDHT from 'hyperdht'
import { readTunnelRequest, writeTunnelResponse } from './protocol'
import { UpstreamTimeoutError } from './errors'
import { proxyTunnelRequest } from './proxy'
import { createAllowlist } from './allowlist'
import { loadOrCreateOperatorKeypair } from '../keys'
import type { ServeTunnelOptions, ServeTunnelResult } from '../types'

export type TunnelConnectionOptions = {
  /** Idle limit on each upstream request. Default 30 000; 0 disables. */
  upstreamTimeoutMs?: number
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
 */
export async function serveTunnelConnection(
  socket: Duplex,
  upstream: string,
  options: TunnelConnectionOptions = {},
): Promise<void> {
  // Clients never half-close, so `end` means the peer is gone, same as `close` or `error`.
  const closed = new AbortController()
  const onGone = () => closed.abort()
  socket.once('end', onGone)
  socket.once('close', onGone)
  socket.on('error', onGone)
  // Attach framed readers synchronously so HyperDHT early bytes are not lost.
  let pendingRequest = readTunnelRequest(socket)
  try {
    while (true) {
      const { meta, body } = await pendingRequest
      let result: { status: number; headers: Record<string, string>; body: Buffer }
      try {
        result = await proxyTunnelRequest(upstream, meta, body, {
          timeoutMs: options.upstreamTimeoutMs,
          signal: closed.signal,
        })
      } catch (err) {
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
      pendingRequest = readTunnelRequest(socket)
    }
  } catch {
    socket.destroy()
  }
}

/**
 * Operator: accept Hyperswarm/DHT connections and proxy framed HTTP to upstream Traefik.
 */
export async function serveTunnel(options: ServeTunnelOptions): Promise<ServeTunnelResult> {
  const upstream = options.upstream.replace(/\/$/, '')
  const keyFile = options.keyFile ?? '.seed/gateway-tunnel/operator.key.json'
  const allowlist = createAllowlist(options.allowlist)
  const keypair = loadOrCreateOperatorKeypair(keyFile)

  const dht = new HyperDHT(options.bootstrap ? { bootstrap: options.bootstrap } : {})
  const server = dht.createServer(
    { firewall: (remotePublicKey) => allowlist.firewall(remotePublicKey) },
    (socket) => {
      // Refuse before serveTunnelConnection attaches a reader, so nothing is read.
      if (!allowlist.check(socket).ok) {
        socket.on('error', () => {})
        socket.destroy()
        return
      }
      void serveTunnelConnection(socket, upstream, {
        upstreamTimeoutMs: options.upstreamTimeoutMs,
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
