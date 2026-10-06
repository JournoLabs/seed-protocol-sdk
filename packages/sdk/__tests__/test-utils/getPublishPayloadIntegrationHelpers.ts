/**
 * Shared helpers and schema for getPublishPayload integration tests.
 * Covers all ModelPropertyDataTypes and segmentation paths (basic, relation, list, image).
 * Environment-agnostic: use from both Node and browser tests after setupTestEnvironment().
 */

import { waitFor } from 'xstate'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import type { IItemProperty } from '@/interfaces'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import type { Item as ItemClass } from '@/Item/Item'
import { BaseDb } from '@/db/Db/BaseDb'
import { eq, and } from 'drizzle-orm'
import { models as modelsTable, modelUids, metadata, seeds } from '@/seedSchema'
import { SchemaRegistry } from '@ethereum-attestation-service/eas-sdk'
import { INTERNAL_DATA_TYPES } from '@/helpers/constants'
import { normalizeDataType } from '@/helpers/property'
import { listRelationEasPropertyName } from '@/helpers/metadataPropertyNames'
import { toSnakeCase } from 'drizzle-orm/casing'
import { getEasSchemaUidForSchemaDefinition, setSchemaUidForSchemaDefinition } from '@/stores/eas'

const SCHEMA_NAME = 'Test Schema getPublishPayload'
const SCHEMA_NAME_OPTIONAL_AUTHOR = 'Test Schema getPublishPayload Optional Author'
const SCHEMA_NAME_ENUM_VALIDATION = 'Test Schema getPublishPayload Enum'

function waitForItemIdle(item: ItemClass<any>, timeout = 10000): Promise<void> {
  const service = item.getService()
  return waitFor(
    service,
    (snapshot) => {
      if (snapshot.value === 'error') throw new Error('Item failed to load')
      return snapshot.value === 'idle'
    },
    { timeout }
  ).catch((err) => {
    if (err?.message === 'Item failed to load') throw err
    throw new Error(`Item loading timeout after ${timeout}ms`)
  })
}

function waitForModelIdle(model: Model, timeout = 5000): Promise<void> {
  return waitFor(
    model.getService(),
    (snapshot) => snapshot.value === 'idle',
    { timeout }
  )
}

export async function waitForPropertyInstances(item: ItemClass<any>, timeout = 10000): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false
    let t: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (done) return
      done = true
      subscription.unsubscribe()
      if (t !== undefined) clearTimeout(t)
      resolve()
    }
    const subscription = item.getService().subscribe((snapshot) => {
      const propertyInstances = snapshot.context.propertyInstances as Map<string, IItemProperty> | undefined
      if (propertyInstances && propertyInstances.size > 0) finish()
    })
    const currentSnapshot = item.getService().getSnapshot()
    const currentPropertyInstances = currentSnapshot.context.propertyInstances as Map<string, IItemProperty> | undefined
    if (currentPropertyInstances && currentPropertyInstances.size > 0) {
      finish()
      return
    }
    t = setTimeout(finish, timeout)
  })
}

/**
 * Comprehensive schema with Author, Tag, Post.
 * Post has: Text, Number, Json, Boolean, Date, Html, File (basic), Relation (author), Image (coverImage), List (tagIds ref Tag).
 */
export function getGetPublishPayloadTestSchema(): SchemaFileFormat {
  const authorId = generateId()
  const tagId = generateId()
  const postId = generateId()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: {
      name: SCHEMA_NAME,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    models: {
      Author: {
        id: authorId,
        properties: {
          name: { id: generateId(), type: 'Text' },
          bio: { id: generateId(), type: 'Text' },
        },
      },
      Tag: {
        id: tagId,
        properties: {
          label: { id: generateId(), type: 'Text' },
        },
      },
      Post: {
        id: postId,
        properties: {
          title: { id: generateId(), type: 'Text' },
          count: { id: generateId(), type: 'Number' },
          payload: { id: generateId(), type: 'Json' },
          isPublished: { id: generateId(), type: 'Boolean' },
          publishedOn: { id: generateId(), type: 'Date' },
          bodyHtml: { id: generateId(), type: 'Html' },
          attachment: { id: generateId(), type: 'File' },
          author: { id: generateId(), type: 'Relation', model: 'Author', required: true },
          coverImage: { id: generateId(), type: 'Image' },
          tagIds: { id: generateId(), type: 'List', refValueType: 'Relation', ref: 'Tag' },
        },
      },
    },
    enums: {},
    migrations: [],
  }
}

export type GetPublishPayloadTestSchemaResult = {
  schemaName: string
  models: { Author: Model; Tag: Model; Post: Model }
}

