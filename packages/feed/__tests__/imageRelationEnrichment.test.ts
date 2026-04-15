import { describe, it, expect } from 'vitest'
import { enrichImageSeedCloneForFeed } from '../src/imageRelationEnrichment'

describe('enrichImageSeedCloneForFeed', () => {
  it('sets arweaveUrl from storageTransactionId', () => {
    const clone: Record<string, unknown> = {
      seedUid: '0xabc',
      storageTransactionId: 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY',
    }
    enrichImageSeedCloneForFeed(clone)
    expect(typeof clone.arweaveUrl).toBe('string')
    expect(String(clone.arweaveUrl)).toContain('JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY')
  })

  it('sets arweaveUrl from storage_transaction_id when camelCase absent', () => {
    const clone: Record<string, unknown> = {
      seedUid: '0xabc',
      storage_transaction_id: '05eY_BXxztbTacIqutY1S5FUXgzq4ock3x2pDHMQqmY',
    }
    enrichImageSeedCloneForFeed(clone)
    expect(typeof clone.arweaveUrl).toBe('string')
    expect(String(clone.arweaveUrl)).toContain('05eY_BXxztbTacIqutY1S5FUXgzq4ock3x2pDHMQqmY')
  })

  it('does not set arweaveUrl when no storage tx', () => {
    const clone: Record<string, unknown> = { seedUid: '0xabc' }
    enrichImageSeedCloneForFeed(clone)
    expect(clone.arweaveUrl).toBeUndefined()
  })
})
