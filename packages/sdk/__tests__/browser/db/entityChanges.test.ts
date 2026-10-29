import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq, gt, sql } from 'drizzle-orm'
import { BaseEasClient, resetSchemaUidCaches } from '@seedprotocol/eas'
import { BaseDb } from '@/db/Db/BaseDb'
import { entityChanges, metadata, seeds, versions } from '@/seedSchema'
import { createNewItem } from '@/db/write/createNewItem'
import { createSeeds } from '@/db/write/createSeeds'
import { createSeed, resolveNewSeedFields } from '@/db/write/createSeed'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { updateSeedRevokedAt } from '@/db/write/updateSeedRevokedAt'
import { updateSeedUid } from '@/db/write/updateSeedUid'
import { deleteItem } from '@/db/write/deleteItem'
import { hardDeleteLocalSeedsByLocalIds } from '@/db/write/removeLocalCopiesForAddresses'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

/**
 * Migration 0023's triggers log every row written to seeds, versions and metadata in
 * entity_changes (ADR 0020), whichever writer wrote it. One writer per group of the design note's
 * write-path list, the OLD-keys rows of key changes, rollback and an unconditional delete.
 */

const SCHEMA_NAME = 'Test Schema Entity Changes'
const MODEL = 'ChangePost'
const PROPERTIES = ['title', 'summary']

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
        properties: Object.fromEntries(PROPERTIES.map((name) => [name, { id: generateId(), type: 'Text' }])),
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

type Change = { tbl: string; seedLocalId: string | null; seedUid: string | null; propertyName: string | null }

const db = () => BaseDb.getAppDb()

const lastSeq = async () => {
  const [row] = await db().select({ seq: sql<number | null>`max(${entityChanges.seq})` }).from(entityChanges)
  return Number(row?.seq ?? 0)
}

/** The log rows `write` added, oldest first. */
const changesOf = async (write: () => Promise<unknown>): Promise<Change[]> => {
  const since = await lastSeq()
  await write()
  return db()
    .select({
      tbl: entityChanges.tbl,
      seedLocalId: entityChanges.seedLocalId,
      seedUid: entityChanges.seedUid,
      propertyName: entityChanges.propertyName,
    })
    .from(entityChanges)
    .where(gt(entityChanges.seq, since))
    .orderBy(entityChanges.seq)
}

const tables = (changes: Change[]) => changes.map((c) => c.tbl)
const uid = () => `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`

