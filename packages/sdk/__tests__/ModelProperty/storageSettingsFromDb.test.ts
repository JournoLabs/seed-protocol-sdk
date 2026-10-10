import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../test-utils/client-init'

/**
 * A property's storage settings (schema file `storage: { type, path, extension }`) are stored with
 * its `properties` row, so a ModelProperty loaded from the DB has them no matter how the schema
 * was loaded before.
 */
const SCHEMA_NAME = 'storage-settings-from-db-test'
/** Unique: browser test files in one worker share a DB. */
const MODEL_NAME = 'Storsetpage'

describe.sequential('ModelProperty storage settings from the DB', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
    const { importJsonSchema } = await import('@/imports/json')
    await importJsonSchema({
      contents: JSON.stringify({
        name: SCHEMA_NAME,
        models: {
          [MODEL_NAME]: {
            properties: {
              title: { type: 'Text' },
              html: {
                type: 'Text',
                storage: { type: 'ItemStorage', path: '/html', extension: '.html' },
              },
            },
          },
        },
      }),
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const propertyRow = async (name: string) => {
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { properties, models } = await import('@/seedSchema')
    const [row] = await BaseDb.getAppDb()
      .select({
        schemaFileId: properties.schemaFileId,
        isEdited: properties.isEdited,
        storageType: properties.storageType,
        localStorageDir: properties.localStorageDir,
        filenameSuffix: properties.filenameSuffix,
      })
      .from(properties)
      .innerJoin(models, eq(models.id, properties.modelId))
      .where(and(eq(models.name, MODEL_NAME), eq(properties.name, name)))
    return row
  }

  it('stores them with the property row', async () => {
    expect(await propertyRow('html')).toMatchObject({
      storageType: 'ItemStorage',
      localStorageDir: '/html',
      filenameSuffix: '.html',
    })
    expect(await propertyRow('title')).toMatchObject({
      storageType: null,
      localStorageDir: null,
      filenameSuffix: null,
    })
  })

  it('loads them when the property instance is created from its row', async () => {
    const { ModelProperty } = await import('@/ModelProperty/ModelProperty')
    const { Model } = await import('@/Model/Model')
    const html = await propertyRow('html')

    // Drop every cached instance, so nothing can come from the schema file or an earlier load.
    Model.getByName(MODEL_NAME, SCHEMA_NAME)?.unload()
    ModelProperty.evictForModels([MODEL_NAME])
    expect(ModelProperty.getById(html!.schemaFileId!)).toBeUndefined()

    const reloaded = await ModelProperty.createById(html!.schemaFileId!)
    expect(reloaded).toBeDefined()
    expect({
      storageType: reloaded!.storageType,
      localStorageDir: reloaded!.localStorageDir,
      filenameSuffix: reloaded!.filenameSuffix,
    }).toEqual({ storageType: 'ItemStorage', localStorageDir: '/html', filenameSuffix: '.html' })
  })

  it('keeps them, unedited, when the same schema is imported again', async () => {
    const { importJsonSchema } = await import('@/imports/json')
    await importJsonSchema({
      contents: JSON.stringify({
        name: SCHEMA_NAME,
        models: {
          [MODEL_NAME]: {
            properties: {
              title: { type: 'Text' },
              html: {
                type: 'Text',
                storage: { type: 'ItemStorage', path: '/html', extension: '.html' },
              },
            },
          },
        },
      }),
    })
    await vi.waitFor(async () => {
      expect(await propertyRow('html')).toMatchObject({
        isEdited: false,
        storageType: 'ItemStorage',
        localStorageDir: '/html',
        filenameSuffix: '.html',
      })
    })
  })
})
