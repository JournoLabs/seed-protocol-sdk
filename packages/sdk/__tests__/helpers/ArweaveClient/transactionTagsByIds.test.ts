import { describe, expect, it, vi } from 'vitest'
import { GET_TRANSACTIONS_TAGS_BY_IDS, getTransactionTagsByIds } from '@seedprotocol/arweave'

const id = (n: number) => `tx${String(n).padStart(41, '0')}`

/** GraphQL client stand-in answering `transactions(ids:)` for every id except `missing`. */
const fakeClient = (opts: { missing?: Set<string>; failBatch?: number } = {}) => {
  let call = 0
  const request = vi.fn(async (_doc: string, vars: { ids: string[]; first: number }) => {
    call += 1
    if (opts.failBatch === call) throw new Error('gateway 502')
    return {
      transactions: {
        edges: vars.ids
          .filter((txId) => !opts.missing?.has(txId))
          .map((txId) => ({ node: { id: txId, tags: [{ name: 'Content-SHA-256', value: `hash-${txId}` }] } })),
      },
    }
  })
  return { request } as any
}

describe('getTransactionTagsByIds', () => {
  it('fetches in batches of at most 100 with the ids filter, keyed by id', async () => {
    const ids = Array.from({ length: 230 }, (_, i) => id(i))
    const client = fakeClient()
    const tags = await getTransactionTagsByIds([...ids, ids[0]!], { client })

    expect(client.request).toHaveBeenCalledTimes(3)
    expect(client.request.mock.calls.map((c: any[]) => c[1].ids.length)).toEqual([100, 100, 30])
    expect(client.request.mock.calls[0][0]).toBe(GET_TRANSACTIONS_TAGS_BY_IDS)
    expect(client.request.mock.calls[0][1].first).toBe(100)
    expect(tags.size).toBe(230)
    expect(tags.get(id(129))).toEqual([{ name: 'Content-SHA-256', value: `hash-${id(129)}` }])
  })

  it('leaves out unknown transactions and skips a failed batch instead of throwing', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => id(i))
    const onError = vi.fn()
    const tags = await getTransactionTagsByIds(ids, {
      client: fakeClient({ missing: new Set([id(1)]), failBatch: 2 }),
      batchSize: 2,
      onError,
    })
    // batch 1: 0, 1 (1 unknown); batch 2: 2, 3 (failed); batch 3: 4
    expect([...tags.keys()]).toEqual([id(0), id(4)])
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('makes no request for an empty list', async () => {
    const client = fakeClient()
    expect((await getTransactionTagsByIds([], { client })).size).toBe(0)
    expect(client.request).not.toHaveBeenCalled()
  })
})
