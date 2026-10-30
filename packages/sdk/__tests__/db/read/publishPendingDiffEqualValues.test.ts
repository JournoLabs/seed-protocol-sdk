/**
 * An edit that puts a property back to its published value is not an unpublished change: the
 * outbox leaves no draft for it, and the pending diff and the publish payload leave it out.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { getPublishPendingDiff } from '@/db/read/getPublishPendingDiff'
import { recordPublishRequests, type PublishRequestRecord } from '@/db/write/recordPublishRequests'
import { propertyValuesEqual } from '@/helpers/propertyValuesEqual'
import { generateId } from '@/helpers'
import type { Item as ItemClass } from '@/Item/Item'
import type { IItemProperty } from '@/interfaces'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  createItemWithBasicPropertiesOnly,
  createItemWithRelation,
  markPublished,
  randomUid,
  UNPUBLISH_TEST_PUBLISHER,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'

const testDescribe =
  typeof window === 'undefined' ? describe.sequential || describe : describe

const propertyOf = (item: ItemClass<any>, name: string) =>
  item.properties.find(
    (p) => p.propertyName === name || p.propertyName === `${name}Id`,
  ) as IItemProperty<any>

/** Assigns `value` and waits for the outbox to apply it. */
async function edit(item: ItemClass<any>, name: string, value: string) {
  propertyOf(item, name).value = value
  const { waitForPendingOutboxOps } = await import('@/outbox')
  await waitForPendingOutboxOps({ seedLocalIds: [item.seedLocalId!] })
}

const pendingNames = async (item: ItemClass<any>) =>
  (await getPublishPendingDiff(item)).pendingProperties.map((p) =>
    p.propertyName.replace(/Id$/, ''),
  )

const attestedNames = async (item: ItemClass<any>) =>
  (await getPublishPayload(item, [], { publishMode: 'patch' }))
    .find((p) => p.localId === item.seedLocalId)!
    .listOfAttestations.map((a: any) =>
      (a._propertyName as string).replace(/Id$/, ''),
    )

async function draftRows(item: ItemClass<any>, name: string) {
  const property = propertyOf(item, name)
  return BaseDb.getAppDb()
    .select()
    .from(metadata)
    .where(
      and(
        eq(metadata.seedLocalId, item.seedLocalId!),
        eq(metadata.propertyName, property.propertyName),
        isNull(metadata.uid),
      ),
    )
}

