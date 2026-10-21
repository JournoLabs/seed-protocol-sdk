/**
 * Publishing a cleared property (ADR 0021): a removal attests the EAS type's empty value, in both
 * modes; a retraction attests nothing and is counted as revocations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { getPublishPayload, type PublishMode } from '@/db/read/getPublishPayload'
import { getPublishPendingDiff } from '@/db/read/getPublishPendingDiff'
import { summarizePublishWork } from '@/db/read/summarizePublishWork'
import { getPendingRetractions } from '@/db/read/getPropertyClear'
import { PublishValidationFailedError } from '@/db/read/publishErrors'
import { loadEasSdk } from '@/helpers/easSdk'
import type { Item as ItemClass } from '@/Item/Item'
import type { IItemProperty } from '@/interfaces'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
  createItemWithImageAndUploadedTx,
  markPublished,
  randomUid,
  UNPUBLISH_TEST_PUBLISHER,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const ZERO_BYTES32 = `0x${'0'.repeat(64)}`

const propertyOf = (item: ItemClass<any>, name: string) =>
  item.properties.find((p) => p.propertyName === name || p.propertyName === `${name}Id`) as IItemProperty<any>

/** The item's own attestations in a publish payload, each decoded as a `string` (Text, Number). */
async function attested(item: ItemClass<any>, publishMode: PublishMode = 'patch') {
  const payloads = await getPublishPayload(item, [], { publishMode })
  const own = payloads.find((p) => p.localId === item.seedLocalId)
  const { SchemaEncoder } = await loadEasSdk()
  return (own?.listOfAttestations ?? []).map((a: any) => {
    let value: unknown
    try {
      value = new SchemaEncoder('string value').decodeData(a.data[0].data)[0]?.value?.value
    } catch {
      value = undefined
    }
    return { name: a._propertyName as string, value }
  })
}

const ownAttestationNames = async (item: ItemClass<any>, publishMode: PublishMode = 'patch') =>
  (await getPublishPayload(item, [], { publishMode }))
    .find((p) => p.localId === item.seedLocalId)!
    .listOfAttestations.map((a: any) => a._propertyName as string)

const ownAttestationData = async (item: ItemClass<any>, name: string, publishMode: PublishMode = 'patch') =>
  (await getPublishPayload(item, [], { publishMode }))
    .find((p) => p.localId === item.seedLocalId)!
    .listOfAttestations.find((a: any) => a._propertyName === name)?.data[0].data as string | undefined

