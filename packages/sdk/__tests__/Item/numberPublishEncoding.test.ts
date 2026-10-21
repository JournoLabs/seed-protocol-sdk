import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { SchemaEncoder } from '@ethereum-attestation-service/eas-sdk'
import { Item } from '@/Item/Item'
import { Model } from '@/Model/Model'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'
import { createNewItem } from '@/db/write/createNewItem'
import { metadata } from '@/seedSchema/MetadataSchema'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { PublishValidationFailedError } from '@/db/read/getPublishPayload'
import { getEasSchemaUidForSchemaDefinition } from '@seedprotocol/eas'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  waitForPropertyInstances,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

// ADR 0010: Number publishes as `string <name>`, so values a uint8 couldn't hold publish.
const SCHEMA_NAME = 'Test Schema number publish encoding'

const schema = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    NumberArticle: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        wordCount: { id: generateId(), type: 'Number' },
      },
    },
  },
  enums: {},
  migrations: [],
} as SchemaFileFormat

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

testDescribe('Number publish encoding (ADR 0010)', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['NumberArticle'], SCHEMA_NAME)
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema)
    await waitForEntityIdle(Model.create('NumberArticle', SCHEMA_NAME, { waitForReady: false }), {
      timeout: WAIT_TIMEOUT_MS,
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const loadArticle = async (seedLocalId: string) => {
    const item = (await Item.find({ seedLocalId, modelName: 'NumberArticle' }))!
    await waitForEntityIdle(item, { timeout: WAIT_TIMEOUT_MS })
    await waitForPropertyInstances(item)
    return item
  }

  const wordCountAttestation = async (item: Item<any>) => {
    const payload: any[] = await item.getPublishPayload([])
    const atts = payload.flatMap((p) => p.listOfAttestations ?? [])
    const att = atts.find((a: any) => a._propertyName === 'wordCount')
    if (att) expect(att.schema).toBe(await getEasSchemaUidForSchemaDefinition({ schemaText: 'string word_count' }))
    return att
  }

  it.each([
    [256, '256'],
    [-1, '-1'],
    [1.5, '1.5'],
    [0, '0'],
    [1e21, '1e+21'],
  ])('%s attests under string word_count as %s', async (input, expected) => {
    const created = await Item.create({ modelName: 'NumberArticle', title: 't', wordCount: input } as any)
    await waitForEntityIdle(created, { timeout: WAIT_TIMEOUT_MS })
    const item = await loadArticle(created.seedLocalId!)

    const att = await wordCountAttestation(item)
    expect(att).toBeDefined()
    const [field] = new SchemaEncoder('string word_count').decodeData(att.data[0].data)
    expect(field!.value.value).toBe(expected)
  }, 60000)

  it('a stored value that is not a number fails with publish_invalid_number', async () => {
    const { seedLocalId } = await createNewItem({ modelName: 'NumberArticle', title: 't', wordCount: 3 } as any)
    // As a row synced from a foreign `string word_count` attestation before ADR 0010 could hold.
    await BaseDb.getAppDb()!
      .update(metadata)
      .set({ propertyValue: 'many' })
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'wordCount')))
    const fresh = await loadArticle(seedLocalId)
    expect(fresh.wordCount).toBe('many')

    const error = await fresh.getPublishPayload([]).then(
      () => undefined,
      (e) => e,
    )
    expect(error).toBeInstanceOf(PublishValidationFailedError)
    expect(error.validationErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'wordCount', code: 'publish_invalid_number' })]),
    )
  }, 60000)
})
