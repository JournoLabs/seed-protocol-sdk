import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, appState } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { setRevokeExecutor } from '@/helpers/publishConfig'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createPublishedItemForUnpublish,
  UNPUBLISH_TEST_PUBLISHER,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { createTestRevokeExecutor } from '../test-utils/testRevokeExecutor'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('Item.unpublish integration', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 90000,
      configOverrides: {
        addresses: [UNPUBLISH_TEST_PUBLISHER],
      },
    })
    await createGetPublishPayloadTestSchema()
    setRevokeExecutor(createTestRevokeExecutor())
  }, 90000)

  afterAll(async () => {
    setRevokeExecutor(null)
    await teardownTestEnvironment()
  })

  it('unpublish updates local state (revokedAt, isRevoked)', async () => {
    const { item } = await createPublishedItemForUnpublish({ title: 'Unpublish local state test' })
    expect(item.seedUid).toBeDefined()
    expect(item.schemaUid).toBeDefined()
    expect(item.revokedAt).toBeUndefined()
    expect(item.isRevoked).toBe(false)

    await item.unpublish()

    expect(item.revokedAt).toBeDefined()
    expect(typeof item.revokedAt).toBe('number')
    expect(item.revokedAt!).toBeGreaterThan(0)
    expect(item.isRevoked).toBe(true)
  }, 30000)

  it('unpublish updates DB (seeds.revokedAt)', async () => {
    const { item, seedLocalId } = await createPublishedItemForUnpublish({ title: 'Unpublish DB test' })
    const db = BaseDb.getAppDb()
    const beforeRows = await db
      .select({ revokedAt: seeds.revokedAt })
      .from(seeds)
      .where(eq(seeds.localId, seedLocalId))
      .limit(1)
    expect(beforeRows[0].revokedAt).toBeNull()

    await item.unpublish()

    const afterRows = await db
      .select({ revokedAt: seeds.revokedAt })
      .from(seeds)
      .where(eq(seeds.localId, seedLocalId))
      .limit(1)
    expect(afterRows[0].revokedAt).toBeDefined()
    expect(typeof afterRows[0].revokedAt).toBe('number')
    expect(afterRows[0].revokedAt!).toBeGreaterThan(0)
  }, 30000)

  it('unpublish throws when not published (no seedUid)', async () => {
    const { createItemWithBasicPropertiesOnly } = await import(
      '../test-utils/getPublishPayloadIntegrationHelpers'
    )
    const { item } = await createItemWithBasicPropertiesOnly({ title: 'Never published' })
    expect(item.seedUid).toBeFalsy()

    await expect(item.unpublish()).rejects.toThrow('Item is not published. Cannot unpublish.')
  }, 30000)

  it('unpublish throws when revoke not configured', async () => {
    const { item } = await createPublishedItemForUnpublish({ title: 'Revoke not configured test' })
    setRevokeExecutor(null)
    try {
      await expect(item.unpublish()).rejects.toThrow(
        'Revocation is not configured. Call initPublish() from @seedprotocol/publish or ensure PublishProvider is mounted with config.'
      )
    } finally {
      setRevokeExecutor(createTestRevokeExecutor())
    }
  }, 30000)

  it('unpublish throws when not owned', async () => {
    const otherPublisher = '0x' + 'f'.repeat(40)
    const { item } = await createPublishedItemForUnpublish({
      title: 'Not owned test',
      publisher: otherPublisher,
    })
    expect(item.seedUid).toBeDefined()
    expect(item.schemaUid).toBeDefined()

    // Ensure owned addresses exclude the item's publisher (clear addresses so only we "own" nothing from this item)
    const db = BaseDb.getAppDb()
    await db
      .update(appState)
      .set({ value: JSON.stringify({ owned: [], watched: [] }) })
      .where(eq(appState.key, 'addresses'))

    await expect(item.unpublish()).rejects.toThrow('Item is read-only: you do not own this item')

    // Restore addresses for subsequent tests
    await db
      .update(appState)
      .set({ value: JSON.stringify({ owned: [UNPUBLISH_TEST_PUBLISHER], watched: [] }) })
      .where(eq(appState.key, 'addresses'))
  }, 30000)

  it('unpublish throws when no schema UID', async () => {
    const { item, seedLocalId } = await createPublishedItemForUnpublish({
      title: 'No schema UID test',
    })
    const db = BaseDb.getAppDb()
    await db.update(seeds).set({ schemaUid: null, updatedAt: Date.now() }).where(eq(seeds.localId, seedLocalId))
    item.getService().send({ type: 'updateContext', schemaUid: undefined })

    await expect(item.unpublish()).rejects.toThrow('Item has no schema UID. Cannot unpublish.')
  }, 30000)
})
