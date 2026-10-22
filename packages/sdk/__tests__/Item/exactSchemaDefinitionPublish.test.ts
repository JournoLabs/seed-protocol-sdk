import { waitFor } from 'xstate'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item } from '@/Item/Item'
import { Model } from '@/Model/Model'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { waitForEntityReady } from '@/helpers/entity/entityLifecycle'
import { getEasSchemaUidForSchemaDefinition, setSchemaUidForSchemaDefinition } from '@seedprotocol/eas'
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
    ExactDefWriter: {
      id: generateId(),
      properties: { byline: { id: generateId(), type: 'Text' } },
    },
    ExactDefArticle: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        dek: { id: generateId(), type: 'Text' },
        kicker: { id: generateId(), type: 'Text' },
        writer: { id: generateId(), type: 'Relation', model: 'ExactDefWriter' },
      },
    },
  },
  enums: {},
  migrations: [],
} as SchemaFileFormat

// A schema with the same name and another type, as a by-name lookup finds first.
const BYTES32_DEK_UID = '0x' + 'cd'.repeat(32)
const BYTES32_KICKER_UID = '0x' + 'ce'.repeat(32)
const STRING_WRITER_UID = '0x' + 'cf'.repeat(32)

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

testDescribe('publish uses the schema for the exact definition', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['ExactDefWriter', 'ExactDefArticle'], SCHEMA_NAME)
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema)
    // What a by-name lookup of `kicker` returns when EAS has `bytes32 kicker` too.
    setSchemaUidForSchemaDefinition({ text: 'kicker', schemaUid: BYTES32_KICKER_UID })
    for (const name of ['ExactDefWriter', 'ExactDefArticle']) {
      await waitForEntityReady(Model.create(name, SCHEMA_NAME, { waitForReady: false }), { timeout: WAIT_TIMEOUT_MS })
    }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('attests under `string dek`, not the schema the property found by name', async () => {
    const created = await Item.create({ modelName: 'ExactDefArticle', title: 't', dek: 'standfirst' } as any)
    await waitForEntityReady(created, { timeout: WAIT_TIMEOUT_MS })
    const item = (await Item.find({ seedLocalId: created.seedLocalId!, modelName: 'ExactDefArticle' }))!
    await waitForEntityReady(item, { timeout: WAIT_TIMEOUT_MS })
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

  const loadArticle = async (values: Record<string, unknown>) => {
    const created = await Item.create({ modelName: 'ExactDefArticle', title: 't', ...values } as any)
    await waitForEntityReady(created, { timeout: WAIT_TIMEOUT_MS })
    const item = (await Item.find({ seedLocalId: created.seedLocalId!, modelName: 'ExactDefArticle' }))!
    await waitForEntityReady(item, { timeout: WAIT_TIMEOUT_MS })
    await waitForPropertyInstances(item)
    return item
  }

  it('a rehydrated property looks its schema up by `string kicker`, not by the name alone', async () => {
    const item = await loadArticle({ kicker: 'News' })
    const kicker = item.properties.find((p) => p.propertyName === 'kicker')!
    await waitForEntityReady(kicker, { timeout: WAIT_TIMEOUT_MS })
    expect(kicker.schemaUid).toBeUndefined()
    // EAS sync rehydrates properties after writing metadata; that runs the initialize actor.
    kicker.getService().send({ type: 'rehydrateFromDb' })
    // The rehydrate runs in the machine (hydratingFromDb, initializing) and ends back in idle
    await waitFor(kicker.getService(), (s) => s.value === 'idle', { timeout: WAIT_TIMEOUT_MS })
    const stringKickerUid = await getEasSchemaUidForSchemaDefinition({ schemaText: 'string kicker' })
    expect(stringKickerUid).toMatch(/^0x[0-9a-f]{64}$/)
    expect(kicker.schemaUid).toBe(stringKickerUid)
  }, 60000)

  it('links a related draft under `bytes32 writer`, not the schema the property found by name', async () => {
    const writer = await Item.create({ modelName: 'ExactDefWriter', byline: 'Someone' } as any)
    await waitForEntityReady(writer, { timeout: WAIT_TIMEOUT_MS })
    const item = await loadArticle({ writer: writer.seedLocalId })
    const writerProp = item.properties.find((p) => p.propertyName === 'writer' || p.propertyName === 'writerId')!
    writerProp.getService().send({ type: 'updateContext', schemaUid: STRING_WRITER_UID })
    expect(writerProp.schemaUid).toBe(STRING_WRITER_UID)

    const payload: any[] = await item.getPublishPayload([])
    const linked = payload.flatMap((p) => p.propertiesToUpdate ?? []).map((u: any) => u.propertySchemaUid)
    const bytes32WriterUid = await getEasSchemaUidForSchemaDefinition({ schemaText: 'bytes32 writer' })
    expect(bytes32WriterUid).toMatch(/^0x[0-9a-f]{64}$/)
    expect(linked).toContain(bytes32WriterUid)
    expect(linked).not.toContain(STRING_WRITER_UID)
  }, 60000)
})
