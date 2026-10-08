import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { updateSeedRevokedAt } from '@/db/write/updateSeedRevokedAt'
import { updateVersionUid } from '@/db/write/updateVersionUid'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'
import { summarizePublishWork } from '@/db/read/summarizePublishWork'
import { setRevokeExecutor } from '@/helpers/publishConfig'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createPublishedItemForUnpublish,
  UNPUBLISH_TEST_PUBLISHER,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

/**
 * docs/ATTESTATION_REVOCATION.md "Republishing": publishing an unpublished item creates a new seed
 * attestation (new seedUid) and a new version; it never attaches to the revoked seed.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const ZERO = '0x' + '0'.repeat(64)

let uidCounter = 0
/** Distinct valid bytes32 uids; the prefix keeps them apart from other files' uids. */
const nextUid = (): string => {
  uidCounter += 1
  const tail = `${Date.now().toString(16)}${uidCounter.toString(16).padStart(4, '0')}`
  return '0x' + ('2e9b15' + tail).padEnd(64, 'd')
}

testDescribe('republish after unpublish', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
      configOverrides: { addresses: [UNPUBLISH_TEST_PUBLISHER] },
    })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    setRevokeExecutor(null)
    await teardownTestEnvironment()
  })

  it('creates a new seed and version, and local state follows the new seed', async () => {
    const { item, seedLocalId, seedUid: oldSeedUid, publisher } = await createPublishedItemForUnpublish({
      title: 'Republish me',
    })
    const db = BaseDb.getAppDb()

    // Published: the item's version and its title property carry attestation uids.
    const oldVersionUid = nextUid()
    const oldTitleUid = nextUid()
    await db
      .update(versions)
      .set({ uid: oldVersionUid, seedUid: oldSeedUid, attestationCreatedAt: Date.now() })
      .where(eq(versions.seedLocalId, seedLocalId))
    await db
      .update(metadata)
      .set({ uid: oldTitleUid })
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'title')))
    item.getService().send({ type: 'updateContext', latestVersionUid: oldVersionUid })
    // As for an item loaded by uid: the instance cache also holds it under its seed uid.
    const cache = (Item as any).instanceCache as Map<string, { instance: unknown }>
    const entry = cache.get(seedLocalId)
    expect(entry).toBeDefined()
    cache.set(oldSeedUid, entry!)

    // Unpublish, stamping like the publish package's revoke executor.
    setRevokeExecutor(async ({ seedLocalId: id }) => {
      await updateSeedRevokedAt({
        seedLocalId: id,
        revokedAt: Math.floor(Date.now() / 1000),
        versionUids: [oldVersionUid],
        metadataUids: [oldTitleUid],
      })
    })
    try {
      await item.unpublish()
    } finally {
      setRevokeExecutor(null)
    }
    expect(item.isRevoked).toBe(true)

    // The payload asks for a new seed and a new version, with every property (the published title
    // too: the new seed has no property attestations yet).
    const payload = await item.getPublishPayload([])
    const own = payload.find((p: any) => p.localId === seedLocalId)!
    expect(own.seedUid).toBe(ZERO)
    expect(own.versionUid).toBe(ZERO)
    expect(own.listOfAttestations.some((a: any) => a._propertyName === 'title')).toBe(true)

    const summary = await summarizePublishWork(item)
    expect(summary.newSeedCount).toBe(1)
    expect(summary.newVersionCount).toBe(1)

    // The publish completes (mocked chain). As the publish package's createAttestations does: it
    // records the new version, assigns the new seed uid to the item (persistSeedUidFromPublishResult),
    // then persists it (persistSeedUidSafely).
    const newSeedUid = nextUid()
    const newVersionUid = nextUid()
    await updateVersionUid({ seedLocalId, versionUid: newVersionUid, publisher })
    ;(item as { seedUid?: string }).seedUid = newSeedUid
    await item.persistSeedUid(publisher, Date.now())

    const [seedRow] = await db
      .select({ uid: seeds.uid, revokedAt: seeds.revokedAt })
      .from(seeds)
      .where(eq(seeds.localId, seedLocalId))
    expect(seedRow).toEqual({ uid: newSeedUid, revokedAt: null })

    expect(item.seedUid).toBe(newSeedUid)
    expect(item.isRevoked).toBe(false)
    expect(item.latestVersionUid).toBe(newVersionUid)
    expect((await getLatestPublishedVersionRow(seedLocalId))?.uid).toBe(newVersionUid)

    // The instance cache's uid alias follows the seed.
    expect(cache.has(oldSeedUid)).toBe(false)
    expect(cache.get(newSeedUid)).toBe(entry)
    expect((await Item.find({ seedUid: newSeedUid } as any))?.seedLocalId).toBe(seedLocalId)

    // The old version stays revoked; the next patch publish attaches to the new seed and version.
    const [oldVersion] = await db
      .select({ revokedAt: versions.revokedAt })
      .from(versions)
      .where(eq(versions.uid, oldVersionUid))
    expect(oldVersion?.revokedAt).not.toBeNull()
    const next = (await item.getPublishPayload([])).find((p: any) => p.localId === seedLocalId)!
    expect(next.seedUid).toBe(newSeedUid)
    expect(next.versionUid).toBe(newVersionUid)
  })
})
