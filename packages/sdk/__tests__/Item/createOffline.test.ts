/**
 * Offline: every EAS request fails as `fetch` does without a network. Creating an item and saving
 * an image to it must still work (docs-writer batch 4): the model's schema UID comes from the
 * local DB, or is left unset for publish to look up.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { BaseEasClient, resetSchemaUidCaches } from '@seedprotocol/eas'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle, type HasService } from '../test-utils/waitForIdle'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('creating items offline', () => {
  const schemaName = 'Test Schema Offline Create'
  const testSchema: SchemaFileFormat = {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: 'test-schema-offline-create',
    metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    models: {
      Memo: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          photo: { id: generateId(), type: 'Image' },
        },
      },
    },
    enums: {},
    migrations: [],
  }

  let restoreEasClient: (() => void) | undefined

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
    const model = Model.create('Memo', schemaName, { waitForReady: false })
    await model.waitForReady({ timeout: WAIT_TIMEOUT_MS })

    const online = BaseEasClient.getEasClient()
    BaseEasClient.configure({
      getEasClient: () =>
        ({
          request: async () => {
            throw new TypeError('fetch failed')
          },
        }) as never,
    })
    restoreEasClient = () => BaseEasClient.configure({ getEasClient: () => online })
    resetSchemaUidCaches()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    restoreEasClient?.()
    resetSchemaUidCaches()
    await teardownTestEnvironment()
  })

  it('creates an item and saves an image to it', async () => {
    const item = await Item.create({ modelName: 'Memo', schemaName, title: 'Written on a plane' })
    await waitForIdle(item as unknown as HasService, 'Item', 10_000)
    expect(item.seedLocalId).toBeTruthy()

    const photo = item.properties.find(
      (p) => p.propertyName === 'photo' || p.propertyName === 'photoId',
    ) as ItemProperty<any>
    photo.value = new File([new Uint8Array([1, 2, 3])], 'cloud.png', { type: 'image/png' })
    const settled = await waitFor(
      photo.getService(),
      (s) => s.value === 'idle' && !s.context.isSaving && s.context.refSeedType === 'image',
      { timeout: WAIT_TIMEOUT_MS },
    )
    expect(settled.context._saveError ?? null).toBeNull()
    expect(settled.context.refResolvedValue).toMatch(/cloud\.png$/)
  })
})
