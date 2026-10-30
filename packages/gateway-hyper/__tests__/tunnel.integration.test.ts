import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { duplexPair } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  readTunnelRequest,
  readTunnelResponse,
  writeTunnelRequest,
  writeTunnelResponse,
} from '../src/tunnel/protocol'
import { proxyTunnelRequest } from '../src/tunnel/proxy'
import { connectTunnel, serveTunnel } from '../src/index'
import type { DhtBootstrapNode } from '../src/types'
import { startTestnet, type LocalTestnet } from './helpers/testnet'

const runDhtTests =
  process.env.GATEWAY_HYPER_TESTS === '1' || process.env.GATEWAY_HYPER_TESTS === 'true'

describe('gateway-hyper upstream proxy', () => {
  it('forwards framed GET requests to an upstream HTTP server', async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })

    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
    const addr = upstream.address()
    if (!addr || typeof addr === 'string') {
      throw new Error('upstream address unavailable')
    }

    const [clientSide, operatorSide] = duplexPair()
    const operatorDone = (async () => {
      const request = await readTunnelRequest(operatorSide)
      const response = await proxyTunnelRequest(
        `http://127.0.0.1:${addr.port}`,
        request.meta,
        request.body,
      )
      await writeTunnelResponse(
        operatorSide,
        { status: response.status, headers: response.headers },
        response.body,
      )
    })()

    await writeTunnelRequest(
      clientSide,
      { method: 'GET', path: '/info', headers: { accept: 'application/json' } },
      Buffer.alloc(0),
    )
    const tunnelResponse = await readTunnelResponse(clientSide)
    await operatorDone
    expect(tunnelResponse.meta.status).toBe(200)
    expect(JSON.parse(tunnelResponse.body.toString('utf8'))).toEqual({ ok: true })

    clientSide.destroy()
    operatorSide.destroy()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  })
})

async function expectInfoThroughTunnel(bootstrap: DhtBootstrapNode[] | undefined) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-hyper-int-'))
  const keyFile = path.join(tmpDir, 'operator.key.json')

  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, via: 'upstream' }))
  })

  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
  const addr = upstream.address()
  if (!addr || typeof addr === 'string') {
    throw new Error('upstream address unavailable')
  }

  const operator = await serveTunnel({
    upstream: `http://127.0.0.1:${addr.port}`,
    keyFile,
    bootstrap,
  })

  const client = await connectTunnel({
    key: operator.key,
    host: '127.0.0.1',
    port: 0,
    bootstrap,
  })

  try {
    const res = await fetch(`${client.baseUrl}/info`)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok?: boolean; via?: string }
    expect(json.ok).toBe(true)
    expect(json.via).toBe('upstream')
  } finally {
    await client.close()
    await operator.close()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  }
}

describe.runIf(runDhtTests)('gateway-hyper tunnel over the public DHT', () => {
  it('proxies HTTP through serve + connect', async () => {
    await expectInfoThroughTunnel(undefined)
  }, 120_000)
})

describe('gateway-hyper DHT tunnel integration', () => {
  let testnet: LocalTestnet
  beforeAll(async () => {
    testnet = await startTestnet()
  })
  afterAll(async () => {
    await testnet.destroy()
  })

  it('proxies HTTP through serve + connect over HyperDHT', async () => {
    await expectInfoThroughTunnel(testnet.bootstrap)
  }, 30_000)

  describe('with a hung upstream', () => {
    const big = Buffer.alloc(20 * 1024 * 1024)
    for (let i = 0; i < big.length; i += 4096) big[i] = i % 251

    async function startStack(serveOpts: { upstreamTimeoutMs: number }, requestTimeoutMs: number) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-hyper-int-'))
      const upstream = http.createServer((req, res) => {
        if (req.url === '/hang') return
        if (req.url === '/big') {
          res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
          res.end(big)
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
      await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', () => resolve()))
      const addr = upstream.address()
      if (!addr || typeof addr === 'string') throw new Error('upstream address unavailable')
      const operator = await serveTunnel({
        upstream: `http://127.0.0.1:${addr.port}`,
        keyFile: path.join(tmpDir, 'operator.key.json'),
        bootstrap: testnet.bootstrap,
        ...serveOpts,
      })
      const client = await connectTunnel({
        key: operator.key,
        host: '127.0.0.1',
        port: 0,
        requestTimeoutMs,
        bootstrap: testnet.bootstrap,
      })
      return {
        client,
        close: async () => {
          await client.close()
          await operator.close()
          upstream.closeAllConnections()
          await new Promise<void>((resolve) => upstream.close(() => resolve()))
        },
      }
    }

    it('answers 504 from the operator and keeps serving the session', async () => {
      const stack = await startStack({ upstreamTimeoutMs: 1000 }, 10_000)
      try {
        const hung = await fetch(`${stack.client.baseUrl}/hang`)
        expect(hung.status).toBe(504)
        expect(await hung.text()).toMatch(/Gateway Hyper upstream timeout/)
        const info = await fetch(`${stack.client.baseUrl}/info`)
        expect(info.status).toBe(200)
      } finally {
        await stack.close()
      }
    }, 120_000)

    it('abandons the request on the client and reconnects', async () => {
      const stack = await startStack({ upstreamTimeoutMs: 0 }, 1000)
      try {
        const hung = await fetch(`${stack.client.baseUrl}/hang`)
        expect(hung.status).toBe(504)
        expect(await hung.text()).toMatch(/Gateway Hyper tunnel error/)
        const info = await fetch(`${stack.client.baseUrl}/info`)
        expect(info.status).toBe(200)
      } finally {
        await stack.close()
      }
    }, 120_000)

    it('answers /info on another stream while /hang is in flight', async () => {
      const stack = await startStack({ upstreamTimeoutMs: 0 }, 0)
      const hangAbort = new AbortController()
      let hangSettled = false
      const hung = fetch(`${stack.client.baseUrl}/hang`, { signal: hangAbort.signal }).finally(
        () => {
          hangSettled = true
        },
      )
      hung.catch(() => {})
      try {
        const info = await fetch(`${stack.client.baseUrl}/info`)
        expect(info.status).toBe(200)
        expect(await info.json()).toEqual({ ok: true })
        expect(hangSettled).toBe(false)
      } finally {
        hangAbort.abort()
        await hung.catch(() => {})
        await stack.close()
      }
    }, 120_000)

    it('carries a response larger than one secret-stream write', async () => {
      const stack = await startStack({ upstreamTimeoutMs: 30_000 }, 60_000)
      try {
        const res = await fetch(`${stack.client.baseUrl}/big`)
        expect(res.status).toBe(200)
        expect(Buffer.from(await res.arrayBuffer()).equals(big)).toBe(true)
      } finally {
        await stack.close()
      }
    }, 120_000)
  })
})