/** Placeholder schema UIDs for test models when EAS has no schema. Deterministic per model (0x + 64 hex). */
function testModelPlaceholderUid(index: number): string {
  return '0x' + (index + 1).toString(16).padStart(64, '0')
}

export async function ensureModelUidsForGetPublishPayloadTest(modelNames: string[] = ['Author', 'Tag', 'Post', 'Image', 'File', 'Html']): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return
  for (let i = 0; i < modelNames.length; i++) {
    const name = modelNames[i]
    const rows = await db.select({ id: modelsTable.id }).from(modelsTable).where(eq(modelsTable.name, name)).limit(1)
    if (rows.length === 0) continue
    const modelId = rows[0].id
    const existing = await db.select().from(modelUids).where(eq(modelUids.modelId, modelId)).limit(1)
    if (existing.length > 0) continue
    await db.insert(modelUids).values({ modelId, uid: testModelPlaceholderUid(i) })
  }
}

/**
 * Cache a schema UID for every property schema definition of the test models that EAS doesn't have.
 * getPublishPayload fails a property whose schema isn't registered (the publish package registers
 * them in ensureEasSchemasForItem, which these tests don't run). Covers both name forms a property
 * can attest under (schema key, Id-suffixed, List-of-relation storage name).
 */
export async function ensurePropertySchemaUidsForGetPublishPayloadTest(schema: SchemaFileFormat): Promise<void> {
  const zeroAddress = '0x0000000000000000000000000000000000000000' as `0x${string}`
  for (const model of Object.values(schema.models ?? {})) {
    for (const [key, def] of Object.entries((model as { properties?: Record<string, any> }).properties ?? {})) {
      const dataType = normalizeDataType(def.type ?? def.dataType)
      const eas = (INTERNAL_DATA_TYPES as Record<string, { eas?: string }>)[dataType]?.eas
      if (!eas) continue
      const names = new Set([key, `${key}Id`])
      const listName = listRelationEasPropertyName(key, { dataType, ref: def.ref ?? def.model })
      if (listName) names.add(listName)
      for (const name of names) {
        const text = `${eas} ${toSnakeCase(name)}`
        if (await getEasSchemaUidForSchemaDefinition({ schemaText: text })) continue
        setSchemaUidForSchemaDefinition({ text, schemaUid: SchemaRegistry.getSchemaUID(text, zeroAddress, true) })
      }
    }
  }
}

/**
 * Schema with optional author relation (required: false).
 * Used for testing that optional relations skip (no throw) when related item not found.
 */
export function getGetPublishPayloadTestSchemaOptionalAuthor(): SchemaFileFormat {
  const authorId = generateId()
  const tagId = generateId()
  const postId = generateId()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: {
      name: SCHEMA_NAME_OPTIONAL_AUTHOR,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    models: {
      Author: {
        id: authorId,
        properties: {
          name: { id: generateId(), type: 'Text' },
          bio: { id: generateId(), type: 'Text' },
        },
      },
      Tag: {
        id: tagId,
        properties: {
          label: { id: generateId(), type: 'Text' },
        },
      },
      Post: {
        id: postId,
        properties: {
          title: { id: generateId(), type: 'Text' },
          author: { id: generateId(), type: 'Relation', model: 'Author', required: false },
          tagIds: { id: generateId(), type: 'List', refValueType: 'Relation', ref: 'Tag' },
        },
      },
    },
    enums: {},
    migrations: [],
  }
}

/**
 * Schema with Article model that has status Text property with enum validation.
 * Used for testing that getPublishPayload rejects invalid enum values.
 */
export function getGetPublishPayloadTestSchemaWithEnum(): SchemaFileFormat {
  const articleId = generateId()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: {
      name: SCHEMA_NAME_ENUM_VALIDATION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    models: {
      Article: {
        id: articleId,
        properties: {
          title: { id: generateId(), type: 'Text' },
          status: {
            id: generateId(),
            type: 'Text',
            validation: { enum: ['draft', 'published', 'archived'] },
          },
        },
      },
    },
    enums: {},
    migrations: [],
  }
}

/**
 * The imported schema's model instance. Model.create without a modelFileId makes a new runtime model
 * with a unique name ("Post 1"), which leaves duplicate models in the DB that confuse name lookups.
 */
function getSchemaModel(schema: { models: Record<string, { id?: string }> }, modelName: string, schemaName: string): Model {
  return Model.create(modelName, schemaName, { modelFileId: schema.models[modelName].id, waitForReady: false }) as Model
}

/**
 * Import the comprehensive schema and create all models. Call once in beforeAll.
 */
