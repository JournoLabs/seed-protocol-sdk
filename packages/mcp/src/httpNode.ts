import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createSeedMcpHttpHandler, type SeedMcpHttpOptions } from './http.js'

export interface SeedMcpHttpServerOptions extends SeedMcpHttpOptions {
  /** The path MCP is served at. Every other path gets 404. Default `/mcp`. */
  path?: string
  /**
   * Take the client address for the rate limit from the last `X-Forwarded-For` entry, the one the
   * proxy in front of this server added, instead of the socket. Set it only behind such a proxy.
   */
  trustProxy?: boolean
}

const MAX_BODY_BYTES = 1_000_000

class BodyTooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge()
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function clientAddress(req: IncomingMessage, trustProxy: boolean): string | undefined {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for']
    const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').map((a) => a.trim()).filter(Boolean).pop()
    if (last) return last
  }
  return req.socket.remoteAddress
}

/** A `node:http` server running {@link createSeedMcpHttpHandler} at `options.path`. Not listening yet. */
export function createSeedMcpHttpServer(options: SeedMcpHttpServerOptions = {}): Server {
  const { path = '/mcp', trustProxy = false, ...handlerOptions } = options
  const handle = createSeedMcpHttpHandler(handlerOptions)

  const respond = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== path) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`Not found. The MCP endpoint is ${path}.`)
      return
    }
    let body: Buffer | undefined
    if (req.method === 'POST') {
      try {
        body = await readBody(req)
      } catch (error) {
        if (!(error instanceof BodyTooLarge)) throw error
        res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }).end('Request body too large.')
        return
      }
    }
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v)
    }
    const request = new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), {
      method: req.method,
      headers,
      body: body && body.length > 0 ? new Uint8Array(body) : undefined,
    })
    const response = await handle(request, { clientAddress: clientAddress(req, trustProxy) })
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  }

  return createServer((req, res) => {
    respond(req, res).catch((error: unknown) => {
      console.error('seed-mcp:', error)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Internal error.')
    })
  })
}
