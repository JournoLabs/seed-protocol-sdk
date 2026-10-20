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
    evm: { eth: '0', usd: 0, gas: 1n, userPays: true },
    arweave: {
      ar: '0',
      usd: 0,
      bytes: 0,
      uploadCount: 0,
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
})
