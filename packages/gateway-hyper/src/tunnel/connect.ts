import http from 'node:http'
import { forwardNodeRequest } from './forward'
import { createTunnelSession } from './session'
import type { ConnectTunnelOptions, ConnectTunnelResult } from '../types'

/**
 * Client: dial operator key and expose a localhost HTTP server that forwards through the tunnel.
 */
export async function connectTunnel(options: ConnectTunnelOptions): Promise<ConnectTunnelResult> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 1984

  const session = await createTunnelSession({
    key: options.key,
    storePath: options.storePath,
    bootstrap: options.bootstrap,
    requestTimeoutMs: options.requestTimeoutMs,
    connectTimeoutMs: options.connectTimeoutMs,
    maxStreams: options.maxStreams,
  })

  const server = http.createServer((req, res) => {
    void forwardNodeRequest(session, req, res, '')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })

  const address = server.address()
  const boundPort =
    address && typeof address === 'object' ? address.port : port

  const baseUrl = `http://${host}:${boundPort}`

  return {
    key: options.key,
    host,
    port: boundPort,
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await session.close()
    },
  }
}

export function localGatewayUrl(baseUrl: string, path = ''): string {
  const base = baseUrl.replace(/\/$/, '')
  if (!path) return base
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
}
