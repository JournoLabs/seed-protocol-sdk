import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { getItemsData } from '@/db/read/getItems'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const VALID_V1 = '0x' + '1'.repeat(64)

async function waitForItemIdle(item: Item<any>, timeout = 15000): Promise<void> {
  const service = item.getService()
  await waitFor(
    service,
    (snapshot) => {
      if (snapshot.value === 'error') throw new Error('Item failed to load')
      return snapshot.value === 'idle'
    },
    { timeout },
  ).catch((err) => {
    if (err?.message === 'Item failed to load') throw err
    throw new Error(`Item loading timeout after ${timeout}ms`)
  })
}

testDescribe('getItemsData', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 90000,
    })
    await createGetPublishPayloadTestSchema()
  }, 90000)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('returns only local items (no seedUid) by default', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Local only test',
      count: 1,
    })
    expect(item.seedLocalId).toBeTruthy()

    const items = await getItemsData({ modelName: 'Post', includeEas: false })
    expect(Array.isArray(items)).toBe(true)
    // All returned items should have no seedUid (local only)
    for (const i of items) {
      expect(i.seedUid === null || i.seedUid === undefined || i.seedUid === '').toBe(true)
    }
    const found = items.find((i) => i.seedLocalId === item.seedLocalId)
    expect(found).toBeDefined()
  })

  it('includes EAS items when includeEas is true', async () => {
    // Create a local item
    await createItemWithBasicPropertiesOnly({
      title: 'Include EAS test',
      count: 1,
    })

    // Manually insert an EAS-style seed (with uid) for testing
    const appDb = BaseDb.getAppDb()
    const easSeedLocalId = 'eas-test-seed-' + Date.now()
    const easSeedUid = '0x' + 'b'.repeat(64)
    await appDb.insert(seeds).values({
      localId: easSeedLocalId,
      uid: easSeedUid,
      type: 'post',
      schemaUid: null,
      createdAt: Date.now(),
    })
    // Need a version for the seed to appear in getItemsData (versionsCount > 0)
    await appDb.insert(versions).values({
      localId: 'eas-test-version-' + Date.now(),
      seedLocalId: easSeedLocalId,
      seedUid: easSeedUid,
      seedType: 'post',
      createdAt: Date.now(),
    })

    const itemsWithEas = await getItemsData({ modelName: 'Post', includeEas: true })
    const easItem = itemsWithEas.find((i) => i.seedUid === easSeedUid)
    expect(easItem).toBeDefined()

    const itemsLocalOnly = await getItemsData({ modelName: 'Post', includeEas: false })
    const easItemInLocalOnly = itemsLocalOnly.find((i) => i.seedUid === easSeedUid)
    expect(easItemInLocalOnly).toBeUndefined()
  })

  it('does not turn publishedVersion* list metadata into ItemProperty or publish attestations', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Published version metadata regression',
      count: 1,
    })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()
    const existing = await db
      .select({ localId: versions.localId })
      .from(versions)
      .where(eq(versions.seedLocalId, seedLocalId))
    const t = Date.now()
    for (const row of existing) {
      await db.delete(versions).where(eq(versions.localId, row.localId!))
    }
    await db.insert(versions).values({
      localId: 'vd-old-' + t,
      seedLocalId,
      seedUid: null,
      seedType: 'post',
      uid: VALID_V1,
      createdAt: t - 3000,
    })
    await db.insert(versions).values({
      localId: 'vd-new-' + t,
      seedLocalId,
      seedUid: null,
      seedType: 'post',
      uid: 'NULL',
      createdAt: t - 500,
    })

    const items = await getItemsData({ modelName: 'Post', includeEas: false })
    const row = items.find((i) => i.seedLocalId === seedLocalId)
    expect(row?.publishedVersionUid).toBe(VALID_V1)
    expect(row?.publishedVersionLocalId).toBe('vd-old-' + t)

    // Bypass Item.instanceCache so constructor runs with list-row props (regression target).
    item.unload()

    const fromListRow = await Item.create({
      ...row,
      modelName: 'Post',
    })
    await waitForItemIdle(fromListRow)

    expect(Object.keys(fromListRow.allProperties)).not.toContain('publishedVersionUid')
    expect(Object.keys(fromListRow.allProperties)).not.toContain('publishedVersionLocalId')
    expect(fromListRow.properties.map((p) => p.propertyName)).not.toContain('publishedVersionUid')
    expect(fromListRow.properties.map((p) => p.propertyName)).not.toContain('publishedVersionLocalId')

    const publishBlob = JSON.stringify(await fromListRow.getPublishPayload([]), (_, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    )
    expect(publishBlob).not.toContain('published_version_uid')
    expect(publishBlob).not.toContain('published_version_local')
    expect(publishBlob).not.toContain('publishedVersionUid')
    expect(publishBlob).not.toContain('publishedVersionLocalId')
  })
})
