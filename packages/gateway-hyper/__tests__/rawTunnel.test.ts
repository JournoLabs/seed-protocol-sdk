import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import HyperDHT from 'hyperdht'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MAX_FRAME_BYTES } from '../src/tunnel/protocol'
import type { RawClientEvent, RawTunnelEvent } from '../src/tunnel/events'
import { connectRawTunnel } from '../src/tunnel/rawConnect'
import { parseTcpUpstream, serveRawTunnel } from '../src/tunnel/rawServe'
import type { ConnectRawTunnelOptions, ServeRawTunnelOptions } from '../src/types'
import { startTestnet, type LocalTestnet } from './helpers/testnet'

const LARGE = MAX_FRAME_BYTES + 6 * 1024 * 1024 // 70 MiB, above the framed tunnel's cap
const CHUNK = Buffer.alloc(1024 * 1024, 7)

describe('parseTcpUpstream', () => {
  it.each([
    ['http://127.0.0.1:1980', { host: '127.0.0.1', port: 1980 }],
    ['http://traefik', { host: 'traefik', port: 80 }],
    ['https://example.com', { host: 'example.com', port: 443 }],
    ['10.0.0.2:8080', { host: '10.0.0.2', port: 8080 }],
    ['http://[::1]:81', { host: '::1', port: 81 }],
  ])('%s', (input, expected) => {
    expect(parseTcpUpstream(input)).toEqual(expected)
  })

  it('needs a port for schemes other than http and https', () => {
    expect(() => parseTcpUpstream('tcp://example.com')).toThrow(/Invalid raw upstream/)
  })
})

