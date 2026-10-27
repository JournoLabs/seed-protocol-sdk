import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import type { IItem } from '@seedprotocol/sdk'
import { itemPublishFingerprint, watchPublishCost } from './watchPublishCost'
import type { PublishCostEstimate } from './types'

// Lets the mocked estimate/reprice promises settle. Timers are fake, so time only moves via advance().
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms)
  await flush()
}

function makeEstimate(totalUsd: number): PublishCostEstimate {
  return {
    totalUsd,
    evm: { eth: '0', usd: 0, gas: 1n, userPays: true, testnet: false },
    arweave: {
      ar: '0',
      usd: 0,
      bytes: 0,
      chargedBytes: 0,
      uploadCount: 0,
      uploadTo: 'upload-api',
      freeBytes: 0,
      path: 'bundler',
      userPays: true,
    },
    prices: { ethUsd: 1, arUsd: 1, fetchedAt: Date.now() },
    work: {
      publishMode: 'patch',
      seedCount: 1,
      newSeedCount: 1,
      newVersionCount: 1,
      attestationCount: 1,
      uploadCount: 0,
      uploadBytes: 0,
    },
    estimatedAt: Date.now(),
  }
}

function createMockItem(initialTitle = 'hello') {
  const state = { title: initialTitle }
  const listeners = new Set<(ctx: unknown) => void>()
  const item = {
    seedLocalId: 'item1234567',
    seedUid: '',
    latestVersionLocalId: 'ver12345678',
    properties: [
      {
        propertyName: 'title',
        uid: '',
        get value() {
          return state.title
        },
        getService: () => ({
          getSnapshot: () => ({ context: { propertyValue: state.title } }),
        }),
      },
    ],
    subscribe: (cb: (ctx: unknown) => void) => {
      listeners.add(cb)
      return { unsubscribe: () => listeners.delete(cb) }
    },
    setTitle(next: string) {
      state.title = next
      listeners.forEach((cb) => cb({}))
    },
  }
  return item as unknown as IItem<any> & { setTitle: (next: string) => void }
}

describe('itemPublishFingerprint', () => {
  test('changes when a property value changes', () => {
    const item = createMockItem('a')
    const first = itemPublishFingerprint(item)
    item.setTitle('b')
    expect(itemPublishFingerprint(item)).not.toBe(first)
  })
})

