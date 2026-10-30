import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, pendingWrites } from '@/seedSchema'
import { Item } from '@/Item/Item'
import { ItemProperty, ItemPropertySaveValidationError } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { appendOutboxOp, drainOutbox, getOutboxOps, OutboxOpFailedError, startItemOutbox, waitForOutboxOp } from '@/outbox'
import { outboxIdleForTests, pauseOutboxDrainForTests } from '@/outbox/outbox'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle } from '../test-utils/waitForIdle'

/**
 * Plain item values (Text, Number, Boolean, Date, List, Relation ids) are written through the
 * outbox (ADR 0019): an assignment appends a `set` op that the leader applies.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential
const SCHEMA_NAME = 'Test Schema Outbox Item Values'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      OutboxPost: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          summary: { id: generateId(), type: 'Text', validation: { maxLength: 5 } },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

type Post = Item<any> & { title?: string; summary?: string }

testDescribe('item values through the outbox', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    startItemOutbox()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    pauseOutboxDrainForTests(false)
    await outboxIdleForTests()
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const createPost = async (title: string) => {
    const post = (await Item.create({ modelName: 'OutboxPost', schemaName: SCHEMA_NAME, title } as never)) as Post
    await waitForIdle(post, 'Item', 15000)
    return post
  }
  const opsFor = (seedLocalId: string, propertyName: string) =>
    BaseDb.getAppDb()
      .select()
      .from(pendingWrites)
      .where(and(eq(pendingWrites.seedLocalId, seedLocalId), eq(pendingWrites.propertyName, propertyName)))
      .orderBy(asc(pendingWrites.id))
  const rowsFor = (seedLocalId: string, propertyName: string) =>
    BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, propertyName)))
  const titleProperty = (post: Post) => post.properties.find((p) => p.propertyName === 'title')!

  it('an assignment appends a set op that applies to the property row', async () => {
    const post = await createPost('first')
    const property = titleProperty(post)
    property.value = 'through the outbox'
    await property.save()

    const ops = await opsFor(post.seedLocalId, 'title')
    expect(ops.at(-1)).toMatchObject({ kind: 'set', status: 'applied' })
    const rows = await rowsFor(post.seedLocalId, 'title')
    expect(rows.map((row: { propertyValue: string | null }) => row.propertyValue)).toEqual(['through the outbox'])
    expect(JSON.parse(ops.at(-1)!.result!).localId).toBe(rows[0].localId)
    post.unload()
  }, 30000)

  it('typing appends one op per keystroke in order, and writes one row with the last value', async () => {
    const post = await createPost('t')
    const before = (await opsFor(post.seedLocalId, 'title')).length
    pauseOutboxDrainForTests(true)
    // The setter appends before it returns (decision D2): no keystroke waits for another
    for (const value of ['ty', 'typ', 'typed']) post.title = value
    expect(post.title).toBe('typed')
    await vi.waitFor(async () => expect((await opsFor(post.seedLocalId, 'title')).length).toBe(before + 3), {
      timeout: 10000,
    })
    const appended = (await opsFor(post.seedLocalId, 'title')).slice(before)
    expect(appended.map((op: { value: string | null }) => JSON.parse(op.value!).newValue)).toEqual(['ty', 'typ', 'typed'])

    pauseOutboxDrainForTests(false)
    await waitForOutboxOp(appended[2].opId)
    const settled = await opsFor(post.seedLocalId, 'title')
    expect(settled.slice(before).map((op: { status: string }) => op.status)).toEqual(['superseded', 'superseded', 'applied'])
    const rows = await rowsFor(post.seedLocalId, 'title')
    expect(rows.map((row: { propertyValue: string | null }) => row.propertyValue)).toEqual(['typed'])
    expect(post.title).toBe('typed')
    post.unload()
  }, 30000)

  it('a value assigned just before a reload shows after it and is written once draining resumes', async () => {
    const post = await createPost('before reload')
    const seedLocalId = post.seedLocalId
    pauseOutboxDrainForTests(true)
    post.title = 'kept across reload'
    await vi.waitFor(async () => expect((await opsFor(seedLocalId, 'title')).at(-1)?.status).toBe('pending'), {
      timeout: 10000,
    })

    // A reload: the cached instances go, the op stays in the table
    Item.dropCachedInstancesForSeedIds([seedLocalId])
    ItemProperty.clearInstanceCacheForItem(seedLocalId)
    const reloaded = (await Item.find({ seedLocalId })) as Post
    expect(reloaded).not.toBe(post)
    expect(reloaded.title).toBe('kept across reload')
    expect((await rowsFor(seedLocalId, 'title'))[0].propertyValue).toBe('before reload')

    pauseOutboxDrainForTests(false)
    await vi.waitFor(async () => expect((await rowsFor(seedLocalId, 'title'))[0].propertyValue).toBe('kept across reload'), {
      timeout: 10000,
    })
    reloaded.unload()
  }, 30000)

  it('a value that breaks a rule appends nothing', async () => {
    const post = await createPost('rules')
    const summary = post.properties.find((p) => p.propertyName === 'summary')!
    summary.value = 'far too long'
    const error = await summary.save().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ItemPropertySaveValidationError)
    expect(await opsFor(post.seedLocalId, 'summary')).toEqual([])
    post.unload()
  }, 30000)

  it('two ops for a property with no row yet, drained at once, write one row', async () => {
    const post = await createPost('two tabs')
    const seedLocalId = post.seedLocalId
    const versionLocalId = post.latestVersionLocalId
    pauseOutboxDrainForTests(true)
    // As two tabs would: each appends a set for a property that has no row yet
    const ids = []
    for (const newValue of ['from tab one', 'from tab two']) {
      ids.push(
        await appendOutboxOp({
          seedLocalId,
          propertyName: 'notes',
          kind: 'set',
          value: { newValue, versionLocalId, modelName: 'OutboxPost' },
        }),
      )
    }
    await Promise.all([drainOutbox(), drainOutbox()])
    await Promise.all(ids.map((id) => waitForOutboxOp(id)))

    const rows = await rowsFor(seedLocalId, 'notes')
    expect(rows.map((row: { propertyValue: string | null }) => row.propertyValue)).toEqual(['from tab two'])
    post.unload()
  }, 30000)

  describe('relation targets', () => {
    const setRelation = (seedLocalId: string, newValue: string, list = false) =>
      appendOutboxOp({
        seedLocalId,
        propertyName: list ? 'relatedIds' : 'author',
        kind: 'set',
        value: list
          ? { newValue, dataType: 'List', refValueType: 'Relation' }
          : { newValue, dataType: 'Relation' },
      })
    const failureOf = async (opId: string) => (await waitForOutboxOp(opId).catch((error: unknown) => error)) as OutboxOpFailedError

    it('a relation to a local seed, or to an attestation uid with no local copy, applies', async () => {
      const post = await createPost('relating')
      const target = await createPost('target')
      await waitForOutboxOp(await setRelation(post.seedLocalId, target.seedLocalId))
      expect((await rowsFor(post.seedLocalId, 'author'))[0].propertyValue).toBe(target.seedLocalId)

      const remoteUid = '0x' + 'ab'.repeat(32)
      await waitForOutboxOp(await setRelation(post.seedLocalId, JSON.stringify([target.seedLocalId, remoteUid]), true))
      expect((await rowsFor(post.seedLocalId, 'relatedIds'))[0].propertyValue).toBe(
        JSON.stringify([target.seedLocalId, remoteUid]),
      )
    }, 30000)

    it('a relation to a local seed id that does not exist fails with RelationTargetError', async () => {
      const post = await createPost('dangling')
      const single = await failureOf(await setRelation(post.seedLocalId, 'noSuchSeed1'))
      expect(single).toBeInstanceOf(OutboxOpFailedError)
      expect(single.errorName).toBe('RelationTargetError')

      const listed = await failureOf(await setRelation(post.seedLocalId, JSON.stringify([post.seedLocalId, 'noSuchSeed2']), true))
      expect(listed.errorName).toBe('RelationTargetError')
      expect(await rowsFor(post.seedLocalId, 'author')).toEqual([])
      expect(await rowsFor(post.seedLocalId, 'relatedIds')).toEqual([])
    }, 30000)

    it("a create whose initial relation names a local seed that doesn't exist fails with RelationTargetError", async () => {
      const target = await createPost('existing target')
      const createWith = (author: string) =>
        appendOutboxOp({
          seedLocalId: generateId(),
          kind: 'create',
          value: {
            modelName: 'OutboxPost',
            seed: { type: 'outbox_post', fields: {} },
            rows: [{ propertyName: 'author', propertyValue: author, propertyRecordSchema: { dataType: 'Relation' } }],
          },
        })
      const failed = await failureOf(await createWith('noSuchSeed4'))
      expect(failed).toBeInstanceOf(OutboxOpFailedError)
      expect(failed.errorName).toBe('RelationTargetError')
      await waitForOutboxOp(await createWith(target.seedLocalId))
    }, 30000)

    it('a relation to a seed whose create op is pending waits for it, without counting an attempt', async () => {
      const post = await createPost('waiting')
      pauseOutboxDrainForTests(true)
      const targetId = generateId()
      const relate = await setRelation(post.seedLocalId, targetId)
      const create = await appendOutboxOp({
        seedLocalId: targetId,
        kind: 'create',
        value: { modelName: 'OutboxPost', seed: { type: 'outbox_post', fields: {} }, rows: [] },
      })
      pauseOutboxDrainForTests(false)

      await waitForOutboxOp(create)
      await waitForOutboxOp(relate)
      const [op] = await getOutboxOps([relate])
      expect(op.status).toBe('applied')
      expect(op.attempts).toBe(0)
      expect((await rowsFor(post.seedLocalId, 'author'))[0].propertyValue).toBe(targetId)
    }, 30000)
  })
})
