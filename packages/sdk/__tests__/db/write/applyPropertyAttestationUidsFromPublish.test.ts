import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { applyPropertyAttestationUidsFromPublish } from '@/db/write/applyPropertyAttestationUidsFromPublish'
import { getPublishPendingDiff } from '@/db/read/getPublishPendingDiff'
import { setupTestEnvironment, teardownTestEnvironment } from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const SCHEMA_TITLE = '0x' + '1'.repeat(64)
const SCHEMA_COUNT = '0x' + '2'.repeat(64)
const ATTEST_TITLE = '0x' + 'e'.repeat(64)
const ATTEST_COUNT = '0x' + 'f'.repeat(64)

testDescribe('applyPropertyAttestationUidsFromPublish', () => {
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

  it('writes UIDs onto latest placeholder metadata rows and clears pending diff', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Apply UID test',
      count: 42,
    })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()

    const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
    const titleRow = rows.find((r) => r.propertyName === 'title')
    const countRow = rows.find((r) => r.propertyName === 'count')
    expect(titleRow?.localId).toBeTruthy()
    expect(countRow?.localId).toBeTruthy()

    const t = Date.now()
    await db
      .update(metadata)
      .set({
        schemaUid: SCHEMA_TITLE,
        uid: null,
        attestationCreatedAt: null,
        createdAt: t,
      })
      .where(eq(metadata.localId, titleRow!.localId!))
    await db
      .update(metadata)
      .set({
        schemaUid: SCHEMA_COUNT,
        uid: null,
        attestationCreatedAt: null,
        createdAt: t + 1,
      })
      .where(eq(metadata.localId, countRow!.localId!))

    let diff = await getPublishPendingDiff({ seedLocalId })
    const pendingBefore = diff.pendingProperties.map((p) => p.propertyName)
    expect(pendingBefore).toContain('title')
    expect(pendingBefore).toContain('count')

    await applyPropertyAttestationUidsFromPublish({
      seedLocalId,
      attestationCreatedAtMs: t + 10_000,
      pairs: [
        { schemaUid: SCHEMA_TITLE, attestationUid: ATTEST_TITLE, propertyName: 'title' },
        { schemaUid: SCHEMA_COUNT, attestationUid: ATTEST_COUNT, propertyName: 'count' },
      ],
    })

    const after = await db.select().from(metadata).where(eq(metadata.localId, titleRow!.localId!))
    expect(after[0]?.uid).toBe(ATTEST_TITLE)
    expect(after[0]?.attestationCreatedAt).toBe(t + 10_000)

    diff = await getPublishPendingDiff({ seedLocalId })
    const stillPending = diff.pendingProperties.filter(
      (p) => p.propertyName === 'title' || p.propertyName === 'count',
    )
    expect(stillPending).toHaveLength(0)
  })

  it('with two placeholder title rows same timestamp, applies UID to local_id tie-break winner', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Two placeholders tie',
      count: 7,
    })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()
    const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
    const titleRow = rows.find((r) => r.propertyName === 'title')
    expect(titleRow?.localId).toBeTruthy()

    const t = Date.now()
    await db.insert(metadata).values({
      localId: `aaa_2ph_title_${t}`,
      uid: null,
      propertyName: titleRow!.propertyName,
      propertyValue: titleRow!.propertyValue,
      schemaUid: SCHEMA_TITLE,
      modelType: titleRow!.modelType,
      seedLocalId: titleRow!.seedLocalId,
      seedUid: titleRow!.seedUid,
      versionLocalId: titleRow!.versionLocalId,
      versionUid: titleRow!.versionUid,
      easDataType: titleRow!.easDataType,
      createdAt: t,
      attestationCreatedAt: null,
    })

    await db
      .update(metadata)
      .set({
        localId: `zzz_2ph_title_${t}`,
        uid: null,
        schemaUid: SCHEMA_TITLE,
        createdAt: t,
        attestationCreatedAt: null,
      })
      .where(eq(metadata.localId, titleRow!.localId!))

    let diff = await getPublishPendingDiff({ seedLocalId })
    expect(diff.pendingProperties.map((p) => p.propertyName)).toContain('title')

    await applyPropertyAttestationUidsFromPublish({
      seedLocalId,
      attestationCreatedAtMs: t + 5_000,
      pairs: [{ schemaUid: SCHEMA_TITLE, attestationUid: ATTEST_TITLE, propertyName: 'title' }],
    })

    const zzz = await db.select().from(metadata).where(eq(metadata.localId, `zzz_2ph_title_${t}`))
    const aaa = await db.select().from(metadata).where(eq(metadata.localId, `aaa_2ph_title_${t}`))
    expect(zzz[0]?.uid).toBe(ATTEST_TITLE)
    expect(aaa[0]?.uid == null || aaa[0]?.uid === '').toBe(true)

    diff = await getPublishPendingDiff({ seedLocalId })
    expect(diff.pendingProperties.map((p) => p.propertyName)).not.toContain('title')
  })
})
