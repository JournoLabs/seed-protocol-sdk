import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, pendingWrites, type MetadataType } from '@/seedSchema'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { planPropertyWrite, whenValidationLoaded } from '@/ItemProperty/propertyWrite'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { StagedValueMissingError } from '@/storageValue/stage'
import { startItemOutbox, waitForOutboxOp, type SetPropertyValueOp } from '@/outbox'
import { appendOutboxOp, outboxIdleForTests, pauseOutboxDrainForTests } from '@/outbox/outbox'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle } from '../test-utils/waitForIdle'
import { waitForPropertyInstances } from '../test-utils/getPublishPayloadIntegrationHelpers'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

/**
 * Decision D2 (ADR 0019 over ADR 0020): the setter appends its op before it returns, so a
 * property's value is always the overlay (its newest pending op from any tab, else its stored row).
 * A synced row doesn't replace a pending value, a failed write shows the overlay's next value, and
 * an op whose tab closed before staging its value still settles.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential
const SCHEMA_NAME = 'Test Schema Overlay Writes'
const MODEL = 'OverlayWritePost'

const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const pngFile = (name: string): File =>
  new File([Uint8Array.from(atob(MINIMAL_PNG_BASE64), (c) => c.charCodeAt(0))], name, { type: 'image/png' })

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      [MODEL]: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          cover: { id: generateId(), type: 'Image' },
          notes: { id: generateId(), type: 'Text', storage: { type: 'ItemStorage', path: '/notes', extension: '.md' } },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

const isNode = typeof window === 'undefined'

testDescribe('overlay writes (decision D2)', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    startItemOutbox()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    vi.restoreAllMocks()
    pauseOutboxDrainForTests(false)
    await outboxIdleForTests()
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const createPost = async (values: Record<string, unknown> = {}) => {
    const post = (await Item.create({ modelName: MODEL, schemaName: SCHEMA_NAME, title: 'stored', ...values } as never)) as Item<any>
    await waitForIdle(post, 'Item', 15000)
    await waitForPropertyInstances(post)
    return post
  }
  const propertyOf = (post: Item<any>, name: string) =>
    post.properties.find((p) => p.propertyName === name || p.propertyName === `${name}Id`)! as ItemProperty<any>
  const rowsOf = (seedLocalId: string, names: string[]): Promise<MetadataType[]> =>
    BaseDb.getAppDb()
      .select()
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, seedLocalId), inArray(metadata.propertyName, names)))
      .orderBy(desc(metadata.createdAt))
  const opsOf = (seedLocalId: string, propertyNames: string[]) =>
    BaseDb.getAppDb()
      .select()
      .from(pendingWrites)
      .where(and(eq(pendingWrites.seedLocalId, seedLocalId), inArray(pendingWrites.propertyName, propertyNames)))
      .orderBy(asc(pendingWrites.id))
  /** A reload: the cached instances go, the outbox and rows stay. */
  const reload = async (seedLocalId: string) => {
    Item.dropCachedInstancesForSeedIds([seedLocalId])
    ItemProperty.clearInstanceCacheForItem(seedLocalId)
    const item = (await Item.find({ seedLocalId })) as Item<any>
    await waitForIdle(item, 'Item', 15000)
    await waitForPropertyInstances(item)
    return item
  }
  /** What EAS sync writes for a property: an attested row newer than the local one. */
  const insertSyncedRow = async (local: MetadataType, propertyValue: string) => {
    const localId = generateId()
    await BaseDb.getAppDb()
      .insert(metadata)
      .values({
        ...local,
        localId,
        uid: `0x${'ab'.repeat(32)}`,
        propertyValue,
        attestationCreatedAt: Date.now() + 1_000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    return localId
  }
  /** The browser's change feed re-reads on the insert; Node has none, so it re-reads as Item does after a sync. */
  const afterSync = async (property: ItemProperty<any>, syncedLocalId: string) => {
    if (isNode) property.getService().send({ type: 'rehydrateFromDb' })
    await vi.waitFor(() => expect(property.getService().getSnapshot().context.localId).toBe(syncedLocalId), {
      timeout: WAIT_TIMEOUT_MS,
    })
  }

  it('a synced row doesn’t replace a value another tab has pending (G07-4)', async () => {
    const post = await createPost({ title: 'before both' })
    const [local] = await rowsOf(post.seedLocalId, ['title'])
    pauseOutboxDrainForTests(true)

    // Another tab's assignment: its op is in the shared table, not in this tab's memory
    const value: SetPropertyValueOp = {
      newValue: 'from the other tab',
      localId: local.localId,
      versionLocalId: local.versionLocalId,
      modelName: MODEL,
      dataType: 'Text',
    }
    await BaseDb.getAppDb().insert(pendingWrites).values({
      opId: generateId(),
      seedLocalId: post.seedLocalId,
      propertyName: 'title',
      kind: 'set',
      value: JSON.stringify(value),
      baseRowId: local.localId,
      createdAt: Date.now(),
      tabId: 'other-tab',
      status: 'pending',
      attempts: 0,
    })
    const loaded = await reload(post.seedLocalId)
    const title = propertyOf(loaded, 'title')
    expect(title.value).toBe('from the other tab')

    const syncedLocalId = await insertSyncedRow(local, 'synced from another device')
    await afterSync(title, syncedLocalId)
    expect(title.value).toBe('from the other tab')

    // Applied over the synced row: the pending edit wins and the conflict is recorded
    pauseOutboxDrainForTests(false)
    await vi.waitFor(async () => expect((await opsOf(post.seedLocalId, ['title'])).at(-1)?.status).toBe('applied'), {
      timeout: WAIT_TIMEOUT_MS,
    })
    expect((await rowsOf(post.seedLocalId, ['title']))[0].propertyValue).toBe('from the other tab')
    loaded.unload()
  }, 30000)

  it('a synced row doesn’t replace this tab’s pending value', async () => {
    const post = await createPost({ title: 'before typing' })
    const [local] = await rowsOf(post.seedLocalId, ['title'])
    const title = propertyOf(post, 'title')
    pauseOutboxDrainForTests(true)
    title.value = 'typed here'

    const syncedLocalId = await insertSyncedRow(local, 'synced meanwhile')
    await afterSync(title, syncedLocalId)
    expect(title.value).toBe('typed here')

    pauseOutboxDrainForTests(false)
    await title.save()
    expect(title.value).toBe('typed here')
    expect((await rowsOf(post.seedLocalId, ['title']))[0].propertyValue).toBe('typed here')
    post.unload()
  }, 30000)

  it('a failed storage write shows the previous value again', async () => {
    const post = await createPost()
    const cover = propertyOf(post, 'cover')
    cover.value = pngFile('first.png')
    await cover.save()
    const saved = cover.getService().getSnapshot().context
    expect(saved.refResolvedValue).toMatch(/first\.png$/)

    // The staged write fails, so the op's bytes never land and preparing it fails the op
    const original = BaseFileManager.saveFile.bind(BaseFileManager)
    vi.spyOn(BaseFileManager, 'saveFile').mockImplementation(async (filePath, content) => {
      if (filePath.includes('/staging/')) throw new Error('disk full')
      return original(filePath, content)
    })
    cover.value = pngFile('second.png')
    expect(cover.getService().getSnapshot().context.propertyValue).not.toBe(saved.propertyValue)

    const error = await cover.save().catch((e: unknown) => e)
    expect((error as Error).message).toContain('was never written')
    // The op failed in the drainer; the caller gets the class back as the cause (D31)
    expect((error as Error).cause).toBeInstanceOf(StagedValueMissingError)
    expect(((error as Error).cause as StagedValueMissingError).path).toContain('/staging/')
    const after = cover.getService().getSnapshot().context
    expect(after.propertyValue).toBe(saved.propertyValue)
    expect(after.refResolvedValue).toBe(saved.refResolvedValue)
    expect(after.isSaving).toBe(false)
    const [op] = (await opsOf(post.seedLocalId, ['cover', 'coverId'])).slice(-1)
    expect(op.status).toBe('failed')
    expect(op.errorName).toBe('StagedValueMissingError')
    post.unload()
  }, 30000)

  it('an ItemStorage op appended before its tab staged the value is staged from the op when it applies', async () => {
    const post = await createPost()
    const notes = propertyOf(post, 'notes')
    await whenValidationLoaded()
    const context = notes.getService().getSnapshot().context
    const plan = planPropertyWrite(context, '# written after a crash')
    if (plan.writeKind === 'invalid') throw new Error('invalid')
    expect(plan.op.valueRef).toBeTruthy()

    // A crash between append and staging: the op is in the table, its staged file never written
    const opId = await appendOutboxOp({ ...plan.op, seedLocalId: post.seedLocalId })
    await waitForOutboxOp(opId)
    const [op] = await BaseDb.getAppDb().select().from(pendingWrites).where(eq(pendingWrites.opId, opId))
    expect(op.status).toBe('applied')
    const [row] = await rowsOf(post.seedLocalId, ['notes'])
    expect(
      await BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('notes', row.refResolvedValue!)),
    ).toBe('# written after a crash')
    expect(await BaseFileManager.pathExists(plan.op.valueRef!)).toBe(false)
    post.unload()
  }, 30000)

  it('an Image op whose bytes never landed fails without holding up the property', async () => {
    const post = await createPost()
    const cover = propertyOf(post, 'cover')
    await whenValidationLoaded()
    const context = cover.getService().getSnapshot().context
    const plan = planPropertyWrite(context, pngFile('lost.png'))
    if (plan.writeKind === 'invalid') throw new Error('invalid')
    pauseOutboxDrainForTests(true)
    // The tab closed before writing the staged bytes; nothing holds the staging lock
    const lostOpId = await appendOutboxOp({ ...plan.op, seedLocalId: post.seedLocalId })
    pauseOutboxDrainForTests(false)
    await expect(waitForOutboxOp(lostOpId)).rejects.toThrow('was never written')

    cover.value = pngFile('after.png')
    await cover.save()
    expect(cover.getService().getSnapshot().context.refResolvedValue).toMatch(/after\.png$/)
    post.unload()
  }, 30000)
})
