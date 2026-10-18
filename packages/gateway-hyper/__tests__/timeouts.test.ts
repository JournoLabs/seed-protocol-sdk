import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { duplexPair, type Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { TunnelTimeoutError, UpstreamTimeoutError } from '../src/tunnel/errors'
import { forwardFetchRequest, forwardNodeRequest } from '../src/tunnel/forward'
import {
  MAX_FRAME_BYTES,
  readFrame,
  readTunnelRequest,
  readTunnelResponse,
  WRITE_CHUNK_BYTES,
  writeFrame,
  writeTunnelRequest,
  writeTunnelResponse,
} from '../src/tunnel/protocol'
import { proxyTunnelRequest, upstreamRequestHeaders } from '../src/tunnel/proxy'
import { serveTunnelConnection } from '../src/tunnel/serve'
import { createTunnelPool, createTunnelQueue, type TunnelSession } from '../src/tunnel/session'
import type { TunnelMeta } from '../src/types'

const GET_INFO: TunnelMeta = { method: 'GET', path: '/info', headers: {} }

/** Hands out a fresh in-memory stream pair whenever the previous client side is destroyed. */
function pairFactory() {
  const operatorSides: Duplex[] = []
  let current: Duplex | null = null
  const getSocket = async () => {
    if (current && !current.destroyed) return current
    const [client, operator] = duplexPair()
    current = client
    operatorSides.push(operator)
    return client
  }
  return { getSocket, operatorSides }
}

function sessionFrom(runOnTunnel: TunnelSession['runOnTunnel']): TunnelSession {
  return {
    key: 'test',
    runOnTunnel,
    forwardHttp: (meta, body, opts) =>
      runOnTunnel(async (socket) => {
        await writeTunnelRequest(socket, meta, body)
        return readTunnelResponse(socket)
      }, opts),
    close: async () => {},
  }
}

/** Reply `status` to every request read from `operator`. */
async function answerAll(operator: Duplex, status = 200): Promise<void> {
  try {
    while (true) {
      const req = await readTunnelRequest(operator)
      await writeTunnelResponse(operator, { status, headers: {} }, Buffer.from(req.meta.path))
    }
  } catch {
    /* stream closed */
  }
}

const servers: http.Server[] = []

async function startUpstream(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

describe('frame reader', () => {
  it('rejects a pending read when the stream is destroyed without ending', async () => {
    const [, reader] = duplexPair()
    const read = readFrame(reader)
    reader.destroy()
    await expect(read).rejects.toThrow(/Stream closed/)
  })
})

describe('frame writes', () => {
  it('splits payloads larger than secret-stream allows in one write', async () => {
    const [writer, reader] = duplexPair()
    const sizes: number[] = []
    const write = writer.write.bind(writer)
    writer.write = ((chunk: Buffer, ...rest: never[]) => {
      sizes.push(chunk.length)
      return write(chunk, ...rest)
    }) as typeof writer.write

    const payload = Buffer.alloc(20 * 1024 * 1024)
    for (let i = 0; i < payload.length; i += 4096) payload[i] = i % 251
    const read = readFrame(reader)
    await writeFrame(writer, payload)
    expect((await read).equals(payload)).toBe(true)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(WRITE_CHUNK_BYTES + 4)
    expect(sizes.length).toBe(20)
  })

  it('rejects an oversized body before writing its meta frame', async () => {
    const [writer] = duplexPair()
    let writes = 0
    writer.write = (() => {
      writes++
      return true
    }) as typeof writer.write
    // Only the length is checked, so a fake buffer avoids allocating 64 MiB.
    const body = { length: MAX_FRAME_BYTES + 1 } as Buffer
    await expect(writeTunnelRequest(writer, GET_INFO, body)).rejects.toThrow(/Frame too large/)
    expect(writes).toBe(0)
  })
})

describe('createTunnelQueue', () => {
  it('times out an unanswered request, destroys the stream, and reconnects for the next', async () => {
    const { getSocket, operatorSides } = pairFactory()
    const session = sessionFrom(createTunnelQueue(getSocket, 100))

    const stuck = session.forwardHttp(GET_INFO, Buffer.alloc(0))
    await expect(stuck).rejects.toBeInstanceOf(TunnelTimeoutError)
    expect(operatorSides).toHaveLength(1)

    const next = session.forwardHttp({ ...GET_INFO, path: '/next' }, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))
    expect(operatorSides).toHaveLength(2)
    void answerAll(operatorSides[1]!)
    const res = await next
    expect(res.meta.status).toBe(200)
    expect(res.body.toString()).toBe('/next')
  })

  it('keeps a slow transfer alive while bytes keep arriving', async () => {
    const { getSocket, operatorSides } = pairFactory()
    const session = sessionFrom(createTunnelQueue(getSocket, 150))
    const pending = session.forwardHttp(GET_INFO, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))
    const operator = operatorSides[0]!
    await readTunnelRequest(operator)

    // 6 chunks, 100 ms apart: 600 ms in total, never idle for 150 ms.
    const meta = Buffer.from(JSON.stringify({ status: 200, headers: {} }))
    const header = Buffer.alloc(4)
    header.writeUInt32BE(meta.length)
    operator.write(Buffer.concat([header, meta]))
    const bodyHeader = Buffer.alloc(4)
    bodyHeader.writeUInt32BE(6)
    operator.write(bodyHeader)
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      operator.write(Buffer.from('x'))
    }
    const res = await pending
    expect(res.body.toString()).toBe('xxxxxx')
  })

  it('destroys the stream when an in-flight request is aborted', async () => {
    const { getSocket, operatorSides } = pairFactory()
    const session = sessionFrom(createTunnelQueue(getSocket, 0))
    const controller = new AbortController()
    const pending = session.forwardHttp(GET_INFO, Buffer.alloc(0), { signal: controller.signal })
    await new Promise((resolve) => setImmediate(resolve))
    const firstClient = await getSocket()

    controller.abort()
    await expect(pending).rejects.toThrow(/abort/i)
    expect(firstClient.destroyed).toBe(true)

    const next = session.forwardHttp(GET_INFO, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))
    void answerAll(operatorSides[1]!)
    expect((await next).meta.status).toBe(200)
  })

  it('rejects a queued request on abort without touching the stream', async () => {
    const { getSocket, operatorSides } = pairFactory()
    const session = sessionFrom(createTunnelQueue(getSocket, 0))
    const first = session.forwardHttp({ ...GET_INFO, path: '/first' }, Buffer.alloc(0))
    const controller = new AbortController()
    const queued = session.forwardHttp(GET_INFO, Buffer.alloc(0), { signal: controller.signal })

    controller.abort()
    await expect(queued).rejects.toThrow(/abort/i)

    void answerAll(operatorSides[0]!)
    expect((await first).body.toString()).toBe('/first')
    expect(operatorSides).toHaveLength(1)
  })

  it('drops the stream after a request fails so its framing cannot leak into the next', async () => {
    const { getSocket, operatorSides } = pairFactory()
    const session = sessionFrom(createTunnelQueue(getSocket, 0))
    const pending = session.forwardHttp(GET_INFO, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))
    const operator = operatorSides[0]!
    await readTunnelRequest(operator)
    // A meta frame that is not valid JSON.
    await writeFrame(operator, Buffer.from('not json'))
    await expect(pending).rejects.toThrow()

    const next = session.forwardHttp(GET_INFO, Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))
    expect(operatorSides).toHaveLength(2)
    void answerAll(operatorSides[1]!)
    expect((await next).meta.status).toBe(200)
  })
})

