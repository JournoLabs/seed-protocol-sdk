import type { IncomingMessage, ServerResponse } from 'node:http'
import { createTunnelSession, type TunnelSession } from './session'
import { forwardFetchRequest, forwardNodeRequest } from './forward'
import type { CreateGatewayProxyOptions, GatewayProxy } from '../types'

function resolveProxyKey(options: CreateGatewayProxyOptions): string {
  const key =
    options.key?.trim() ||
    (typeof process !== 'undefined' ? process.env.SEED_GATEWAY_HYPER_KEY?.trim() : '') ||
    ''
  if (!key) {
    throw new Error(
      'createGatewayProxy requires options.key or SEED_GATEWAY_HYPER_KEY environment variable',
    )
  }
  return key
}

/**
 * App-server Hyper gateway proxy for hosted web apps (Path B).
 *
 * Mount on a Node route (Next.js Node runtime, Express, etc.). Keep the operator
 * Hyper key on the server only — browsers talk HTTP to `proxyBaseUrl`.
 *
 * Prefer Node.js over Bun for Holepunch natives.
 */
export function createGatewayProxy(options: CreateGatewayProxyOptions = {}): GatewayProxy {
  const mountPath = options.mountPath?.trim() || '/api/seed-gateway'
  const key = resolveProxyKey(options)

  let session: TunnelSession | null = null
  let starting: Promise<TunnelSession> | null = null

  const ensureSession = async (): Promise<TunnelSession> => {
    if (session) return session
    if (starting) return starting
    starting = createTunnelSession({ key, storePath: options.storePath }).then((s) => {
      session = s
      starting = null
      return s
    })
    try {
      return await starting
    } catch (err) {
      starting = null
      throw err
    }
  }

  const proxy: GatewayProxy = {
    mountPath,
    start: async () => {
      await ensureSession()
    },
    close: async () => {
      if (starting) {
        try {
          await starting
        } catch {
          /* ignore start failure during close */
        }
      }
      if (session) {
        await session.close()
        session = null
      }
    },
    handleNode: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        try {
          const s = await ensureSession()
          await forwardNodeRequest(s, req, res, mountPath)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
          }
          res.end(`Gateway Hyper tunnel error: ${message}`)
        }
      })()
    },
    handleFetch: async (request: Request): Promise<Response> => {
      try {
        const s = await ensureSession()
        return await forwardFetchRequest(s, request, mountPath)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(`Gateway Hyper tunnel error: ${message}`, {
          status: 502,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
    },
  }

  if (options.eager) {
    void proxy.start().catch(() => {
      /* first request will surface the error */
    })
  }

  return proxy
}
