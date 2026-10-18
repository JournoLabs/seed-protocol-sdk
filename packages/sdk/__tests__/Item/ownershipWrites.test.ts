import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { client } from '@/client'
import { setGetPublisherForNewSeeds } from '@/helpers/publishConfig'
import { OwnershipError } from '@/helpers/ownership'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
  UNPUBLISH_TEST_PUBLISHER,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const OTHER_PUBLISHER = '0x' + 'f'.repeat(40)

async function createDraftStampedBy(publisher: string | null, title: string) {
  setGetPublisherForNewSeeds(publisher ? async () => publisher : null)
  try {
    return (await createItemWithBasicPropertiesOnly({ title })).item
  } finally {
    setGetPublisherForNewSeeds(null)
  }
}

async function storedTitles(seedLocalId: string): Promise<string[]> {
  const rows = await BaseDb.getAppDb()!
    .select({ value: metadata.propertyValue })
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'title')))
  return rows.map((row: { value: string | null }) => row.value ?? '')
}

testDescribe('writes check ownership', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
      configOverrides: { addresses: [UNPUBLISH_TEST_PUBLISHER] },
    })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('assigning a property on an item you do not own is refused and rolled back', async () => {
    const item = await createDraftStampedBy(OTHER_PUBLISHER, 'Not mine')
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'title' })
    expect(property).toBeDefined()

    property!.value = 'Overwritten'

    await vi.waitFor(() => {
      const context = property!.getService().getSnapshot().context
      expect(context._saveError?.name).toBe('OwnershipError')
      expect(context.isSaving).toBe(false)
    })
    expect(property!.value).toBe('Not mine')
    expect(await storedTitles(item.seedLocalId)).not.toContain('Overwritten')
  }, 30000)

  it('assigning a property on an item you own still saves', async () => {
    const item = await createDraftStampedBy(UNPUBLISH_TEST_PUBLISHER, 'Mine')
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'title' })

    property!.value = 'Edited'

    await vi.waitFor(async () => expect(await storedTitles(item.seedLocalId)).toContain('Edited'))
    expect(property!.getService().getSnapshot().context._saveError ?? null).toBeNull()
  }, 30000)

  it('ItemProperty.destroy refuses an item you do not own and keeps its rows', async () => {
    const item = await createDraftStampedBy(OTHER_PUBLISHER, 'Keep me')
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'title' })

    await expect(property!.destroy()).rejects.toBeInstanceOf(OwnershipError)
    expect(await storedTitles(item.seedLocalId)).toContain('Keep me')
  }, 30000)

  it('claimUnpublishedDrafts updates publisher on loaded items', async () => {
    // With a single owned address a new draft is that address's; with two it gets no publisher
    // (which one publishes isn't known), so there is something to claim.
    await client.setAddresses({ owned: [UNPUBLISH_TEST_PUBLISHER, OTHER_PUBLISHER], watched: [] })
    try {
      const item = await createDraftStampedBy(null, 'Unclaimed draft')
      expect(item.publisher).toBeUndefined()

      await client.claimUnpublishedDrafts(UNPUBLISH_TEST_PUBLISHER)

      expect(item.publisher).toBe(UNPUBLISH_TEST_PUBLISHER.toLowerCase())
    } finally {
      await client.setAddresses({ owned: [UNPUBLISH_TEST_PUBLISHER], watched: [] })
    }
  }, 30000)
})
