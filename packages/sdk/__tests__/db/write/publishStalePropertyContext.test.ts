/**
 * Audit 1.1 (V3b): a property context that missed an outside write attested its old value, and uid
 * recording gave the attestation uid to the newest placeholder row by name, which held the new
 * value. The payload is read from rows (publishGraph.ts), carries the row id behind each value
 * (`_metadataLocalId`), and recording updates that row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { applyPropertyAttestationUidsFromPublish } from '@/db/write/applyPropertyAttestationUidsFromPublish'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

const OLD_UID = '0x' + '7'.repeat(64)
const NEW_UID = '0x' + '8'.repeat(64)

const titleRows = async (seedLocalId: string) =>
  BaseDb.getAppDb()
    .select({ localId: metadata.localId, uid: metadata.uid, value: metadata.propertyValue })
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'title')))

/** Builds the payload, decodes the title attestation and records a receipt for it as publish does. */
const publishTitle = async (item: any) => {
  const payload = await getPublishPayload(item, [])
  const att = payload[0]!.listOfAttestations.find((a: any) => a._propertyName === 'title') as any
  expect(att).toBeDefined()
  const [field] = new SchemaEncoder('string title').decodeData(att.data[0].data)
  await applyPropertyAttestationUidsFromPublish({
    seedLocalId: item.seedLocalId,
    attestationCreatedAtMs: Date.now(),
    pairs: [
      {
        schemaUid: att.schema,
        attestationUid: NEW_UID,
        propertyName: 'title',
        metadataLocalId: att._metadataLocalId,
      },
    ],
  })
  const holder = (await titleRows(item.seedLocalId)).find((r) => r.uid === NEW_UID)
  return { attested: field!.value.value, att, holder }
}

describe.sequential('publish records the uid on the row it attested', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('fresh value: the payload names the title row and recording updates it', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({ title: 'fresh value', count: 1 })
    const [row] = await titleRows(item.seedLocalId!)

    const { attested, att, holder } = await publishTitle(item)

    expect(attested).toBe('fresh value')
    expect(att._metadataLocalId).toBe(row!.localId)
    expect(holder?.localId).toBe(row!.localId)
    expect(holder?.value).toBe('fresh value')
  }, 60000)

  it('stale context: attests the newest row value, and the uid lands on that row', async () => {
    const { item } = await createItemWithBasicPropertiesOnly({ title: 'old value', count: 1 })
    const seedLocalId = item.seedLocalId!
    const db = BaseDb.getAppDb()
    const titleProp = item.properties.find((p) => p.propertyName === 'title')!

    // "Published" title: the row and the context carry an attestation uid.
    const [titleRow] = await titleRows(seedLocalId)
    await db
      .update(metadata)
      .set({ uid: OLD_UID, attestationCreatedAt: Date.now() - 60_000 })
      .where(eq(metadata.localId, titleRow!.localId))
    titleProp.getService().send({ type: 'updateContext', uid: OLD_UID } as any)

    // Outside write (another tab, a dropped live query): a new draft row the context never sees.
    const written = await updateItemPropertyValue({
      localId: titleRow!.localId,
      seedLocalId,
      propertyName: 'title',
      newValue: 'new value',
      modelName: 'Post',
    })
    expect(written?.localId).toBeTruthy()
    expect(written!.localId).not.toBe(titleRow!.localId)

    const { attested, att, holder } = await publishTitle(item)

    expect(attested).toBe('new value')
    expect(att._metadataLocalId).toBe(written!.localId)
    expect(holder?.localId).toBe(written!.localId)
    expect(holder?.value).toBe(attested)
    const old = (await titleRows(seedLocalId)).find((r) => r.localId === titleRow!.localId)
    expect(old?.uid).toBe(OLD_UID)
  }, 60000)
})