/**
 * Opens a fresh in-memory stream pair per call. The operator side answers every request with
 * its path, except `/hang`, which it never answers.
 */
function streamFactory() {
  const clients: Duplex[] = []
  let maxLive = 0
  const openStream = async () => {
    const [client, operator] = duplexPair()
    clients.push(client)
    maxLive = Math.max(maxLive, clients.filter((c) => !c.destroyed).length)
    void (async () => {
      try {
        while (true) {
          const req = await readTunnelRequest(operator)
          if (req.meta.path === '/hang') return
          const body = Buffer.from(req.meta.path)
          await writeTunnelResponse(operator, { status: 200, headers: {} }, body)
        }
      } catch {
        /* stream closed */
      }
    })()
    return client
  }
  return { openStream, clients, maxLive: () => maxLive }
}

describe('createTunnelPool', () => {
  const get = (path: string) => ({ ...GET_INFO, path })
  const opts = (maxStreams: number, requestTimeoutMs: number) => ({ maxStreams, requestTimeoutMs })

  it('answers a request on another stream while one hangs', async () => {
    const { openStream, clients } = streamFactory()
    const session = sessionFrom(createTunnelPool(openStream, opts(2, 0)).runOnTunnel)

    let hungSettled = false
    const hung = session.forwardHttp(get('/hang'), Buffer.alloc(0))
    hung.then(
      () => (hungSettled = true),
      () => (hungSettled = true),
    )
    const info = await session.forwardHttp(get('/info'), Buffer.alloc(0))
    expect(info.body.toString()).toBe('/info')
    expect(hungSettled).toBe(false)
    expect(clients).toHaveLength(2)
    expect(clients[0]!.destroyed).toBe(false)
  })

  it('never opens more than maxStreams and reuses idle streams', async () => {
    const { openStream, clients, maxLive } = streamFactory()
    const session = sessionFrom(createTunnelPool(openStream, opts(2, 0)).runOnTunnel)

    const paths = ['/a', '/b', '/c', '/d', '/e', '/f']
    const results = await Promise.all(
      paths.map((p) => session.forwardHttp(get(p), Buffer.alloc(0))),
    )
    expect(results.map((r) => r.body.toString())).toEqual(paths)
    expect(clients).toHaveLength(2)
    expect(maxLive()).toBe(2)

    await session.forwardHttp(get('/g'), Buffer.alloc(0))
    expect(clients).toHaveLength(2)
  })

  it('queues behind busy streams when the pool is full', async () => {
    const { openStream, clients } = streamFactory()
    const session = sessionFrom(createTunnelPool(openStream, opts(1, 100)).runOnTunnel)

    const hung = session.forwardHttp(get('/hang'), Buffer.alloc(0))
    const queued = session.forwardHttp(get('/info'), Buffer.alloc(0))
    await expect(hung).rejects.toBeInstanceOf(TunnelTimeoutError)
    expect((await queued).body.toString()).toBe('/info')
    // The hung stream was destroyed; the queued request reopened the only slot.
    expect(clients).toHaveLength(2)
    expect(clients[0]!.destroyed).toBe(true)
  })

  it('destroys only the abandoned stream', async () => {
    const { openStream, clients } = streamFactory()
    const session = sessionFrom(createTunnelPool(openStream, opts(2, 100)).runOnTunnel)

    const hung = session.forwardHttp(get('/hang'), Buffer.alloc(0))
    await session.forwardHttp(get('/info'), Buffer.alloc(0))
    await expect(hung).rejects.toBeInstanceOf(TunnelTimeoutError)
    expect(clients[0]!.destroyed).toBe(true)
    expect(clients[1]!.destroyed).toBe(false)

    // The next request takes the live stream instead of reopening the dead one.
    await session.forwardHttp(get('/next'), Buffer.alloc(0))
    expect(clients).toHaveLength(2)
  })

  it('drops a queued request on abort without opening or touching a stream', async () => {
    const { openStream, clients } = streamFactory()
    const session = sessionFrom(createTunnelPool(openStream, opts(1, 0)).runOnTunnel)
    const controller = new AbortController()

    const hung = session.forwardHttp(get('/hang'), Buffer.alloc(0), { signal: controller.signal })
    const other = new AbortController()
    const queued = session.forwardHttp(get('/info'), Buffer.alloc(0), { signal: other.signal })
    other.abort()
    await expect(queued).rejects.toThrow(/abort/i)
    expect(clients).toHaveLength(1)
    expect(clients[0]!.destroyed).toBe(false)

    controller.abort()
    await expect(hung).rejects.toThrow(/abort/i)
    const after = await session.forwardHttp(get('/after'), Buffer.alloc(0))
    expect(after.body.toString()).toBe('/after')
  })

  it('rejects queued requests and destroys streams on close', async () => {
    const { openStream, clients } = streamFactory()
    const pool = createTunnelPool(openStream, opts(1, 0))
    const session = sessionFrom(pool.runOnTunnel)

    const hung = session.forwardHttp(get('/hang'), Buffer.alloc(0))
    const queued = session.forwardHttp(get('/info'), Buffer.alloc(0))
    await new Promise((resolve) => setImmediate(resolve))
    pool.close()
    await expect(queued).rejects.toThrow(/closed/)
    await expect(hung).rejects.toThrow()
    expect(clients[0]!.destroyed).toBe(true)
    const late = session.forwardHttp(get('/info'), Buffer.alloc(0))
    await expect(late).rejects.toThrow(/closed/)
  })
})