testDescribe('publishing a cleared property', () => {
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

  it('attests a zero bytes32 for a removed Image, and reports it as removed', async () => {
    const { postItem, imageItem } = await createItemWithImageAndUploadedTx()
    await markPublished(postItem, [imageItem])
    expect(await ownAttestationNames(postItem)).toEqual([])
    const coverImage = propertyOf(postItem, 'coverImage')

    await coverImage.clear()

    const names = await ownAttestationNames(postItem)
    expect(names).toEqual([coverImage.propertyName])
    expect(await ownAttestationData(postItem, coverImage.propertyName)).toBe(ZERO_BYTES32)
    const { pendingProperties } = await getPublishPendingDiff(postItem)
    expect(pendingProperties.map((p) => [p.propertyName.replace(/Id$/, ''), p.change])).toEqual([['coverImage', 'removed']])
    const summary = await summarizePublishWork(postItem, { publishMode: 'patch' })
    expect(summary.attestationCount).toBe(1)
    expect(summary.revocationCount).toBe(0)
  }, 60_000)

  it("attests '' for Text and Number set empty after publish", async () => {
    const { item } = await createItemWithBasicPropertiesOnly()
    await markPublished(item)

    await propertyOf(item, 'title').clear()
    await propertyOf(item, 'count').clear()

    const values = Object.fromEntries((await attested(item)).map((a) => [a.name, a.value]))
    expect(values).toEqual({ title: '', count: '' })
  }, 60_000)

  it('attests the removal in new_version mode too, with the other values', async () => {
    const { item } = await createItemWithBasicPropertiesOnly()
    await markPublished(item)
    await propertyOf(item, 'title').clear()

    const values = Object.fromEntries((await attested(item, 'new_version')).map((a) => [a.name, a.value]))
    expect(values.title).toBe('')
    expect(values.count).toBe('42')
  }, 60_000)

  it('attests nothing for a retraction and counts its revocation', async () => {
    const { postItem, imageItem } = await createItemWithImageAndUploadedTx()
    await markPublished(postItem, [imageItem])
    const coverImage = propertyOf(postItem, 'coverImage')

    await coverImage.clear({ retract: true })

    expect(await ownAttestationNames(postItem)).toEqual([])
    const { pendingProperties } = await getPublishPendingDiff(postItem)
    expect(pendingProperties.map((p) => p.change)).toEqual(['retracted'])
    const summary = await summarizePublishWork(postItem, { publishMode: 'patch' })
    expect(summary.attestationCount).toBe(0)
    expect(summary.revocationCount).toBe(1)
  }, 60_000)

  it('retracts the newest Version\'s attestations and same-valued ones on earlier Versions, not other values', async () => {
    const { postItem, imageItem } = await createItemWithImageAndUploadedTx()
    await markPublished(postItem, [imageItem])
    const coverImage = propertyOf(postItem, 'coverImage')
    const db = BaseDb.getAppDb()
    const [current] = await db.select().from(metadata).where(eq(metadata.localId, coverImage.localId!))
    const { localId: _l, uid: currentUid, ...row } = current!
    // Two attestations on an earlier Version: the same image, and a different one
    const earlier = { versionUid: randomUid(), attestationCreatedAt: row.attestationCreatedAt! - 5_000 }
    const sameUid = randomUid()
    const otherUid = randomUid()
    await db.insert(metadata).values([
      { ...row, ...earlier, localId: 'cover-same-01', uid: sameUid, createdAt: earlier.attestationCreatedAt },
      { ...row, ...earlier, localId: 'cover-other1', uid: otherUid, propertyValue: randomUid(), createdAt: earlier.attestationCreatedAt },
    ])

    await coverImage.clear({ retract: true })

    const [retraction] = await getPendingRetractions({ seedLocalId: postItem.seedLocalId, seedUid: postItem.seedUid })
    expect(retraction?.attestations.map((a) => a.uid).sort()).toEqual([currentUid!, sameUid].sort())
  }, 60_000)

  it("doesn't publish or report a property cleared before it was ever attested", async () => {
    const { item } = await createItemWithBasicPropertiesOnly()
    await markPublished(item)
    const db = BaseDb.getAppDb()
    // A property the published version never had: give its row no uid, as if added after publish
    const title = propertyOf(item, 'title')
    await db.update(metadata).set({ uid: null }).where(eq(metadata.localId, title.localId!))
    title.getService().send({ type: 'updateContext', uid: undefined })

    await title.clear()

    expect(await ownAttestationNames(item)).not.toContain('title')
    const { pendingProperties } = await getPublishPendingDiff(item)
    expect(pendingProperties.map((p) => p.propertyName)).not.toContain('title')
  }, 60_000)

  it('fails validation for a published Boolean whose value is empty', async () => {
    const { item } = await createItemWithBasicPropertiesOnly()
    await markPublished(item)
    const isPublished = propertyOf(item, 'isPublished')
    // Assigning null is refused locally (a Boolean); a draft row with none can still come from
    // elsewhere, e.g. an import
    const [published] = await BaseDb.getAppDb().select().from(metadata).where(eq(metadata.localId, isPublished.localId!))
    const { localId: _localId, uid: _uid, ...rest } = published!
    await BaseDb.getAppDb()
      .insert(metadata)
      .values({ ...rest, localId: 'emptybool01', uid: null, propertyValue: null, attestationCreatedAt: null, createdAt: Date.now() })
    isPublished.getService().send({
      type: 'updateContext',
      localId: 'emptybool01',
      uid: undefined,
      propertyValue: null,
      renderValue: null,
    })

    const error = await getPublishPayload(item, [], { publishMode: 'patch' }).catch((e) => e)
    expect(error).toBeInstanceOf(PublishValidationFailedError)
    expect(error.validationErrors.map((e: { code: string }) => e.code)).toContain('publish_clear_unsupported')
  }, 60_000)
})
