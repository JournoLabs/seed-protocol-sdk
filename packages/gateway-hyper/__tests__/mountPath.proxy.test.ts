import { describe, expect, it } from 'vitest'
import { duplexPair } from 'node:stream'
import { stripMountPath } from '../src/tunnel/mountPath'
import {
  filterResponseHeaders,
  flattenRequestHeaders,
  readTunnelRequest,
  writeTunnelRequest,
  writeTunnelResponse,
  readTunnelResponse,
} from '../src/tunnel/protocol'
import type { TunnelSession } from '../src/tunnel/session'
import { forwardFetchRequest } from '../src/tunnel/forward'

describe('stripMountPath', () => {
  it('strips mount prefix and preserves query', () => {
    expect(stripMountPath('/api/seed-gateway/info', '/api/seed-gateway')).toBe('/info')
    expect(stripMountPath('/api/seed-gateway/graphql?x=1', '/api/seed-gateway')).toBe(
      '/graphql?x=1',
    )
  })

  it('returns root when path equals mount', () => {
    expect(stripMountPath('/api/seed-gateway', '/api/seed-gateway')).toBe('/')
  })

  it('leaves already-stripped paths alone', () => {
    expect(stripMountPath('/info', '/api/seed-gateway')).toBe('/info')
  })

  it('handles empty mount', () => {
    expect(stripMountPath('/raw/abc', '')).toBe('/raw/abc')
  })
})

describe('forwardFetchRequest path stripping', () => {
  it('forwards stripped path over a mock tunnel session', async () => {
    const [client, server] = duplexPair()

    const session: TunnelSession = {
      key: 'test',
      runOnTunnel: async (fn) => fn(client),
      forwardHttp: async (meta, body) => {
        await writeTunnelRequest(client, meta, body)
        return readTunnelResponse(client)
      },
      close: async () => {},
    }

    const serverDone = (async () => {
      const req = await readTunnelRequest(server)
      expect(req.meta.method).toBe('GET')
      expect(req.meta.path).toBe('/info')
      await writeTunnelResponse(
        server,
        { status: 200, headers: { 'content-type': 'application/json' } },
        Buffer.from('{"ok":true}'),
      )
    })()

    const response = await forwardFetchRequest(
      session,
      new Request('http://localhost/api/seed-gateway/info'),
      '/api/seed-gateway',
    )
    await serverDone

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"ok":true}')
  })
})

describe('header helpers', () => {
  it('flattens and filters hop-by-hop headers', () => {
    expect(
      flattenRequestHeaders({ accept: 'application/json', 'x-custom': ['a', 'b'] }),
    ).toEqual({ accept: 'application/json', 'x-custom': 'a, b' })
    expect(
      filterResponseHeaders({
        'content-type': 'text/plain',
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
      }),
    ).toEqual({ 'content-type': 'text/plain' })
  })
})
