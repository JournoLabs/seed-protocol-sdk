import net from 'node:net'
import type { Duplex } from 'node:stream'
import HyperDHT from 'hyperdht'
import { createAllowlist } from './allowlist'
import { safeEmitter } from './events'
import { pipeRaw } from './rawPipe'
import { encodePublicKeyZ32, resolveOperatorKeypair } from '../keys'
import type { ServeRawTunnelOptions, ServeRawTunnelResult } from '../types'

/** Default operator key file for raw mode, apart from the framed tunnel's key. */
export const DEFAULT_RAW_OPERATOR_KEY_FILE = '.seed/gateway-tunnel/raw-operator.key.json'

/** `http://host:port`, `https://host`, or `host:port`, as a TCP address. */
export function parseTcpUpstream(upstream: string): { host: string; port: number } {
  const text = upstream.trim()
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `tcp://${text}`)
  const defaultPort = url.protocol === 'http:' ? 80 : url.protocol === 'https:' ? 443 : NaN
  const port = url.port ? Number(url.port) : defaultPort
  const host = url.hostname.replace(/^\[(.*)\]$/, '$1')
  if (!host || !Number.isInteger(port)) {
    throw new Error(`Invalid raw upstream (expected http://host:port or host:port): ${upstream}`)
  }
  return { host, port }
}

/**
 * Operator, raw mode: pipe each HyperDHT stream byte for byte to a new TCP connection to the
 * upstream. There is no framing, so HTTP/1.1 runs end to end between the client's HTTP client
 * and the upstream: keep-alive, streamed bodies of any size, `Range` and WebSockets all work.
 *
 * Clients must use `connectRawTunnel`; a framed `connectTunnel` client can't talk to this
 * server, so it listens on its own key.
 */
export async function serveRawTunnel(options: ServeRawTunnelOptions): Promise<ServeRawTunnelResult> {
  const upstream = parseTcpUpstream(options.upstream)
  const allowlist = createAllowlist(options.allowlist)
  const keypair = resolveOperatorKeypair(options, DEFAULT_RAW_OPERATOR_KEY_FILE)
  const emit = safeEmitter(options.onEvent)
  const open = new Set<Duplex>()
  let connections = 0

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
    (stream) => {
      const verdict = allowlist.check(stream)
      if (!verdict.ok) {
        emit?.({
          name: 'stream.refused',
          remoteKey: encodePublicKeyZ32(stream.remotePublicKey),
          stage: 'connection',
          host: verdict.host,
        })
        stream.on('error', () => {})
        stream.destroy()
        return
      }
      const conn = `c${++connections}`
      emit?.({
        name: 'conn.open',
        conn,
        remoteKey: encodePublicKeyZ32(stream.remotePublicKey),
        host: verdict.host,
        by: verdict.by,
      })
      // allowHalfOpen, so an upstream that half-closes can still read what the client sends.
      const socket = net.connect({ host: upstream.host, port: upstream.port, allowHalfOpen: true })
      socket.setNoDelay(true)
      open.add(stream)
      open.add(socket)
      pipeRaw(stream, socket, {
        graceMs: options.closeGraceMs,
        onClose: (result) => {
          open.delete(stream)
          open.delete(socket)
          emit?.({
            name: 'conn.close',
            conn,
            bytesUp: result.tcpBytesWritten,
            bytesDown: result.tcpBytesRead,
            durationMs: result.durationMs,
            error: result.error,
          })
        },
      })
    },
  )

  await server.listen(keypair)

  return {
    key: keypair.z32,
    upstream: `${upstream.host}:${upstream.port}`,
    close: async () => {
      for (const side of open) side.destroy()
      await server.close()
      await dht.destroy()
    },
  }
}