export async function createGetPublishPayloadTestSchema(): Promise<GetPublishPayloadTestSchemaResult> {
  const schema = getGetPublishPayloadTestSchema()
  await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  await ensureModelUidsForGetPublishPayloadTest()
  await ensurePropertySchemaUidsForGetPublishPayloadTest(schema)
  const authorModel = getSchemaModel(schema, 'Author', SCHEMA_NAME)
  const tagModel = getSchemaModel(schema, 'Tag', SCHEMA_NAME)
  const postModel = getSchemaModel(schema, 'Post', SCHEMA_NAME)
  await waitForModelIdle(authorModel)
  await waitForModelIdle(tagModel)
  await waitForModelIdle(postModel)
  return {
    schemaName: SCHEMA_NAME,
    models: { Author: authorModel, Tag: tagModel, Post: postModel },
  }
}

/**
 * Import schema with optional author and create models. For testing optional relation behavior.
 */
export async function createGetPublishPayloadTestSchemaOptionalAuthor(): Promise<{
  schemaName: string
  models: { Author: Model; Tag: Model; Post: Model }
}> {
  const schema = getGetPublishPayloadTestSchemaOptionalAuthor()
  await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  await ensureModelUidsForGetPublishPayloadTest()
  await ensurePropertySchemaUidsForGetPublishPayloadTest(schema)
  const authorModel = getSchemaModel(schema, 'Author', SCHEMA_NAME_OPTIONAL_AUTHOR)
  const tagModel = getSchemaModel(schema, 'Tag', SCHEMA_NAME_OPTIONAL_AUTHOR)
  const postModel = getSchemaModel(schema, 'Post', SCHEMA_NAME_OPTIONAL_AUTHOR)
  await waitForModelIdle(authorModel)
  await waitForModelIdle(tagModel)
  await waitForModelIdle(postModel)
  return {
    schemaName: SCHEMA_NAME_OPTIONAL_AUTHOR,
    models: { Author: authorModel, Tag: tagModel, Post: postModel },
  }
}

/**
 * Import schema with Article model that has status enum validation.
 * Used for testing getPublishPayload rejects invalid enum values.
 */
export async function createGetPublishPayloadTestSchemaWithEnum(): Promise<{
  schemaName: string
  models: { Article: Model }
}> {
  const schema = getGetPublishPayloadTestSchemaWithEnum()
  await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  await ensureModelUidsForGetPublishPayloadTest(['Article'])
  await ensurePropertySchemaUidsForGetPublishPayloadTest(schema)
  const articleModel = getSchemaModel(schema, 'Article', SCHEMA_NAME_ENUM_VALIDATION)
  await waitForModelIdle(articleModel)
  return {
    schemaName: SCHEMA_NAME_ENUM_VALIDATION,
    models: { Article: articleModel },
  }
}

export type CreateItemWithBasicPropertiesOnlyOptions = {
  title?: string
  count?: number
  payload?: string
  isPublished?: boolean
  publishedOn?: string
  bodyHtml?: string
  attachment?: string
}

/**
 * Post.author is a required relation. Fixtures that are not about relations point it at an Author
 * marked published (seeds.uid set) so getPublishPayload validates and adds no Author payload.
 */
export async function createPublishedTestAuthor(): Promise<ItemClass<any>> {
  const author = await Item.create({ modelName: 'Author', name: 'Published Test Author' })
  await waitForItemIdle(author)
  const db = BaseDb.getAppDb()
  if (!db) throw new Error('Database not available')
  const uid = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  await db.update(seeds).set({ uid, updatedAt: Date.now() }).where(eq(seeds.localId, author.seedLocalId!))
  // getItem can return the cached instance, so its context needs the uid too.
  author.getService().send({ type: 'updateContext', seedUid: uid })
  return author
}

/**
 * Create a Post item with only basic properties set (no list, image), pointing at a published author.
 */
export async function createItemWithBasicPropertiesOnly(
  options: CreateItemWithBasicPropertiesOnlyOptions = {}
): Promise<{ item: ItemClass<any> }> {
  const {
    title = 'A new title 2',
    count = 42,
    payload = '{"key":"value"}',
    isPublished = true,
    publishedOn = '2025-01-15T00:00:00.000Z',
    // Html must go through ItemProperty.save() to become a storage seed; Item.create writes raw values
    // that publish validation rejects. Leave unset unless a test is about that.
    bodyHtml,
    attachment = '',
  } = options
  const author = await createPublishedTestAuthor()
  const item = await Item.create({
    modelName: 'Post',
    author: author.seedLocalId,
    title,
    count,
    payload,
    isPublished,
    publishedOn,
    ...(bodyHtml ? { bodyHtml } : {}),
    ...(attachment ? { attachment } : {}),
  })
  await waitForItemIdle(item)
  await waitForPropertyInstances(item)
  return { item }
}

