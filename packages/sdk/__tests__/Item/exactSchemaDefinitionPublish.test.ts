import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { Model } from '@/Model/Model'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { getEasSchemaUidForSchemaDefinition } from '@/stores/eas'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  waitForPropertyInstances,
} from '../test-utils/getPublishPayloadIntegrationHelpers'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

// Optimism Sepolia has `bytes32 storage_transaction_id` beside `string storage_transaction_id`.
// ItemProperty looks schemas up by name alone, so a property can carry the bytes32 one; publish
// then attested the string tx id under it, and EAS sync read the id back as 0x…20.
const SCHEMA_NAME = 'Test Schema exact schema definition publish'

const schema = {
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    ExactDefArticle: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        dek: { id: generateId(), type: 'Text' },
      },
    },
  },
  enums: {},
  migrations: [],
} as SchemaFileFormat

// A schema with the same name and another type, as a by-name lookup finds first.
const BYTES32_DEK_UID = '0x' + 'cd'.repeat(32)

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

testDescribe('publish uses the schema for the exact definition', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['ExactDefArticle'], SCHEMA_NAME)
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema)
    await waitForEntityIdle(Model.create('ExactDefArticle', SCHEMA_NAME, { waitForReady: false }), {
      timeout: WAIT_TIMEOUT_MS,
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('attests under `string dek`, not the schema the property found by name', async () => {
    const created = await Item.create({ modelName: 'ExactDefArticle', title: 't', dek: 'standfirst' } as any)
    await waitForEntityIdle(created, { timeout: WAIT_TIMEOUT_MS })
    const item = (await Item.find({ seedLocalId: created.seedLocalId!, modelName: 'ExactDefArticle' }))!
    await waitForEntityIdle(item, { timeout: WAIT_TIMEOUT_MS })
    await waitForPropertyInstances(item)
    const dek = item.properties.find((p) => p.propertyName === 'dek')!
    dek.getService().send({ type: 'updateContext', schemaUid: BYTES32_DEK_UID })
    expect(dek.schemaUid).toBe(BYTES32_DEK_UID)

    const payload: any[] = await item.getPublishPayload([])
    const att = payload.flatMap((p) => p.listOfAttestations ?? []).find((a: any) => a._propertyName === 'dek')
    expect(att).toBeDefined()
    const stringDekUid = await getEasSchemaUidForSchemaDefinition({ schemaText: 'string dek' })
    expect(stringDekUid).toMatch(/^0x[0-9a-f]{64}$/)
    expect(att.schema).toBe(stringDekUid)
  }, 60000)
})
