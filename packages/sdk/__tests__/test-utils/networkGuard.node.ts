/**
 * Node (and bun) side of networkGuard.ts. Every TCP connection goes through
 * `net.Socket.prototype.connect` (http, https, tls, undici and so Node's fetch and WebSocket),
 * so that is patched; `fetch` and `WebSocket` are wrapped too, for an error naming the URL and
 * because bun implements both natively. Unix sockets and named pipes are allowed.
 */
import net from 'node:net'
import { blockRequest, emptyEasIndexerResponse, isLocalHost, liveNetworkAllowed, remoteHostOf } from './networkGuard'

const INSTALLED = Symbol.for('seed.test.networkGuard')

type NormalizedConnect = [{ host?: string; path?: string; port?: number | string }, unknown]

export function installNodeNetworkGuard(): void {
  if (liveNetworkAllowed()) return
  const g = globalThis as Record<symbol, unknown>
  if (g[INSTALLED]) return
  g[INSTALLED] = true

  const normalizeArgs = (net as unknown as { _normalizeArgs?: (args: unknown[]) => NormalizedConnect })
    ._normalizeArgs
  const connect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    const [options] = normalizeArgs ? normalizeArgs(args) : [args[0] as NormalizedConnect[0]]
    const host = typeof options === 'object' && options ? options.host : undefined
    const isPipe = typeof options === 'object' && options && typeof options.path === 'string'
    if (!isPipe && !isLocalHost(host)) {
      const error = blockRequest(`TCP connection to ${host}:${options?.port ?? ''}`)
      process.nextTick(() => this.destroy(error))
      return this
    }
    return (connect as (...a: unknown[]) => net.Socket).apply(this, args)
  } as typeof connect

  const realFetch = globalThis.fetch
  if (typeof realFetch === 'function') {
    globalThis.fetch = function guardedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const fake = emptyEasIndexerResponse(url, init)
      if (fake) return Promise.resolve(fake)
      if (remoteHostOf(url)) {
        return Promise.reject(blockRequest(`fetch ${(init?.method ?? 'GET').toUpperCase()} ${url}`))
      }
      return realFetch(input, init)
    } as typeof fetch
  }

  const RealWebSocket = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
  if (typeof RealWebSocket === 'function') {
    globalThis.WebSocket = class GuardedWebSocket extends RealWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (remoteHostOf(String(url))) throw blockRequest(`WebSocket ${String(url)}`)
        super(url, protocols)
      }
    } as typeof WebSocket
  }
}
