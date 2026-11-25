import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { Property } from '@/helpers/property'
import { generateId } from '@/helpers'
import { getPublishUploadData } from '@/db/read/getPublishUploads'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { ensureModelUidsForGetPublishPayloadTest, waitForPropertyInstances } from '../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../test-utils/waitForIdle'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

/**
 * `private: true` on a model defined in code (ADR 0033). It used to be dropped when the model
 * created its properties, so the value published in the clear.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential
const SCHEMA_NAME = 'Test Schema Code Defined Private'

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << >> endobj\n')

const setFile = async (item: Item<any>, propertyName: string, file: File) => {
  const prop = item.allProperties[propertyName]!
  prop.value = file
  await prop.save()
  await vi.waitFor(() => {
    const ctx = (prop.getService().getSnapshot() as any).context
    expect(typeof ctx.propertyValue).toBe('string')
    expect(ctx.refResolvedValue).toBeTruthy()
  }, { timeout: WAIT_TIMEOUT_MS })
}

testDescribe('private on a code-defined model', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await Schema.create(SCHEMA_NAME)
    await Model.create('SealedDoc', SCHEMA_NAME, {
      properties: {
        title: Property.Text(),
        secret: Property.File({ private: true }),
        spread: { ...Property.File(), private: true },
        open: Property.File(),
      },
    })
    await ensureModelUidsForGetPublishPayloadTest(['SealedDoc', 'File'], SCHEMA_NAME)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('the builders that upload take a private option', () => {
    expect(Property.Image({ private: true })).toEqual({ dataType: 'Image', private: true })
    expect(Property.File({ private: true })).toEqual({ dataType: 'File', private: true })
    expect(Property.Json({ private: true })).toEqual({ dataType: 'Json', private: true })
    expect(Property.Html({ private: true })).toEqual({ dataType: 'Html', private: true })
    expect(Property.Image()).toEqual({ dataType: 'Image' })
  })

  it('a private upload, from the builder or spread, refuses to publish without an encryptor', async () => {
    const item = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'SealedDoc', title: 'sealed' } as any)
    await waitForIdle(item, 'Item', 15000)
    await waitForPropertyInstances(item)

    await setFile(item, 'open', new File([PDF], `open-${generateId()}.pdf`))
    expect((await getPublishUploadData(item as any)).map((u) => u.itemPropertyName)).toEqual(['open'])

    for (const name of ['secret', 'spread']) {
      await setFile(item, name, new File([PDF], `${name}-${generateId()}.pdf`))
      await expect(getPublishUploadData(item as any)).rejects.toMatchObject({
        name: 'PrivateUploadNotEncryptedError',
        itemPropertyName: name,
      })
      item.allProperties[name]!.value = null
      await item.allProperties[name]!.save()
    }
  }, 90000)

  it.each([
    ['a Text', { dataType: 'Text', private: true }],
    ['a Number', { dataType: 'Number', private: true }],
    ['a Relation', { dataType: 'Relation', ref: 'SealedDoc', private: true }],
    ['a List', { dataType: 'List', refValueType: 'Text', private: true }],
  ])('refuses private on %s property when the model is defined', async (_label, definition) => {
    await expect(
      Model.create(`Refused${generateId().slice(0, 6)}`, SCHEMA_NAME, { properties: { secret: definition } }),
    ).rejects.toThrow(/secret: only Html, Json, File, Image and ItemStorage Text properties can be private/)
  })

  it('accepts private on ItemStorage Text', async () => {
    const model = await Model.create(`Stored${generateId().slice(0, 6)}`, SCHEMA_NAME, {
      properties: { body: { ...Property.Text('ItemStorage', '/stored', '.md'), private: true } },
    })
    expect(model.modelName).toBeTruthy()
  })
})
