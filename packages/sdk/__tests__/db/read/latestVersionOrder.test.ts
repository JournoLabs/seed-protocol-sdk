import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { getLatestVersionRow } from '@/db/read/getLatestVersionRow'
import { getLatestPublishedVersionRow } from '@/db/read/getLatestPublishedVersionRow'
import { batchLatestPublishedVersionBySeedLocalIds } from '@/db/read/batchLatestPublishedVersionBySeedLocalIds'
import { getItemData } from '@/db/read/getItemData'
import { getItemsData } from '@/db/read/getItems'
import { updateVersionUid } from '@/db/write/updateVersionUid'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import { waitForIdle } from '../../test-utils/waitForIdle'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
  UNPUBLISH_TEST_PUBLISHER,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

// Sync inserts a batch of versions with one created_at, so every head-version reader must break
// the tie the same way: COALESCE(attestation_created_at, created_at) DESC, local_id DESC.

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const SCHEMA_NAME = 'Test Schema getPublishPayload'
const uid = (prefix: string, n: number) => '0x' + (prefix + n.toString(16)).padEnd(64, 'e')

/** Every reader's head version for the seed, keyed by reader. */
const readHeads = async (seedLocalId: string) => {
  const itemData = await getItemData({ seedLocalId } as Parameters<typeof getItemData>[0])
  const listData = (await getItemsData({ modelName: 'Post', schemaName: SCHEMA_NAME, includeEas: true } as Parameters<
    typeof getItemsData
  >[0])) as { seedLocalId?: string; latestVersionLocalId?: string; publishedVersionLocalId?: string }[]
  const listRow = listData.find((r) => r.seedLocalId === seedLocalId)
  const batch = await batchLatestPublishedVersionBySeedLocalIds([seedLocalId])
  return {
    getLatestVersionRow: (await getLatestVersionRow(seedLocalId))?.localId,
    getItemData: itemData?.latestVersionLocalId,
    getItemsData: listRow?.latestVersionLocalId,
    getLatestPublishedVersionRow: (await getLatestPublishedVersionRow(seedLocalId))?.localId,
    getItemDataPublished: itemData?.publishedVersionLocalId,
    getItemsDataPublished: listRow?.publishedVersionLocalId,
    batchLatestPublished: batch.get(seedLocalId)?.localId ?? undefined,
  }
}

testDescribe('head version order when versions tie on created_at', () => {
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

  /**
   * A Post plus the given versions, all with one created_at, as sync inserts them. `createdAt` is in
   * the future, so the item's own version is older than all of them.
   */
  const seedWithTiedVersions = async (
    title: string,
    seedUid: string,
    rows: { localId: string; uid: string | null; attestationCreatedAt: number | null }[],
    createdAt: number,
  ) => {
    const { item } = await createItemWithBasicPropertiesOnly({ title, count: 1 })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()
    await db.update(seeds).set({ uid: seedUid }).where(eq(seeds.localId, seedLocalId))
    await db.insert(versions).values(
      rows.map((r) => ({
        ...r,
        seedLocalId,
        seedUid,
        seedType: 'post',
        createdAt,
        publisher: UNPUBLISH_TEST_PUBLISHER,
      })),
    )
    const tied = await db.select().from(versions).where(eq(versions.createdAt, createdAt))
    expect(tied).toHaveLength(rows.length)
    return { item, seedLocalId }
  }

  it('every reader picks the newest attestation (audit V12)', async () => {
    const t = Date.now() + 10_000
    // Local ids sort differently under binary order ('B' < 'a') and localeCompare ('a' < 'B'), and
    // neither puts the newest attestation first.
    const { item, seedLocalId } = await seedWithTiedVersions(
      'Head order V12',
      uid('5eed', 1),
      [
        { localId: 'Bv12aaaaaa', uid: uid('12ab', 2), attestationCreatedAt: t - 3000 },
        { localId: 'av12bbbbbb', uid: uid('12ab', 3), attestationCreatedAt: t - 2000 },
        { localId: '0v12cccccc', uid: uid('12ab', 4), attestationCreatedAt: t - 1000 },
      ],
      t,
    )
    const expected = '0v12cccccc'

    const heads = await readHeads(seedLocalId)
    expect(heads).toEqual(Object.fromEntries(Object.keys(heads).map((k) => [k, expected])))

    item.unload()
    ItemProperty.clearInstanceCacheForItem(seedLocalId)
    const reloaded = await Item.find({ seedLocalId, modelName: 'Post', schemaName: SCHEMA_NAME })
    await waitForIdle(reloaded!, 'reloaded item')
    expect(reloaded!.latestVersionLocalId).toBe(expected)
    // In the browser the item's versions watch re-picks the head after load; it must keep it.
    await new Promise((r) => setTimeout(r, 500))
    expect(reloaded!.latestVersionLocalId).toBe(expected)
  }, 60_000)

  it('falls back to local_id DESC when attestation times tie too, and publish stamps that version', async () => {
    const t = Date.now() + 20_000
    const { seedLocalId } = await seedWithTiedVersions(
      'Head order full tie',
      uid('5eed', 2),
      [
        { localId: 'Bv12dddddd', uid: null, attestationCreatedAt: null },
        { localId: 'av12eeeeee', uid: null, attestationCreatedAt: null },
        { localId: '0v12ffffff', uid: null, attestationCreatedAt: null },
      ],
      t,
    )
    // SQLite compares text by bytes: 'a' (0x61) > 'B' (0x42) > '0' (0x30).
    const expected = 'av12eeeeee'

    expect((await getLatestVersionRow(seedLocalId))?.localId).toBe(expected)
    const heads = await readHeads(seedLocalId)
    expect(heads.getItemData).toBe(expected)
    expect(heads.getItemsData).toBe(expected)

    // The publish stamps the head placeholder, so the published version is the head version.
    const versionUid = uid('57a3', 1)
    await updateVersionUid({ seedLocalId, versionUid, attestationCreatedAt: t })
    const [stamped] = await BaseDb.getAppDb()
      .select({ localId: versions.localId })
      .from(versions)
      .where(eq(versions.uid, versionUid))
    expect(stamped?.localId).toBe(expected)

    const after = await readHeads(seedLocalId)
    expect(after).toEqual(Object.fromEntries(Object.keys(after).map((k) => [k, expected])))
  }, 60_000)
})
