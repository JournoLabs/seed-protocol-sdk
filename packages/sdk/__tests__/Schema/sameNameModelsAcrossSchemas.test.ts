import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { seeds } from '@/seedSchema/SeedSchema'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { getModelPropertiesData } from '@/db/read/getModelPropertiesData'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment } from '../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

// Regression: importing a second schema that also defines "Post" (with its own model id) adopted the
// first schema's Post row and overwrote its schemaFileId. The first schema's cached Model kept the old
// id, ModelProperty.all(oldId) returned nothing, and the one row was linked to both schemas.
testDescribe('same-name models across schemas', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: 90000 })
  }, 90000)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const buildSchemaFile = (schemaName: string, postId: string, properties: string[]) => ({
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    models: {
      Post: {
        id: postId,
        properties: Object.fromEntries(properties.map((name) => [name, { id: generateId(), type: 'Text' }])),
      },
    },
    enums: {},
    migrations: [],
  })

  it('each schema keeps its own Post row and properties', async () => {
    const suffix = generateId()
    const schemaA = buildSchemaFile(`Same Name A ${suffix}`, generateId(), ['title', 'body'])
    const schemaB = buildSchemaFile(`Same Name B ${suffix}`, generateId(), ['headline', 'summary', 'author'])
    const postIdA = schemaA.models.Post.id
    const postIdB = schemaB.models.Post.id
    const db = BaseDb.getAppDb()!

    const rowFor = async (modelFileId: string) =>
      (await db.select().from(modelsTable).where(eq(modelsTable.schemaFileId, modelFileId)))[0]
    const linkedSchemaNames = async (modelId: number) =>
      (
        await db
          .select({ name: schemasTable.name })
          .from(modelSchemas)
          .innerJoin(schemasTable, eq(modelSchemas.schemaId, schemasTable.id))
          .where(eq(modelSchemas.modelId, modelId))
      ).map((r: { name: string }) => r.name)

    await importJsonSchema({ contents: JSON.stringify(schemaA) }, schemaA.version)
    const [postA] = await Model.all(schemaA.metadata.name, { waitForReady: true })
    const rowA = await rowFor(postIdA)
    expect(rowA).toBeDefined()

    await importJsonSchema({ contents: JSON.stringify(schemaB) }, schemaB.version)

    // Schema A's row is untouched; schema B got its own row.
    expect(await rowFor(postIdA)).toMatchObject({ id: rowA.id, name: 'Post', schemaFileId: postIdA })
    const rowB = await rowFor(postIdB)
    expect(rowB).toBeDefined()
    expect(rowB.id).not.toBe(rowA.id)
    expect(rowB.name).toBe('Post')

    expect(await linkedSchemaNames(rowA.id)).toEqual([schemaA.metadata.name])
    expect(await linkedSchemaNames(rowB.id)).toEqual([schemaB.metadata.name])

    expect((await getModelPropertiesData(postIdA)).map((p) => p.name).sort()).toEqual(['body', 'title'])
    expect((await getModelPropertiesData(postIdB)).map((p) => p.name).sort()).toEqual([
      'author',
      'headline',
      'summary',
    ])

    const [postAAfter] = await Model.all(schemaA.metadata.name, { waitForReady: true })
    const [postB] = await Model.all(schemaB.metadata.name, { waitForReady: true })
    expect(postAAfter).toBe(postA)
    expect(postAAfter.id).toBe(postIdA)
    expect(postAAfter._getSnapshotContext()._dbId).toBe(rowA.id)
    expect(postB).not.toBe(postA)
    expect(postB.id).toBe(postIdB)

    expect((await ModelProperty.all(postIdA, { waitForReady: true })).map((p) => p.name).sort()).toEqual([
      'body',
      'title',
    ])
    expect((await ModelProperty.all(postIdB, { waitForReady: true })).map((p) => p.name).sort()).toEqual([
      'author',
      'headline',
      'summary',
    ])

    // Items record their own model, so each resolves its schema's Post definition.
    const itemA = await Item.create({ modelName: 'Post', schemaName: schemaA.metadata.name, title: 'A title' })
    const itemB = await Item.create({ modelName: 'Post', schemaName: schemaB.metadata.name, headline: 'B headline' })
    const seedModelFileId = async (seedLocalId: string) =>
      (await db.select({ modelFileId: seeds.modelFileId }).from(seeds).where(eq(seeds.localId, seedLocalId)))[0]
        ?.modelFileId
    expect(await seedModelFileId(itemA.seedLocalId)).toBe(postIdA)
    expect(await seedModelFileId(itemB.seedLocalId)).toBe(postIdB)

    const itemPropertyNames = async (item: Item<any>) =>
      vi.waitFor(
        () => {
          const names = item.properties.map((p) => p.propertyName).sort()
          expect(names.length).toBeGreaterThan(0)
          return names
        },
        { timeout: 15000 },
      )
    expect(await itemPropertyNames(itemA)).toEqual(['body', 'title'])
    expect(await itemPropertyNames(itemB)).toEqual(['author', 'headline', 'summary'])

    // A fresh load from the DB (no schemaName passed) still finds the right model.
    const seedLocalIdB = itemB.seedLocalId
    itemB.unload()
    const loadedB = await Item.find({ seedLocalId: seedLocalIdB, modelName: 'Post' })
    expect(loadedB).toBeDefined()
    const headline = loadedB!.properties.find((p) => p.propertyName === 'headline')
    expect(loadedB!.properties.map((p) => p.propertyName).sort()).toEqual(['author', 'headline', 'summary'])
    expect(headline?.propertyDef?.dataType).toBe('Text')
  }, 60000)
})
