import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEasGraphQLClient } from '../src/EasClient/createEasGraphQLClient'

/** A fetch that never answers, and rejects once its signal aborts. */
const stalledFetch = vi.fn(
  (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    }),
)

afterEach(() => {
  vi.unstubAllGlobals()
  stalledFetch.mockClear()
})

describe('createEasGraphQLClient', () => {
  it('aborts a request the indexer never answers', async () => {
    vi.stubGlobal('fetch', stalledFetch)
    const client = createEasGraphQLClient('https://indexer.example.com/graphql', 50)
    await expect(client.request('{ schemas { id } }')).rejects.toThrow()
    expect(stalledFetch).toHaveBeenCalledTimes(1)
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
