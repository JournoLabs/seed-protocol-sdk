import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, pendingWrites } from '@/seedSchema'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { eventEmitter } from '@/eventBus'
import { startItemOutbox, type PropertyConflict } from '@/outbox'
import { outboxIdleForTests, pauseOutboxDrainForTests } from '@/outbox/outbox'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle } from '../test-utils/waitForIdle'

/**
 * A local edit that was pending when sync wrote a newer attested value: the edit wins and the
 * conflict is recorded (ADR 0019).
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential
const SCHEMA_NAME = 'Test Schema Outbox Conflicts'
const MODEL = 'ConflictPost'

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
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

const fakeUid = () => '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

testDescribe('conflicts between a pending edit and sync', () => {
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
  const titleRows = (seedLocalId: string) =>
    db()
      .select()
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'title')))

  /** An item whose title row is attested, as after a publish, and its title property. */
  const publishedPost = async (title: string) => {
    const item = (await Item.create({ modelName: MODEL, schemaName: SCHEMA_NAME, title } as never)) as Item<any>
    await waitForIdle(item, 'Item', 15000)
    const [row] = await titleRows(item.seedLocalId)
    const uid = fakeUid()
    const attestedAt = Date.now() - 60_000
    await db().update(metadata).set({ uid, attestationCreatedAt: attestedAt }).where(eq(metadata.localId, row.localId!))
    const property = (await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'title' }))!
    property.getService().send({ type: 'updateContext', localId: row.localId, uid })
    return { item, property, baseRow: { ...row, uid } }
  }

  /** What sync writes for a newer attestation of the property: a new attested row. */
  const syncRemoteValue = async (baseRow: typeof metadata.$inferSelect, value: string, uid = fakeUid()) => {
    const now = Date.now()
    await db().insert(metadata).values({
      ...baseRow,
      id: undefined,
      localId: generateId(),
      uid,
      propertyValue: value,
      createdAt: now,
      attestationCreatedAt: now,
    } as never)
    return uid
  }

  const pendingOps = (seedLocalId: string) =>
    db()
      .select()
      .from(pendingWrites)
      .where(and(eq(pendingWrites.seedLocalId, seedLocalId), eq(pendingWrites.status, 'pending')))

  it('keeps the local edit over a value synced while it was pending, and records the conflict', async () => {
    const { item, property, baseRow } = await publishedPost('base')
    const emitted: PropertyConflict[] = []
    const onConflict = (conflict: PropertyConflict) => emitted.push(conflict)
    eventEmitter.on('itemProperty.conflict', onConflict)
    try {
      pauseOutboxDrainForTests(true)
      property.value = 'local'
      await vi.waitFor(async () => expect(await pendingOps(item.seedLocalId)).toHaveLength(1))
      const remoteUid = await syncRemoteValue(baseRow, 'remote')
      pauseOutboxDrainForTests(false)
      await property.save()

      const expected = {
        seedLocalId: item.seedLocalId,
        propertyName: 'title',
        baseValue: 'base',
        remoteValue: 'remote',
        localValue: 'local',
        remoteUid,
      }
      expect(property.value).toBe('local')
      expect(property.conflict).toMatchObject(expected)
      expect(await item.conflicts()).toEqual([expect.objectContaining(expected)])
      expect(emitted).toEqual([expect.objectContaining(expected)])
      // The edit is a draft over the synced row, which stays
      const rows = await titleRows(item.seedLocalId)
      expect(rows.map((row) => row.propertyValue).sort()).toEqual(['base', 'local', 'remote'])
    } finally {
      eventEmitter.off('itemProperty.conflict', onConflict)
    }
  }, 30000)

  it("resolveConflict('remote') drops the local draft so the synced value shows", async () => {
    const { item, property, baseRow } = await publishedPost('base')
    pauseOutboxDrainForTests(true)
    property.value = 'local'
    await vi.waitFor(async () => expect(await pendingOps(item.seedLocalId)).toHaveLength(1))
    await syncRemoteValue(baseRow, 'remote')
    pauseOutboxDrainForTests(false)
    await property.save()
    expect(property.conflict).not.toBeNull()

    await property.resolveConflict('remote')

    await vi.waitFor(() => expect(property.value).toBe('remote'))
    expect(property.conflict).toBeNull()
    expect(await item.conflicts()).toEqual([])
    const drafts = await db()
      .select()
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, item.seedLocalId), eq(metadata.propertyName, 'title'), isNull(metadata.uid)))
    expect(drafts).toEqual([])
  }, 30000)

  it("resolveConflict('local') and a later edit both settle the conflict", async () => {
    const { item, property, baseRow } = await publishedPost('base')
    pauseOutboxDrainForTests(true)
    property.value = 'local'
    await vi.waitFor(async () => expect(await pendingOps(item.seedLocalId)).toHaveLength(1))
    const [op] = await pendingOps(item.seedLocalId)
    await syncRemoteValue(baseRow, 'remote')
    pauseOutboxDrainForTests(false)
    await property.save()
    expect(property.conflict).not.toBeNull()

    await property.resolveConflict('local')
    expect(property.conflict).toBeNull()
    expect(property.value).toBe('local')
    expect(await item.conflicts()).toEqual([])

    // A resolved conflict stays on its op; a new edit clears an unresolved one in the database
    await db().update(pendingWrites).set({ conflictResolvedAt: null }).where(eq(pendingWrites.opId, op.opId))
    expect(await item.conflicts()).toHaveLength(1)
    property.value = 'local again'
    await property.save()
    expect(await item.conflicts()).toEqual([])
  }, 30000)

  it('records no conflict when sync repeats the base attestation, or brings the same value', async () => {
    const { item, property, baseRow } = await publishedPost('base')
    pauseOutboxDrainForTests(true)
    property.value = 'local'
    await vi.waitFor(async () => expect(await pendingOps(item.seedLocalId)).toHaveLength(1))
    // The same attestation synced again (another row with the base row's uid)
    await syncRemoteValue(baseRow, 'base', baseRow.uid!)
    pauseOutboxDrainForTests(false)
    await property.save()
    expect(property.conflict).toBeNull()

    pauseOutboxDrainForTests(true)
    property.value = 'agreed'
    await vi.waitFor(async () => expect(await pendingOps(item.seedLocalId)).toHaveLength(1))
    await syncRemoteValue(baseRow, 'agreed')
    pauseOutboxDrainForTests(false)
    await property.save()
    expect(property.conflict).toBeNull()
    expect(await item.conflicts()).toEqual([])
  }, 30000)

  it('reloads an unresolved conflict with the property', async () => {
    const { item, property, baseRow } = await publishedPost('base')
    pauseOutboxDrainForTests(true)
    property.value = 'local'
    await vi.waitFor(async () => expect(await pendingOps(item.seedLocalId)).toHaveLength(1))
    await syncRemoteValue(baseRow, 'remote')
    pauseOutboxDrainForTests(false)
    await property.save()

    property.getService().send({ type: 'updateContext', conflict: null })
    property.getService().send({ type: 'rehydrateFromDb' })

    await vi.waitFor(() => expect(property.conflict).toMatchObject({ remoteValue: 'remote', localValue: 'local' }))
  }, 30000)
})
