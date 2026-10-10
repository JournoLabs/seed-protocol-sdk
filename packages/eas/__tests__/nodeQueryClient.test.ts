import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodeQueryClient } from '../src/node/QueryClient.js'
import { configureEasReadChain, resetEasReadChain } from '../src/easEndpoint.js'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('NodeQueryClient', () => {
  afterEach(() => {
    resetEasReadChain()
  })

  it('shares one fetch between concurrent requests with the same key', async () => {
    const client = new NodeQueryClient().getQueryClient()
    const response = deferred<string>()
    const queryFn = vi.fn(() => response.promise)

    const a = client.fetchQuery({ queryKey: ['seeds', ['0x1']], queryFn })
    const b = client.fetchQuery({ queryKey: ['seeds', ['0x1']], queryFn })
    response.resolve('result')

    expect(await Promise.all([a, b])).toEqual(['result', 'result'])
    expect(queryFn).toHaveBeenCalledTimes(1)
  })

  it('does not share between different keys', async () => {
    const client = new NodeQueryClient().getQueryClient()
    const queryFn = vi.fn(async () => 'x')
    await Promise.all([
      client.fetchQuery({ queryKey: ['seeds', ['0x1']], queryFn }),
      client.fetchQuery({ queryKey: ['seeds', ['0x2']], queryFn }),
    ])
    expect(queryFn).toHaveBeenCalledTimes(2)
  })

  it('fetches again once a request settled, unless a staleTime was given', async () => {
    const client = new NodeQueryClient().getQueryClient()
    const queryFn = vi.fn(async () => 'x')

    await client.fetchQuery({ queryKey: ['fresh'], queryFn })
    await client.fetchQuery({ queryKey: ['fresh'], queryFn })
    expect(queryFn).toHaveBeenCalledTimes(2)
    // Dropped on the next tick (gcTime 0 is a zero-delay timer).
    await new Promise((r) => setTimeout(r, 0))
    expect(client.getQueryData(['fresh'])).toBeUndefined()

    queryFn.mockClear()
    await client.fetchQuery({ queryKey: ['kept'], queryFn, staleTime: 60_000 })
    await client.fetchQuery({ queryKey: ['kept'], queryFn, staleTime: 60_000 })
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(['kept'])).toBe('x')
    await client.removeQueries({ queryKey: ['kept'] })
    expect(client.getQueryData(['kept'])).toBeUndefined()
  })

  it('never shares a request between EAS endpoints', async () => {
    const client = new NodeQueryClient().getQueryClient()
    const first = deferred<string>()
    const queryFn = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce('chain 2')

    configureEasReadChain('sdk', { indexerUrl: 'https://one.example/graphql' })
    const a = client.fetchQuery({ queryKey: ['seeds'], queryFn })
    configureEasReadChain('sdk', { indexerUrl: 'https://two.example/graphql' })
    const b = client.fetchQuery({ queryKey: ['seeds'], queryFn })
    first.resolve('chain 1')

    expect(await Promise.all([a, b])).toEqual(['chain 1', 'chain 2'])
  })

  it('does not retry a failed request', async () => {
    const client = new NodeQueryClient().getQueryClient()
    const queryFn = vi.fn(async () => {
      throw new Error('indexer down')
    })
    await expect(client.fetchQuery({ queryKey: ['fails'], queryFn })).rejects.toThrow('indexer down')
    expect(queryFn).toHaveBeenCalledTimes(1)
  })
})
