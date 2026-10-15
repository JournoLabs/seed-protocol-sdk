import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { addSchemaToDb } from '@/helpers/db'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * The schemas table has one row per schema name, holding its latest version. Complete schema
 * files can bring each version under its own id. The row's schemaFileId must stay the id of the
 * version it holds: it used to keep v1's id after taking v2's version and data.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

const add = (name: string, version: number, schemaFileId: string) => {
  const now = Date.now()
  return addSchemaToDb(
    { name, version, createdAt: now, updatedAt: now },
    schemaFileId,
    JSON.stringify({ id: schemaFileId, version, metadata: { name } }),
    false,
  )
}

const rowsNamed = (name: string) =>
  BaseDb.getAppDb().select().from(schemasTable).where(eq(schemasTable.name, name))

testDescribe('addSchemaToDb with a version under another id', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('takes a newer version file\'s id with its version and data', async () => {
    const name = 'Add Schema Newer Version'
    const v1Id = generateId()
    const v2Id = generateId()
    await add(name, 1, v1Id)

    const record = await add(name, 2, v2Id)

    expect(record).toMatchObject({ version: 2, schemaFileId: v2Id })
    const rows = await rowsNamed(name)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ version: 2, schemaFileId: v2Id })
    expect(JSON.parse(rows[0].schemaData!).id).toBe(v2Id)
  })

  it('keeps the latest version when an older version file is added after it', async () => {
    const name = 'Add Schema Older Version'
    const v1Id = generateId()
    const v2Id = generateId()
    await add(name, 1, v1Id)
    await add(name, 2, v2Id)

    const record = await add(name, 1, v1Id)

    expect(record).toMatchObject({ version: 2, schemaFileId: v2Id })
    const rows = await rowsNamed(name)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ version: 2, schemaFileId: v2Id })
    expect(JSON.parse(rows[0].schemaData!).id).toBe(v2Id)
  })

  it('keeps a published schema\'s id when the same version comes with another id', async () => {
    const name = 'Add Schema Same Version'
    const fileId = generateId()
    await add(name, 1, fileId)

    const record = await add(name, 1, generateId())

    expect(record.schemaFileId).toBe(fileId)
    const rows = await rowsNamed(name)
    expect(rows).toHaveLength(1)
    expect(rows[0].schemaFileId).toBe(fileId)
  })
})
