import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEasGraphQLClient } from '../src/EasClient/createEasGraphQLClient'

/** A fetch that never answers, and rejects once its signal aborts. */
const stalledFetch = vi.fn(
  (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    }),
)

const realAny = AbortSignal.any
const realTimeout = AbortSignal.timeout

afterEach(() => {
  vi.unstubAllGlobals()
  stalledFetch.mockClear()
  AbortSignal.any = realAny
  AbortSignal.timeout = realTimeout
})

describe('createEasGraphQLClient', () => {
  it('aborts a request the indexer never answers', async () => {
    vi.stubGlobal('fetch', stalledFetch)
    const client = createEasGraphQLClient('https://indexer.example.com/graphql', 50)
    await expect(client.request('{ schemas { id } }')).rejects.toThrow()
    expect(stalledFetch).toHaveBeenCalledTimes(1)
  })

  it("keeps the timeout with a caller's signal where AbortSignal.any and AbortSignal.timeout don't exist", async () => {
    vi.stubGlobal('fetch', stalledFetch)
    // Older runtimes (Safari before 17.4, Node before 20.3).
    Object.assign(AbortSignal, { any: undefined, timeout: undefined })
    const client = createEasGraphQLClient('https://indexer.example.com/graphql', 50)
    const caller = new AbortController()
    await expect(client.request({ document: '{ schemas { id } }', signal: caller.signal })).rejects.toThrow(
      /timed out after 50 ms/,
    )
  })

  it("aborts when the caller's signal does", async () => {
    vi.stubGlobal('fetch', stalledFetch)
    const client = createEasGraphQLClient('https://indexer.example.com/graphql', 10_000)
    const caller = new AbortController()
    const pending = client.request({ document: '{ schemas { id } }', signal: caller.signal })
    caller.abort(new Error('caller gave up'))
    await expect(pending).rejects.toThrow(/caller gave up/)
  })

  it('returns the answer when the indexer replies in time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: { schemas: [] } }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const client = createEasGraphQLClient('https://indexer.example.com/graphql', 50)
    expect(await client.request('{ schemas { id } }')).toEqual({ schemas: [] })
  })
})