testDescribe('equal property values', () => {
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

  describe('an edit back to the published value', () => {
    it('leaves no draft, and neither the pending diff nor the publish lists it', async () => {
      const { item } = await createItemWithBasicPropertiesOnly({
        title: 'Published title',
        count: 1,
      })
      await markPublished(item)

      await edit(item, 'title', 'Changed title')
      expect(await pendingNames(item)).toEqual(['title'])

      await edit(item, 'title', 'Published title')
      expect(await draftRows(item, 'title')).toEqual([])
      expect(await pendingNames(item)).toEqual([])
      expect(await attestedNames(item)).toEqual([])
      expect(propertyOf(item, 'title').value).toBe('Published title')
    }, 60_000)

    it('compares a relation by its seed: a local id equals the uid the publish recorded', async () => {
      const { authorItem, postItem } = await createItemWithRelation({
        postTitle: 'Relation round trip',
      })
      const { authorItem: otherAuthor } = await createItemWithRelation({
        authorName: 'Other Author',
      })
      await markPublished(postItem, [authorItem, otherAuthor])
      // A publish records a relation as the seed uid it attested
      const author = propertyOf(postItem, 'author')
      await BaseDb.getAppDb()
        .update(metadata)
        .set({ propertyValue: authorItem.seedUid })
        .where(
          and(
            eq(metadata.seedLocalId, postItem.seedLocalId!),
            eq(metadata.propertyName, author.propertyName),
          ),
        )

      await edit(postItem, 'author', otherAuthor.seedLocalId!)
      expect(await pendingNames(postItem)).toEqual(['author'])

      await edit(postItem, 'author', authorItem.seedLocalId!)
      expect(await draftRows(postItem, 'author')).toEqual([])
      expect(await pendingNames(postItem)).toEqual([])
    }, 60_000)

    it('is still an edit when sync has written a newer value since', async () => {
      const { item } = await createItemWithBasicPropertiesOnly({
        title: 'Old title',
        count: 1,
      })
      await markPublished(item)
      const title = propertyOf(item, 'title')
      const db = BaseDb.getAppDb()
      const [attested] = await db
        .select()
        .from(metadata)
        .where(
          and(
            eq(metadata.seedLocalId, item.seedLocalId!),
            eq(metadata.propertyName, title.propertyName),
          ),
        )
      const now = Date.now()
      await db.insert(metadata).values({
        ...attested!,
        localId: generateId(),
        uid: randomUid(),
        propertyValue: 'Synced title',
        attestationCreatedAt: now,
        createdAt: now,
        updatedAt: now,
      })

      // setValue: the property still shows the old title, which the value setter would skip
      title.setValue('Old title')
      const { waitForPendingOutboxOps } = await import('@/outbox')
      await waitForPendingOutboxOps({ seedLocalIds: [item.seedLocalId!] })
      expect(
        (await draftRows(item, 'title')).map(
          (row: { propertyValue: string | null }) => row.propertyValue,
        ),
      ).toEqual(['Old title'])
      const { pendingProperties } = await getPublishPendingDiff(item)
      expect(
        pendingProperties.map((p) => [
          p.propertyName,
          p.currentValue,
          p.previousPublishedValue,
        ]),
      ).toEqual([[title.propertyName, 'Old title', 'Synced title']])
    }, 60_000)
  })

  describe('propertyValuesEqual', () => {
    it('compares lists of seeds member by member, in order', async () => {
      const { authorItem: a } = await createItemWithRelation({
        authorName: 'List A',
      })
      const { authorItem: b } = await createItemWithRelation({
        authorName: 'List B',
      })
      await markPublished(a, [b])
      const list = { dataType: 'List', refValueType: 'Relation' }
      const local = JSON.stringify([a.seedLocalId, b.seedLocalId])
      expect(
        await propertyValuesEqual(
          list,
          local,
          JSON.stringify([a.seedUid, b.seedUid]),
        ),
      ).toBe(true)
      expect(
        await propertyValuesEqual(
          list,
          local,
          JSON.stringify([b.seedUid, a.seedUid]),
        ),
      ).toBe(false)
      expect(
        await propertyValuesEqual(list, local, JSON.stringify([a.seedUid])),
      ).toBe(false)
    }, 60_000)

    it('treats null and an empty string as the same, and plain values as stored', async () => {
      expect(await propertyValuesEqual({ dataType: 'Text' }, null, '')).toBe(
        true,
      )
      expect(await propertyValuesEqual({ dataType: 'Text' }, null, 'x')).toBe(
        false,
      )
      expect(await propertyValuesEqual({ dataType: 'Text' }, 'x', 'x')).toBe(
        true,
      )
      expect(await propertyValuesEqual({ dataType: 'Text' }, 'x', 'X')).toBe(
        false,
      )
    })
  })

  describe('recordPublishRequests', () => {
    /** One new item's publish: its seed, version and title property, with fresh uids. */
    const publishRecord = async (title: string) => {
      const { item } = await createItemWithBasicPropertiesOnly({ title, count: 1 })
      const seedLocalId = item.seedLocalId!
      const db = BaseDb.getAppDb()
      const titleName = propertyOf(item, 'title').propertyName
      const [row] = await db
        .select()
        .from(metadata)
        .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, titleName)))
      const versionUid = randomUid()
      const seedUid = randomUid()
      const record: PublishRequestRecord = {
        seed: { seedLocalId, seedUid, publisher: UNPUBLISH_TEST_PUBLISHER },
        version: { seedLocalId, versionUid, publisher: UNPUBLISH_TEST_PUBLISHER },
        properties: {
          seedLocalId,
          attestationCreatedAtMs: Date.now(),
          versionUid,
          publisher: UNPUBLISH_TEST_PUBLISHER,
          pairs: [{ schemaUid: randomUid(), attestationUid: randomUid(), metadataLocalId: row!.localId }],
        },
      }
      const rows = async () => {
        const seedRows = await db.select().from(seeds).where(eq(seeds.localId, seedLocalId))
        const versionRows = await db.select().from(versions).where(eq(versions.seedLocalId, seedLocalId))
        const metadataRows = await db.select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
        return {
          seedUid: seedRows[0]?.uid ?? null,
          versionUids: versionRows.map((v: { uid: string | null }) => v.uid).sort(),
          metadataUids: metadataRows.map((m: { uid: string | null }) => m.uid).sort(),
          metadataRows: metadataRows.length,
        }
      }
      return { record, rows, seedUid, versionUid }
    }

    it('a failure partway leaves nothing recorded', async () => {
      const first = await publishRecord('Rolled back one')
      const second = await publishRecord('Rolled back two')
      const before = [await first.rows(), await second.rows()]

      // Seeds are written last, so this fails after every version and property write.
      const failing = {
        ...second.record,
        seed: {
          seedLocalId: second.record.seed!.seedLocalId,
          get seedUid(): string {
            throw new Error('write failed')
          },
        },
      }
      await expect(recordPublishRequests([first.record, failing])).rejects.toThrow('write failed')

      expect([await first.rows(), await second.rows()]).toEqual(before)
    })

    it('writing the same records again changes nothing', async () => {
      const { record, rows, seedUid, versionUid } = await publishRecord('Recorded twice')

      await recordPublishRequests([record])
      const once = await rows()
      expect(once.seedUid).toBe(seedUid)
      expect(once.versionUids).toContain(versionUid)

      await recordPublishRequests([record])
      expect(await rows()).toEqual(once)
    })

    it('records the version uid and the property uids together', async () => {
      const { item } = await createItemWithBasicPropertiesOnly({
        title: 'Receipt title',
        count: 1,
      })
      const title = propertyOf(item, 'title')
      const db = BaseDb.getAppDb()
      const [row] = await db
        .select()
        .from(metadata)
        .where(
          and(
            eq(metadata.seedLocalId, item.seedLocalId!),
            eq(metadata.propertyName, title.propertyName),
          ),
        )
      const versionUid = randomUid()
      const propertyUid = randomUid()

      await recordPublishRequests([
        {
          version: {
            seedLocalId: item.seedLocalId!,
            versionUid,
            publisher: UNPUBLISH_TEST_PUBLISHER,
          },
          properties: {
            seedLocalId: item.seedLocalId!,
            attestationCreatedAtMs: Date.now(),
            versionUid,
            publisher: UNPUBLISH_TEST_PUBLISHER,
            pairs: [
              {
                schemaUid: randomUid(),
                attestationUid: propertyUid,
                metadataLocalId: row!.localId,
              },
            ],
          },
        },
      ])

      const versionRows = await db
        .select()
        .from(versions)
        .where(eq(versions.seedLocalId, item.seedLocalId!))
      expect(versionRows.map((v: { uid: string | null }) => v.uid)).toContain(
        versionUid,
      )
      const [recorded] = await db
        .select()
        .from(metadata)
        .where(eq(metadata.localId, row!.localId!))
      expect(recorded!.uid).toBe(propertyUid)
      expect(recorded!.versionUid).toBe(versionUid)
    }, 60_000)
  })
})
