import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { clearLocalQuerySource, registerLocalQuerySource } from '@seedprotocol/query'
import { createSeedMcpHttpHandler, createSeedMcpServer, type SeedMcpHttpOptions } from '../src/index'
import { createSeedMcpHttpServer } from '../src/httpNode'
import { OTHER, POST, POST_V1, PUBLISHER, SPAM_POST, localSource } from './fixtures'

const ENDPOINT = 'http://mcp.test/mcp'
const clients: Client[] = []

beforeEach(() => registerLocalQuerySource(localSource()))
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()))
  clearLocalQuerySource()
})

async function httpClient(options: SeedMcpHttpOptions = {}, clientAddress = '192.0.2.1'): Promise<Client> {
  const handle = createSeedMcpHttpHandler({ source: 'local', attesters: [PUBLISHER], ...options })
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), {
    fetch: (input, init) => handle(new Request(input, init), { clientAddress }),
  })
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(transport)
  clients.push(client)
  return client
}

async function stdioEquivalentClient(): Promise<Client> {
  const server = createSeedMcpServer({ source: 'local', attesters: [PUBLISHER] })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
  clients.push(client)
  return client
}

const post = (body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  })

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
}

describe('createSeedMcpHttpHandler', () => {
  it('returns the same tools and results as the in-process server', async () => {
    const [overHttp, inProcess] = await Promise.all([httpClient(), stdioEquivalentClient()])
    expect(await overHttp.listTools()).toEqual(await inProcess.listTools())
    expect(overHttp.getInstructions()).toBe(inProcess.getInstructions())

    const calls: Array<[string, Record<string, unknown>]> = [
      ['list_seeds', { schema: 'post' }],
      ['get_seed', { seed_uid: POST }],
      ['get_seed', { seed_uid: POST, version_uid: POST_V1, max_chars: 200 }],
      ['get_seed', { seed_uid: SPAM_POST }],
      ['get_changelog', { seed_uid: POST }],
      ['get_provenance', { seed_uid: POST }],
      ['list_seeds', { schema: 'post', attester: OTHER }],
    ]
    for (const [name, args] of calls) {
      const viaHttp = await overHttp.callTool({ name, arguments: args })
      expect(viaHttp).toEqual(await inProcess.callTool({ name, arguments: args }))
    }
    const read = (await overHttp.callTool({ name: 'get_seed', arguments: { seed_uid: POST } })) as {
      content: Array<{ text: string }>
    }
    expect(read.content[0]?.text).toContain(POST)
  })

  it('answers with JSON and no session', async () => {
    const response = await createSeedMcpHttpHandler({ source: 'local' })(post(initialize))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('mcp-session-id')).toBeNull()
    expect(((await response.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe('seed-protocol')
  })

  it('refuses GET and DELETE with 405', async () => {
    const handle = createSeedMcpHttpHandler({ source: 'local' })
    for (const method of ['GET', 'DELETE']) {
      const response = await handle(new Request(ENDPOINT, { method, headers: { accept: 'text/event-stream' } }))
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('POST, OPTIONS')
    }
  })

  it('refuses a browser origin it was not given, and allows a listed one with CORS headers', async () => {
    const handle = createSeedMcpHttpHandler({ source: 'local', allowedOrigins: ['https://inspector.example'] })
    expect((await handle(post(initialize, { origin: 'https://evil.example' }))).status).toBe(403)

    const allowed = await handle(post(initialize, { origin: 'https://inspector.example' }))
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://inspector.example')

    const preflight = await handle(new Request(ENDPOINT, { method: 'OPTIONS', headers: { origin: 'https://inspector.example' } }))
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST')
  })

  it('limits each client address to the configured requests per minute', async () => {
    const handle = createSeedMcpHttpHandler({ source: 'local', rateLimit: 3 })
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await handle(post(initialize), { clientAddress: '192.0.2.1' })).status)
    expect(statuses).toEqual([200, 200, 200, 429])

    const limited = await handle(post(initialize), { clientAddress: '192.0.2.1' })
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await handle(post(initialize), { clientAddress: '192.0.2.2' })).status).toBe(200)
  })
})

describe('createSeedMcpHttpServer', () => {
  let server: Server | undefined
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())))

  async function listen(options: Parameters<typeof createSeedMcpHttpServer>[0] = {}): Promise<string> {
    server = createSeedMcpHttpServer({ source: 'local', attesters: [PUBLISHER], ...options })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  it('serves MCP at /mcp over a real socket', async () => {
    const base = await listen()
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)))
    clients.push(client)
    const result = (await client.callTool({ name: 'list_seeds', arguments: { schema: 'post' } })) as {
      content: Array<{ text: string }>
    }
    expect(result.content[0]?.text).toContain(POST)
    expect((await fetch(`${base}/other`)).status).toBe(404)
  })

  it('refuses a body over 1 MB with 413', async () => {
    const base = await listen()
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: 'x'.repeat(1_000_001),
    })
    expect(response.status).toBe(413)
  })

  it('keys the rate limit on the proxy’s X-Forwarded-For entry with trustProxy', async () => {
    const base = await listen({ rateLimit: 1, trustProxy: true })
    const send = (forwardedFor: string) =>
      fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-forwarded-for': forwardedFor },
        body: JSON.stringify(initialize),
      })
    expect((await send('10.0.0.9, 192.0.2.1')).status).toBe(200)
    // The first entry is client-supplied; changing it doesn't escape the limit.
    expect((await send('10.0.0.8, 192.0.2.1')).status).toBe(429)
    expect((await send('192.0.2.2')).status).toBe(200)
  })
})
