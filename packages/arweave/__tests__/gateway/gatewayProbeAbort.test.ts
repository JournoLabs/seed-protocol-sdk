import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeGateway, resetArweaveReadGatewayForTests } from '../../src/ArweaveClient/selectReadGateway.js'
import {
  invalidateSidecarProbeCache,
  resolveSeedGatewayEndpoints,
  resolveSidecarOrigin,
} from '../../src/gateway/resolveSeedGatewayEndpoints.js'
import { DEFAULT_GATEWAY_SIDECAR_HOST, DEFAULT_GATEWAY_SIDECAR_PORT } from '../../src/constants.js'

const PROXY = 'https://app.example.com/api/seed-gateway'
const healthyInfo = () => new Response(JSON.stringify({ network: 'arweave.mainnet' }), { status: 200 })

/** A fetch that never answers; it rejects when its signal aborts, as fetch does. */
const hangingFetch = (_url: string | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')))
  })

/** Hybrid, proxy probed, no sidecar: "proxy, else public HTTP". */
const proxyElseHttp = {
  transport: 'hybrid' as const,
  proxyBaseUrl: PROXY,
  arweaveDomain: 'fallback.example.com',
  hyper: { probeProxy: true, probeSidecar: false },
}

beforeEach(() => {
  resetArweaveReadGatewayForTests()
  invalidateSidecarProbeCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  resetArweaveReadGatewayForTests()
  invalidateSidecarProbeCache()
})

describe('probeGateway', () => {
  it("doesn't count a probe the caller aborts as a gateway failure", async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch))
    const controller = new AbortController()
    const probe = probeGateway(PROXY, { signal: controller.signal })
    controller.abort()
    expect(await probe).toBe(false)

    // The host's circuit stays closed, so the next probe reaches it.
    const fetchMock = vi.fn(async () => healthyInfo())
    vi.stubGlobal('fetch', fetchMock)
    expect(await probeGateway(PROXY)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('times out after timeoutMs even when given a signal that never aborts', async () => {
    const fetchMock = vi.fn(hangingFetch)
    vi.stubGlobal('fetch', fetchMock)
    const started = Date.now()
    expect(await probeGateway(PROXY, { signal: new AbortController().signal, timeoutMs: 50 })).toBe(false)
    expect(Date.now() - started).toBeLessThan(2000)
    const sent = fetchMock.mock.calls[0]?.[1]?.signal
    expect(sent).toBeInstanceOf(AbortSignal)
    expect(sent?.aborted).toBe(true)
  })

  it('with recordCircuit: false, probes a host whose circuit is open and leaves the breaker alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))
    expect(await probeGateway(PROXY)).toBe(false)

    const fetchMock = vi.fn(async () => healthyInfo())
    vi.stubGlobal('fetch', fetchMock)
    // A plain probe skips the open circuit; recordCircuit: false probes anyway and doesn't close it.
    expect(await probeGateway(PROXY)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await probeGateway(PROXY, { recordCircuit: false })).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await probeGateway(PROXY)).toBe(false)

    // A failure with recordCircuit: false doesn't open it.
    resetArweaveReadGatewayForTests()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))
    expect(await probeGateway(PROXY, { recordCircuit: false })).toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => healthyInfo()))
    expect(await probeGateway(PROXY)).toBe(true)
  })
})

describe('resolveSeedGatewayEndpoints probe budget', () => {
  it('falls back to HTTP within timeoutMs when the proxy hangs', async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch))
    const started = Date.now()
    const resolved = await resolveSeedGatewayEndpoints(proxyElseHttp, { timeoutMs: 50 })
    expect(resolved.activePath).toBe('hybrid-fallback-http')
    expect(resolved.arweaveHost).toBe('fallback.example.com')
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("an aborted proxy probe isn't cached or counted: the next resolve uses the healthy proxy", async () => {
    vi.stubGlobal('fetch', vi.fn(hangingFetch))
    expect((await resolveSeedGatewayEndpoints(proxyElseHttp, { timeoutMs: 50 })).activePath).toBe(
      'hybrid-fallback-http',
    )

    vi.stubGlobal('fetch', vi.fn(async () => healthyInfo()))
    const resolved = await resolveSeedGatewayEndpoints(proxyElseHttp)
    expect(resolved.activePath).toBe('http-proxy')
    expect(resolved.arweaveBaseUrl).toBe(PROXY)
  })

  it('re-probes a proxy that failed after 60 s, not 3 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })))
    expect((await resolveSeedGatewayEndpoints(proxyElseHttp)).activePath).toBe('hybrid-fallback-http')

    // Past the failure TTL and the breaker's open period.
    vi.setSystemTime(Date.now() + 61_000)
    vi.stubGlobal('fetch', vi.fn(async () => healthyInfo()))
    expect((await resolveSeedGatewayEndpoints(proxyElseHttp)).activePath).toBe('http-proxy')
  })
})

describe('resolveSidecarOrigin', () => {
  it('returns the configured sidecar, else the default', () => {
    expect(resolveSidecarOrigin({})).toEqual({
      host: `${DEFAULT_GATEWAY_SIDECAR_HOST}:${DEFAULT_GATEWAY_SIDECAR_PORT}`,
      port: DEFAULT_GATEWAY_SIDECAR_PORT,
      baseUrl: `http://${DEFAULT_GATEWAY_SIDECAR_HOST}:${DEFAULT_GATEWAY_SIDECAR_PORT}`,
    })
    expect(resolveSidecarOrigin({ hyper: { localSidecarHost: 'sidecar.test', localSidecarPort: 8080 } })).toEqual({
      host: 'sidecar.test:8080',
      port: 8080,
      baseUrl: 'http://sidecar.test:8080',
    })
  })
})
