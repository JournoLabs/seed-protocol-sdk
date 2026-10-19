import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, pendingWrites, seeds } from '@/seedSchema'
import { client } from '@/client'
import { setGetPublisherForNewSeeds } from '@/helpers/publishConfig'
import { OwnershipError } from '@/helpers/ownership'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { appendOutboxOp, getOutboxOps, OutboxOpFailedError, startItemOutbox, waitForOutboxOp } from '@/outbox'
import { outboxIdleForTests, pauseOutboxDrainForTests } from '@/outbox/outbox'
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

  afterEach(async () => {
    pauseOutboxDrainForTests(false)
    await outboxIdleForTests()
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const pendingOpsFor = (seedLocalId: string) =>
    BaseDb.getAppDb()!
      .select()
      .from(pendingWrites)
      .where(and(eq(pendingWrites.seedLocalId, seedLocalId), eq(pendingWrites.status, 'pending')))
  const setSeedPublisher = (seedLocalId: string, publisher: string) =>
    BaseDb.getAppDb()!.update(seeds).set({ publisher }).where(eq(seeds.localId, seedLocalId))

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

  it('an edit appended while owned fails when the drainer finds the item no longer owned', async () => {
    const item = await createDraftStampedBy(UNPUBLISH_TEST_PUBLISHER, 'Was mine')
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'title' })
    startItemOutbox()
    pauseOutboxDrainForTests(true)

    property!.value = 'Edited before the handover'
    await vi.waitFor(async () => expect(await pendingOpsFor(item.seedLocalId)).toHaveLength(1))
    const [op] = await pendingOpsFor(item.seedLocalId)
    await setSeedPublisher(item.seedLocalId, OTHER_PUBLISHER)
    pauseOutboxDrainForTests(false)

    await vi.waitFor(() => {
      const context = property!.getService().getSnapshot().context
      expect(context._saveError?.name).toBe('OwnershipError')
      expect(context.isSaving).toBe(false)
    })
    const [settled] = await getOutboxOps([op.opId])
    expect(settled.status).toBe('failed')
    expect(settled.errorName).toBe('OwnershipError')
    expect(settled.attempts).toBe(1)
    expect(await storedTitles(item.seedLocalId)).not.toContain('Edited before the handover')
  }, 30000)

  it('a delete op for an item you do not own fails and keeps its rows', async () => {
    const item = await createDraftStampedBy(OTHER_PUBLISHER, 'Not deleted')
    startItemOutbox()

    const opId = await appendOutboxOp({ seedLocalId: item.seedLocalId, kind: 'delete', value: { mode: 'item' } })
    const failure = await waitForOutboxOp(opId).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(OutboxOpFailedError)
    expect((failure as OutboxOpFailedError).errorName).toBe('OwnershipError')
    const [seed] = await BaseDb.getAppDb()!
      .select({ marked: seeds._markedForDeletion })
      .from(seeds)
      .where(eq(seeds.localId, item.seedLocalId))
    expect(seed.marked ?? 0).toBe(0)
  }, 30000)
})