describe('forward handlers', () => {
  it('answers 504 when the tunnel times out', async () => {
    const session = sessionFrom(async () => {
      throw new TunnelTimeoutError(100)
    })
    const res = await forwardFetchRequest(
      session,
      new Request('http://app.test/api/seed-gateway/info'),
      '/api/seed-gateway',
    )
    expect(res.status).toBe(504)
    expect(await res.text()).toMatch(/Gateway Hyper tunnel error: No bytes/)
  })

  it('passes the fetch request signal to the tunnel', async () => {
    let seen: AbortSignal | undefined
    const session: TunnelSession = {
      ...sessionFrom(async () => {
        throw new Error('unused')
      }),
      forwardHttp: async (_meta, _body, opts) => {
        seen = opts?.signal
        return { meta: { status: 200, headers: {} }, body: Buffer.alloc(0) }
      },
    }
    const request = new Request('http://app.test/info')
    await forwardFetchRequest(session, request, '')
    expect(seen).toBe(request.signal)
  })

  it('aborts the tunnel request when the HTTP caller disconnects', async () => {
    let resolveSignal!: (signal: AbortSignal) => void
    const signalSeen = new Promise<AbortSignal>((resolve) => {
      resolveSignal = resolve
    })
    const session: TunnelSession = {
      ...sessionFrom(async () => {
        throw new Error('unused')
      }),
      forwardHttp: (_meta, _body, opts) =>
        new Promise((_resolve, reject) => {
          const signal = opts!.signal!
          resolveSignal(signal)
          signal.addEventListener('abort', () => reject(signal.reason))
        }),
    }
    const base = await startUpstream((req, res) => {
      void forwardNodeRequest(session, req, res, '')
    })
    const clientReq = http.get(`${base}/info`)
    clientReq.on('error', () => {})
    const signal = await signalSeen
    expect(signal.aborted).toBe(false)
    clientReq.destroy()
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
    expect(signal.aborted).toBe(true)
  })
})

