import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { Item } from '@/Item/Item'
import { ItemCreateValidationError } from '@/Item/errors'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { getPropertySchema } from '@/helpers/property'
import { getPropertyDefinition } from '@/helpers/propertyDefinition'
import { prepareHtmlEmbeddedImagesForPublish } from '@/helpers/htmlEmbeddedDataUriPublish'
import { BaseDb } from '@/db/Db/BaseDb'
import { models, properties } from '@/seedSchema'
import { htmlEmbeddedImageCoPublish } from '@/seedSchema/HtmlEmbeddedImageCoPublishSchema'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForPropertyInstances } from '../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../test-utils/waitForIdle'
import { embeddedImageDataUri } from '../test-utils/embeddedImage'

/**
 * Property definitions are stored whole in properties.definition (audit decision D7) and read back
 * from there by every lookup: a schema file's htmlEmbeddedDataUriPolicy reaches publish, and
 * validation defined in a file or in code survives a reload.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const FILE_SCHEMA = 'Test Schema Property Definition File'
const CODE_SCHEMA = 'Test Schema Property Definition Code'

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: FILE_SCHEMA, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    DefArticle: {
      id: generateId(),
      properties: {
        slug: {
          id: generateId(),
          type: 'Text',
          description: 'URL path segment',
          validation: { pattern: '^[a-z-]+$' },
        },
        body: { id: generateId(), type: 'Html', htmlEmbeddedDataUriPolicy: 'preserve' },
      },
    },
  },
  enums: {},
  migrations: [],
})

/** What a page reload does to the caches: every Schema, Model and ModelProperty of the schema goes. */
const evictSchema = (schemaName: string) => {
  Schema.evict(schemaName)
  ModelProperty.evictForModels(Model.evictForSchema(schemaName), schemaName)
}

const propertyRow = async (modelName: string, propertyName: string) => {
  const [row] = await BaseDb.getAppDb()
    .select({ id: properties.id, definition: properties.definition })
    .from(properties)
    .innerJoin(models, eq(models.id, properties.modelId))
    .where(and(eq(models.name, modelName), eq(properties.name, propertyName)))
    .limit(1)
  return row
}

testDescribe('property definitions stored on the row', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('reads validation, the policy and description after a DB load', async () => {
    evictSchema(FILE_SCHEMA)

    const slug = await propertyRow('DefArticle', 'slug')
    expect(await getPropertyDefinition(slug!.id)).toMatchObject({
      name: 'slug',
      dataType: 'Text',
      description: 'URL path segment',
      validation: { pattern: '^[a-z-]+$' },
    })
    expect(await getPropertySchema('DefArticle', 'body', { schemaName: FILE_SCHEMA })).toMatchObject({
      dataType: 'Html',
      htmlEmbeddedDataUriPolicy: 'preserve',
    })

    // Instances built from the row carry them too (saveNewVersion writes files from these)
    const body = await propertyRow('DefArticle', 'body')
    const bodyFileId = (await getPropertyDefinition(body!.id))!.id!
    const instance = await ModelProperty.createById(bodyFileId)
    expect(instance!._getSnapshotContext().htmlEmbeddedDataUriPolicy).toBe('preserve')
  }, 30000)

  it("passes a schema file's htmlEmbeddedDataUriPolicy 'preserve' to publish", async () => {
    const item = await Item.create({
      modelName: 'DefArticle',
      schemaName: FILE_SCHEMA,
      slug: 'with-image',
      body: `<p>pic <img src="${embeddedImageDataUri()}"></p>`,
    } as any)
    await waitForIdle(item, 'Item', 15000)
    await waitForPropertyInstances(item)

    // The publish level says materialize; the property's own policy wins
    const { deferredHtmlSeedLocalIds } = await prepareHtmlEmbeddedImagesForPublish(item as any, 'materialize')
    expect(deferredHtmlSeedLocalIds).toEqual([])
    const coPublished = await BaseDb.getAppDb()
      .select()
      .from(htmlEmbeddedImageCoPublish)
      .where(eq(htmlEmbeddedImageCoPublish.parentSeedLocalId, item.seedLocalId))
    expect(coPublished).toHaveLength(0)
  }, 60000)

  it('keeps code-defined validation across a reload', async () => {
    await Schema.create(CODE_SCHEMA)
    await Model.create('DefSlugged', CODE_SCHEMA, {
      properties: {
        handle: { dataType: 'Text', validation: { pattern: '^[a-z]+$' } },
      },
    })

    // Stored at create time, not at the next saveNewVersion
    const row = await propertyRow('DefSlugged', 'handle')
    expect(JSON.parse(row!.definition!)).toMatchObject({ validation: { pattern: '^[a-z]+$' } })

    evictSchema(CODE_SCHEMA)

    expect(await getPropertySchema('DefSlugged', 'handle', { schemaName: CODE_SCHEMA })).toMatchObject({
      validation: { pattern: '^[a-z]+$' },
    })
    await expect(
      Item.create({ modelName: 'DefSlugged', schemaName: CODE_SCHEMA, handle: 'Not Valid' } as any),
    ).rejects.toBeInstanceOf(ItemCreateValidationError)
  }, 60000)
})
