/**
 * Vitest setup file (browser): no network in tests. See networkGuard.ts. Wraps fetch,
 * XMLHttpRequest, WebSocket, EventSource and sendBeacon on the page. Requests from workers and
 * DOM loads (<img src>) are blocked by Chromium's --host-resolver-rules in vite.config.js
 * instead, without a test failure naming them.
 */
import { afterAll, afterEach } from 'vitest'
import { assertNoBlockedRequests, blockRequest, emptyEasIndexerResponse, liveNetworkAllowed, remoteHostOf } from './networkGuard'

function installBrowserNetworkGuard(): void {
  if (liveNetworkAllowed() || typeof window === 'undefined') return
  const base = location.href
  const remote = (url: string | URL) => remoteHostOf(String(url), base, [location.hostname])

  const realFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const fake = emptyEasIndexerResponse(url, init)
    if (fake) return Promise.resolve(fake)
    if (remote(url)) {
      return Promise.reject(blockRequest(`fetch ${(init?.method ?? 'GET').toUpperCase()} ${url}`))
    }
    return realFetch(input, init)
  }

  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function guardedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    if (remote(url)) throw blockRequest(`XMLHttpRequest ${method} ${String(url)}`)
    return (open as (...a: unknown[]) => void).call(this, method, url, ...rest)
  } as typeof open

  const RealWebSocket = window.WebSocket
  window.WebSocket = class GuardedWebSocket extends RealWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      if (remote(url)) throw blockRequest(`WebSocket ${String(url)}`)
      super(url, protocols)
    }
  } as typeof WebSocket

  const RealEventSource = window.EventSource
  window.EventSource = class GuardedEventSource extends RealEventSource {
    constructor(url: string | URL, init?: EventSourceInit) {
      if (remote(url)) throw blockRequest(`EventSource ${String(url)}`)
      super(url, init)
    }
  } as typeof EventSource

  const sendBeacon = navigator.sendBeacon.bind(navigator)
  navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
    if (remote(url)) throw blockRequest(`sendBeacon ${String(url)}`)
    return sendBeacon(url, data)
  }
}

installBrowserNetworkGuard()
afterEach(() => assertNoBlockedRequests('during this test'))
afterAll(() => assertNoBlockedRequests('in this file outside a test'))
