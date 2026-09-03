import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  flattenRequestHeaders,
} from './protocol'
import { createTunnelSession } from './session'
import type { ConnectTunnelOptions, ConnectTunnelResult } from '../types'

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function createLocalServer(
  forwardHttp: (
    meta: { method: string; path: string; headers: Record<string, string> },
    body: Buffer,
  ) => Promise<{ meta: { status: number; headers: Record<string, string> }; body: Buffer }>,
): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      try {
        const body = await readRequestBody(req)
        const path = req.url ?? '/'
        const meta = {
          method: req.method ?? 'GET',
          path,
          headers: flattenRequestHeaders(req.headers as Record<string, string | string[] | undefined>),
        }

        const { meta: responseMeta, body: responseBody } = await forwardHttp(meta, body)

        res.writeHead(responseMeta.status, responseMeta.headers)
        res.end(responseBody)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
        }
        res.end(`Gateway Hyper tunnel error: ${message}`)
      }
    })()
  })
}

/**
 * Client: dial operator key and expose a localhost HTTP server that forwards through the tunnel.
 */
export async function connectTunnel(options: ConnectTunnelOptions): Promise<ConnectTunnelResult> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 1984

  const session = await createTunnelSession({
    key: options.key,
    storePath: options.storePath,
  })

  const server = createLocalServer((meta, body) => session.forwardHttp(meta, body))

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
