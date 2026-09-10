import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { eventEmitter } from '@/eventBus'
import { LOCAL_COPIES_REMOVED_EVENT } from '@/client/events'
import { Item } from '@/Item/Item'
import {
  arweaveL1FinalizeJobs,
  htmlEmbeddedImageCoPublish,
  metadata,
  publishProcesses,
  seeds,
  versions,
} from '@/seedSchema'
import { eq, inArray } from 'drizzle-orm'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from '../test-utils/client-init'

const ADDR_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const ADDR_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe.sequential('removeLocalCopiesForAddresses', () => {
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 120000,
      configOverrides: {
        syncFromEasOnAddressChange: false,
      },
    })
  }, 120000)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  beforeEach(() => {
    emitSpy = vi.spyOn(eventEmitter, 'emit')
  })

  afterEach(() => {
    emitSpy.mockRestore()
  })

  it('hard-deletes on-chain copies for address, keeps drafts and other publishers, emits event', async () => {
    const { client } = await import('@/client')
    const db = BaseDb.getAppDb()
    const t = Date.now()

    const ownedLocalId = `owned-a-${t}`
    const ownedUid = `0x${'a'.repeat(64)}`
    await db.insert(seeds).values({
      localId: ownedLocalId,
      uid: ownedUid,
      type: 'post',
      publisher: ADDR_A,
      attestationRaw: JSON.stringify({ attester: ADDR_A, id: ownedUid }),
      createdAt: t,
    })
    await db.insert(versions).values({
      localId: `owned-ver-${t}`,
      seedLocalId: ownedLocalId,
      seedUid: ownedUid,
      seedType: 'post',
      createdAt: t,
    })
    await db.insert(metadata).values({
      localId: `owned-meta-${t}`,
      seedLocalId: ownedLocalId,
      seedUid: ownedUid,
      propertyName: 'title',
      propertyValue: 'owned',
      createdAt: t,
    })
    await db.insert(publishProcesses).values({
      seedLocalId: ownedLocalId,
      modelName: 'Post',
      status: 'completed',
      startedAt: t,
      persistedSnapshot: '{}',
      createdAt: t,
      updatedAt: t,
    })
    await db.insert(arweaveL1FinalizeJobs).values({
      seedLocalId: ownedLocalId,
      dataItemId: `data-item-${t}`,
      phase: 'confirmed',
      createdAt: t,
      updatedAt: t,
    })
    await db.insert(htmlEmbeddedImageCoPublish).values({
      parentSeedLocalId: ownedLocalId,
      htmlSeedLocalId: ownedLocalId,
      imageSeedLocalId: ownedLocalId,
      stableKey: `stable-${t}`,
      createdAt: t,
    })

    // Soft-deleted on-chain seed for A (must still hard-delete)
    const softLocalId = `soft-a-${t}`
    const softUid = `0x${'c'.repeat(64)}`
    await db.insert(seeds).values({
      localId: softLocalId,
      uid: softUid,
      type: 'post',
      publisher: ADDR_A,
      attestationRaw: JSON.stringify({ attester: ADDR_A }),
      _markedForDeletion: 1,
      createdAt: t,
    })
    await db.insert(versions).values({
      localId: `soft-ver-${t}`,
      seedLocalId: softLocalId,
      seedUid: softUid,
      seedType: 'post',
      createdAt: t,
    })
    await db.insert(metadata).values({
      localId: `soft-meta-${t}`,
      seedLocalId: softLocalId,
      seedUid: softUid,
      propertyName: 'title',
      propertyValue: 'soft',
      createdAt: t,
    })

    // Draft with publisher A but no on-chain identity — keep
    const draftLocalId = `draft-a-${t}`
    await db.insert(seeds).values({
      localId: draftLocalId,
      uid: null,
      type: 'post',
      publisher: ADDR_A,
      attestationRaw: null,
      createdAt: t,
    })

    // On-chain seed for B — keep
    const otherLocalId = `other-b-${t}`
    const otherUid = `0x${'b'.repeat(64)}`
    await db.insert(seeds).values({
      localId: otherLocalId,
      uid: otherUid,
      type: 'post',
      publisher: ADDR_B,
      attestationRaw: JSON.stringify({ attester: ADDR_B }),
      createdAt: t,
    })
    await db.insert(versions).values({
      localId: `other-ver-${t}`,
      seedLocalId: otherLocalId,
      seedUid: otherUid,
      seedType: 'post',
      createdAt: t,
    })

    // Cache drop is a no-op when nothing is cached; ensure API is safe
    Item.dropCachedInstancesForSeedIds([ownedLocalId, ownedUid])

    const result = await client.removeLocalCopiesForAddresses([ADDR_A])

    expect(result.removedSeedLocalIds).toEqual(
      expect.arrayContaining([ownedLocalId, softLocalId]),
    )
    expect(result.removedSeedLocalIds).not.toContain(draftLocalId)
    expect(result.removedSeedLocalIds).not.toContain(otherLocalId)
    expect(result.removedSeedUids).toEqual(
      expect.arrayContaining([ownedUid, softUid]),
    )

    const remainingSeeds = await db
      .select({ localId: seeds.localId })
      .from(seeds)
      .where(inArray(seeds.localId, [ownedLocalId, softLocalId, draftLocalId, otherLocalId]))
    const remainingIds = remainingSeeds.map((r) => r.localId)
    expect(remainingIds).toContain(draftLocalId)
    expect(remainingIds).toContain(otherLocalId)
    expect(remainingIds).not.toContain(ownedLocalId)
    expect(remainingIds).not.toContain(softLocalId)

    expect(
      await db.select().from(publishProcesses).where(eq(publishProcesses.seedLocalId, ownedLocalId)),
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(arweaveL1FinalizeJobs)
        .where(eq(arweaveL1FinalizeJobs.seedLocalId, ownedLocalId)),
    ).toHaveLength(0)
    expect(
      await db
        .select()
        .from(htmlEmbeddedImageCoPublish)
        .where(eq(htmlEmbeddedImageCoPublish.parentSeedLocalId, ownedLocalId)),
    ).toHaveLength(0)
    expect(
      await db.select().from(metadata).where(eq(metadata.seedLocalId, softLocalId)),
    ).toHaveLength(0)
    expect(
      await db.select().from(versions).where(eq(versions.seedLocalId, ownedLocalId)),
    ).toHaveLength(0)

    expect(Item.getById(ownedLocalId)).toBeNull()
    expect(Item.getById(ownedUid)).toBeNull()

    expect(emitSpy).toHaveBeenCalledWith(
      LOCAL_COPIES_REMOVED_EVENT,
      expect.objectContaining({
        addresses: [ADDR_A],
        removedSeedLocalIds: expect.arrayContaining([ownedLocalId, softLocalId]),
        removedSeedUids: expect.arrayContaining([ownedUid, softUid]),
      }),
    )
  })

  it('matches publisher from attestationRaw.attester when publisher column is null', async () => {
    const { client } = await import('@/client')
    const db = BaseDb.getAppDb()
    const t = Date.now()
    const localId = `raw-attester-${t}`
    const uid = `0x${'d'.repeat(64)}`
    await db.insert(seeds).values({
      localId,
      uid,
      type: 'post',
      publisher: null,
      attestationRaw: JSON.stringify({ attester: ADDR_A }),
      createdAt: t,
    })

    const result = await client.removeLocalCopiesForAddresses([ADDR_A.toUpperCase()])
    expect(result.removedSeedLocalIds).toContain(localId)

    const rows = await db.select().from(seeds).where(eq(seeds.localId, localId))
    expect(rows).toHaveLength(0)
  })

  it('no-ops for empty addresses and emits empty removal payload', async () => {
    const { client } = await import('@/client')
    const result = await client.removeLocalCopiesForAddresses([])
    expect(result).toEqual({ removedSeedLocalIds: [], removedSeedUids: [] })
    expect(emitSpy).toHaveBeenCalledWith(LOCAL_COPIES_REMOVED_EVENT, {
      addresses: [],
      removedSeedLocalIds: [],
      removedSeedUids: [],
    })
  })
})
