import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { inArray } from 'drizzle-orm'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('restoreDataItemIdsOverwrittenByL1', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('puts the attested data item id back, and leaves bundles it can not match', async () => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { metadata, arweaveL1FinalizeJobs } = await import('@/seedSchema')
    const { restoreDataItemIdsOverwrittenByL1 } = await import('@/db/write/restoreDataItemIdsOverwrittenByL1')
    const appDb = BaseDb.getAppDb()
    const now = Date.now()

    const job = (seed: string, dataItemId: string, l1: string) => ({
      seedLocalId: seed,
      versionLocalId: `${seed}-v`,
      dataItemId,
      l1TransactionId: l1,
      bundleId: l1,
      phase: 'confirmed',
      createdAt: now,
      updatedAt: now,
    })
    const row = (localId: string, seed: string, value: string) => ({
      localId,
      seedLocalId: seed,
      versionLocalId: `${seed}-v`,
      propertyName: 'storage_transaction_id',
      propertyValue: value,
      refResolvedValue: `${value}.html`,
      createdAt: now,
    })

    // One file in its bundle: restorable. Two files of one version in a bundle: ambiguous.
    await appDb.insert(arweaveL1FinalizeJobs).values([
      job('l1fix-a', 'DATA_ITEM_A', 'BUNDLE_A'),
      job('l1fix-b', 'DATA_ITEM_B1', 'BUNDLE_B'),
      job('l1fix-b', 'DATA_ITEM_B2', 'BUNDLE_B'),
    ])
    await appDb.insert(metadata).values([
      row('l1fix-row-a', 'l1fix-a', 'BUNDLE_A'),
      row('l1fix-row-b1', 'l1fix-b', 'BUNDLE_B'),
      row('l1fix-row-b2', 'l1fix-b', 'BUNDLE_B'),
    ])

    expect(await restoreDataItemIdsOverwrittenByL1()).toEqual({ restored: 1, ambiguous: 1 })

    const rows = await appDb
      .select()
      .from(metadata)
      .where(inArray(metadata.localId, ['l1fix-row-a', 'l1fix-row-b1', 'l1fix-row-b2']))
    const byId = new Map(rows.map((r: { localId: string }) => [r.localId, r]))
    expect(byId.get('l1fix-row-a')).toMatchObject({ propertyValue: 'DATA_ITEM_A', refResolvedValue: 'DATA_ITEM_A.html' })
    expect(byId.get('l1fix-row-b1')).toMatchObject({ propertyValue: 'BUNDLE_B' })

    expect(await restoreDataItemIdsOverwrittenByL1()).toEqual({ restored: 0, ambiguous: 1 })
  })
})
