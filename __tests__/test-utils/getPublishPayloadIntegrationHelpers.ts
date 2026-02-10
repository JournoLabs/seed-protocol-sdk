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
import { eq } from 'drizzle-orm'
import { models as modelsTable, modelUids } from '@/seedSchema'

const SCHEMA_NAME = 'Test Schema getPublishPayload'

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
          author: { id: generateId(), type: 'Relation', model: 'Author' },
          coverImage: { id: generateId(), type: 'Image' },
          tagIds: { id: generateId(), type: 'List', items: { type: 'Relation', model: 'Tag' } },
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

async function ensureModelUidsForGetPublishPayloadTest(): Promise<void> {
  const db = BaseDb.getAppDb()
  if (!db) return
  const modelNames = ['Author', 'Tag', 'Post', 'Image']
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
 * Import the comprehensive schema and create all models. Call once in beforeAll.
 */
export async function createGetPublishPayloadTestSchema(): Promise<GetPublishPayloadTestSchemaResult> {
  const schema = getGetPublishPayloadTestSchema()
  await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  await ensureModelUidsForGetPublishPayloadTest()
  const authorModel = Model.create('Author', SCHEMA_NAME, { waitForReady: false })
  const tagModel = Model.create('Tag', SCHEMA_NAME, { waitForReady: false })
  const postModel = Model.create('Post', SCHEMA_NAME, { waitForReady: false })
  await waitForModelIdle(authorModel)
  await waitForModelIdle(tagModel)
  await waitForModelIdle(postModel)
  return {
    schemaName: SCHEMA_NAME,
    models: { Author: authorModel, Tag: tagModel, Post: postModel },
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
 * Create a Post item with only basic properties set (no relation, list, image).
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
    bodyHtml = '<p>Hello</p>',
    attachment = '',
  } = options
  const item = await Item.create({
    modelName: 'Post',
    title,
    count,
    payload,
    isPublished,
    publishedOn,
    bodyHtml,
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
  const postItem = await Item.create({
    modelName: 'Post',
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
  const postItem = await Item.create({
    modelName: 'Post',
    title: postTitle,
    coverImage: '', // Empty or placeholder; getPublishPayload may skip or handle
  })
  await waitForItemIdle(postItem)
  await waitForPropertyInstances(postItem)
  return { postItem }
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
    bodyHtml: basicOverrides.bodyHtml ?? '<p>x</p>',
    author: authorItem.seedLocalId,
    tagIds: JSON.stringify(tagIds),
    coverImage: '',
  })
  await waitForItemIdle(item)
  await waitForPropertyInstances(item)
  return { authorItem, tagItems, postItem: item }
}
