import type { Readable, Writable } from 'node:stream'
import type { TunnelMeta, TunnelResponseMeta } from '../types'

/** Maximum single frame payload (64 MiB). */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024

/** Largest single stream write. Secret-stream's limit is 16 MiB - 1. */
export const WRITE_CHUNK_BYTES = 1024 * 1024

type ByteWaiter = {
  length: number
  resolve: (buf: Buffer) => void
  reject: (err: Error) => void
}

/**
 * Per-stream byte buffer. HyperDHT duplexes do not reliably support `unshift`,
 * so we accumulate and slice locally instead of pushing leftovers back.
 *
 * Once the stream ends, errors or closes, every pending and later read that the
 * buffer cannot satisfy rejects. A destroyed stream emits `close` without `end`,
 * so listening for `end` alone would leave reads waiting forever.
 */
class StreamByteReader {
  private buffer = Buffer.alloc(0)
  private waiters: ByteWaiter[] = []
  private failure: Error | null = null

  constructor(stream: Readable) {
    stream.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.drain()
    })
    stream.on('error', (err: Error) => this.fail(err))
    stream.on('end', () => this.fail(new Error('Unexpected end of stream')))
    stream.on('close', () => this.fail(new Error('Stream closed')))
  }

  readExact(length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (length === 0) {
        resolve(Buffer.alloc(0))
        return
      }
      this.waiters.push({ length, resolve, reject })
      this.drain()
      this.rejectWaiters()
    })
  }

  private fail(err: Error): void {
    this.failure ??= err
    this.drain()
    this.rejectWaiters()
  }

  private rejectWaiters(): void {
    if (!this.failure || this.waiters.length === 0) return
    const waiters = this.waiters.splice(0)
    for (const w of waiters) {
      w.reject(
        new Error(
          `${this.failure.message} (expected ${w.length} bytes, got ${this.buffer.length})`,
        ),
      )
    }
  }

  private drain(): void {
    while (this.waiters.length > 0) {
      const next = this.waiters[0]
      if (!next || this.buffer.length < next.length) break
      this.waiters.shift()
      const out = this.buffer.subarray(0, next.length)
      this.buffer = this.buffer.subarray(next.length)
      next.resolve(out)
    }
  }
}

const readers = new WeakMap<Readable, StreamByteReader>()

function getReader(stream: Readable): StreamByteReader {
  let reader = readers.get(stream)
  if (!reader) {
    reader = new StreamByteReader(stream)
    readers.set(stream, reader)
  }
  return reader
}

function readExact(stream: Readable, length: number): Promise<Buffer> {
  return getReader(stream).readExact(length)
}

function writeBuffer(stream: Writable, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.destroyed) {
      reject(new Error('Stream closed'))
      return
    }
    // HyperDHT duplexes often never invoke write(callback). Use return value + drain.
    try {
      const ok = stream.write(buf)
      if (ok) {
        resolve()
        return
      }
      const cleanup = () => {
        stream.off('drain', onDrain)
        stream.off('error', onError)
        stream.off('close', onClose)
      }
      const onDrain = () => {
        cleanup()
        resolve()
      }
      const onError = (err: Error) => {
        cleanup()
        reject(err)
      }
      const onClose = () => {
        cleanup()
        reject(new Error('Stream closed'))
      }
      stream.once('drain', onDrain)
      stream.once('error', onError)
      stream.once('close', onClose)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

function assertFrameSize(length: number): void {
  if (length > MAX_FRAME_BYTES) {
    throw new Error(`Frame too large: ${length} bytes (max ${MAX_FRAME_BYTES})`)
  }
}

export async function writeFrame(stream: Writable, payload: Buffer): Promise<void> {
  assertFrameSize(payload.length)
  const header = Buffer.alloc(4)
  header.writeUInt32BE(payload.length, 0)
  // The header goes out with the first chunk. Secret-stream rejects any single write over
  // 16 MiB, so larger payloads are split, waiting for drain between chunks.
  const first = payload.subarray(0, WRITE_CHUNK_BYTES)
  await writeBuffer(stream, Buffer.concat([header, first]))
  for (let offset = first.length; offset < payload.length; offset += WRITE_CHUNK_BYTES) {
    await writeBuffer(stream, payload.subarray(offset, offset + WRITE_CHUNK_BYTES))
  }
}

export async function readFrame(stream: Readable): Promise<Buffer> {
  const header = await readExact(stream, 4)
  const length = header.readUInt32BE(0)
  if (length === 0) {
    return Buffer.alloc(0)
  }
  assertFrameSize(length)
  return readExact(stream, length)
}

export async function writeTunnelRequest(
  stream: Writable,
  meta: TunnelMeta,
  body: Buffer,
): Promise<void> {
  // Check the body before writing meta so an oversized body leaves the stream in sync.
  assertFrameSize(body.length)
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
  // Check the body before writing meta so an oversized body leaves the stream in sync.
  assertFrameSize(body.length)
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
