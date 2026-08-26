import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { duplexPair } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  readTunnelRequest,
  readTunnelResponse,
  writeTunnelRequest,
  writeTunnelResponse,
} from '../src/tunnel/protocol'
import { proxyTunnelRequest } from '../src/tunnel/proxy'
import { connectTunnel, serveTunnel } from '../src/index'

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

describe.runIf(runDhtTests)('gateway-hyper DHT tunnel integration', () => {
  it('proxies HTTP through serve + connect over HyperDHT', async () => {
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
    })

    const client = await connectTunnel({
      key: operator.key,
      host: '127.0.0.1',
      port: 0,
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
  }, 120_000)
})
