import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, versions } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { getPublishPendingDiff } from '@/db/read/getPublishPendingDiff'
import { getItemsData } from '@/db/read/getItems'
import { getSeedPublishState } from '@/db/read/getSeedPublishState'
import { setupTestEnvironment, teardownTestEnvironment } from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const VALID_V1 = '0x' + '1'.repeat(64)
const VALID_V0 = '0x' + '0'.repeat(63) + '1'

testDescribe('getPublishPendingDiff', () => {
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

  it('uses latest row with valid EAS version uid when newest row has placeholder uid', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Pending diff version scan',
      count: 1,
    })
    const seedLocalId = item.seedLocalId
    expect(seedLocalId).toBeTruthy()

    const db = BaseDb.getAppDb()
    const existing = await db
      .select({ localId: versions.localId })
      .from(versions)
      .where(eq(versions.seedLocalId, seedLocalId))

    const now = Date.now()
    for (const row of existing) {
      await db.delete(versions).where(eq(versions.localId, row.localId!))
    }

    await db.insert(versions).values({
      localId: 'v-old-' + now,
      seedLocalId,
      seedUid: null,
      seedType: 'post',
      uid: VALID_V0,
      createdAt: now - 2000,
      attestationCreatedAt: now - 2000,
    })
    await db.insert(versions).values({
      localId: 'v-new-' + now,
      seedLocalId,
      seedUid: null,
      seedType: 'post',
      uid: 'NULL',
      createdAt: now - 1000,
    })

    const diff = await getPublishPendingDiff({ seedLocalId })
    expect(diff.lastPublishedVersionUid).toBe(VALID_V0)
    expect(diff.lastVersionPublishedAt).toBe(now - 2000)
  })

  it('getItemsData versionData uses latest version row by created_at', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'VersionData order test',
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
    expect(row?.latestVersionUid).toBe('NULL')
    expect(row?.latestVersionLocalId).toBe('vd-new-' + t)
    expect(row?.publishedVersionUid).toBe(VALID_V1)
    expect(row?.publishedVersionLocalId).toBe('vd-old-' + t)

    const state = await getSeedPublishState({ seedLocalId })
    expect(state.status).toBe('onchain')
    expect(state.versionAttestationUid).toBe(VALID_V1)
    expect(state.explorerUid).toBeTruthy()
  })

  it('when COALESCE time ties, uses local_id so attested row beats placeholder', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Tie-break pending diff',
      count: 1,
    })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()
    const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
    const titleRow = rows.find((r) => r.propertyName === 'title')
    expect(titleRow?.localId).toBeTruthy()

    const t = Date.now()
    const attestedLocalId = `zzz_tie_title_${t}`
    await db.insert(metadata).values({
      localId: attestedLocalId,
      uid: VALID_V1,
      propertyName: titleRow!.propertyName,
      propertyValue: titleRow!.propertyValue,
      schemaUid: titleRow!.schemaUid,
      modelType: titleRow!.modelType,
      seedLocalId: titleRow!.seedLocalId,
      seedUid: titleRow!.seedUid,
      versionLocalId: titleRow!.versionLocalId,
      versionUid: titleRow!.versionUid,
      easDataType: titleRow!.easDataType,
      createdAt: t,
      attestationCreatedAt: t,
    })

    await db
      .update(metadata)
      .set({
        localId: `aaa_tie_title_${t}`,
        uid: null,
        createdAt: t,
        attestationCreatedAt: t,
      })
      .where(eq(metadata.localId, titleRow!.localId!))

    for (let i = 0; i < 5; i++) {
      const diff = await getPublishPendingDiff({ seedLocalId })
      expect(
        diff.pendingProperties.map((p) => p.propertyName),
        `iteration ${i}`,
      ).not.toContain('title')
    }
  })
})
