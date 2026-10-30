import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'
import {
  resolveSeedGatewayEndpoints,
  resolveProxyBaseUrl,
  invalidateSidecarProbeCache,
} from '../../src/gateway/resolveSeedGatewayEndpoints.js'
import { DEFAULT_ARWEAVE_HOST, DEFAULT_GATEWAY_SIDECAR_PORT } from '../../src/constants.js'

describe('resolveProxyBaseUrl', () => {
  it('keeps absolute URLs and strips trailing slash', () => {
    expect(resolveProxyBaseUrl('https://app.example.com/api/seed-gateway/')).toBe(
      'https://app.example.com/api/seed-gateway',
    )
  })

  it('resolves relative paths with options.origin', () => {
    expect(
      resolveProxyBaseUrl('/api/seed-gateway', { origin: 'https://app.example.com' }),
    ).toBe('https://app.example.com/api/seed-gateway')
  })

  it('throws for relative paths without origin', () => {
    expect(() => resolveProxyBaseUrl('/api/seed-gateway')).toThrow(/requires a browser origin/)
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

  it("leaves uploadApiBaseUrl empty when unset: a public gateway doesn't serve the upload API", async () => {
    const resolved = await resolveSeedGatewayEndpoints({ transport: 'http-gateway' })
    expect(resolved.arweaveBaseUrl).toBe(`https://${DEFAULT_ARWEAVE_HOST}`)
    expect(resolved.uploadApiBaseUrl).toBe('')
  })

  it('defaults to http-gateway with DEFAULT_ARWEAVE_HOST', async () => {
    const resolved = await resolveSeedGatewayEndpoints({})
    expect(resolved.mode).toBe('http-gateway')
    expect(resolved.arweaveHost).toBe(DEFAULT_ARWEAVE_HOST)
    expect(resolved.publicArweaveBaseUrl).toBe(`https://${DEFAULT_ARWEAVE_HOST}`)
  })

  it('keeps the public gateway from arweaveDomain when reads go through a sidecar or proxy', async () => {
    const hyper = await resolveSeedGatewayEndpoints({
      transport: 'hyper',
      hyper: { localSidecarPort: 4321, probeSidecar: false },
    })
    expect(hyper.arweaveBaseUrl).toBe('http://127.0.0.1:4321')
    expect(hyper.publicArweaveBaseUrl).toBe(`https://${DEFAULT_ARWEAVE_HOST}`)

    const proxy = await resolveSeedGatewayEndpoints({
      transport: 'http-gateway',
      arweaveDomain: 'custom.ar.example',
      proxyBaseUrl: 'https://app.example/api/seed-gateway',
      hyper: { probeSidecar: false },
    })
    expect(proxy.arweaveBaseUrl).toBe('https://app.example/api/seed-gateway')
    expect(proxy.publicArweaveBaseUrl).toBe('https://custom.ar.example')
  })

  describe('proxy and sidecar', () => {
    let servers: http.Server[] = []

    afterEach(async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => resolve())
            }),
        ),
      )
      servers = []
      requests = 0
      vi.unstubAllGlobals()
    })

    /** A page in a browser at `origin`. */
    const onPage = (origin: string) => vi.stubGlobal('window', { location: { origin } })

    it("hybrid doesn't probe the sidecar from a public web page", async () => {
      const sidecarPort = await listenMockGateway()
      onPage('https://app.example.com')
      const resolved = await resolveSeedGatewayEndpoints({
        transport: 'hybrid',
        hyper: { localSidecarPort: sidecarPort, probeSidecar: true },
      })
      expect(resolved.activePath).toBe('hybrid-fallback-http')
      expect(requests).toBe(0)
    })

    it('hybrid probes the sidecar from a loopback page, or with probeSidecarFromBrowser', async () => {
      const sidecarPort = await listenMockGateway()
      onPage('http://localhost:5173')
      const local = await resolveSeedGatewayEndpoints({
        transport: 'hybrid',
        hyper: { localSidecarPort: sidecarPort, probeSidecar: true },
      })
      expect(local.activePath).toBe('hyper-sidecar')

      invalidateSidecarProbeCache()
      onPage('https://desktop.example.com')
      const optedIn = await resolveSeedGatewayEndpoints({
        transport: 'hybrid',
        hyper: { localSidecarPort: sidecarPort, probeSidecar: true, probeSidecarFromBrowser: true },
      })
      expect(optedIn.activePath).toBe('hyper-sidecar')
    })

    it('probeProxy: false adopts the proxy without probing it, while probeSidecar stays on', async () => {
      const resolved = await resolveSeedGatewayEndpoints({
        transport: 'http-gateway',
        proxyBaseUrl: 'http://127.0.0.1:9/api/seed-gateway',
        hyper: { probeSidecar: true, probeProxy: false },
      })
      expect(resolved.activePath).toBe('http-proxy')
    })

    let requests = 0

    async function listenMockGateway(): Promise<number> {
      const server = http.createServer((_req, res) => {
        requests += 1
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ network: 'arweave', version: 1 }))
      })
      servers.push(server)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const addr = server.address()
      if (!addr || typeof addr === 'string') throw new Error('no port')
      return addr.port
    }

    it('http-gateway with healthy proxyBaseUrl selects http-proxy', async () => {
      const port = await listenMockGateway()
      const resolved = await resolveSeedGatewayEndpoints({
        transport: 'http-gateway',
        proxyBaseUrl: `http://127.0.0.1:${port}/api/seed-gateway`,
        arweaveDomain: DEFAULT_ARWEAVE_HOST,
      })
      // probe hits /api/seed-gateway/info — mock serves any path as 200
      expect(resolved.activePath).toBe('http-proxy')
      expect(resolved.arweaveBaseUrl).toBe(`http://127.0.0.1:${port}/api/seed-gateway`)
      expect(resolved.arweaveGraphqlUrl).toBe(
        `http://127.0.0.1:${port}/api/seed-gateway/graphql`,
      )
      expect(resolved.uploadApiBaseUrl).toBe(`http://127.0.0.1:${port}/api/seed-gateway`)
    })

    it('hybrid prefers healthy proxy over sidecar', async () => {
      const proxyPort = await listenMockGateway()
      const sidecarPort = await listenMockGateway()
      const resolved = await resolveSeedGatewayEndpoints({
        transport: 'hybrid',
        proxyBaseUrl: `http://127.0.0.1:${proxyPort}/gw`,
        arweaveDomain: DEFAULT_ARWEAVE_HOST,
        hyper: { localSidecarPort: sidecarPort, probeSidecar: true },
      })
      expect(resolved.activePath).toBe('http-proxy')
      expect(resolved.arweaveBaseUrl).toBe(`http://127.0.0.1:${proxyPort}/gw`)
    })

    it('hybrid falls back to sidecar when proxy is down', async () => {
      const sidecarPort = await listenMockGateway()
      const resolved = await resolveSeedGatewayEndpoints({
        transport: 'hybrid',
        proxyBaseUrl: 'http://127.0.0.1:9/api/seed-gateway',
        arweaveDomain: DEFAULT_ARWEAVE_HOST,
        hyper: { localSidecarPort: sidecarPort, probeSidecar: true },
      })
      expect(resolved.activePath).toBe('hyper-sidecar')
      expect(resolved.arweaveBaseUrl).toBe(`http://127.0.0.1:${sidecarPort}`)
    })

    it('selects hyper-sidecar when sidecar /info responds', async () => {
      const port = await listenMockGateway()
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

    it('hyper prefers healthy proxy over sidecar', async () => {
      const proxyPort = await listenMockGateway()
      const resolved = await resolveSeedGatewayEndpoints({
        transport: 'hyper',
        proxyBaseUrl: `http://127.0.0.1:${proxyPort}`,
        hyper: { localSidecarPort: DEFAULT_GATEWAY_SIDECAR_PORT, probeSidecar: true },
      })
      expect(resolved.activePath).toBe('http-proxy')
    })
  })
})
