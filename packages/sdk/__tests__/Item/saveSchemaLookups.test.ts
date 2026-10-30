/**
 * Saving a property looks its EAS schema up through the same cache createNewItem fills, so saves
 * after a create don't wait on the indexer (PermaPress measured ~3 s per save when each one asked
 * it). The stub indexer finds a schema only for `string title`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
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

const TITLE_SCHEMA_UID = '0x' + 'c'.repeat(64)

testDescribe('EAS schema lookups when saving', () => {
  const schemaName = 'Test Schema Save Lookups'
  const testSchema: SchemaFileFormat = {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: 'test-schema-save-lookups',
    metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    models: {
      Clip: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          width: { id: generateId(), type: 'Number' },
          savedAt: { id: generateId(), type: 'Date' },
          photo: { id: generateId(), type: 'Image' },
        },
      },
    },
    enums: {},
    migrations: [],
  }

  /** Variables of every request the stub indexer received. */
  const requests: unknown[] = []
  let restoreEasClient: (() => void) | undefined

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
    const model = Model.create('Clip', schemaName, { waitForReady: false })
    await model.waitForReady({ timeout: WAIT_TIMEOUT_MS })

    const online = BaseEasClient.getEasClient()
    BaseEasClient.configure({
      getEasClient: () =>
        ({
          request: async (_document: unknown, variables: unknown) => {
            requests.push(variables)
            return JSON.stringify(variables).includes('"string title"')
              ? { schemas: [{ id: TITLE_SCHEMA_UID }] }
              : { schemas: [] }
          },
        }) as never,
    })
    restoreEasClient = () => BaseEasClient.configure({ getEasClient: () => online })
  }, SETUP_HOOK_TIMEOUT_MS)

  beforeEach(() => {
    resetSchemaUidCaches()
    requests.length = 0
  })

  afterAll(async () => {
    restoreEasClient?.()
    resetSchemaUidCaches()
    await teardownTestEnvironment()
  })

  const propertyOf = (item: Item<any>, name: string) =>
    item.properties.find((p) => p.propertyName === name || p.propertyName === `${name}Id`) as ItemProperty<any>

  const save = async (property: ItemProperty<any>, value: unknown) => {
    property.value = value
    await property.save()
    const settled = await waitFor(property.getService(), (s) => s.value === 'idle' && !s.context.isSaving, {
      timeout: WAIT_TIMEOUT_MS,
    })
    expect(settled.context._saveError ?? null).toBeNull()
  }

  it('asks EAS once per property definition on create, and not again on save', async () => {
    const item = await Item.create({ modelName: 'Clip', schemaName })
    await waitForIdle(item as unknown as HasService, 'Item', 10_000)
    const afterCreate = requests.length
    expect(afterCreate).toBeGreaterThan(0)

    await save(propertyOf(item, 'width'), 640)
    await save(propertyOf(item, 'savedAt'), '2024-11-20')
    await save(propertyOf(item, 'width'), 800)
    await save(propertyOf(item, 'title'), 'A clip')

    expect(requests.slice(afterCreate)).toEqual([])
  })

  it('stores a schema UID that EAS has on the row at create', async () => {
    const item = await Item.create({ modelName: 'Clip', schemaName })
    await waitForIdle(item as unknown as HasService, 'Item', 10_000)
    expect(propertyOf(item, 'title').getService().getSnapshot().context.schemaUid).toBe(TITLE_SCHEMA_UID)
  })

  it('saves an image without asking EAS for the property schema again', async () => {
    const item = await Item.create({ modelName: 'Clip', schemaName })
    await waitForIdle(item as unknown as HasService, 'Item', 10_000)
    const afterCreate = requests.length

    const photo = propertyOf(item, 'photo')
    photo.value = new File([new Uint8Array([1, 2, 3])], 'clip.png', { type: 'image/png' })
    await waitFor(
      photo.getService(),
      (s) => s.value === 'idle' && !s.context.isSaving && s.context.refSeedType === 'image',
      { timeout: WAIT_TIMEOUT_MS },
    )

    const propertyLookups = requests
      .slice(afterCreate)
      .filter((variables) => JSON.stringify(variables).includes('bytes32 photo'))
    expect(propertyLookups).toEqual([])
  })
})
