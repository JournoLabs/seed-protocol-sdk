import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { duplexPair } from 'node:stream'
import HyperDHT from 'hyperdht'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { formatTunnelEvent } from '../src/cli'
import { encodePublicKeyZ32 } from '../src/keys'
import type { TunnelEvent } from '../src/tunnel/events'
import { serveTunnel, serveTunnelConnection } from '../src/tunnel/serve'
import { createTunnelSession, type TunnelSession } from '../src/tunnel/session'
import type { ServeTunnelOptions } from '../src/types'
import { startTestnet, type LocalTestnet } from './helpers/testnet'

const REQUEST_ID_HEADER = 'x-seed-tunnel-request-id'

describe('serveTunnel events', () => {
  let testnet: LocalTestnet
  let upstream: http.Server
  let upstreamUrl: string
  const seenIds: (string | undefined)[] = []

  beforeAll(async () => {
    testnet = await startTestnet()
    upstream = http.createServer((req, res) => {
      seenIds.push(req.headers[REQUEST_ID_HEADER] as string | undefined)
      if (req.url === '/hang') return
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('hello')
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
    const addr = upstream.address()
    if (!addr || typeof addr === 'string') throw new Error('upstream address unavailable')
    upstreamUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(async () => {
    upstream.closeAllConnections()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
    await testnet.destroy()
  })

  async function startStack(
    serveOpts: Partial<ServeTunnelOptions>,
    keyPair = HyperDHT.keyPair(),
  ): Promise<{ events: TunnelEvent[]; session: TunnelSession; close: () => Promise<void> }> {
    const events: TunnelEvent[] = []
    const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-hyper-ev-')), 'op.json')
    const operator = await serveTunnel({
      upstream: upstreamUrl,
      keyFile,
      bootstrap: testnet.bootstrap,
      onEvent: (event) => events.push(event),
      ...serveOpts,
    })
    const session = await createTunnelSession({
      key: operator.key,
      keyPair,
      bootstrap: testnet.bootstrap,
      connectTimeoutMs: 5000,
      requestTimeoutMs: 10_000,
    })
    return {
      events,
      session,
      close: async () => {
        await session.close()
        await operator.close()
      },
    }
  }

  const get = (session: TunnelSession, urlPath: string, headers: Record<string, string> = {}) =>
    session.forwardHttp({ method: 'GET', path: urlPath, headers }, Buffer.alloc(0))

  it('reports a request from receipt to response, then the stream closing', async () => {
    const client = HyperDHT.keyPair()
    const stack = await startStack({}, client)
    try {
      const res = await get(stack.session, '/info')
      expect(res.meta.status).toBe(200)
    } finally {
      await stack.close()
    }
    await vi.waitFor(() => expect(stack.events.map((e) => e.name)).toContain('stream.close'))
    // Closing the session destroys its stream, which the operator may also see as an error.
    const events = stack.events.filter((e) => e.name !== 'stream.error')
    expect(events.map((e) => e.name)).toEqual([
      'stream.open',
      'req.recv',
      'up.response',
      'up.done',
      'res.sent',
      'stream.close',
    ])
    const [open, recv, response, done, sent, close] = events
    expect(open).toMatchObject({ remoteKey: encodePublicKeyZ32(client.publicKey), by: 'open' })
    const request = (recv as Extract<TunnelEvent, { name: 'req.recv' }>).request
    expect(recv).toMatchObject({ stream: 's1', method: 'GET', path: '/info', bodyBytes: 0 })
    expect(response).toMatchObject({ request, status: 200 })
    expect(done).toMatchObject({ request, status: 200, bytes: 5 })
    expect(sent).toMatchObject({ request, status: 200, bytes: 5 })
    expect(close).toMatchObject({ stream: 's1', requests: 1, inflight: null })
    expect((close as Extract<TunnelEvent, { name: 'stream.close' }>).bytesIn).toBeGreaterThan(0)
  }, 30_000)

  it('reports an upstream failure with its phase and the 502 sent', async () => {
    const closedPort = await new Promise<number>((resolve) => {
      const probe = net.createServer().listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as net.AddressInfo
        probe.close(() => resolve(port))
      })
    })
    const stack = await startStack({ upstream: `http://127.0.0.1:${closedPort}` })
    try {
      expect((await get(stack.session, '/info')).meta.status).toBe(502)
    } finally {
      await stack.close()
    }
    const error = stack.events.find((e) => e.name === 'up.error')
    expect(error).toMatchObject({ phase: 'send', code: 'ECONNREFUSED', aborted: false })
    expect(stack.events.find((e) => e.name === 'res.sent')).toMatchObject({ status: 502 })
  }, 30_000)

  it('reports an upstream timeout while waiting, and the 504 sent', async () => {
    const stack = await startStack({ upstreamTimeoutMs: 300 })
    try {
      expect((await get(stack.session, '/hang')).meta.status).toBe(504)
    } finally {
      await stack.close()
    }
    expect(stack.events.find((e) => e.name === 'up.timeout')).toMatchObject({
      phase: 'wait',
      timeoutMs: 300,
    })
    expect(stack.events.some((e) => e.name === 'up.error')).toBe(false)
    expect(stack.events.find((e) => e.name === 'res.sent')).toMatchObject({ status: 504 })
  }, 30_000)

  it('reports refusals at the handshake and on the connection', async () => {
    const listed = HyperDHT.keyPair()
    const client = HyperDHT.keyPair()
    const keysOnly = await startStack({ allowlist: { keys: [listed.publicKey.toString('hex')] } }, client)
    await expect(get(keysOnly.session, '/info')).rejects.toThrow()
    await keysOnly.close()
    expect(keysOnly.events.find((e) => e.name === 'stream.refused')).toEqual({
      name: 'stream.refused',
      remoteKey: encodePublicKeyZ32(client.publicKey),
      stage: 'handshake',
      host: null,
    })

    const withIps = await startStack({ allowlist: { ips: ['198.51.100.0/24'] } }, client)
    await expect(get(withIps.session, '/info')).rejects.toThrow()
    await withIps.close()
    const refused = withIps.events.find((e) => e.name === 'stream.refused')
    expect(refused).toMatchObject({ stage: 'connection', remoteKey: encodePublicKeyZ32(client.publicKey) })
    expect((refused as Extract<TunnelEvent, { name: 'stream.refused' }>).host).toBeTruthy()
    expect(withIps.events.some((e) => e.name === 'stream.open')).toBe(false)
  }, 30_000)

  it('sends the request id upstream, replacing one the client sent', async () => {
    const stack = await startStack({ requestIdHeader: REQUEST_ID_HEADER })
    seenIds.length = 0
    try {
      await get(stack.session, '/a')
      await get(stack.session, '/b', { [REQUEST_ID_HEADER.toUpperCase()]: 'forged' })
    } finally {
      await stack.close()
    }
    const recvIds = stack.events.flatMap((e) => (e.name === 'req.recv' ? [e.request] : []))
    expect(recvIds).toHaveLength(2)
    expect(seenIds).toEqual(recvIds)
    expect(new Set(recvIds).size).toBe(2)
  }, 30_000)

  it('keeps serving when the listener throws', async () => {
    const stack = await startStack({
      onEvent: () => {
        throw new Error('listener broke')
      },
    })
    try {
      expect((await get(stack.session, '/info')).meta.status).toBe(200)
      expect((await get(stack.session, '/info')).meta.status).toBe(200)
    } finally {
      await stack.close()
    }
  }, 30_000)
})

describe('serveTunnelConnection without onEvent', () => {
  it('adds no listeners beyond the frame reader and its close handlers', () => {
    const count = (opts: Parameters<typeof serveTunnelConnection>[2]) => {
      const [client, operator] = duplexPair()
      void serveTunnelConnection(operator, 'http://127.0.0.1:9', opts)
      const n = { data: operator.listenerCount('data'), close: operator.listenerCount('close') }
      client.destroy()
      operator.destroy()
      return n
    }
    const plain = count({})
    expect(count({ requestIdHeader: REQUEST_ID_HEADER })).toEqual(plain)
    expect(count({ onEvent: () => {} }).data).toBe(plain.data + 1)
  })
})

describe('formatTunnelEvent', () => {
  it('writes one key=value line, quoting values with spaces and skipping nulls', () => {
    const line = formatTunnelEvent(
      { name: 'up.error', request: 'x-r1', phase: 'send', error: 'connect ECONNREFUSED 1.2.3.4:80', aborted: false },
      new Date('2026-10-23T00:00:00.000Z'),
    )
    expect(line).toBe(
      '2026-10-23T00:00:00.000Z tunnel-trace up.error request=x-r1 phase=send error="connect ECONNREFUSED 1.2.3.4:80" aborted=false',
    )
    expect(
      formatTunnelEvent({ name: 'stream.refused', remoteKey: 'k', stage: 'handshake', host: null }),
    ).not.toContain('host=')
  })
})
