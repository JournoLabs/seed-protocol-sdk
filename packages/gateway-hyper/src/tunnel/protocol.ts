import type { Readable, Writable } from 'node:stream'
import type { TunnelMeta, TunnelResponseMeta } from '../types'

/** Maximum single frame payload (64 MiB). */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024

function readExact(stream: Readable, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0

    const onData = (chunk: Buffer) => {
      chunks.push(chunk)
      total += chunk.length
      if (total >= length) {
        cleanup()
        const buf = Buffer.concat(chunks)
        resolve(buf.subarray(0, length))
        const extra = buf.subarray(length)
        if (extra.length > 0) {
          stream.unshift(extra)
        }
      }
    }

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    const onEnd = () => {
      cleanup()
      reject(new Error(`Unexpected end of stream (expected ${length} bytes, got ${total})`))
    }

    const cleanup = () => {
      stream.off('data', onData)
      stream.off('error', onError)
      stream.off('end', onEnd)
    }

    stream.on('data', onData)
    stream.on('error', onError)
    stream.on('end', onEnd)
  })
}

function writeBuffer(stream: Writable, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(buf, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

export async function writeFrame(stream: Writable, payload: Buffer): Promise<void> {
  if (payload.length > MAX_FRAME_BYTES) {
    throw new Error(`Frame too large: ${payload.length} bytes (max ${MAX_FRAME_BYTES})`)
  }
  const header = Buffer.alloc(4)
  header.writeUInt32BE(payload.length, 0)
  await writeBuffer(stream, header)
  if (payload.length > 0) {
    await writeBuffer(stream, payload)
  }
}

export async function readFrame(stream: Readable): Promise<Buffer> {
  const header = await readExact(stream, 4)
  const length = header.readUInt32BE(0)
  if (length === 0) {
    return Buffer.alloc(0)
  }
  if (length > MAX_FRAME_BYTES) {
    throw new Error(`Frame too large: ${length} bytes (max ${MAX_FRAME_BYTES})`)
  }
  return readExact(stream, length)
}

export async function writeTunnelRequest(
  stream: Writable,
  meta: TunnelMeta,
  body: Buffer,
): Promise<void> {
  const metaFrame = Buffer.from(JSON.stringify(meta), 'utf8')
  await writeFrame(stream, metaFrame)
  await writeFrame(stream, body)
}

export async function readTunnelRequest(
  stream: Readable,
): Promise<{ meta: TunnelMeta; body: Buffer }> {
  const metaBuf = await readFrame(stream)
  const meta = JSON.parse(metaBuf.toString('utf8')) as TunnelMeta
  if (!meta.method || !meta.path) {
    throw new Error('Invalid tunnel request meta: missing method or path')
  }
  meta.headers = meta.headers ?? {}
  const body = await readFrame(stream)
  return { meta, body }
}

export async function writeTunnelResponse(
  stream: Writable,
  meta: TunnelResponseMeta,
  body: Buffer,
): Promise<void> {
  const metaFrame = Buffer.from(JSON.stringify(meta), 'utf8')
  await writeFrame(stream, metaFrame)
  await writeFrame(stream, body)
}

export async function readTunnelResponse(
  stream: Readable,
): Promise<{ meta: TunnelResponseMeta; body: Buffer }> {
  const metaBuf = await readFrame(stream)
  const meta = JSON.parse(metaBuf.toString('utf8')) as TunnelResponseMeta
  if (typeof meta.status !== 'number') {
    throw new Error('Invalid tunnel response meta: missing status')
  }
  meta.headers = meta.headers ?? {}
  const body = await readFrame(stream)
  return { meta, body }
}

/** Normalize header values to strings for tunnel transport. */
export function flattenRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue
    out[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}

/** Pick response headers safe to forward to the local HTTP client. */
export function filterResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const skip = new Set([
    'connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
  ])
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (skip.has(key.toLowerCase())) continue
    if (value == null) continue
    out[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return out
}
