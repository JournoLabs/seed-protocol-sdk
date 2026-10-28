import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent, getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici'
import { createEasGraphQLClient } from '../src/EasClient/createEasGraphQLClient'
import { NodeEasClient } from '../src/node/EasClient'
import { createEasNodeDispatcher } from '../src/node/easDispatcher'

const okFetch = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ data: { schemas: [] } }), {
      headers: { 'content-type': 'application/json' },
    }),
)

const dispatcherOfLastCall = () => (okFetch.mock.calls.at(-1)?.[1] as { dispatcher?: unknown } | undefined)?.dispatcher

afterEach(() => {
  vi.unstubAllGlobals()
  okFetch.mockClear()
})

describe('EAS fetch dispatcher', () => {
  it('createEasGraphQLClient passes the dispatcher to fetch', async () => {
    vi.stubGlobal('fetch', okFetch)
    const dispatcher = {}
    await createEasGraphQLClient('https://indexer.example.com/graphql', 50, { dispatcher }).request('{ schemas { id } }')
    expect(dispatcherOfLastCall()).toBe(dispatcher)
  })

  it('createEasGraphQLClient awaits a dispatcher promise before the request', async () => {
    vi.stubGlobal('fetch', okFetch)
    const dispatcher = {}
    await createEasGraphQLClient('https://indexer.example.com/graphql', 50, { dispatcher: Promise.resolve(dispatcher) }).request(
      '{ schemas { id } }',
    )
    expect(dispatcherOfLastCall()).toBe(dispatcher)
  })

  it('createEasGraphQLClient passes none by default', async () => {
    vi.stubGlobal('fetch', okFetch)
    await createEasGraphQLClient('https://indexer.example.com/graphql', 50).request('{ schemas { id } }')
    expect(dispatcherOfLastCall()).toBeUndefined()
  })

  it('NodeEasClient sends requests through an undici Agent with the EAS TLS settings', async () => {
    vi.stubGlobal('fetch', okFetch)
    const client = new NodeEasClient()
    await client.getEasClient().request('{ schemas { id } }')
    await client.getEasClient().request('{ schemas { id } }')
    const first = okFetch.mock.calls[0]?.[1] as { dispatcher?: unknown }
    expect(first.dispatcher).toBeInstanceOf(Agent)
    // One Agent per client, so its connections are reused across requests.
    expect(dispatcherOfLastCall()).toBe(first.dispatcher)
    await (first.dispatcher as Agent).close()
  })

  it('NodeEasClient takes a host dispatcher, or false for fetch defaults', async () => {
    vi.stubGlobal('fetch', okFetch)
    const own = new Agent()
    await new NodeEasClient({ dispatcher: own }).getEasClient().request('{ schemas { id } }')
    expect(dispatcherOfLastCall()).toBe(own)
    await own.close()

    await new NodeEasClient({ dispatcher: false }).getEasClient().request('{ schemas { id } }')
    expect(dispatcherOfLastCall()).toBeUndefined()
  })

  it('createEasNodeDispatcher resolves to undefined under Bun or Deno', async () => {
    const versions = process.versions
    for (const runtime of [{ bun: '1.3.14' }, { deno: '2.5.0' }]) {
      Object.defineProperty(process, 'versions', { value: { ...versions, ...runtime }, configurable: true })
      try {
        await expect(createEasNodeDispatcher()).resolves.toBeUndefined()
      } finally {
        Object.defineProperty(process, 'versions', { value: versions, configurable: true })
      }
    }
  })

  it('createEasNodeDispatcher steps aside for a proxy or mock global dispatcher', async () => {
    const previous = getGlobalDispatcher()
    const mock = new MockAgent()
    setGlobalDispatcher(mock)
    try {
      await expect(createEasNodeDispatcher()).resolves.toBeUndefined()
    } finally {
      setGlobalDispatcher(previous)
      await mock.close()
    }
    const plain = await createEasNodeDispatcher()
    expect(plain).toBeInstanceOf(Agent)
    await plain!.close()
  })
})