export type CreateItemWithRelationOptions = {
  authorName?: string
  authorBio?: string
  postTitle?: string
}

/**
 * Create an Author and a Post with author relation set.
 */
export async function createItemWithRelation(
  options: CreateItemWithRelationOptions = {}
): Promise<{ authorItem: ItemClass<any>; postItem: ItemClass<any> }> {
  const { authorName = 'Jane Author', authorBio = 'Bio', postTitle = 'Post with author' } = options
  const authorItem = await Item.create({ modelName: 'Author', name: authorName, bio: authorBio })
  await waitForItemIdle(authorItem)
  await waitForPropertyInstances(authorItem)
  const postItem = await Item.create({
    modelName: 'Post',
    title: postTitle,
    author: authorItem.seedLocalId,
  })
  await waitForItemIdle(postItem)
  await waitForPropertyInstances(postItem)
  return { authorItem, postItem }
}

export type CreateItemWithListOptions = {
  tagLabels?: string[]
  postTitle?: string
}

/**
 * Create Tag items and a Post with tagIds list set.
 */
export async function createItemWithList(
  options: CreateItemWithListOptions = {}
): Promise<{ tagItems: ItemClass<any>[]; postItem: ItemClass<any> }> {
  const { tagLabels = ['tag1', 'tag2'], postTitle = 'Post with tags' } = options
  const tagItems: ItemClass<any>[] = []
  for (const label of tagLabels) {
    const tagItem = await Item.create({ modelName: 'Tag', label })
    await waitForItemIdle(tagItem)
    tagItems.push(tagItem)
  }
  const tagIds = tagItems.map((t) => t.seedLocalId)
  const author = await createPublishedTestAuthor()
  const postItem = await Item.create({
    modelName: 'Post',
    author: author.seedLocalId,
    title: postTitle,
    tagIds: JSON.stringify(tagIds),
  })
  await waitForItemIdle(postItem)
  await waitForPropertyInstances(postItem)
  return { tagItems, postItem }
}

export type CreateItemWithImageOptions = {
  postTitle?: string
}

/**
 * Create a Post with coverImage set (placeholder value; image path may require file setup).
 */
export async function createItemWithImage(
  options: CreateItemWithImageOptions = {}
): Promise<{ postItem: ItemClass<any> }> {
  const { postTitle = 'Post with image' } = options
  const author = await createPublishedTestAuthor()
  const postItem = await Item.create({
    modelName: 'Post',
    author: author.seedLocalId,
    title: postTitle,
    coverImage: '', // Empty or placeholder; getPublishPayload may skip or handle
  })
  await waitForItemIdle(postItem)
  await waitForPropertyInstances(postItem)
  return { postItem }
}

export type CreateItemWithImageAndUploadedTxOptions = {
  postTitle?: string
  imageUri?: string
  imageAlt?: string
}

/**
 * Create an Image item and a Post with coverImage referencing it.
 * Use for tests that verify getPublishPayload with uploadedTransactions.
 */
export async function createItemWithImageAndUploadedTx(
  options: CreateItemWithImageAndUploadedTxOptions = {}
): Promise<{ postItem: ItemClass<any>; imageItem: ItemClass<any> }> {
  const {
    postTitle = 'Post with image',
    imageUri = 'https://example.com/img.png',
    imageAlt = 'Alt',
  } = options
  const imageItem = await Item.create({
    modelName: 'Image',
    uri: imageUri,
    alt: imageAlt,
  })
  await waitForItemIdle(imageItem)
  await waitForPropertyInstances(imageItem)
  const author = await createPublishedTestAuthor()
  const postItem = await Item.create({
    modelName: 'Post',
    author: author.seedLocalId,
    title: postTitle,
    coverImage: imageItem.seedLocalId,
  })
  await waitForItemIdle(postItem)
  await waitForPropertyInstances(postItem)
  return { postItem, imageItem }
}

/**
 * Create an Image item, then delete its storageTransactionId metadata row.
 * Returns the image item's seedLocalId so tests can reload it and verify
 * the placeholder property fix (loadOrCreateItem creates ItemProperty for
 * model schema properties without metadata).
 */
