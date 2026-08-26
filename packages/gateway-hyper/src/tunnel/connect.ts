import http from 'node:http'
import type { Duplex } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import HyperDHT from 'hyperdht'
import {
  flattenRequestHeaders,
  readTunnelResponse,
  writeTunnelRequest,
} from './protocol'
import { createEphemeralClientKeypair, decodePublicKey } from '../keys'
import type { ConnectTunnelOptions, ConnectTunnelResult } from '../types'

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function createLocalServer(
  runOnTunnel: <T>(fn: (socket: Duplex) => Promise<T>) => Promise<T>,
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

        const { meta: responseMeta, body: responseBody } = await runOnTunnel(async (socket) => {
          await writeTunnelRequest(socket, meta, body)
          return readTunnelResponse(socket)
        })

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
  const remotePublicKey = decodePublicKey(options.key)
  const clientKey = createEphemeralClientKeypair()

  const dht = new HyperDHT()
  let activeSocket: Duplex | null = null
  let connecting: Promise<Duplex> | null = null

  const getSocket = async (): Promise<Duplex> => {
    if (activeSocket && !activeSocket.destroyed) {
      return activeSocket
    }
    if (connecting) {
      return connecting
    }
    connecting = new Promise<Duplex>((resolve, reject) => {
      const socket = dht.connect(remotePublicKey, {
        keyPair: { publicKey: clientKey.publicKey, secretKey: clientKey.secretKey },
      }) as Duplex
      const onReady = () => {
        activeSocket = socket
        connecting = null
        resolve(socket)
      }
      socket.once('open', onReady)
      socket.once('connect', onReady)
      socket.once('error', (err: Error) => {
        connecting = null
        reject(err)
      })
    })
    return connecting
  }

  /** Serialize tunnel transactions on one persistent socket. */
  let tunnelQueue: Promise<unknown> = Promise.resolve()
  const runOnTunnel = async <T>(fn: (socket: Duplex) => Promise<T>): Promise<T> => {
    const run = tunnelQueue.then(() => getSocket()).then(fn)
    tunnelQueue = run.catch(() => {})
    return run
  }

  const server = createLocalServer((handler) => runOnTunnel(handler))

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
      if (activeSocket && !activeSocket.destroyed) {
        activeSocket.destroy()
      }
      await dht.destroy()
    },
  }
}

export function localGatewayUrl(baseUrl: string, path = ''): string {
  const base = baseUrl.replace(/\/$/, '')
  if (!path) return base
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
}
