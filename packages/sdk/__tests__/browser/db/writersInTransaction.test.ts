import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, seeds, versions } from '@/seedSchema'
import { createSeed, resolveNewSeedFields } from '@/db/write/createSeed'
import { createVersion } from '@/db/write/createVersion'
import { createMetadata } from '@/db/write/createMetadata'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

/**
 * The item writers run on a transaction's `tx` when given one: every read they make goes through it
 * too. In the browser a read through the app database inside a transaction waits for the
 * transaction, so a missed one shows here as a timeout.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential
const SCHEMA_NAME = 'Test Schema Writers In Transaction'
const MODEL = 'TxPost'
const IN_TRANSACTION_TIMEOUT_MS = 5000

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: { [MODEL]: { id: generateId(), properties: { title: { id: generateId(), type: 'Text' } } } },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

/** Fails instead of hanging when a writer waits on the transaction it runs in. */
const withinTimeout = <T>(work: Promise<T>) =>
  Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('transaction did not finish: a read waited on it')), IN_TRANSACTION_TIMEOUT_MS),
    ),
  ])

testDescribe('item writers in a transaction', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  /** A new item's rows and a value edit, the way Item.create and an assignment write them. */
  const writeItem = (fail: boolean) => async (tx: unknown) => {
    const db = tx as ReturnType<typeof BaseDb.getAppDb>
    const seedLocalId = await createSeed({ type: 'tx_post' }, { db, fields })
    const versionLocalId = await createVersion({ seedLocalId, seedType: 'tx_post' }, { db })
    await createMetadata(
      { seedLocalId, versionLocalId, propertyName: 'title', propertyValue: 'first', modelName: MODEL },
      undefined,
      { db },
    )
    const updated = await updateItemPropertyValue(
      { seedLocalId, versionLocalId, propertyName: 'title', newValue: 'second', modelName: MODEL },
      { db },
    )
    if (fail) throw new Error('roll back')
    return { seedLocalId, versionLocalId, updated }
  }

  let fields: Awaited<ReturnType<typeof resolveNewSeedFields>>

  it('writes a new item and an edit in one transaction', async () => {
    fields = await resolveNewSeedFields('tx_post')
    const { seedLocalId, versionLocalId, updated } = await withinTimeout(BaseDb.transaction(writeItem(false)))
    expect(updated?.uid).toBeNull()

    const db = BaseDb.getAppDb()
    expect(await db.select().from(seeds).where(eq(seeds.localId, seedLocalId))).toHaveLength(1)
    expect(await db.select().from(versions).where(eq(versions.localId, versionLocalId))).toHaveLength(1)
    const rows = await db
      .select()
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'title')))
    expect(rows.map((row: { propertyValue: string | null }) => row.propertyValue)).toEqual(['second'])
  })

  it('leaves no rows when the transaction rolls back', async () => {
    fields = await resolveNewSeedFields('tx_post')
    const before = (await BaseDb.getAppDb().select({ localId: seeds.localId }).from(seeds)).length

    await expect(withinTimeout(BaseDb.transaction(writeItem(true)))).rejects.toThrow('roll back')

    expect((await BaseDb.getAppDb().select({ localId: seeds.localId }).from(seeds)).length).toBe(before)
  })

  it('createSeed refuses a given db without resolved fields', async () => {
    await expect(createSeed({ type: 'tx_post' }, { db: BaseDb.getAppDb() })).rejects.toThrow(/resolveNewSeedFields/)
  })
})
