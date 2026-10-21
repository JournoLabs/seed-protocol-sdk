import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'

/**
 * Sync after an unpublish and republish (SDK audit 1.7). EAS returns the revoked old seed and the
 * new one. The old uid is the republished item's history (its old version rows record it), so sync
 * must not insert it as a second seed row, and refs holding the old uid keep resolving to the item.
 */
type FakeAttestation = {
  id: string
  schemaId: string
  refUID: string
  attester: string
  timeCreated: number
  revoked: boolean
  revocationTime: number
  decodedDataJson: string
  schema: { schemaNames: { name: string }[] }
}

const fakeEas = vi.hoisted(() => ({
  modelSchemas: [] as { id: string; schema: string }[],
  seeds: [] as FakeAttestation[],
  versions: [] as FakeAttestation[],
  properties: [] as FakeAttestation[],
}))

vi.mock('@/eas', async () => {
  const actual = await import('@seedprotocol/eas')
  return {
    ...actual,
    getModelSchemasFromEas: async () => fakeEas.modelSchemas,
    getSeedsFromSchemaUids: async ({ schemaUids }: { schemaUids: string[] }) =>
      fakeEas.seeds.filter((s) => schemaUids.includes(s.schemaId)),
    getItemVersionsFromEas: async ({ seedUids }: { seedUids: string[] }) =>
      fakeEas.versions.filter((v) => seedUids.includes(v.refUID)),
    getItemPropertiesFromEas: async ({ versionUids }: { versionUids: string[] }) =>
      fakeEas.properties.filter((p) => versionUids.includes(p.refUID)),
  }
})

// Keep the post-sync file download from reaching the network.
vi.mock('@/events/files/download', () => ({
  downloadAllFilesRequestHandler: async () => {},
  downloadAllFilesBinaryRequestHandler: async () => {},
  downloadTransactionIdWithDedupe: async () => false,
  scheduleBulkFilesDownloadFromEasSync: () => {},
}))

const ZERO = '0x' + '0'.repeat(64)
const VERSION_SCHEMA_UID = '0x' + 'cf'.repeat(32)

let uidCounter = 0
const nextUid = (): string => {
  uidCounter += 1
  const tail = `${Date.now().toString(16)}${uidCounter.toString(16).padStart(4, '0')}`
  return '0x' + ('e17' + tail).padEnd(64, 'f')
}

/** EAS returns both seed attestations (sync fetches revoked ones too), each with its version. */
const easReturnsRepublishedSeed = ({
  attester,
  schemaUid,
  modelType,
  oldSeedUid,
  oldVersionUid,
  newSeedUid,
  newVersionUid,
}: {
  attester: string
  schemaUid: string
  modelType: string
  oldSeedUid: string
  oldVersionUid: string
  newSeedUid: string
  newVersionUid: string
}) => {
  const nowS = Math.floor(Date.now() / 1000)
  const att = (id: string, refUID: string, schemaId: string, name: string, timeCreated: number, revoked = false) => ({
    id,
    schemaId,
    refUID,
    attester,
    timeCreated,
    revoked,
    revocationTime: revoked ? nowS - 10 : 0,
    decodedDataJson: '',
    schema: { schemaNames: [{ name }] },
  })
  fakeEas.modelSchemas = [{ id: schemaUid, schema: `bytes32 ${modelType}` }]
  fakeEas.seeds = [
    att(oldSeedUid, ZERO, schemaUid, modelType, nowS - 120, true),
    att(newSeedUid, ZERO, schemaUid, modelType, nowS - 5),
  ]
  fakeEas.versions = [
    att(oldVersionUid, oldSeedUid, VERSION_SCHEMA_UID, 'version', nowS - 119, true),
    att(newVersionUid, newSeedUid, VERSION_SCHEMA_UID, 'version', nowS - 4),
  ]
  fakeEas.properties = []
}

