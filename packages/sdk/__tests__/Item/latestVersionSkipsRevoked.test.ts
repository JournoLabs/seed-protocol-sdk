import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'
import { batchLatestPublishedVersionBySeedLocalIds } from '@/db/read/batchLatestPublishedVersionBySeedLocalIds'
import { getItemsData } from '@/db/read/getItems'
import { getItemData } from '@/db/read/getItemData'
import { getSeedPublishState } from '@/db/read/getSeedPublishState'
import { getPublishPendingDiff } from '@/db/read/getPublishPendingDiff'
import { updateSeedRevokedAt } from '@/db/write/updateSeedRevokedAt'
import { setRevokeExecutor } from '@/helpers/publishConfig'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
  createPublishedItemForUnpublish,
  UNPUBLISH_TEST_PUBLISHER,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

/**
 * "Latest version" and "latest published version" never pick a version whose attestation was
 * revoked (`versions.revoked_at`). See docs/ATTESTATION_REVOCATION.md.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

let uidCounter = 0
/** Distinct valid bytes32 uids per call; the prefix keeps them apart from other files' uids. */
const nextUid = (): string => {
  uidCounter += 1
  const tail = `${Date.now().toString(16)}${uidCounter.toString(16).padStart(4, '0')}`
  return '0x' + ('1a7e5e' + tail).padEnd(64, 'c')
}

async function waitForItemIdle(item: Item<any>, timeout = 15000): Promise<void> {
  await waitFor(
    item.getService(),
    (snapshot) => {
      if (snapshot.value === 'error') throw new Error('Item failed to load')
      return snapshot.value === 'idle'
    },
    { timeout },
  )
}

/** Cold reload: a fresh Item instance built from the DB, not the cached one. */
async function reloadItem(item: Item<any>): Promise<Item<any>> {
  const seedLocalId = item.seedLocalId
  item.unload()
  ItemProperty.clearInstanceCacheForItem(seedLocalId)
  const reloaded = await Item.create({
    modelName: 'Post',
    schemaName: 'Test Schema getPublishPayload',
    seedLocalId,
  } as any)
  await waitForItemIdle(reloaded)
  return reloaded
}

/**
 * A published item whose head version is attested. Returns the seed and the item's own version row.
 */
async function createPublishedItem(title: string) {
  const { item } = await createItemWithBasicPropertiesOnly({ title, count: 1 })
  const seedLocalId = item.seedLocalId!
  const db = BaseDb.getAppDb()
  const seedUid = nextUid()
  await db.update(seeds).set({ uid: seedUid }).where(eq(seeds.localId, seedLocalId))
  const own = await db
    .select({ localId: versions.localId, createdAt: versions.createdAt })
    .from(versions)
    .where(eq(versions.seedLocalId, seedLocalId))
  expect(own.length).toBe(1)
  return { item, seedLocalId, seedUid, ownVersion: own[0]! }
}

