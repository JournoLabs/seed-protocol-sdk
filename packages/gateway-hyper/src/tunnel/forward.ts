import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  filterResponseHeaders,
  flattenRequestHeaders,
} from './protocol'
import { stripMountPath } from './mountPath'
import type { TunnelSession } from './session'
import type { TunnelMeta, TunnelResponseMeta } from '../types'

async function readNodeBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function forwardNodeRequest(
  session: TunnelSession,
  req: IncomingMessage,
  res: ServerResponse,
  mountPath: string,
): Promise<void> {
  try {
    const body = await readNodeBody(req)
    const path = stripMountPath(req.url ?? '/', mountPath)
    const meta: TunnelMeta = {
      method: req.method ?? 'GET',
      path,
      headers: flattenRequestHeaders(req.headers as Record<string, string | string[] | undefined>),
    }
    const { meta: responseMeta, body: responseBody } = await session.forwardHttp(meta, body)
    writeNodeResponse(res, responseMeta, responseBody)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    }
    res.end(`Gateway Hyper tunnel error: ${message}`)
  }
}

function writeNodeResponse(
  res: ServerResponse,
  meta: TunnelResponseMeta,
  body: Buffer,
): void {
  res.writeHead(meta.status, filterResponseHeaders(meta.headers))
  res.end(body)
}

export async function forwardFetchRequest(
  session: TunnelSession,
  request: Request,
  mountPath: string,
): Promise<Response> {
  try {
    const url = new URL(request.url)
    const path = stripMountPath(`${url.pathname}${url.search}`, mountPath)
    const bodyBuf = Buffer.from(await request.arrayBuffer())
    const headerRecord: Record<string, string> = {}
    request.headers.forEach((value, key) => {
      headerRecord[key] = value
    })
    const meta: TunnelMeta = {
      method: request.method || 'GET',
      path,
      headers: flattenRequestHeaders(headerRecord),
    }
    const { meta: responseMeta, body: responseBody } = await session.forwardHttp(meta, bodyBuf)
    return new Response(responseBody, {
      status: responseMeta.status,
      headers: filterResponseHeaders(responseMeta.headers),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(`Gateway Hyper tunnel error: ${message}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}
