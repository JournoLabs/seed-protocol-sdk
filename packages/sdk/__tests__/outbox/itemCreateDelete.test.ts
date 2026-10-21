import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, asc, eq, sql } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, pendingWrites, seeds } from '@/seedSchema'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { renamePendingWritesForProperty } from '@/helpers/db'
import { hardDeleteLocalSeedsByLocalIds } from '@/db/write/removeLocalCopiesForAddresses'
import { appendOutboxOp, getOutboxOps, startItemOutbox, waitForPendingOutboxOps } from '@/outbox'
import { outboxIdleForTests, pauseOutboxDrainForTests } from '@/outbox/outbox'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle } from '../test-utils/waitForIdle'

/**
 * Creating and deleting items through the outbox (ADR 0019), and the writers that must know about
 * pending ops: publish waits for them, a purge removes them, a property rename moves them.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential
const SCHEMA_NAME = 'Test Schema Outbox Create Delete'
const MODEL = 'LifecyclePost'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      [MODEL]: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          body: { id: generateId(), type: 'Text' },
          notes: { id: generateId(), type: 'Text', storage: { type: 'ItemStorage', path: '/notes', extension: '.md' } },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

type Post = Item<any> & { title?: string; body?: string }

testDescribe('item lifecycle through the outbox', () => {
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

  const db = () => BaseDb.getAppDb()
  const createPost = async (values: Record<string, unknown> = {}) => {
    const post = (await Item.create({ modelName: MODEL, schemaName: SCHEMA_NAME, title: 'post', ...values } as never)) as Post
    await waitForIdle(post, 'Item', 15000)
    return post
  }
  const opsFor = (seedLocalId: string) =>
    db().select().from(pendingWrites).where(eq(pendingWrites.seedLocalId, seedLocalId)).orderBy(asc(pendingWrites.id))
  const stagedFiles = async () => {
    const dir = BaseFileManager.getFilesPath('staging')
    if (!(await BaseFileManager.pathExists(dir))) return []
    const fs = await BaseFileManager.getFs()
    return fs.promises.readdir(dir) as Promise<string[]>
  }

  it('Item.create writes the seed, version and rows as one create op', async () => {
    const post = await createPost({ body: 'first body', notes: '# notes' })
    const [create] = await opsFor(post.seedLocalId)
    expect(create).toMatchObject({ kind: 'create', status: 'applied', propertyName: null })
    expect(await db().select().from(seeds).where(eq(seeds.localId, post.seedLocalId))).toHaveLength(1)
    const rows = await db().select().from(metadata).where(eq(metadata.seedLocalId, post.seedLocalId))
    expect(rows.map((row: { propertyName: string | null }) => row.propertyName).sort()).toEqual(['body', 'notes', 'title'])
    const notes = rows.find((row: { propertyName: string | null }) => row.propertyName === 'notes')!
    expect(await BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('notes', notes.refResolvedValue!))).toBe('# notes')
    expect(await stagedFiles()).toEqual([])
    post.unload()
  }, 30000)

  it('a row that can’t be written fails the whole create, staged files included', async () => {
    const seedsBefore = (await db().select({ localId: seeds.localId }).from(seeds)).length
    await db().run(
      sql.raw(
        "CREATE TRIGGER fail_body_insert BEFORE INSERT ON metadata WHEN NEW.property_name = 'body' BEGIN SELECT RAISE(ABORT, 'body row refused'); END",
      ),
    )
    try {
      await expect(createPost({ body: 'refused', notes: '# staged' })).rejects.toThrow(/body row refused/)
    } finally {
      await db().run(sql.raw('DROP TRIGGER fail_body_insert'))
    }
    expect((await db().select({ localId: seeds.localId }).from(seeds)).length).toBe(seedsBefore)
    const [failed] = await db()
      .select()
      .from(pendingWrites)
      .where(and(eq(pendingWrites.kind, 'create'), eq(pendingWrites.status, 'failed')))
    expect(failed.error).toMatch(/body row refused/)
    await vi.waitFor(async () => expect(await stagedFiles()).toEqual([]), { timeout: 5000 })
  }, 30000)

  it('Item.destroy applies after the item’s pending edit', async () => {
    const post = await createPost()
    pauseOutboxDrainForTests(true)
    post.title = 'edited before destroy'
    await vi.waitFor(async () => expect((await opsFor(post.seedLocalId)).at(-1)?.kind).toBe('set'), { timeout: 10000 })
    const destroying = post.destroy()
    await vi.waitFor(async () => expect((await opsFor(post.seedLocalId)).at(-1)?.kind).toBe('delete'), { timeout: 10000 })

    pauseOutboxDrainForTests(false)
    await destroying

    const ops = await opsFor(post.seedLocalId)
    const [set, del] = ops.slice(-2)
    expect([set.kind, set.status, del.kind, del.status]).toEqual(['set', 'applied', 'delete', 'applied'])
    expect(set.appliedAt!).toBeLessThanOrEqual(del.appliedAt!)
    const [seed] = await db().select().from(seeds).where(eq(seeds.localId, post.seedLocalId))
    expect(seed._markedForDeletion).toBe(1)
    const [title] = await db()
      .select()
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, post.seedLocalId), eq(metadata.propertyName, 'title')))
    expect(title.propertyValue).toBe('edited before destroy')
  }, 30000)

  it('ItemProperty.destroy deletes the property’s rows through a delete op', async () => {
    const post = await createPost({ body: 'to remove' })
    const body = post.properties.find((p) => p.propertyName === 'body')!
    await body.destroy()

    const del = (await opsFor(post.seedLocalId)).at(-1)!
    expect(del).toMatchObject({ kind: 'delete', status: 'applied', propertyName: 'body' })
    const rows = await db()
      .select()
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, post.seedLocalId), eq(metadata.propertyName, 'body')))
    expect(rows).toEqual([])
    post.unload()
  }, 30000)

  it('a purge removes the seed’s pending ops', async () => {
    const post = await createPost()
    pauseOutboxDrainForTests(true)
    const opId = await appendOutboxOp({ seedLocalId: post.seedLocalId, propertyName: 'title', kind: 'set', value: { newValue: 'x' } })
    post.unload()
    await hardDeleteLocalSeedsByLocalIds([post.seedLocalId])
    expect(await getOutboxOps([opId])).toEqual([])
    expect(await opsFor(post.seedLocalId)).toEqual([])
  }, 30000)

  it('a property rename moves pending ops to the new name', async () => {
    const post = await createPost()
    pauseOutboxDrainForTests(true)
    const opId = await appendOutboxOp({ seedLocalId: post.seedLocalId, propertyName: 'body', kind: 'set', value: { newValue: 'y' } })
    await renamePendingWritesForProperty(MODEL, 'body', 'summary')
    const [op] = await getOutboxOps([opId])
    expect(op.propertyName).toBe('summary')
    // Back, for the other tests' rows
    await renamePendingWritesForProperty(MODEL, 'summary', 'body')
    await db().delete(pendingWrites).where(eq(pendingWrites.opId, opId))
    post.unload()
  }, 30000)

  it('waitForPendingOutboxOps waits for every op pending when called', async () => {
    const post = await createPost()
    pauseOutboxDrainForTests(true)
    post.title = 'published value'
    await vi.waitFor(async () => expect((await opsFor(post.seedLocalId)).at(-1)?.status).toBe('pending'), { timeout: 10000 })

    let settled = false
    const waiting = waitForPendingOutboxOps().then(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(settled).toBe(false)
    pauseOutboxDrainForTests(false)
    await waiting
    expect((await opsFor(post.seedLocalId)).at(-1)?.status).toBe('applied')
    post.unload()
  }, 30000)
})
