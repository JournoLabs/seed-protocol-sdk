import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { models as modelsTable, properties as propertiesTable } from '@/seedSchema/ModelSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { seeds } from '@/seedSchema/SeedSchema'
import { appState } from '@/seedSchema/AppStateSchema'
import { AmbiguousModelError } from '@/Model/errors'
import { resolveModelRecord } from '@/db/read/resolveModelRecord'
import {
  LEGACY_ITEM_MODEL_CHECK_KEY,
  resetAmbiguousLegacyItemData,
} from '@/db/resetAmbiguousLegacyItemData'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { getModelPropertiesData } from '@/db/read/getModelPropertiesData'
import { generateId } from '@/helpers'
import { savePropertyToDb, writePropertyToDb } from '@/helpers/db'
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

    // Without a schema, a name that exists in two schemas is an error, not a guess.
    const ambiguous = Item.create({ modelName: 'Post', title: 'which Post?' })
    await expect(ambiguous).rejects.toBeInstanceOf(AmbiguousModelError)
    await expect(ambiguous).rejects.toMatchObject({
      modelName: 'Post',
      schemaNames: [schemaA.metadata.name, schemaB.metadata.name].sort(),
    })
    expect(() => Model.getByName('Post')).toThrow(AmbiguousModelError)
    await expect(resolveModelRecord('Post')).rejects.toBeInstanceOf(AmbiguousModelError)
    expect(Model.getByName('Post', schemaB.metadata.name)).toBe(postB)

    // Listing doesn't need one model: all Posts unscoped, one schema's with schemaName or modelFileId.
    const allPosts = (await Item.all('Post')).map((i) => i.seedLocalId)
    expect(allPosts).toEqual(expect.arrayContaining([itemA.seedLocalId, seedLocalIdB]))
    const postsInA = (await Item.all('Post', false, { schemaName: schemaA.metadata.name })).map((i) => i.seedLocalId)
    expect(postsInA).toEqual([itemA.seedLocalId])
    const postsInB = (await Item.all('Post', false, { modelFileId: postIdB })).map((i) => i.seedLocalId)
    expect(postsInB).toEqual([seedLocalIdB])
  }, 60000)

  // Regression: writePropertyToDb/savePropertyToDb found a Relation's target with a global name lookup,
  // which threw "Multiple records found" once two schemas defined the target model (e.g. Author).
  it('resolves a Relation target in the owning model\'s schema when the name is defined twice', async () => {
    const suffix = generateId()
    const buildAuthorSchema = (schemaName: string) => ({
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        Author: { id: generateId(), properties: { name: { id: generateId(), type: 'Text' } } },
        Article: { id: generateId(), properties: { title: { id: generateId(), type: 'Text' } } },
      },
      enums: {},
      migrations: [],
    })
    const schemaA = buildAuthorSchema(`Ref Scope A ${suffix}`)
    const schemaB = buildAuthorSchema(`Ref Scope B ${suffix}`)
    await importJsonSchema({ contents: JSON.stringify(schemaA) }, schemaA.version)
    await importJsonSchema({ contents: JSON.stringify(schemaB) }, schemaB.version)

    const db = BaseDb.getAppDb()!
    const rowIdFor = async (modelFileId: string) =>
      (await db.select({ id: modelsTable.id }).from(modelsTable).where(eq(modelsTable.schemaFileId, modelFileId)))[0]
        .id as number
    const articleB = await rowIdFor(schemaB.models.Article.id)
    const authorB = await rowIdFor(schemaB.models.Author.id)
    const refModelIdOf = async (propertyFileId: string) =>
      (
        await db
          .select({ refModelId: propertiesTable.refModelId })
          .from(propertiesTable)
          .where(eq(propertiesTable.schemaFileId, propertyFileId))
      )[0]?.refModelId

    // Path of a runtime model's write (writeModelToDb → writePropertyToDb)
    const writtenId = generateId()
    await writePropertyToDb(writtenId, { modelId: articleB, name: 'author', dataType: 'Relation', refModelName: 'Author' })
    expect(await refModelIdOf(writtenId)).toBe(authorB)

    // Path of ModelProperty.save()
    const savedId = generateId()
    await savePropertyToDb({
      id: savedId,
      name: 'editor',
      modelId: articleB,
      modelName: 'Article',
      dataType: 'Relation',
      refModelName: 'Author',
    } as Parameters<typeof savePropertyToDb>[0])
    expect(await refModelIdOf(savedId)).toBe(authorB)
  }, 60000)

  it('clears item data once when legacy seeds have no model and their name is ambiguous', async () => {
    const db = BaseDb.getAppDb()!
    const suffix = generateId()
    const schemaA = buildSchemaFile(`Legacy A ${suffix}`, generateId(), ['title'])
    const schemaB = buildSchemaFile(`Legacy B ${suffix}`, generateId(), ['headline'])
    await importJsonSchema({ contents: JSON.stringify(schemaA) }, schemaA.version)
    await importJsonSchema({ contents: JSON.stringify(schemaB) }, schemaB.version)
    const schemaCount = async () => (await db.select({ id: schemasTable.id }).from(schemasTable)).length
    const schemasBefore = await schemaCount()

    // A seed from before seeds.model_file_id existed
    const legacySeedLocalId = generateId()
    await db.insert(seeds).values({ localId: legacySeedLocalId, type: 'post', createdAt: Date.now() })
    await db.delete(appState).where(eq(appState.key, LEGACY_ITEM_MODEL_CHECK_KEY))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await resetAmbiguousLegacyItemData()).toBe(true)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Clearing local item data'))
    } finally {
      warn.mockRestore()
    }
    expect(await db.select({ localId: seeds.localId }).from(seeds)).toEqual([])
    expect(await schemaCount()).toBe(schemasBefore)

    // Only once: later seeds without a model (e.g. EAS-synced) don't trigger it again.
    await db.insert(seeds).values({ localId: generateId(), type: 'post', createdAt: Date.now() })
    expect(await resetAmbiguousLegacyItemData()).toBe(false)
    expect((await db.select({ localId: seeds.localId }).from(seeds)).length).toBe(1)
  }, 60000)
})
