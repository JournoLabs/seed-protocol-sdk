import { describe, expect, it } from 'vitest'
import { duplexPair } from 'node:stream'
import {
  readFrame,
  readTunnelRequest,
  readTunnelResponse,
  writeFrame,
  writeTunnelRequest,
  writeTunnelResponse,
} from '../src/tunnel/protocol'

describe('gateway-hyper protocol', () => {
  it('round-trips length-prefixed frames', async () => {
    const [writer, reader] = duplexPair()
    const payload = Buffer.from('hello frame')
    const readPromise = readFrame(reader)
    await writeFrame(writer, payload)
    const read = await readPromise
    expect(read.toString()).toBe('hello frame')
  })

  it('round-trips tunnel request meta + body', async () => {
    const [writer, reader] = duplexPair()
    const meta = {
      method: 'GET',
      path: '/raw/abc',
      headers: { accept: 'application/json' },
    }
    const body = Buffer.from('payload')
    const readPromise = readTunnelRequest(reader)
    await writeTunnelRequest(writer, meta, body)
    const parsed = await readPromise
    expect(parsed.meta).toEqual(meta)
    expect(parsed.body.toString()).toBe('payload')
  })

  it('round-trips tunnel response meta + body', async () => {
    const [writer, reader] = duplexPair()
    const meta = { status: 200, headers: { 'content-type': 'text/plain' } }
    const body = Buffer.from('ok')
    const readPromise = readTunnelResponse(reader)
    await writeTunnelResponse(writer, meta, body)
    const parsed = await readPromise
    expect(parsed.meta).toEqual(meta)
    expect(parsed.body.toString()).toBe('ok')
  })

  it("says the other side runs in raw mode when it sends plain HTTP instead of a frame", async () => {
    const [writer, reader] = duplexPair()
    const readPromise = readTunnelResponse(reader)
    writer.write(Buffer.from('HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n'))
    await expect(readPromise).rejects.toThrow(/plain HTTP.*raw mode/)
  })

})
