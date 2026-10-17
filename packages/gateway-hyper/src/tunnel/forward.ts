import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  filterResponseHeaders,
  flattenRequestHeaders,
} from './protocol'
import { stripMountPath } from './mountPath'
import { TunnelTimeoutError } from './errors'
import type { TunnelSession } from './session'
import type { TunnelMeta, TunnelResponseMeta } from '../types'

async function readNodeBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** 504 when the tunnel timed out, 502 for any other tunnel failure. */
function tunnelErrorStatus(err: unknown): number {
  return err instanceof TunnelTimeoutError ? 504 : 502
}

function tunnelErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return `Gateway Hyper tunnel error: ${message}`
}

export async function forwardNodeRequest(
  session: TunnelSession,
  req: IncomingMessage,
  res: ServerResponse,
  mountPath: string,
): Promise<void> {
  // The caller hanging up abandons the request instead of leaving it on the tunnel.
  const controller = new AbortController()
  const onClose = () => {
    if (!res.writableEnded) controller.abort()
  }
  res.once('close', onClose)
  try {
    const body = await readNodeBody(req)
    const path = stripMountPath(req.url ?? '/', mountPath)
    const meta: TunnelMeta = {
      method: req.method ?? 'GET',
      path,
      headers: flattenRequestHeaders(req.headers as Record<string, string | string[] | undefined>),
    }
    const { meta: responseMeta, body: responseBody } = await session.forwardHttp(meta, body, {
      signal: controller.signal,
    })
    writeNodeResponse(res, responseMeta, responseBody)
  } catch (err) {
    if (controller.signal.aborted) return
    if (!res.headersSent) {
      res.writeHead(tunnelErrorStatus(err), { 'Content-Type': 'text/plain; charset=utf-8' })
    }
    res.end(tunnelErrorMessage(err))
  } finally {
    res.off('close', onClose)
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
    const { meta: responseMeta, body: responseBody } = await session.forwardHttp(meta, bodyBuf, {
      signal: request.signal,
    })
    return new Response(responseBody, {
      status: responseMeta.status,
      headers: filterResponseHeaders(responseMeta.headers),
    })
  } catch (err) {
    return new Response(tunnelErrorMessage(err), {
      status: tunnelErrorStatus(err),
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}
