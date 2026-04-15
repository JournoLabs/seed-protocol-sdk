import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as getPublishUploadDataModule from '../helpers/getPublishUploadData'
import { executeCreateArweaveDataItemsPhase2 } from './createArweaveDataItemsPhase2'
import type { PublishMachineContext } from '../../../types'

vi.mock('~/config', () => ({
  getPublishConfig: vi.fn(() => ({
    signDataItems: async (uploads: { versionLocalId: string; itemPropertyName: string }[]) =>
      uploads.map((u) => ({
        transaction: { id: `tx-${u.versionLocalId}` },
        versionId: u.versionLocalId,
        modelName: u.itemPropertyName,
      })),
    dataItemSigner: undefined,
  })),
}))

describe('executeCreateArweaveDataItemsPhase2', () => {
  beforeEach(() => {
    vi.spyOn(getPublishUploadDataModule, 'getPublishUploadData').mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls getPublishUploadData with onlyHtmlStorageSeedLocalIds and skipRelationRecursion', async () => {
    const item = {
      seedLocalId: 'parent1',
      getPublishUploads: () => [],
    } as unknown as PublishMachineContext['item']

    await executeCreateArweaveDataItemsPhase2({
      item,
      htmlEmbeddedDeferredHtmlSeedLocalIds: ['htmlSeedA', 'htmlSeedB'],
    } as PublishMachineContext)

    expect(getPublishUploadDataModule.getPublishUploadData).toHaveBeenCalledWith(
      item,
      [],
      undefined,
      expect.objectContaining({
        onlyHtmlStorageSeedLocalIds: ['htmlSeedA', 'htmlSeedB'],
        skipRelationRecursion: true,
      }),
    )
  })

  it('forwards arweaveUploadTags when set on context', async () => {
    const item = {
      seedLocalId: 'parent1',
      getPublishUploads: () => [],
    } as unknown as PublishMachineContext['item']

    await executeCreateArweaveDataItemsPhase2({
      item,
      htmlEmbeddedDeferredHtmlSeedLocalIds: ['h1'],
      arweaveUploadTags: [{ name: 'App-Name', value: 'Test' }],
    } as PublishMachineContext)

    expect(getPublishUploadDataModule.getPublishUploadData).toHaveBeenCalledWith(
      item,
      [],
      undefined,
      expect.objectContaining({
        arweaveUploadTags: [{ name: 'App-Name', value: 'Test' }],
      }),
    )
  })

  it('returns empty result when phase-2 upload list is empty', async () => {
    const item = {
      seedLocalId: 'parent1',
      getPublishUploads: () => [],
    } as unknown as PublishMachineContext['item']

    const out = await executeCreateArweaveDataItemsPhase2({
      item,
      htmlEmbeddedDeferredHtmlSeedLocalIds: ['h1'],
    } as PublishMachineContext)

    expect(out.arweaveTransactions).toEqual([])
    expect(out.publishUploads).toEqual([])
    expect(out.signedDataItems).toBeUndefined()
  })

  it('signs non-empty upload list via signDataItems from config', async () => {
    vi.spyOn(getPublishUploadDataModule, 'getPublishUploadData').mockResolvedValue([
      {
        data: new Uint8Array([1, 2, 3]),
        tags: [],
        itemPropertyName: 'bodyHtml',
        itemPropertyLocalId: 'pl1',
        seedLocalId: 'htmlStorage1',
        versionLocalId: 'v1',
      },
    ] as Awaited<ReturnType<typeof getPublishUploadDataModule.getPublishUploadData>>)

    const item = {
      seedLocalId: 'parent1',
      getPublishUploads: () => [],
    } as unknown as PublishMachineContext['item']

    const out = await executeCreateArweaveDataItemsPhase2({
      item,
      htmlEmbeddedDeferredHtmlSeedLocalIds: ['h1'],
    } as PublishMachineContext)

    expect(out.arweaveTransactions).toHaveLength(1)
    expect(out.arweaveTransactions[0]!.transaction.id).toBe('tx-v1')
    expect(out.publishUploads[0]!.seedLocalId).toBe('htmlStorage1')
  })
})
