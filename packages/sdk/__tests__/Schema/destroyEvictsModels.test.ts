import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { Schema } from '@/Schema/Schema'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

// Regression: Schema.destroy() deleted model/property rows but left Model and ModelProperty
// instances cached, so after re-importing the schema Model.all returned the old instance with a
// _dbId pointing at a deleted row.
testDescribe('Schema.destroy evicts cached models and properties', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: 90000 })
  }, 90000)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('re-importing a destroyed schema yields fresh instances bound to the new rows', async () => {
    const schemaName = `Destroy Evict ${generateId()}`
    const modelFileId = generateId()
    const schemaFile = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        Note: {
          id: modelFileId,
          properties: {
            title: { id: generateId(), type: 'Text' },
            body: { id: generateId(), type: 'Text' },
          },
        },
      },
      enums: {},
      migrations: [],
    }
    const db = BaseDb.getAppDb()!
    const noteRowId = async () =>
      (await db.select({ id: modelsTable.id }).from(modelsTable).where(eq(modelsTable.schemaFileId, modelFileId)))[0]?.id

    await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)
    const [oldModel] = await Model.all(schemaName, { waitForReady: true })
    const oldProperties = await ModelProperty.all(modelFileId, { waitForReady: true })
    const oldRowId = await noteRowId()
    expect(oldModel._getSnapshotContext()._dbId).toBe(oldRowId)
    expect(oldProperties.map((p) => p.name).sort()).toEqual(['body', 'title'])

    const schema = await Schema.create(schemaName, { waitForReady: true })
    await schema.destroy()
    expect(await noteRowId()).toBeUndefined()

    await importJsonSchema({ contents: JSON.stringify(schemaFile) }, schemaFile.version)
    const newRowId = await vi.waitUntil(noteRowId, { timeout: 15000 })
    expect(newRowId).not.toBe(oldRowId)

    const [newModel] = await Model.all(schemaName, { waitForReady: true })
    expect(newModel).not.toBe(oldModel)
    await vi.waitFor(() => expect(newModel._getSnapshotContext()._dbId).toBe(newRowId), { timeout: 15000 })

    const newProperties = await ModelProperty.all(modelFileId, { waitForReady: true })
    expect(newProperties.map((p) => p.name).sort()).toEqual(['body', 'title'])
    for (const property of newProperties) {
      expect(oldProperties).not.toContain(property)
    }
  }, 60000)
})
