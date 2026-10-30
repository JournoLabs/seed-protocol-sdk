import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { generateId } from '@/helpers'
import { importJsonSchema } from '@/imports/json'
import { updateModelProperties } from '@/helpers/updateSchema'
import { waitForEntityReady } from '@/helpers/entity/entityLifecycle'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForPropertyInstances } from '../test-utils/getPublishPayloadIntegrationHelpers'
import { embeddedImageBytes, embeddedImageDataUri } from '../test-utils/embeddedImage'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

/**
 * A `data:image/...` URI assigned to a Relation→Image property is stored as an Image seed with its
 * file. With no `refValueType` on the property's row the setter wrote it as a plain Relation value,
 * and the outbox failed the op with "Relation target not found".
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema relationImageSave'

const schemaFile = () => ({
  $schema: 'https://seedprotocol.io/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    PhotoPost: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        photo: { id: generateId(), type: 'Relation', refValueType: 'Image', model: 'Image' },
        banner: { id: generateId(), type: 'Relation', model: 'Image' },
        cover: { id: generateId(), type: 'Relation', model: 'Image' },
      },
    },
  },
  enums: {},
  migrations: [],
})

const createPost = async () => {
  const item = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'PhotoPost', title: 'photo' } as any)
  await waitForEntityReady(item, { timeout: WAIT_TIMEOUT_MS })
  await waitForPropertyInstances(item)
  return item
}

const expectSavedImage = async (seedLocalId: string, propertyName: string) => {
  const [row] = await BaseDb.getAppDb()!
    .select()
    .from(metadata)
    .where(
      and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, propertyName), eq(metadata.refSeedType, 'image')),
    )
  expect(row?.refResolvedValue).toBeTruthy()
  const file = await BaseFileManager.readFile(BaseFileManager.getFilesPath('images', row.refResolvedValue!))
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(embeddedImageBytes())
}

testDescribe('a data URI assigned to a Relation→Image', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it("is saved as an Image for a schema file's Relation with refValueType Image", async () => {
    const post = await createPost()
    const photo = post.allProperties['photo']!
    photo.value = embeddedImageDataUri()
    await photo.save()
    await expectSavedImage(post.seedLocalId!, 'photoId')
  }, 30000)

  it('is saved as an Image once a Relation is redefined as a Relation→Image', async () => {
    await updateModelProperties(SCHEMA_NAME, [
      { modelName: 'PhotoPost', propertyName: 'banner', updates: { refValueType: 'Image' } },
    ])
    const post = await createPost()
    const banner = post.allProperties['banner']!
    banner.value = embeddedImageDataUri()
    await banner.save()
    await expectSavedImage(post.seedLocalId!, 'bannerId')
  }, 30000)

  it('is saved as an Image by an item loaded before the Relation was redefined', async () => {
    const post = await createPost()
    await updateModelProperties(SCHEMA_NAME, [
      { modelName: 'PhotoPost', propertyName: 'cover', updates: { refValueType: 'Image' } },
    ])
    const cover = post.allProperties['cover']!
    cover.value = embeddedImageDataUri()
    await cover.save()
    await expectSavedImage(post.seedLocalId!, 'coverId')
  }, 30000)
})
