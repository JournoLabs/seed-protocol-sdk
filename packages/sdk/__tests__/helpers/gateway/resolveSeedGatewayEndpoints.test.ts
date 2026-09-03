import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import {
  resolveSeedGatewayEndpoints,
  resolveProxyBaseUrl,
  invalidateSidecarProbeCache,
} from '@/helpers/gateway/resolveSeedGatewayEndpoints'
import { DEFAULT_ARWEAVE_HOST, DEFAULT_GATEWAY_SIDECAR_PORT } from '@/helpers/constants'

describe('resolveProxyBaseUrl', () => {
  it('resolves relative paths with options.origin', () => {
    expect(
      resolveProxyBaseUrl('/api/seed-gateway', { origin: 'https://app.example.com' }),
    ).toBe('https://app.example.com/api/seed-gateway')
  })
})

describe('resolveSeedGatewayEndpoints', () => {
  beforeEach(() => {
    invalidateSidecarProbeCache()
  })

  it('http-gateway mode uses arweaveDomain and uploadApiBaseUrl', async () => {
    const resolved = await resolveSeedGatewayEndpoints({
      transport: 'http-gateway',
      arweaveDomain: 'custom.ar.example',
      uploadApiBaseUrl: 'https://app.example',
    })
    expect(resolved.activePath).toBe('http')
    expect(resolved.arweaveHost).toBe('custom.ar.example')
    expect(resolved.arweaveProtocol).toBe('https')
    expect(resolved.uploadApiBaseUrl).toBe('https://app.example')
    expect(resolved.arweaveGraphqlUrl).toBe('https://custom.ar.example/graphql')
  })

  it('defaults to http-gateway with DEFAULT_ARWEAVE_HOST', async () => {
    const resolved = await resolveSeedGatewayEndpoints({})
    expect(resolved.mode).toBe('http-gateway')
    expect(resolved.arweaveHost).toBe(DEFAULT_ARWEAVE_HOST)
  })

  describe('hybrid with mock sidecar', () => {
    let server: http.Server
    let port = 0

    beforeEach(async () => {
      server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ network: 'arweave', version: 1 }))
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('no port')
      port = addr.port
    })

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    it('selects hyper-sidecar when sidecar /info responds', async () => {
      const resolved = await resolveSeedGatewayEndpoints({
        transport: 'hybrid',
        arweaveDomain: DEFAULT_ARWEAVE_HOST,
        hyper: { localSidecarPort: port, probeSidecar: true },
      })
      expect(resolved.activePath).toBe('hyper-sidecar')
      expect(resolved.arweaveBaseUrl).toBe(`http://127.0.0.1:${port}`)
    })

    it('falls back to HTTP when sidecar is down', async () => {
      const resolved = await resolveSeedGatewayEndpoints({
        transport: 'hybrid',
        arweaveDomain: 'fallback.gateway',
        hyper: { localSidecarPort: DEFAULT_GATEWAY_SIDECAR_PORT, probeSidecar: true },
      })
      expect(resolved.activePath).toBe('hybrid-fallback-http')
      expect(resolved.arweaveHost).toBe('fallback.gateway')
    })

    it('hybrid prefers proxy over sidecar when proxy is healthy', async () => {
      const resolved = await resolveSeedGatewayEndpoints({
        transport: 'hybrid',
        proxyBaseUrl: `http://127.0.0.1:${port}/api/seed-gateway`,
        arweaveDomain: DEFAULT_ARWEAVE_HOST,
        hyper: { localSidecarPort: DEFAULT_GATEWAY_SIDECAR_PORT, probeSidecar: true },
      })
      expect(resolved.activePath).toBe('http-proxy')
      expect(resolved.arweaveBaseUrl).toBe(`http://127.0.0.1:${port}/api/seed-gateway`)
    })
  })
})
