import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
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

  // Regression: model lookups by name weren't scoped to the schema. Importing schema B adopted
  // schema A's same-named row (rewriting its schemaFileId), and a model instance that loaded before
  // its own row existed bound to A's row, so creating, destroying or re-importing B clobbered A.
  describe('a same-named model in another schema', () => {
    const makeSchemaFile = (schemaName: string, modelFileId: string) => ({
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        Note: {
          id: modelFileId,
          properties: {
            title: { id: generateId(), type: 'Text' },
          },
        },
      },
      enums: {},
      migrations: [],
    })
    const rowIdFor = async (modelFileId: string) =>
      (await BaseDb.getAppDb()!.select({ id: modelsTable.id }).from(modelsTable).where(eq(modelsTable.schemaFileId, modelFileId)))[0]?.id

    let schemaAName: string
    let modelFileIdA: string
    let modelA: Model
    let rowIdA: number | undefined

    const expectAUntouched = async () => {
      expect(await rowIdFor(modelFileIdA)).toBe(rowIdA)
      expect(modelA.id).toBe(modelFileIdA)
      expect(modelA._getSnapshotContext().schemaName).toBe(schemaAName)
      expect(modelA._getSnapshotContext()._dbId).toBe(rowIdA)
      const all = await Model.all(schemaAName, { waitForReady: true })
      expect(all).toEqual([modelA])
    }

    beforeAll(async () => {
      schemaAName = `Same Name A ${generateId()}`
      modelFileIdA = generateId()
      const schemaFileA = makeSchemaFile(schemaAName, modelFileIdA)
      await importJsonSchema({ contents: JSON.stringify(schemaFileA) }, schemaFileA.version)
      ;[modelA] = await Model.all(schemaAName, { waitForReady: true })
      rowIdA = await rowIdFor(modelFileIdA)
      expect(rowIdA).toBeDefined()
      const links = await BaseDb.getAppDb()!.select().from(modelSchemas).where(eq(modelSchemas.modelId, rowIdA!))
      expect(links).toHaveLength(1)
      expect(modelA.id).toBe(modelFileIdA)
      expect(modelA._getSnapshotContext()._dbId).toBe(rowIdA)
    }, 60000)

    afterAll(async () => {
      const schemaA = await Schema.create(schemaAName, { waitForReady: true })
      await schemaA.destroy()
    })

    it('is left alone by importing, destroying and re-importing a schema', async () => {
      const schemaBName = `Same Name B ${generateId()}`
      const modelFileIdB = generateId()
      const schemaFileB = makeSchemaFile(schemaBName, modelFileIdB)

      await importJsonSchema({ contents: JSON.stringify(schemaFileB) }, schemaFileB.version)
      const rowIdB = await vi.waitUntil(() => rowIdFor(modelFileIdB), { timeout: 15000 })
      expect(rowIdB).not.toBe(rowIdA)
      const [modelB] = await Model.all(schemaBName, { waitForReady: true })
      expect(modelB).not.toBe(modelA)
      expect(modelB.id).toBe(modelFileIdB)
      await expectAUntouched()

      const schemaB = await Schema.create(schemaBName, { waitForReady: true })
      await schemaB.destroy()
      expect(await rowIdFor(modelFileIdB)).toBeUndefined()
      await expectAUntouched()

      await importJsonSchema({ contents: JSON.stringify(schemaFileB) }, schemaFileB.version)
      const reimportedRowIdB = await vi.waitUntil(() => rowIdFor(modelFileIdB), { timeout: 15000 })
      const [reimportedModelB] = await Model.all(schemaBName, { waitForReady: true })
      expect(reimportedModelB.id).toBe(modelFileIdB)
      await vi.waitFor(() => expect(reimportedModelB._getSnapshotContext()._dbId).toBe(reimportedRowIdB), { timeout: 15000 })
      await expectAUntouched()

      await (await Schema.create(schemaBName, { waitForReady: true })).destroy()
    }, 60000)

    it('is not adopted by a model instance that loads before its own row exists', async () => {
      const schemaCName = `Same Name C ${generateId()}`
      const modelFileIdC = generateId()
      const modelC = await Model.create('Note', schemaCName, { modelFileId: modelFileIdC, waitForReady: true })
      expect(modelC).not.toBe(modelA)
      expect(modelC.id).toBe(modelFileIdC)
      expect(modelC._getSnapshotContext().schemaName).toBe(schemaCName)
      expect(modelC._getSnapshotContext()._dbId).not.toBe(rowIdA)
      await expectAUntouched()

      await (await Schema.create(schemaCName, { waitForReady: true })).destroy()
    }, 60000)
  })
})