describe('watchPublishCost', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('emits an immediate first estimate', async () => {
    const item = createMockItem()
    const totals: number[] = []
    const handle = watchPublishCost(
      item,
      (snapshot) => {
        if (snapshot.estimate) totals.push(snapshot.estimate.totalUsd)
      },
      {
        itemIdleMs: 10_000,
        priceRefreshMs: 0,
        estimate: async () => makeEstimate(4),
      },
    )
    await flush()
    expect(totals).toContain(4)
    handle.dispose()
  })

  test('restarts the idle timer when the item changes', async () => {
    const item = createMockItem()
    let estimateCalls = 0
    const handle = watchPublishCost(
      item,
      () => {},
      {
        itemIdleMs: 80,
        priceRefreshMs: 0,
        estimate: async () => {
          estimateCalls += 1
          return makeEstimate(estimateCalls)
        },
      },
    )
    await flush()
    expect(estimateCalls).toBe(1)
    item.setTitle('edit-1')
    await advance(40)
    item.setTitle('edit-2')
    // 80ms after edit-1, but only 40ms after edit-2 restarted the timer
    await advance(40)
    expect(estimateCalls).toBe(1)
    await advance(40)
    expect(estimateCalls).toBe(2)
    handle.dispose()
  })

  test('price refresh reprices without re-summarizing', async () => {
    const item = createMockItem()
    let estimateCalls = 0
    let repriceCalls = 0
    let lastTotal = 0
    const handle = watchPublishCost(
      item,
      (snapshot) => {
        if (snapshot.estimate) lastTotal = snapshot.estimate.totalUsd
      },
      {
        itemIdleMs: 10_000,
        priceRefreshMs: 40,
        estimate: async () => {
          estimateCalls += 1
          return makeEstimate(1)
        },
        reprice: async (prev) => {
          repriceCalls += 1
          return { ...prev, totalUsd: 99 }
        },
      },
    )
    await flush()
    expect(estimateCalls).toBe(1)
    await advance(40)
    expect(estimateCalls).toBe(1)
    expect(repriceCalls).toBeGreaterThanOrEqual(1)
    expect(lastTotal).toBe(99)
    handle.dispose()
  })

  test('shows the previous estimate as stale until the first estimate arrives', async () => {
    const item = createMockItem()
    const snapshots: Array<{ total: number | null; isStale: boolean }> = []
    let resolveEstimate: (estimate: PublishCostEstimate) => void = () => {}
    const handle = watchPublishCost(
      item,
      (snapshot) => {
        snapshots.push({ total: snapshot.estimate?.totalUsd ?? null, isStale: snapshot.isStale })
      },
      {
        itemIdleMs: 10_000,
        priceRefreshMs: 0,
        previousEstimate: makeEstimate(3),
        estimate: () => new Promise((resolve) => (resolveEstimate = resolve)),
      },
    )
    await flush()
    expect(snapshots).toEqual([{ total: 3, isStale: true }])
    resolveEstimate(makeEstimate(5))
    await flush()
    expect(snapshots.at(-1)).toEqual({ total: 5, isStale: false })
    handle.dispose()
  })

  test('retries a failed first estimate once, still estimating meanwhile', async () => {
    const item = createMockItem()
    const snapshots: Array<{ total: number | null; isEstimating: boolean; error: Error | null }> = []
    let estimateCalls = 0
    const handle = watchPublishCost(
      item,
      (snapshot) => {
        snapshots.push({
          total: snapshot.estimate?.totalUsd ?? null,
          isEstimating: snapshot.isEstimating,
          error: snapshot.error,
        })
      },
      {
        itemIdleMs: 10_000,
        priceRefreshMs: 0,
        firstEstimateRetryMs: 50,
        estimate: async () => {
          estimateCalls += 1
          if (estimateCalls === 1) throw new Error('rpc down')
          return makeEstimate(7)
        },
      },
    )
    await flush()
    expect(estimateCalls).toBe(1)
    expect(snapshots.at(-1)).toEqual({ total: null, isEstimating: true, error: null })
    await advance(50)
    expect(estimateCalls).toBe(2)
    expect(snapshots.at(-1)).toEqual({ total: 7, isEstimating: false, error: null })
    expect(snapshots.some((s) => s.error)).toBe(false)
    handle.dispose()
  })

  test('reports the error when the retry fails too, and retries only once', async () => {
    const item = createMockItem()
    let lastError = null as Error | null
    let isEstimating = true
    let estimateCalls = 0
    const handle = watchPublishCost(
      item,
      (snapshot) => {
        lastError = snapshot.error
        isEstimating = snapshot.isEstimating
      },
      {
        itemIdleMs: 10_000,
        priceRefreshMs: 0,
        firstEstimateRetryMs: 50,
        estimate: async () => {
          estimateCalls += 1
          throw new Error(`fail ${estimateCalls}`)
        },
      },
    )
    await flush()
    await advance(50)
    expect(estimateCalls).toBe(2)
    expect(lastError?.message).toBe('fail 2')
    expect(isEstimating).toBe(false)
    await advance(500)
    expect(estimateCalls).toBe(2)
    handle.dispose()
  })

  test('does not retry after an estimate has succeeded', async () => {
    const item = createMockItem()
    let lastError = null as Error | null
    let estimateCalls = 0
    const handle = watchPublishCost(
      item,
      (snapshot) => {
        lastError = snapshot.error
      },
      {
        itemIdleMs: 0,
        priceRefreshMs: 0,
        firstEstimateRetryMs: 50,
        estimate: async () => {
          estimateCalls += 1
          if (estimateCalls > 1) throw new Error('later failure')
          return makeEstimate(1)
        },
      },
    )
    await flush()
    item.setTitle('edit')
    await flush()
    expect(estimateCalls).toBe(2)
    expect(lastError?.message).toBe('later failure')
    await advance(500)
    expect(estimateCalls).toBe(2)
    handle.dispose()
  })

  test('dispose cancels a pending retry', async () => {
    const item = createMockItem()
    let estimateCalls = 0
    const handle = watchPublishCost(item, () => {}, {
      itemIdleMs: 10_000,
      priceRefreshMs: 0,
      firstEstimateRetryMs: 50,
      estimate: async () => {
        estimateCalls += 1
        throw new Error('rpc down')
      },
    })
    await flush()
    handle.dispose()
    await advance(500)
    expect(estimateCalls).toBe(1)
  })

  test('re-estimates on row writes once it watches rows, not on item updates', async () => {
    const item = createMockItem()
    let rowWrite: (() => void) | undefined
    let unwatched = 0
    let estimateCalls = 0
    const handle = watchPublishCost(item, () => {}, {
      itemIdleMs: 0,
      priceRefreshMs: 0,
      estimate: async () => {
        estimateCalls += 1
        return makeEstimate(estimateCalls)
      },
      watchRows: async (_item, onChange) => {
        rowWrite = onChange
        return () => {
          unwatched += 1
        }
      },
    })
    await flush()
    expect(estimateCalls).toBe(1)
    // The loaded value changes before the row is written: the row write is what counts
    item.setTitle('edit')
    await flush()
    expect(estimateCalls).toBe(1)
    rowWrite!()
    await flush()
    expect(estimateCalls).toBe(2)
    handle.dispose()
    expect(unwatched).toBe(1)
  })

  test('compares item values when it cannot watch rows', async () => {
    const item = createMockItem()
    let estimateCalls = 0
    const handle = watchPublishCost(item, () => {}, {
      itemIdleMs: 0,
      priceRefreshMs: 0,
      estimate: async () => {
        estimateCalls += 1
        return makeEstimate(estimateCalls)
      },
      watchRows: async () => null,
    })
    await flush()
    item.setTitle('edit')
    await flush()
    expect(estimateCalls).toBe(2)
    handle.dispose()
  })
})
