import http from 'node:http'
import { URL } from 'node:url'
import { filterResponseHeaders } from './protocol'
import type { TunnelMeta } from '../types'

export async function proxyTunnelRequest(
  upstreamBase: string,
  meta: TunnelMeta,
  body: Buffer,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const base = upstreamBase.replace(/\/$/, '')
  const targetUrl = new URL(meta.path, `${base}/`)

  return new Promise((resolve, reject) => {
    const req = http.request(
      targetUrl,
      {
        method: meta.method,
        headers: meta.headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 502,
            headers: filterResponseHeaders(res.headers as Record<string, string | string[] | undefined>),
            body: Buffer.concat(chunks),
          })
        })
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    if (body.length > 0) {
      req.write(body)
    }
    req.end()
  })
}
