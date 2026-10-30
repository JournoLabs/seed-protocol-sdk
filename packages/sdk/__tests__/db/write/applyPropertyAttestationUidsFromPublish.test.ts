import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { eq } from 'drizzle-orm'
import { applyPropertyAttestationUidsFromPublish } from '@/db/write/applyPropertyAttestationUidsFromPublish'
import { getPublishPendingDiff } from '@/db/read/getPublishPendingDiff'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
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
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('writes UIDs onto the attested rows and clears pending diff', async () => {
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
        { schemaUid: SCHEMA_TITLE, attestationUid: ATTEST_TITLE, propertyName: 'title', metadataLocalId: titleRow!.localId },
        { schemaUid: SCHEMA_COUNT, attestationUid: ATTEST_COUNT, propertyName: 'count', metadataLocalId: countRow!.localId },
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

  it('gives each row it records the attester as publisher', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({ title: 'Attester publisher', count: 7 })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()
    const eoa = '0x' + '1'.repeat(40)
    const smartAccount = '0x' + '2'.repeat(40)
    const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
    const titleRow = rows.find((r) => r.propertyName === 'title')!
    await db
      .update(metadata)
      .set({ schemaUid: SCHEMA_TITLE, uid: null, publisher: eoa })
      .where(eq(metadata.localId, titleRow.localId!))

    await applyPropertyAttestationUidsFromPublish({
      seedLocalId,
      attestationCreatedAtMs: Date.now(),
      publisher: smartAccount,
      pairs: [{ schemaUid: SCHEMA_TITLE, attestationUid: '0x' + 'a1'.repeat(32), metadataLocalId: titleRow.localId }],
    })

    const [after] = await db.select().from(metadata).where(eq(metadata.localId, titleRow.localId!))
    expect(after?.publisher).toBe(smartAccount)
  })

  it('never writes a UID onto a row sync derived from a storage_transaction_id attestation', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Derived row is no placeholder',
      count: 3,
    })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()
    const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
    const titleRow = rows.find((r) => r.propertyName === 'title')!

    const t = Date.now()
    await db
      .update(metadata)
      .set({ schemaUid: null, uid: null, attestationCreatedAt: null, createdAt: t })
      .where(eq(metadata.localId, titleRow.localId!))
    // Newer, no uid, same property: only the marker says it isn't a placeholder.
    const derivedLocalId = `derived_title_${t}`
    await db.insert(metadata).values({
      localId: derivedLocalId,
      uid: null,
      propertyName: 'title',
      propertyValue: 'tx-id',
      refValueType: 'file',
      seedLocalId,
      derivedFromUid: '0x' + 'a'.repeat(64),
      createdAt: t + 5,
    })

    await applyPropertyAttestationUidsFromPublish({
      seedLocalId,
      attestationCreatedAtMs: t + 10_000,
      pairs: [{ schemaUid: SCHEMA_TITLE, attestationUid: ATTEST_TITLE, propertyName: 'title', metadataLocalId: titleRow.localId }],
    })

    const [derived] = await db.select().from(metadata).where(eq(metadata.localId, derivedLocalId))
    expect(derived?.uid).toBeNull()
    const [title] = await db.select().from(metadata).where(eq(metadata.localId, titleRow.localId!))
    expect(title?.uid).toBe(ATTEST_TITLE)
  })

  it('records the row the payload read, not a newer placeholder of the same property (G18-4)', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Attested value',
      count: 7,
    })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()
    const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
    const titleRow = rows.find((r) => r.propertyName === 'title')!

    // An edit that landed after the payload was built: newer, no uid, another value.
    const t = Date.now()
    const newerLocalId = `newer_title_${t}`
    await db.insert(metadata).values({
      localId: newerLocalId,
      uid: null,
      propertyName: 'title',
      propertyValue: 'edited after the payload',
      seedLocalId,
      versionLocalId: titleRow.versionLocalId,
      createdAt: t + 60_000,
    })

    await applyPropertyAttestationUidsFromPublish({
      seedLocalId,
      attestationCreatedAtMs: t,
      pairs: [{ schemaUid: SCHEMA_TITLE, attestationUid: ATTEST_TITLE, propertyName: 'title', metadataLocalId: titleRow.localId }],
    })

    const [attested] = await db.select().from(metadata).where(eq(metadata.localId, titleRow.localId!))
    const [newer] = await db.select().from(metadata).where(eq(metadata.localId, newerLocalId))
    expect(attested?.uid).toBe(ATTEST_TITLE)
    expect(attested?.propertyValue).toBe('Attested value')
    expect(newer?.uid).toBeNull()
    const diff = await getPublishPendingDiff({ seedLocalId })
    expect(diff.pendingProperties.map((p) => p.propertyName)).toContain('title')
  })

  it('backfills the schema uid of an attested row that has none', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'No schema uid',
      count: 3,
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
        schemaUid: null,
        uid: null,
        attestationCreatedAt: null,
        createdAt: t,
      })
      .where(eq(metadata.localId, titleRow!.localId!))
    await db
      .update(metadata)
      .set({
        schemaUid: null,
        uid: null,
        attestationCreatedAt: null,
        createdAt: t + 1,
      })
      .where(eq(metadata.localId, countRow!.localId!))

    await applyPropertyAttestationUidsFromPublish({
      seedLocalId,
      attestationCreatedAtMs: t + 10_000,
      pairs: [
        { schemaUid: SCHEMA_TITLE, attestationUid: ATTEST_TITLE, propertyName: 'title', metadataLocalId: titleRow!.localId },
        { schemaUid: SCHEMA_COUNT, attestationUid: ATTEST_COUNT, propertyName: 'count', metadataLocalId: countRow!.localId },
      ],
    })

    const titleAfter = await db.select().from(metadata).where(eq(metadata.localId, titleRow!.localId!))
    const countAfter = await db.select().from(metadata).where(eq(metadata.localId, countRow!.localId!))
    expect(titleAfter[0]?.uid).toBe(ATTEST_TITLE)
    expect(titleAfter[0]?.schemaUid?.toLowerCase()).toBe(SCHEMA_TITLE.toLowerCase())
    expect(countAfter[0]?.uid).toBe(ATTEST_COUNT)
    expect(countAfter[0]?.schemaUid?.toLowerCase()).toBe(SCHEMA_COUNT.toLowerCase())

    const diff = await getPublishPendingDiff({ seedLocalId })
    const stillPending = diff.pendingProperties.filter(
      (p) => p.propertyName === 'title' || p.propertyName === 'count',
    )
    expect(stillPending).toHaveLength(0)
  })

  it('a pair without a row id records nothing on the rows of its property (no search by name)', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({
      title: 'Mismatched schema uid',
      count: 1,
    })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()
    const rows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
    const titleRow = rows.find((r) => r.propertyName === 'title')
    expect(titleRow?.localId).toBeTruthy()

    await db
      .update(metadata)
      .set({
        schemaUid: SCHEMA_COUNT,
        uid: null,
        attestationCreatedAt: null,
      })
      .where(eq(metadata.localId, titleRow!.localId!))

    await applyPropertyAttestationUidsFromPublish({
      seedLocalId,
      attestationCreatedAtMs: Date.now(),
      pairs: [{ schemaUid: SCHEMA_TITLE, attestationUid: ATTEST_TITLE, propertyName: 'title' }],
    })

    const after = await db.select().from(metadata).where(eq(metadata.localId, titleRow!.localId!))
    expect(after[0]?.uid == null || after[0]?.uid === '').toBe(true)
    expect(after[0]?.schemaUid?.toLowerCase()).toBe(SCHEMA_COUNT.toLowerCase())
  })
})
