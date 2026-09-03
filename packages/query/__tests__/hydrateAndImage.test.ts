import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BaseArweaveClient } from '@seedprotocol/arweave'
import { enrichImageSeedClone } from '../src/imageRelationEnrichment'
import {
  hydrateArweaveRichTextInItems,
  isArweaveTransactionGatewayUrl,
} from '../src/hydrateArweaveRichText'

describe('enrichImageSeedClone', () => {
  beforeEach(() => {
    BaseArweaveClient.setHost('arweave.net')
  })

  it('adds arweaveUrl from storageTransactionId', () => {
    const clone: Record<string, unknown> = {
      storageTransactionId: 'LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk',
    }
    enrichImageSeedClone(clone)
    expect(clone.arweaveUrl).toBe(
      'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk',
    )
  })
})

describe('hydrateArweaveRichTextInItems', () => {
  beforeEach(() => {
    BaseArweaveClient.setHost('arweave.net')
    vi.restoreAllMocks()
  })

  it('isArweaveTransactionGatewayUrl accepts standard gateway tx URL', () => {
    expect(
      isArweaveTransactionGatewayUrl(
        'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk',
      ),
    ).toBe(true)
  })

  it('replaces gateway html with fetched UTF-8', async () => {
    const url = 'https://arweave.net/LqiubbBd7HAHsntdWbSqn0JoRjPcmZ6TQCNpJPthmAk'
    const html = '<article><p>Hello</p></article>'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
        arrayBuffer: async () => new TextEncoder().encode(html).buffer,
      }),
    )

    const items = [{ html: url }] as Record<string, unknown>[]
    await hydrateArweaveRichTextInItems(items)
    expect(items[0]!.html).toBe(html)
  })
})