describe.sequential('entity_changes triggers', () => {
  let restoreEasClient: (() => void) | undefined

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    // createNewItem looks up property schema uids; answer "none registered" without the network.
    const online = BaseEasClient.getEasClient()
    BaseEasClient.configure({ getEasClient: () => ({ request: async () => ({ schemas: [] }) }) as never })
    restoreEasClient = () => BaseEasClient.configure({ getEasClient: () => online })
    resetSchemaUidCaches()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    restoreEasClient?.()
    resetSchemaUidCaches()
    await teardownTestEnvironment()
  })

  let seedLocalId: string

  it('logs one row per row an outbox create writes', async () => {
    const changes = await changesOf(async () => {
      seedLocalId = (await createNewItem({ modelName: MODEL, title: 'first', summary: 's' } as never)).seedLocalId
    })
    expect(changes.every((c) => c.seedLocalId === seedLocalId)).toBe(true)
    expect(tables(changes).filter((t) => t === 'seeds')).toHaveLength(1)
    expect(tables(changes).filter((t) => t === 'versions')).toHaveLength(1)
    const metadataRows = await db().select().from(metadata).where(eq(metadata.seedLocalId, seedLocalId))
    expect(changes.filter((c) => c.tbl === 'metadata').map((c) => c.propertyName).sort()).toEqual(
      metadataRows.map((row: { propertyName: string }) => row.propertyName).sort(),
    )
  })

  it('logs a value edit with its property name', async () => {
    const changes = await changesOf(() =>
      updateItemPropertyValue({ seedLocalId, propertyName: 'title', newValue: 'second', modelName: MODEL }),
    )
    expect(changes).toEqual([{ tbl: 'metadata', seedLocalId, seedUid: null, propertyName: 'title' }])
  })

  it('logs EAS sync inserts and revocation updates', async () => {
    const syncedLocalId = generateId()
    const syncedUid = uid()
    const inserted = await changesOf(() =>
      createSeeds([{ localId: syncedLocalId, uid: syncedUid, type: 'change_post', createdAt: Date.now() }]),
    )
    expect(inserted).toEqual([{ tbl: 'seeds', seedLocalId: syncedLocalId, seedUid: syncedUid, propertyName: null }])

    const revoked = await changesOf(() => updateSeedRevokedAt({ seedLocalId: syncedLocalId, revokedAt: Date.now() }))
    expect(revoked).toEqual([{ tbl: 'seeds', seedLocalId: syncedLocalId, seedUid: syncedUid, propertyName: null }])
  })

  it('logs a publish receipt and the OLD keys of its seedUid cascade', async () => {
    // The cascade moves attested rows recorded before the seed uid was known.
    await db().update(versions).set({ uid: uid() }).where(eq(versions.seedLocalId, seedLocalId))
    await db()
      .update(metadata)
      .set({ uid: uid() })
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'title')))
    const seedUid = uid()
    const changes = await changesOf(() => updateSeedUid({ seedLocalId, seedUid }))
    // Each updated row logs its new keys and, since its seed_uid changed, its old ones.
    expect(changes.filter((c) => c.tbl === 'seeds')).toEqual([
      { tbl: 'seeds', seedLocalId, seedUid, propertyName: null },
      { tbl: 'seeds', seedLocalId, seedUid: null, propertyName: null },
    ])
    const cascaded = changes.filter((c) => c.tbl !== 'seeds')
    expect(cascaded).toEqual([
      { tbl: 'versions', seedLocalId, seedUid, propertyName: null },
      { tbl: 'versions', seedLocalId, seedUid: null, propertyName: null },
      { tbl: 'metadata', seedLocalId, seedUid, propertyName: 'title' },
      { tbl: 'metadata', seedLocalId, seedUid: null, propertyName: 'title' },
    ])
  })

  it('logs a property_name change under both names', async () => {
    const [row] = await db()
      .select({ localId: metadata.localId })
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'summary')))
    expect(row?.localId).toBeTruthy()
    const changes = await changesOf(() =>
      db().update(metadata).set({ propertyName: 'abstract' }).where(eq(metadata.localId, row!.localId!)),
    )
    expect(changes.map((c) => c.propertyName)).toEqual(['abstract', 'summary'])
    expect(changes.every((c) => c.tbl === 'metadata' && c.seedLocalId === seedLocalId)).toBe(true)
  })

  it('logs soft and hard deletes', async () => {
    const soft = await changesOf(() => deleteItem({ seedLocalId }))
    expect(tables(soft)).toEqual(['seeds'])

    const hard = await changesOf(() => hardDeleteLocalSeedsByLocalIds([seedLocalId]))
    expect(new Set(tables(hard))).toEqual(new Set(['seeds', 'versions', 'metadata']))
    expect(hard.every((c) => c.seedLocalId === seedLocalId)).toBe(true)
  })

  it('logs nothing for a rolled-back transaction', async () => {
    const fields = await resolveNewSeedFields('change_post')
    const changes = await changesOf(() =>
      BaseDb.transaction(async (tx) => {
        await createSeed({ type: 'change_post' }, { db: tx, fields })
        throw new Error('roll back')
      }).catch(() => undefined),
    )
    expect(changes).toEqual([])
  })

  it('logs every row of an unconditional delete', async () => {
    const count = (await db().select({ localId: seeds.localId }).from(seeds)).length
    expect(count).toBeGreaterThan(0)
    const changes = await changesOf(() => db().delete(seeds))
    expect(tables(changes)).toEqual(Array(count).fill('seeds'))
  })
})