describe('raw tunnel over HyperDHT', () => {
  let testnet: LocalTestnet
  let upstream: http.Server
  let upstreamUrl: string
  let upstreamRequests = 0

  beforeAll(async () => {
    testnet = await startTestnet()
    upstream = http.createServer((req, res) => {
      upstreamRequests++
      const url = new URL(req.url ?? '/', 'http://x')
      if (req.method === 'POST' && url.pathname === '/count') {
        let n = 0
        req.on('data', (chunk: Buffer) => {
          n += chunk.length
        })
        req.on('end', () => res.end(String(n)))
        return
      }
      if (url.pathname === '/big') {
        const total = Number(url.searchParams.get('n'))
        res.writeHead(200, { 'content-length': String(total) })
        let sent = 0
        const write = () => {
          while (sent < total) {
            const piece = CHUNK.subarray(0, Math.min(CHUNK.length, total - sent))
            sent += piece.length
            if (!res.write(piece)) return void res.once('drain', write)
          }
          res.end()
        }
        write()
        return
      }
      res.end('ok')
    })
    // Node's server otherwise ends its socket when the client half-closes, cutting off a
    // response still being written, with or without a tunnel in between.
    ;(upstream as http.Server & { httpAllowHalfOpen: boolean }).httpAllowHalfOpen = true
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
    serveOpts: Partial<ServeRawTunnelOptions> = {},
    connectOpts: Partial<ConnectRawTunnelOptions> = {},
  ) {
    const operatorEvents: RawTunnelEvent[] = []
    const clientEvents: RawClientEvent[] = []
    const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-hyper-raw-')), 'op.json')
    const operator = await serveRawTunnel({
      upstream: upstreamUrl,
      keyFile,
      bootstrap: testnet.bootstrap,
      onEvent: (event) => operatorEvents.push(event),
      ...serveOpts,
    })
    const client = await connectRawTunnel({
      key: operator.key,
      port: 0,
      bootstrap: testnet.bootstrap,
      connectTimeoutMs: 5000,
      onEvent: (event) => clientEvents.push(event),
      ...connectOpts,
    })
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    return {
      operatorEvents,
      clientEvents,
      client,
      agent,
      close: async () => {
        agent.destroy()
        await client.close()
        await operator.close()
      },
    }
  }

  type Stack = Awaited<ReturnType<typeof startStack>>

  function request(
    stack: Stack,
    method: string,
    urlPath: string,
    writeBody?: (req: http.ClientRequest) => void,
  ): Promise<{ status: number; body: Buffer; reused: boolean }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: stack.client.host, port: stack.client.port, method, path: urlPath, agent: stack.agent },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), reused: req.reusedSocket }),
          )
          res.on('error', reject)
        },
      )
      req.on('error', reject)
      if (writeBody) writeBody(req)
      else req.end()
    })
  }

  /** Write `total` bytes of body in 1 MiB chunks, waiting for drain. */
  function streamBody(total: number) {
    return (req: http.ClientRequest) => {
      let sent = 0
      const write = () => {
        while (sent < total) {
          const piece = CHUNK.subarray(0, Math.min(CHUNK.length, total - sent))
          sent += piece.length
          if (!req.write(piece)) return void req.once('drain', write)
        }
        req.end()
      }
      write()
    }
  }

  it('streams a request body and a response larger than the framed limit', async () => {
    const stack = await startStack()
    try {
      const upload = await request(stack, 'POST', '/count', streamBody(LARGE))
      expect(upload.status).toBe(200)
      expect(Number(upload.body.toString())).toBe(LARGE)
      const download = await request(stack, 'GET', `/big?n=${LARGE}`)
      expect(download.status).toBe(200)
      expect(download.body.length).toBe(LARGE)
    } finally {
      await stack.close()
    }
  }, 120_000)

  it('carries two requests over one kept-alive connection and one HyperDHT stream', async () => {
    const stack = await startStack()
    try {
      const first = await request(stack, 'GET', '/')
      const second = await request(stack, 'GET', '/')
      expect([first.status, second.status]).toEqual([200, 200])
      expect(second.reused).toBe(true)
      expect(stack.operatorEvents.filter((e) => e.name === 'conn.open')).toHaveLength(1)
      expect(stack.clientEvents.filter((e) => e.name === 'conn.open')).toHaveLength(1)
    } finally {
      await stack.close()
    }
  }, 30_000)

  /** Send a raw HTTP/1.1 request on a new TCP connection and read until the tunnel closes it. */
  function rawExchange(stack: Stack, request: string, after: 'half-close' | 'close-after-response') {
    return new Promise<Buffer>((resolve, reject) => {
      const socket = net.connect(stack.client.port, stack.client.host)
      const chunks: Buffer[] = []
      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        if (after === 'close-after-response' && Buffer.concat(chunks).includes('\r\n\r\nok')) socket.end()
      })
      socket.on('error', reject)
      socket.on('close', () => resolve(Buffer.concat(chunks)))
      socket.write(request)
      if (after === 'half-close') socket.end()
    })
  }

  it('delivers the whole response when the client half-closes right after its request', async () => {
    const stack = await startStack()
    const size = 5 * 1024 * 1024
    try {
      const reply = await rawExchange(
        stack,
        `GET /big?n=${size} HTTP/1.1\r\nHost: tunnel\r\n\r\n`,
        'half-close',
      )
      const headerEnd = reply.indexOf('\r\n\r\n')
      expect(reply.subarray(0, headerEnd).toString()).toMatch(/^HTTP\/1\.1 200/)
      expect(reply.length - headerEnd - 4).toBe(size)
      await vi.waitFor(() => expect(stack.operatorEvents.some((e) => e.name === 'conn.close')).toBe(true))
      expect(stack.operatorEvents.find((e) => e.name === 'conn.close')).toMatchObject({ error: null })
    } finally {
      await stack.close()
    }
  }, 60_000)

  it('closes without a reset on the operator when the client closes first', async () => {
    const stack = await startStack()
    try {
      const reply = await rawExchange(
        stack,
        'GET / HTTP/1.1\r\nHost: tunnel\r\nConnection: keep-alive\r\n\r\n',
        'close-after-response',
      )
      expect(reply.toString()).toMatch(/^HTTP\/1\.1 200[\s\S]*\r\n\r\nok$/)
      await vi.waitFor(() => expect(stack.operatorEvents.some((e) => e.name === 'conn.close')).toBe(true))
      await vi.waitFor(() => expect(stack.clientEvents.some((e) => e.name === 'conn.close')).toBe(true))
      expect(stack.operatorEvents.find((e) => e.name === 'conn.close')).toMatchObject({ error: null })
      expect(stack.clientEvents.find((e) => e.name === 'conn.close')).toMatchObject({ error: null })
    } finally {
      await stack.close()
    }
  }, 30_000)

  it('gives up on a stream that does not open within connectTimeoutMs', async () => {
    // An operator whose handshake never finishes: the firewall never answers.
    const dht = new HyperDHT({ bootstrap: testnet.bootstrap })
    const kp = HyperDHT.keyPair()
    await dht.createServer({ firewall: () => new Promise<boolean>(() => {}) }).listen(kp)
    const events: RawClientEvent[] = []
    const client = await connectRawTunnel({
      key: kp.publicKey.toString('hex'),
      port: 0,
      bootstrap: testnet.bootstrap,
      connectTimeoutMs: 500,
      onEvent: (event) => events.push(event),
    })
    try {
      const started = performance.now()
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect(client.port, client.host)
        socket.on('error', () => {})
        socket.on('close', () => resolve())
        setTimeout(() => reject(new Error('socket stayed open')), 10_000).unref()
      })
      expect(performance.now() - started).toBeGreaterThanOrEqual(450)
      await vi.waitFor(() => expect(events.some((e) => e.name === 'conn.close')).toBe(true))
      expect(events.find((e) => e.name === 'conn.close')).toMatchObject({ error: 'connect-timeout' })
      expect(events.some((e) => e.name === 'conn.open')).toBe(false)
    } finally {
      await client.close()
      await dht.destroy()
    }
  }, 30_000)

  it('refuses a client the allowlist does not cover', async () => {
    const stack = await startStack({ allowlist: { keys: [HyperDHT.keyPair().publicKey.toString('hex')] } })
    const before = upstreamRequests
    try {
      await expect(request(stack, 'GET', '/')).rejects.toThrow()
      expect(upstreamRequests).toBe(before)
      expect(stack.operatorEvents.some((e) => e.name === 'stream.refused')).toBe(true)
      expect(stack.operatorEvents.some((e) => e.name === 'conn.open')).toBe(false)
    } finally {
      await stack.close()
    }
  }, 30_000)

  it('closes connections beyond maxConnections at once', async () => {
    const stack = await startStack({}, { maxConnections: 1 })
    const first = net.connect(stack.client.port, stack.client.host)
    first.on('error', () => {})
    try {
      await new Promise<void>((resolve) => first.once('connect', () => resolve()))
      await vi.waitFor(() => expect(stack.clientEvents.some((e) => e.name === 'conn.open')).toBe(true))
      await new Promise<void>((resolve) => {
        const second = net.connect(stack.client.port, stack.client.host)
        second.on('error', () => {})
        second.on('close', () => resolve())
      })
      expect(stack.clientEvents.find((e) => e.name === 'conn.refused')).toEqual({
        name: 'conn.refused',
        open: 1,
        max: 1,
      })
    } finally {
      first.destroy()
      await stack.close()
    }
  }, 30_000)
})