testDescribe('latest version helpers skip revoked versions', () => {
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

  it('reports the older live version when the newest version is revoked', async () => {
    const { item, seedLocalId, seedUid, ownVersion } = await createPublishedItem(
      'Newest version revoked',
    )
    const db = BaseDb.getAppDb()
    const t = (ownVersion.createdAt ?? Date.now()) + 10_000
    const liveUid = nextUid()
    const revokedUid = nextUid()
    const liveLocalId = `lv-live-${t}`
    const revokedLocalId = `lv-revoked-${t}`
    await db.insert(versions).values({
      localId: liveLocalId,
      seedLocalId,
      seedUid,
      seedType: 'post',
      uid: liveUid,
      createdAt: t,
      attestationCreatedAt: t,
    })
    await db.insert(versions).values({
      localId: revokedLocalId,
      seedLocalId,
      seedUid,
      seedType: 'post',
      uid: revokedUid,
      createdAt: t + 1000,
      attestationCreatedAt: t + 1000,
      revokedAt: Math.floor(t / 1000) + 5,
    })

    expect((await getLatestPublishedVersionRow(seedLocalId))?.uid).toBe(liveUid)
    expect((await batchLatestPublishedVersionBySeedLocalIds([seedLocalId])).get(seedLocalId)?.uid).toBe(
      liveUid,
    )

    const rows = await getItemsData({ modelName: 'Post', includeEas: true })
    const row = rows.find((r) => r.seedLocalId === seedLocalId)
    expect(row?.latestVersionLocalId).toBe(liveLocalId)
    expect(row?.latestVersionUid).toBe(liveUid)
    expect(row?.publishedVersionUid).toBe(liveUid)
    expect(row?.publishedVersionLocalId).toBe(liveLocalId)
    expect(row?.lastVersionPublishedAt).toBe(t)
    expect(row?.versionsCount).toBe(3)

    const data = await getItemData({ seedLocalId })
    expect(data?.latestVersionLocalId).toBe(liveLocalId)
    expect(data?.latestVersionUid).toBe(liveUid)
    expect(data?.publishedVersionUid).toBe(liveUid)
    expect(data?.lastVersionPublishedAt).toBe(t)

    expect((await getSeedPublishState({ seedLocalId })).versionAttestationUid).toBe(liveUid)
    expect((await getPublishPendingDiff({ seedLocalId })).lastPublishedVersionUid).toBe(liveUid)

    const reloaded = await reloadItem(item)
    expect(reloaded.latestVersionLocalId).toBe(liveLocalId)
    expect(reloaded.latestVersionUid).toBe(liveUid)

    // A patch publish attaches new property attestations to the live version, not the revoked one.
    const payload = await reloaded.getPublishPayload([])
    const own = payload.find((p: any) => p.localId === seedLocalId)
    expect(own?.versionUid).toBe(liveUid)
    reloaded.unload()
  })

  it('after a full unpublish the item has no latest or published version but keeps its values', async () => {
    const { item, seedLocalId, seedUid, ownVersion } = await createPublishedItem(
      'Fully unpublished keeps values',
    )
    const db = BaseDb.getAppDb()
    const versionUid = nextUid()
    const at = Math.floor(Date.now() / 1000)
    await db
      .update(versions)
      .set({ uid: versionUid, seedUid, attestationCreatedAt: Date.now() })
      .where(eq(versions.localId, ownVersion.localId!))
    await updateSeedRevokedAt({ seedLocalId, revokedAt: at, versionUids: [versionUid] })

    expect(await getLatestPublishedVersionRow(seedLocalId)).toBeNull()
    expect((await batchLatestPublishedVersionBySeedLocalIds([seedLocalId])).has(seedLocalId)).toBe(false)

    const data = await getItemData({ seedLocalId })
    expect(data?.publishedVersionUid).toBeFalsy()
    expect(data?.latestVersionUid).toBeFalsy()
    expect(data?.latestVersionLocalId).toBeFalsy()
    expect(data?.lastVersionPublishedAt).toBeFalsy()
    expect(data?.versionsCount).toBe(1)

    const state = await getSeedPublishState({ seedLocalId })
    expect(state.versionAttestationUid).toBeNull()
    expect(state.revokedAt).toBe(at)

    const reloaded = await reloadItem(item)
    expect(reloaded.isRevoked).toBe(true)
    expect(reloaded.latestVersionUid).toBeFalsy()
    expect(reloaded.latestVersionLocalId).toBeFalsy()
    // The revoked item's last values still load.
    const title = reloaded.properties.find((p) => p.propertyName === 'title')
    expect(title?.value).toBe('Fully unpublished keeps values')

    // Publishing again doesn't attach to the revoked version.
    const payload = await reloaded.getPublishPayload([])
    const own = payload.find((p: any) => p.localId === seedLocalId)
    expect(own?.versionUid).not.toBe(versionUid)
    reloaded.unload()
  })

  it('item.unpublish() clears the in-memory latest version once its versions are revoked', async () => {
    const { item, seedLocalId, seedUid } = await createPublishedItemForUnpublish({
      title: 'Unpublish clears latest version',
    })
    const db = BaseDb.getAppDb()
    const versionUid = nextUid()
    await db
      .update(versions)
      .set({ uid: versionUid, seedUid })
      .where(eq(versions.seedLocalId, seedLocalId))
    item.getService().send({ type: 'updateContext', latestVersionUid: versionUid })
    expect(item.latestVersionUid).toBe(versionUid)

    // Like the publish package's executor: stamps the seed and its version attestations.
    setRevokeExecutor(async ({ seedLocalId: id }) => {
      await updateSeedRevokedAt({
        seedLocalId: id,
        revokedAt: Math.floor(Date.now() / 1000),
        versionUids: [versionUid],
      })
    })
    try {
      await item.unpublish()
    } finally {
      setRevokeExecutor(null)
    }

    expect(item.isRevoked).toBe(true)
    expect(item.latestVersionUid).toBeFalsy()
    expect(item.latestVersionLocalId).toBeFalsy()
  })
})
