import { beforeEach, describe, expect, mock, test } from 'bun:test'

/**
 * A run replacing a parked one (ADR 0036) reuses the parked run's stored uploads where the property
 * and content hash match; anything else is signed and uploaded again.
 */
const realConfig = await import('../../../config')
mock.module('../../../config', () => ({ ...realConfig, getPublishConfig: () => ({}) }))

/** Ids the blob store still holds. */
let stored = new Set<string>()
const prepare = mock(async (uploads: Array<{ itemPropertyLocalId: string }>) => ({
  ids: uploads.map((u) => `new-${u.itemPropertyLocalId}`),
  pending: uploads.map((u) => ({ id: `new-${u.itemPropertyLocalId}` })),
}))
const assertStored = mock(async (ids: string[]) => {
  const missing = ids.filter((id) => !stored.has(id))
  if (missing.length) throw new Error(`not stored: ${missing.join(', ')}`)
})
mock.module('~/blobStore', () => ({ getBlobStore: () => ({ prepare, assertStored }) }))

const { prepareUploads } = await import('./createArweaveDataItems')

const upload = (itemPropertyLocalId: string, contentHash: string) => ({
  blob: new Blob(['x']),
  contentHash,
  tags: [],
  itemPropertyName: 'storageTransactionId',
  itemPropertyLocalId,
  seedLocalId: `seed-${itemPropertyLocalId}`,
  versionLocalId: `version-${itemPropertyLocalId}`,
})
const parked = (itemPropertyLocalId: string, contentHash: string, txId: string) => ({
  itemPropertyName: 'storageTransactionId',
  itemPropertyLocalId,
  seedLocalId: `seed-${itemPropertyLocalId}`,
  versionLocalId: `version-${itemPropertyLocalId}`,
  transactionToSign: null,
  contentHash,
  txId,
})
const ids = (result: Awaited<ReturnType<typeof prepareUploads>>) => result.arweaveTransactions.map((t) => t.transaction.id)

beforeEach(() => {
  stored = new Set(['old-a', 'old-b'])
  prepare.mockClear()
})

describe('prepareUploads with a replaced run', () => {
  test('a matching stored upload is reused, not signed again', async () => {
    const result = await prepareUploads([upload('a', 'hash-a'), upload('b', 'hash-b')], {
      reusableUploads: [parked('a', 'hash-a', 'old-a'), parked('b', 'hash-b', 'old-b')],
    })
    expect(ids(result)).toEqual(['old-a', 'old-b'])
    expect(prepare).not.toHaveBeenCalled()
    expect(result.bundlerUploadNotNeeded).toBe(true)
    expect(result.publishUploads.map((u) => u.contentHash)).toEqual(['hash-a', 'hash-b'])
  })

  test('an upload whose content hash changed uploads again', async () => {
    const result = await prepareUploads([upload('a', 'hash-a'), upload('b', 'hash-b2')], {
      reusableUploads: [parked('a', 'hash-a', 'old-a'), parked('b', 'hash-b', 'old-b')],
    })
    expect(ids(result)).toEqual(['old-a', 'new-b'])
    expect(prepare.mock.calls[0]![0].map((u) => u.itemPropertyLocalId)).toEqual(['b'])
    expect(result.bundlerUploadNotNeeded).toBe(false)
  })

  test('an upload the blob store no longer holds uploads again', async () => {
    stored.delete('old-b')
    const result = await prepareUploads([upload('a', 'hash-a'), upload('b', 'hash-b')], {
      reusableUploads: [parked('a', 'hash-a', 'old-a'), parked('b', 'hash-b', 'old-b')],
    })
    expect(ids(result)).toEqual(['old-a', 'new-b'])
    expect(prepare.mock.calls[0]![0].map((u) => u.itemPropertyLocalId)).toEqual(['b'])
  })

  test('with nothing to reuse every upload is prepared', async () => {
    const result = await prepareUploads([upload('a', 'hash-a')], {})
    expect(ids(result)).toEqual(['new-a'])
  })
})
