import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { waitFor } from 'xstate'
import { updateSeedRevokedAt } from '@/db/write/updateSeedRevokedAt'
import { updateVersionUid } from '@/db/write/updateVersionUid'
import { applyPropertyAttestationUidsFromPublish } from '@/db/write/applyPropertyAttestationUidsFromPublish'
import { getItemProperties } from '@/db/read/getItemProperties'
import { getPublishPendingDiff } from '@/db/read/getPublishPendingDiff'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'
import { summarizePublishWork } from '@/db/read/summarizePublishWork'
import { setRevokeExecutor } from '@/helpers/publishConfig'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createPublishedItemForUnpublish,
  UNPUBLISH_TEST_PUBLISHER,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { waitUntilOrThrow } from '../test-utils/waitUntil'

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

  /**
   * Simulates a full-snapshot publish completing, as the publish package does: record the version
   * (updateVersionUid), then each property attestation (applyPropertyAttestationUidsFromPublish,
   * pairs in payload order), then the seed uid. Returns the new uids.
   */
  const completeFullSnapshotPublish = async (
    item: Item<any>,
    seedLocalId: string,
    publisher: string,
    publishMode: 'patch' | 'new_version',
    newSeedUid?: string,
  ) => {
    const payload = await item.getPublishPayload([], { publishMode })
    const own = payload.find((p: any) => p.localId === seedLocalId)!
    expect(own.versionUid).toBe(ZERO)
    const newVersionUid = nextUid()
    const attested = own.listOfAttestations.map((a: any) => ({
      propertyName: a._propertyName as string,
      schemaUid: a.schema as string,
      attestationUid: nextUid(),
    }))
    const at = Date.now()
    await updateVersionUid({ seedLocalId, versionUid: newVersionUid, publisher, attestationCreatedAt: at })
    await applyPropertyAttestationUidsFromPublish({
      seedLocalId,
      attestationCreatedAtMs: at,
      versionUid: newVersionUid,
      pairs: attested,
    })
    if (newSeedUid) (item as { seedUid?: string }).seedUid = newSeedUid
    await item.persistSeedUid(publisher, at)
    return { newVersionUid, attested }
  }

  /** Every property row of the seed attested on the published version. */
  const markAllPropertiesAttested = async (seedLocalId: string, versionUid: string, seedUid: string) => {
    const db = BaseDb.getAppDb()
    const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
    const uids: string[] = []
    for (const row of rows) {
      const u = nextUid()
      uids.push(u)
      await db
        .update(metadata)
        .set({ uid: u, versionUid, seedUid, attestationCreatedAt: Date.now() - 60_000 })
        .where(eq(metadata.localId, row.localId!))
    }
    return uids
  }

  const expectRecordedOnNewVersion = async (
    seedLocalId: string,
    newVersionUid: string,
    attested: { propertyName: string; attestationUid: string }[],
    values: Record<string, unknown>,
    seedUid: string,
  ) => {
    const db = BaseDb.getAppDb()
    const [newVersion] = await db
      .select({ localId: versions.localId, seedUid: versions.seedUid })
      .from(versions)
      .where(eq(versions.uid, newVersionUid))
    expect(newVersion?.localId).toBeTruthy()
    expect(newVersion?.seedUid).toBe(seedUid)
    const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
    expect(attested.length).toBeGreaterThan(0)
    for (const { propertyName, attestationUid } of attested) {
      const row = rows.find((r: any) => r.uid === attestationUid)
      expect(row, `row for ${propertyName}`).toBeDefined()
      expect(row).toMatchObject({
        propertyName,
        versionUid: newVersionUid,
        versionLocalId: newVersion!.localId,
        seedUid,
        revokedAt: null,
      })
    }
    // Readers show the published values from the new rows, without a sync.
    const read = await getItemProperties({ seedLocalId })
    for (const [name, value] of Object.entries(values)) {
      const property = read.find((p: any) => p.propertyName === name)
      expect(property?.propertyValue, name).toBe(value)
      expect(attested.some((a) => a.attestationUid === property?.uid), `${name} reads the new row`).toBe(true)
    }
    expect((await getPublishPendingDiff({ seedLocalId })).pendingProperties).toEqual([])
  }

  it('republish records every attested property on the new version, already-attested ones too', async () => {
    const { item, seedLocalId, seedUid: oldSeedUid, publisher } = await createPublishedItemForUnpublish({
      title: 'All attested, then republished',
    })
    const db = BaseDb.getAppDb()
    const oldVersionUid = nextUid()
    await db
      .update(versions)
      .set({ uid: oldVersionUid, seedUid: oldSeedUid, attestationCreatedAt: Date.now() - 60_000 })
      .where(eq(versions.seedLocalId, seedLocalId))
    const oldPropertyUids = await markAllPropertiesAttested(seedLocalId, oldVersionUid, oldSeedUid)
    item.getService().send({ type: 'updateContext', latestVersionUid: oldVersionUid })

    setRevokeExecutor(async ({ seedLocalId: id }) => {
      await updateSeedRevokedAt({
        seedLocalId: id,
        revokedAt: Math.floor(Date.now() / 1000),
        versionUids: [oldVersionUid],
        metadataUids: oldPropertyUids,
      })
    })
    try {
      await item.unpublish()
    } finally {
      setRevokeExecutor(null)
    }

    const newSeedUid = nextUid()
    const { newVersionUid, attested } = await completeFullSnapshotPublish(
      item,
      seedLocalId,
      publisher,
      'patch',
      newSeedUid,
    )
    await expectRecordedOnNewVersion(
      seedLocalId,
      newVersionUid,
      attested,
      { title: 'All attested, then republished' },
      newSeedUid,
    )
    // The old seed's rows stay as they were: history of the revoked seed.
    const oldRows = await db.select().from(metadata).where(eq(metadata.versionUid, oldVersionUid))
    expect(oldRows.map((r: any) => r.uid).sort()).toEqual([...oldPropertyUids].sort())
    expect(oldRows.every((r: any) => r.revokedAt != null && r.seedUid === oldSeedUid)).toBe(true)
  })

  it('new_version publish records every property on the new version, already-attested ones too', async () => {
    const { item, seedLocalId, seedUid, publisher } = await createPublishedItemForUnpublish({
      title: 'All attested, new version',
    })
    const db = BaseDb.getAppDb()
    const oldVersionUid = nextUid()
    await db
      .update(versions)
      .set({ uid: oldVersionUid, seedUid, attestationCreatedAt: Date.now() - 60_000 })
      .where(eq(versions.seedLocalId, seedLocalId))
    await markAllPropertiesAttested(seedLocalId, oldVersionUid, seedUid)
    item.getService().send({ type: 'updateContext', latestVersionUid: oldVersionUid })

    const { newVersionUid, attested } = await completeFullSnapshotPublish(
      item,
      seedLocalId,
      publisher,
      'new_version',
    )
    await expectRecordedOnNewVersion(
      seedLocalId,
      newVersionUid,
      attested,
      { title: 'All attested, new version' },
      seedUid,
    )
    expect(item.latestVersionUid).toBe(newVersionUid)

    // Replaying the same results (e.g. a retried persist) adds nothing.
    const count = async () =>
      (await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))).length
    const before = await count()
    await applyPropertyAttestationUidsFromPublish({
      seedLocalId,
      attestationCreatedAtMs: Date.now(),
      versionUid: newVersionUid,
      pairs: attested,
    })
    expect(await count()).toBe(before)
  })

  // Browser only: Node skips the Item liveQuery.
  const itBrowser = typeof window === 'undefined' ? it.skip : it

  itBrowser("an item loaded by seed uid keeps observing its seed row after a republish changes the uid", async () => {
    const { item, seedLocalId, seedUid: oldSeedUid, publisher } = await createPublishedItemForUnpublish({
      title: 'Watched across republish',
    })
    const db = BaseDb.getAppDb()

    // Load it as Item.all does for a published item: with its seed uid known from the start.
    item.unload()
    ItemProperty.clearInstanceCacheForItem(seedLocalId)
    const loaded = await Item.create({
      modelName: 'Post',
      schemaName: 'Test Schema getPublishPayload',
      seedLocalId,
      seedUid: oldSeedUid,
    } as any)
    await waitFor(loaded.getService(), (s) => s.value === 'idle', { timeout: 15000 })
    expect(loaded.seedUid).toBe(oldSeedUid)

    // Unpublish, then republish (as in the test above): the seed gets a new uid.
    await updateSeedRevokedAt({ seedLocalId, revokedAt: Math.floor(Date.now() / 1000) })
    await waitUntilOrThrow(() => loaded.isRevoked, 'the item to observe the unpublish', 5000)
    const newSeedUid = nextUid()
    await updateVersionUid({ seedLocalId, versionUid: nextUid(), publisher })
    ;(loaded as { seedUid?: string }).seedUid = newSeedUid
    await loaded.persistSeedUid(publisher, Date.now())
    expect(loaded.seedUid).toBe(newSeedUid)
    expect(loaded.isRevoked).toBe(false)

    // Later changes to the seed row (another tab unpublishing, sync) still reach the item.
    const revokedAgainAt = Math.floor(Date.now() / 1000) + 7
    await updateSeedRevokedAt({ seedLocalId, revokedAt: revokedAgainAt })
    await waitUntilOrThrow(
      () => loaded.revokedAt === revokedAgainAt,
      'the item to observe revoked_at on its republished seed',
      5000,
    )

    const syncedSeedUid = nextUid()
    await db.update(seeds).set({ uid: syncedSeedUid, revokedAt: null }).where(eq(seeds.localId, seedLocalId))
    await waitUntilOrThrow(
      () => loaded.seedUid === syncedSeedUid && !loaded.isRevoked,
      'the item to observe a seed uid written elsewhere',
      5000,
    )
    const cache = (Item as any).instanceCache as Map<string, unknown>
    expect(cache.has(newSeedUid)).toBe(false)
    expect(cache.has(syncedSeedUid)).toBe(true)
    loaded.unload()
  })

  itBrowser('the old seed row, observed before the new uid is persisted, does not bring the old uid back', async () => {
    const { item, seedLocalId, seedUid: oldSeedUid, publisher } = await createPublishedItemForUnpublish({
      title: 'No flash back',
    })
    const db = BaseDb.getAppDb()
    const cache = (Item as any).instanceCache as Map<string, unknown>
    const entry = cache.get(seedLocalId)
    expect(entry).toBeDefined()
    cache.set(oldSeedUid, entry!)

    // Unpublished; the item's seed liveQuery observes it.
    await updateSeedRevokedAt({ seedLocalId, revokedAt: Math.floor(Date.now() / 1000) })
    await waitUntilOrThrow(() => item.isRevoked, 'the item to observe the unpublish', 5000)

    // A second watch on the same row tells the test when an emission was delivered.
    const watched: { uid: string | null; updatedAt: number | null }[] = []
    const watch = BaseDb.liveQuery<{ uid: string | null; updatedAt: number | null }>(
      (sql: any) => sql`SELECT uid, updated_at as updatedAt FROM seeds WHERE local_id = ${seedLocalId}`,
    ).subscribe({ next: (rows) => rows[0] && watched.push(rows[0]) })
    const seenUids: (string | undefined)[] = []
    const seen = item.getService().subscribe((s) => seenUids.push((s.context as { seedUid?: string }).seedUid))

    try {
      // Republish in flight: the publish has given the item its new seed uid (the tracked setter's
      // context update; its DB write has not landed yet) ...
      const newSeedUid = nextUid()
      ;(Item as any).sendTrackedPropertyUpdate(item, 'seedUid', newSeedUid)
      expect(item.seedUid).toBe(newSeedUid)
      expect(item.isRevoked).toBe(false)

      // ... when the old seed row changes before the new uid's DB write lands (here a sync records
      // the old seed's revocation time) and the liveQuery delivers it: old uid, revoked. (The
      // liveQuery drops unchanged results, so an unchanged old row would not be delivered.)
      const staleAt = Date.now() + 1
      await db
        .update(seeds)
        .set({ revokedAt: Math.floor(staleAt / 1000) - 5, updatedAt: staleAt })
        .where(eq(seeds.localId, seedLocalId))
      await waitUntilOrThrow(
        () => watched.some((r) => r.updatedAt === staleAt && r.uid === oldSeedUid),
        'the liveQuery to deliver the old seed row',
        5000,
      )
      // Both watches are notified by the same change; let the item's handler run.
      await new Promise((r) => setTimeout(r, 50))

      expect(item.seedUid).toBe(newSeedUid)
      expect(item.isRevoked).toBe(false)
      expect(seenUids.slice(seenUids.indexOf(newSeedUid))).not.toContain(oldSeedUid)
      expect(cache.has(oldSeedUid)).toBe(false)
      expect(cache.get(newSeedUid)).toBe(entry)

      // The new uid lands in the DB; later changes to the row reach the item again.
      await item.persistSeedUid(publisher, Date.now())
      await waitUntilOrThrow(
        () => watched.some((r) => r.uid === newSeedUid),
        'the liveQuery to deliver the persisted seed row',
        5000,
      )
      const revokedAgainAt = Math.floor(Date.now() / 1000) + 11
      await updateSeedRevokedAt({ seedLocalId, revokedAt: revokedAgainAt })
      await waitUntilOrThrow(
        () => item.revokedAt === revokedAgainAt,
        'the item to observe revoked_at on its republished seed',
        5000,
      )
      expect(item.seedUid).toBe(newSeedUid)
    } finally {
      watch.unsubscribe()
      seen.unsubscribe()
    }
  })
})