describe.sequential('runSyncFromEas after a republish', () => {
  beforeAll(async () => {
    const { UNPUBLISH_TEST_PUBLISHER, createGetPublishPayloadTestSchema } = await import(
      '../../test-utils/getPublishPayloadIntegrationHelpers'
    )
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
      configOverrides: { addresses: [UNPUBLISH_TEST_PUBLISHER] },
    })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    const { setRevokeExecutor } = await import('@/helpers/publishConfig')
    setRevokeExecutor(null)
    await teardownTestEnvironment()
  })

  it('keeps one seed row: the old uid stays the item, unrevoked', async () => {
    const { createPublishedItemForUnpublish } = await import('../../test-utils/getPublishPayloadIntegrationHelpers')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds, versions, metadata } = await import('@/seedSchema')
    const { and, eq, inArray } = await import('drizzle-orm')
    const { updateSeedRevokedAt } = await import('@/db/write/updateSeedRevokedAt')
    const { updateVersionUid } = await import('@/db/write/updateVersionUid')
    const { setRevokeExecutor } = await import('@/helpers/publishConfig')
    const { findRelatedSeedRow } = await import('@/db/read/resolveRelatedSeedRef')
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')

    // Publish, unpublish and republish as in Item/republishAfterUnpublish.test.ts.
    const { item, seedLocalId, seedUid: oldSeedUid, publisher } = await createPublishedItemForUnpublish({
      title: 'Sync after republish',
    })
    const db = BaseDb.getAppDb()
    const oldVersionUid = nextUid()
    const oldTitleUid = nextUid()
    await db
      .update(versions)
      .set({ uid: oldVersionUid, seedUid: oldSeedUid, attestationCreatedAt: Date.now() - 60_000 })
      .where(eq(versions.seedLocalId, seedLocalId))
    await db
      .update(metadata)
      .set({ uid: oldTitleUid })
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'title')))
    item.getService().send({ type: 'updateContext', latestVersionUid: oldVersionUid })

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

    const newSeedUid = nextUid()
    const newVersionUid = nextUid()
    await updateVersionUid({ seedLocalId, versionUid: newVersionUid, publisher })
    ;(item as { seedUid?: string }).seedUid = newSeedUid
    await item.persistSeedUid(publisher, Date.now())

    const [seedRow] = await db.select().from(seeds).where(eq(seeds.localId, seedLocalId))
    expect(seedRow.uid).toBe(newSeedUid)

    easReturnsRepublishedSeed({
      attester: publisher,
      schemaUid: seedRow.schemaUid as string,
      modelType: 'post',
      oldSeedUid,
      oldVersionUid,
      newSeedUid,
      newVersionUid,
    })
    await runSyncFromEas({ addresses: [publisher] })

    const seedRows = await db
      .select({ localId: seeds.localId, uid: seeds.uid, revokedAt: seeds.revokedAt })
      .from(seeds)
      .where(inArray(seeds.uid, [oldSeedUid, newSeedUid]))
    expect(seedRows).toEqual([{ localId: seedLocalId, uid: newSeedUid, revokedAt: null }])

    const [oldVersion] = await db
      .select({ seedLocalId: versions.seedLocalId, seedUid: versions.seedUid })
      .from(versions)
      .where(eq(versions.uid, oldVersionUid))
    expect(oldVersion).toEqual({ seedLocalId, seedUid: oldSeedUid })

    const resolved = await findRelatedSeedRow({ seedUid: oldSeedUid })
    expect(resolved?.seedLocalId).toBe(seedLocalId)
    expect(resolved?.seedUid).toBe(newSeedUid)
  }, 60000)

  it('a referrer holding the old uid publishes after the sync', async () => {
    const { createPublishedTestAuthor, UNPUBLISH_TEST_PUBLISHER } = await import(
      '../../test-utils/getPublishPayloadIntegrationHelpers'
    )
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds, versions } = await import('@/seedSchema')
    const { eq, inArray } = await import('drizzle-orm')
    const { Item } = await import('@/Item/Item')
    const { waitForEntityIdle } = await import('@/helpers/waitForEntityIdle')
    const { runSyncFromEas } = await import('@/events/item/syncDbWithEas')
    const db = BaseDb.getAppDb()

    // An Author published as oldUid, unpublished and published again as newUid: its old version
    // row keeps oldUid, as after a real republish.
    const author = await createPublishedTestAuthor()
    const authorLocalId = author.seedLocalId!
    const [authorSeed] = await db.select().from(seeds).where(eq(seeds.localId, authorLocalId))
    const oldUid = authorSeed.uid as string
    const oldVersionUid = nextUid()
    const newUid = nextUid()
    const newVersionUid = nextUid()
    await db
      .update(versions)
      .set({ uid: oldVersionUid, seedUid: oldUid, revokedAt: Math.floor(Date.now() / 1000) - 60 })
      .where(eq(versions.seedLocalId, authorLocalId))
    await db.insert(versions).values({
      localId: 'rpnv' + Date.now().toString(36).slice(-6),
      seedLocalId: authorLocalId,
      seedUid: newUid,
      uid: newVersionUid,
      seedType: 'author',
      createdAt: Date.now() + 1000,
      attestationCreatedAt: Date.now(),
    })
    await db
      .update(seeds)
      .set({ uid: newUid, revokedAt: null, publisher: UNPUBLISH_TEST_PUBLISHER })
      .where(eq(seeds.localId, authorLocalId))
    author.getService().send({ type: 'updateContext', seedUid: newUid })

    // A Post that refers to the author by its old uid (as a Post synced from chain would).
    const post = await Item.create({
      modelName: 'Post',
      schemaName: 'Test Schema getPublishPayload',
      author: oldUid,
      title: 'Referrer after republish',
      count: 1,
      payload: '{}',
      isPublished: true,
      publishedOn: '2025-01-15T00:00:00.000Z',
    } as any)
    await waitForEntityIdle(post, { timeout: 15000 })

    const authorRefs = async () => {
      const payload = await post.getPublishPayload([])
      const own = payload.find((p: any) => p.localId === post.seedLocalId)
      return JSON.stringify(own?.listOfAttestations ?? [], (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    }
    expect(await authorRefs()).toContain(newUid)

    easReturnsRepublishedSeed({
      attester: UNPUBLISH_TEST_PUBLISHER,
      schemaUid: '0x' + 'a7'.repeat(32),
      modelType: 'author',
      oldSeedUid: oldUid,
      oldVersionUid,
      newSeedUid: newUid,
      newVersionUid,
    })
    await runSyncFromEas({ addresses: [UNPUBLISH_TEST_PUBLISHER] })

    const seedRows = await db
      .select({ localId: seeds.localId })
      .from(seeds)
      .where(inArray(seeds.uid, [oldUid, newUid]))
    expect(seedRows).toEqual([{ localId: authorLocalId }])
    expect(await authorRefs()).toContain(newUid)
  }, 60000)

  it('resolves an old uid to the item when a version-less row with that uid exists', async () => {
    const { createPublishedTestAuthor } = await import('../../test-utils/getPublishPayloadIntegrationHelpers')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { seeds, versions } = await import('@/seedSchema')
    const { eq } = await import('drizzle-orm')
    const { findRelatedSeedRow } = await import('@/db/read/resolveRelatedSeedRef')
    const db = BaseDb.getAppDb()

    // The state an older sync left: the item holds newUid, a second row holds oldUid.
    const author = await createPublishedTestAuthor()
    const authorLocalId = author.seedLocalId!
    const [authorSeed] = await db.select().from(seeds).where(eq(seeds.localId, authorLocalId))
    const oldUid = authorSeed.uid as string
    const newUid = nextUid()
    await db.update(versions).set({ seedUid: oldUid }).where(eq(versions.seedLocalId, authorLocalId))
    await db.update(seeds).set({ uid: newUid }).where(eq(seeds.localId, authorLocalId))
    await db.insert(seeds).values({
      localId: 'ghst' + Date.now().toString(36).slice(-6),
      uid: oldUid,
      type: 'author',
      revokedAt: Math.floor(Date.now() / 1000),
      createdAt: Date.now(),
    })

    const resolved = await findRelatedSeedRow({ seedUid: oldUid })
    expect(resolved?.seedLocalId).toBe(authorLocalId)
  }, 60000)
})