describe('operator upstream', () => {
  it('strips hop-by-hop headers and moves host to x-forwarded-host', () => {
    expect(
      upstreamRequestHeaders({
        host: 'app.example.com',
        connection: 'keep-alive, x-hop',
        'x-hop': '1',
        'keep-alive': 'timeout=5',
        'transfer-encoding': 'chunked',
        'content-length': '3',
        accept: 'application/json',
      }),
    ).toEqual({ accept: 'application/json', 'x-forwarded-host': 'app.example.com' })
  })

  it('fails with UpstreamTimeoutError when the upstream never answers', async () => {
    const base = await startUpstream(() => {
      /* never respond */
    })
    await expect(
      proxyTunnelRequest(base, GET_INFO, Buffer.alloc(0), { timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError)
  })

  it('times out an upstream that stalls partway through the body', async () => {
    const base = await startUpstream((_req, res) => {
      res.writeHead(200, { 'content-length': '10' })
      res.write('12345')
    })
    await expect(
      proxyTunnelRequest(base, GET_INFO, Buffer.alloc(0), { timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError)
  })
})

describe('serveTunnelConnection', () => {
  async function serveOverPair(upstream: string, upstreamTimeoutMs: number) {
    const [client, operator] = duplexPair()
    const done = serveTunnelConnection(operator, upstream, { upstreamTimeoutMs })
    const send = async (path: string) => {
      await writeTunnelRequest(client, { method: 'GET', path, headers: {} }, Buffer.alloc(0))
      return readTunnelResponse(client)
    }
    return { client, operator, done, send }
  }

  it('answers 504 for a hung upstream and keeps serving the stream', async () => {
    const base = await startUpstream((req, res) => {
      if (req.url === '/hang') return
      res.end('ok')
    })
    const { client, done, send } = await serveOverPair(base, 100)

    const hung = await send('/hang')
    expect(hung.meta.status).toBe(504)
    expect(hung.body.toString()).toMatch(/Gateway Hyper upstream timeout/)

    const info = await send('/info')
    expect(info.meta.status).toBe(200)
    expect(info.body.toString()).toBe('ok')

    client.destroy()
    await done
  })

  it('answers 502 when the upstream connection fails and keeps serving the stream', async () => {
    const base = await startUpstream((req, res) => {
      if (req.url === '/reset') {
        req.socket.destroy()
        return
      }
      res.end('ok')
    })
    const { client, done, send } = await serveOverPair(base, 1000)

    const reset = await send('/reset')
    expect(reset.meta.status).toBe(502)
    expect(reset.body.toString()).toMatch(/Gateway Hyper upstream error/)
    expect((await send('/info')).meta.status).toBe(200)

    client.destroy()
    await done
  })

  it('aborts the upstream request when the tunnel stream closes', async () => {
    let upstreamClosed!: () => void
    const closed = new Promise<void>((resolve) => {
      upstreamClosed = resolve
    })
    let requestSeen!: () => void
    const seen = new Promise<void>((resolve) => {
      requestSeen = resolve
    })
    const base = await startUpstream((_req, res) => {
      res.on('close', () => upstreamClosed())
      requestSeen()
    })
    const { client, done } = await serveOverPair(base, 0)
    await writeTunnelRequest(client, GET_INFO, Buffer.alloc(0))
    await seen
    client.destroy()
    await closed
    await done
  })
})