export async function createImageItemWithMissingStorageTxMetadata(): Promise<{
  imageSeedLocalId: string
}> {
  const imageItem = await Item.create({
    modelName: 'Image',
    uri: 'https://example.com/img.png',
    alt: 'Test alt',
  })
  await waitForItemIdle(imageItem)
  await waitForPropertyInstances(imageItem)

  const db = BaseDb.getAppDb()
  if (!db) {
    throw new Error('Database not available')
  }
  await db
    .delete(metadata)
    .where(
      and(
        eq(metadata.propertyName, 'storageTransactionId'),
        eq(metadata.seedLocalId, imageItem.seedLocalId)
      )
    )

  return { imageSeedLocalId: imageItem.seedLocalId }
}

export type CreateItemWithAllPropertyTypesOptions = {
  authorName?: string
  tagLabels?: string[]
  postTitle?: string
  basicOverrides?: Partial<CreateItemWithBasicPropertiesOnlyOptions>
}

/**
 * Create Author, Tags, and Post with all property types set (basic + relation + list + image).
 */
export async function createItemWithAllPropertyTypes(
  options: CreateItemWithAllPropertyTypesOptions = {}
): Promise<{
  authorItem: ItemClass<any>
  tagItems: ItemClass<any>[]
  postItem: ItemClass<any>
}> {
  const {
    authorName = 'Full Author',
    tagLabels = ['a', 'b'],
    postTitle = 'Full post',
    basicOverrides = {},
  } = options
  const authorItem = await Item.create({ modelName: 'Author', name: authorName, bio: 'Bio' })
  await waitForItemIdle(authorItem)
  await waitForPropertyInstances(authorItem)
  const tagItems: ItemClass<any>[] = []
  for (const label of tagLabels) {
    const tagItem = await Item.create({ modelName: 'Tag', label })
    await waitForItemIdle(tagItem)
    tagItems.push(tagItem)
  }
  const tagIds = tagItems.map((t) => t.seedLocalId)
  const item = await Item.create({
    modelName: 'Post',
    title: basicOverrides.title ?? postTitle,
    count: basicOverrides.count ?? 10,
    payload: basicOverrides.payload ?? '{}',
    isPublished: basicOverrides.isPublished ?? false,
    publishedOn: basicOverrides.publishedOn ?? new Date().toISOString(),
    ...(basicOverrides.bodyHtml ? { bodyHtml: basicOverrides.bodyHtml } : {}),
    author: authorItem.seedLocalId,
    tagIds: JSON.stringify(tagIds),
    coverImage: '',
  })
  await waitForItemIdle(item)
  await waitForPropertyInstances(item)
  return { authorItem, tagItems, postItem: item }
}

export type CreatePublishedItemForUnpublishOptions = {
  title?: string
  /** Publisher address - must be in client config addresses for assertItemOwned to pass */
  publisher?: string
}

/** Default publisher for unpublish tests. Include in client config addresses. */
export const UNPUBLISH_TEST_PUBLISHER = '0x' + 'd'.repeat(40)

/** Default seed UID for simulating published state. */
export const UNPUBLISH_TEST_SEED_UID = '0x' + 'e'.repeat(64)

/**
 * Create a Post item in "published" state (seedUid, publisher, schemaUid set).
 * Use for unpublish integration tests. Client config must include publisher in addresses.
 */
export async function createPublishedItemForUnpublish(
  options: CreatePublishedItemForUnpublishOptions = {}
): Promise<{
  item: ItemClass<any>
  seedLocalId: string
  seedUid: string
  publisher: string
}> {
  const { title = 'Unpublish test post', publisher = UNPUBLISH_TEST_PUBLISHER } = options
  const { item } = await createItemWithBasicPropertiesOnly({ title })
  const seedLocalId = item.seedLocalId!
  const seedUid = UNPUBLISH_TEST_SEED_UID

  const db = BaseDb.getAppDb()
  if (!db) throw new Error('Database not available')

  // Get schema UID for Post model from modelUids
  const postModelRows = await db
    .select({ uid: modelUids.uid })
    .from(modelsTable)
    .innerJoin(modelUids, eq(modelsTable.id, modelUids.modelId))
    .where(eq(modelsTable.name, 'Post'))
    .limit(1)
  const schemaUid = postModelRows[0]?.uid ?? testModelPlaceholderUid(2)

  // Update seeds row with published state
  await db
    .update(seeds)
    .set({
      uid: seedUid,
      publisher,
      schemaUid,
      updatedAt: Date.now(),
    })
    .where(eq(seeds.localId, seedLocalId))

  // Update item context so unpublish can read seedUid and schemaUid
  item.getService().send({ type: 'updateContext', seedUid, schemaUid })

  return { item, seedLocalId, seedUid, publisher }
}
