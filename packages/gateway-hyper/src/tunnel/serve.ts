import type { Duplex } from 'node:stream'
import HyperDHT from 'hyperdht'
import { readTunnelRequest, writeTunnelResponse } from './protocol'
import { proxyTunnelRequest } from './proxy'
import { loadOrCreateOperatorKeypair } from '../keys'
import type { ServeTunnelOptions, ServeTunnelResult } from '../types'

function handleConnection(
  socket: Duplex,
  upstream: string,
): void {
  void (async () => {
    try {
      while (true) {
        const { meta, body } = await readTunnelRequest(socket)
        const result = await proxyTunnelRequest(upstream, meta, body)
        await writeTunnelResponse(
          socket,
          { status: result.status, headers: result.headers },
          result.body,
        )
      }
    } catch {
      socket.destroy()
    }
  })()
}

/**
 * Operator: accept Hyperswarm/DHT connections and proxy framed HTTP to upstream Traefik.
 */
export async function serveTunnel(options: ServeTunnelOptions): Promise<ServeTunnelResult> {
  const upstream = options.upstream.replace(/\/$/, '')
  const keyFile = options.keyFile ?? '.seed/gateway-tunnel/operator.key.json'
  const keypair = loadOrCreateOperatorKeypair(keyFile)

  const dht = new HyperDHT()
  const server = dht.createServer((socket) => {
    handleConnection(socket as Duplex, upstream)
  })

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
