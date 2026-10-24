import net from 'node:net'
import HyperDHT from 'hyperdht'
import { decodePublicKey, resolveClientKeypair } from '../keys'
import { safeEmitter } from './events'
import { TunnelConnectTimeoutError } from './errors'
import { pipeRaw } from './rawPipe'
import { DEFAULT_CONNECT_TIMEOUT_MS } from './session'
import type { ConnectRawTunnelOptions, ConnectRawTunnelResult } from '../types'

/** Default local port for `connectRawTunnel`, next to the framed sidecar's 1984. */
export const DEFAULT_RAW_PORT = 1985

/** Default limit on TCP connections open through one raw client at once. */
export const DEFAULT_MAX_RAW_CONNECTIONS = 64

/**
 * Client, raw mode: listen on a local TCP port and carry each connection over its own
 * HyperDHT stream to a `serveRawTunnel` operator, which pipes it to its upstream.
 *
 * Each connection costs a DHT lookup and handshake (about 100–400 ms), so put an HTTP client
 * that keeps connections alive in front, such as nginx with `keepalive` on its upstream.
 */
export async function connectRawTunnel(options: ConnectRawTunnelOptions): Promise<ConnectRawTunnelResult> {
  const remotePublicKey = decodePublicKey(options.key)
  const clientKey = resolveClientKeypair(options)
  const host = options.host ?? '127.0.0.1'
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_RAW_CONNECTIONS
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  const emit = safeEmitter(options.onEvent)
  const open = new Set<net.Socket>()
  let connections = 0

  const dht = new HyperDHT(options.bootstrap ? { bootstrap: options.bootstrap } : {})

  // allowHalfOpen: a client that half-closes after its request still gets the response.
  // Node's default would end our side as soon as the client's side ended.
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    if (open.size >= maxConnections) {
      emit?.({ name: 'conn.refused', open: open.size, max: maxConnections })
      socket.destroy()
      return
    }
    const conn = `c${++connections}`
    const started = performance.now()
    open.add(socket)
    socket.setNoDelay(true)

    const stream = dht.connect(remotePublicKey, {
      keyPair: { publicKey: clientKey.publicKey, secretKey: clientKey.secretKey },
    })
    let timer: ReturnType<typeof setTimeout> | null = null
    const pipe = pipeRaw(stream, socket, {
      graceMs: options.closeGraceMs,
      onClose: (result) => {
        if (timer) clearTimeout(timer)
        open.delete(socket)
        emit?.({
          name: 'conn.close',
          conn,
          bytesUp: result.tcpBytesRead,
          bytesDown: result.tcpBytesWritten,
          durationMs: result.durationMs,
          error: result.error,
        })
      },
    })
    // A refused or unreachable operator can leave the stream opening forever.
    if (connectTimeoutMs > 0) {
      timer = setTimeout(() => {
        pipe.fail('connect-timeout')
        stream.destroy(new TunnelConnectTimeoutError(connectTimeoutMs))
      }, connectTimeoutMs)
    }
    stream.once('open', () => {
      if (timer) clearTimeout(timer)
      emit?.({ name: 'conn.open', conn, connectMs: Math.round(performance.now() - started) })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? DEFAULT_RAW_PORT, host, () => resolve())
  })
  const address = server.address()
  const port = address && typeof address === 'object' ? address.port : (options.port ?? DEFAULT_RAW_PORT)

  return {
    key: options.key,
    clientKey: clientKey.z32,
    host,
    port,
    close: async () => {
      for (const socket of open) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await dht.destroy()
    },
  }
}
