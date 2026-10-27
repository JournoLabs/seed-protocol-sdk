import { describe, expect, test } from 'bun:test'
// @ts-expect-error jsdom ships no types and @types/jsdom isn't installed
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import type { IItem } from '@seedprotocol/sdk'
import type { PublishCostEstimate } from '../services/publishCost/types'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })

const { createRoot } = await import('react-dom/client')
const { usePublishCostEstimate } = await import('./usePublishCostEstimate')

function makeEstimate(totalUsd: number): PublishCostEstimate {
  return { totalUsd } as PublishCostEstimate
}

function mockItem(seedLocalId: string): IItem<any> {
  return {
    seedLocalId,
    seedUid: '',
    latestVersionLocalId: 'ver12345678',
    properties: [],
    subscribe: () => ({ unsubscribe: () => {} }),
  } as unknown as IItem<any>
}

describe('usePublishCostEstimate', () => {
  test('keeps the last estimate across a new Item instance for the same seed', async () => {
    const pending = new Map<IItem<any>, (estimate: PublishCostEstimate) => void>()
    const options = {
      itemIdleMs: 10_000,
      priceRefreshMs: 0,
      estimate: (item: IItem<any>) => new Promise<PublishCostEstimate>((resolve) => pending.set(item, resolve)),
    }
    const seen: Array<number | null> = []
    const Probe = ({ item }: { item: IItem<any> }) => {
      const { estimate } = usePublishCostEstimate(item, options)
      seen.push(estimate?.totalUsd ?? null)
      return null
    }

    const root = createRoot(document.createElement('div'))
    const first = mockItem('seed0000001')
    await act(async () => root.render(<Probe item={first} />))
    await act(async () => pending.get(first)!(makeEstimate(4)))
    expect(seen.at(-1)).toBe(4)

    // Same seed, new instance: the estimate stays while the new watcher's first one runs.
    const replacement = mockItem('seed0000001')
    seen.length = 0
    await act(async () => root.render(<Probe item={replacement} />))
    expect(seen).not.toContain(null)
    await act(async () => pending.get(replacement)!(makeEstimate(6)))
    expect(seen.at(-1)).toBe(6)

    // Another seed starts empty.
    await act(async () => root.render(<Probe item={mockItem('seed0000002')} />))
    expect(seen.at(-1)).toBeNull()

    await act(async () => root.unmount())
  })
  test("shows the caller's previousEstimate, as stale, until the first estimate arrives", async () => {
    let resolveFirst: (estimate: PublishCostEstimate) => void = () => {}
    const options = {
      itemIdleMs: 10_000,
      priceRefreshMs: 0,
      previousEstimate: makeEstimate(3),
      estimate: () => new Promise<PublishCostEstimate>((resolve) => (resolveFirst = resolve)),
    }
    const seen: Array<{ total: number | null; isStale: boolean }> = []
    const Probe = ({ item }: { item: IItem<any> }) => {
      const { estimate, isStale } = usePublishCostEstimate(item, options)
      seen.push({ total: estimate?.totalUsd ?? null, isStale })
      return null
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Probe item={mockItem('seed0000003')} />))
    expect(seen.at(-1)).toEqual({ total: 3, isStale: true })
    await act(async () => resolveFirst(makeEstimate(5)))
    expect(seen.at(-1)).toEqual({ total: 5, isStale: false })

    await act(async () => root.unmount())
  })
})
