import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { Model } from '@/Model/Model'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { createNewItem } from '@/db/write/createNewItem'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { waitForEntityIdle } from '@/helpers/waitForEntityIdle'
import { getEasSchemaUidForSchemaDefinition, setSchemaUidForSchemaDefinition } from '@/stores/eas'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  waitForPropertyInstances,
} from '../test-utils/getPublishPayloadIntegrationHelpers'

// PermaPress: Publication admins/staff (List of Relation → Identity) attested as `bytes32[] staff`
// or `bytes32[] staff_identity_ids` depending on load order. Publish must always use the storage name.
const SCHEMA_NAME = 'Test Schema list relation publish name'

const DECOY_STAFF_UID = '0x' + 'aa'.repeat(32)
const DECOY_ADMINS_UID = '0x' + 'bb'.repeat(32)

function publicationSchema(): SchemaFileFormat {
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
      Identity: {
        id: generateId(),
        properties: { displayName: { id: generateId(), type: 'Text' } },
      },
      Publication: {
        id: generateId(),
        properties: {
          name: { id: generateId(), type: 'Text' },
          admins: { id: generateId(), type: 'List', refValueType: 'Relation', ref: 'Identity' },
          staff: { id: generateId(), type: 'List', refValueType: 'Relation', ref: 'Identity' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

const testDescribe =
  typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

testDescribe('List-of-relation EAS name', () => {
  let staffUid: string
  let adminsUid: string

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = publicationSchema()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['Identity', 'Publication'])
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema)
    // Stray schema-key schemas, like the ones the twin picked up.
    setSchemaUidForSchemaDefinition({ text: 'bytes32[] staff', schemaUid: DECOY_STAFF_UID })
    setSchemaUidForSchemaDefinition({ text: 'bytes32[] admins', schemaUid: DECOY_ADMINS_UID })
    staffUid = (await getEasSchemaUidForSchemaDefinition({ schemaText: 'bytes32[] staff_identity_ids' }))!
    adminsUid = (await getEasSchemaUidForSchemaDefinition({ schemaText: 'bytes32[] admin_identity_ids' }))!
    for (const name of ['Identity', 'Publication']) {
      await waitForEntityIdle(Model.create(name, SCHEMA_NAME, { waitForReady: false }), { timeout: 10_000 })
    }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  const createIdentity = async () => {
    const identity = await Item.create({ modelName: 'Identity', displayName: 'Someone' } as any)
    await waitForEntityIdle(identity, { timeout: 10_000 })
    return identity.seedLocalId!
  }

  const loadPublication = async (seedLocalId: string) => {
    const item = (await Item.find({ seedLocalId, modelName: 'Publication' }))!
    await waitForEntityIdle(item, { timeout: 10_000 })
    await waitForPropertyInstances(item)
    return item
  }

  const schemaUidsIn = (payload: any[]) => {
    const uids = new Set<string>()
    for (const p of payload) {
      for (const a of p.listOfAttestations ?? []) uids.add(String(a.schema).toLowerCase())
      for (const u of p.propertiesToUpdate ?? []) uids.add(String(u.propertySchemaUid).toLowerCase())
    }
    return uids
  }

  const metadataNames = async (seedLocalId: string) => {
    const rows = await BaseDb.getAppDb()!
      .select({ propertyName: metadata.propertyName })
      .from(metadata)
      .where(eq(metadata.seedLocalId, seedLocalId))
    return rows.map((r: { propertyName: string | null }) => r.propertyName)
  }

  it('createNewItem writes list relations under the storage name and publishes them as *_identity_ids', async () => {
    const admin = await createIdentity()
    const member = await createIdentity()
    const { seedLocalId } = await createNewItem({
      modelName: 'Publication',
      name: 'Pub',
      admins: JSON.stringify([admin]),
      staff: JSON.stringify([member]),
    } as any)

    const names = await metadataNames(seedLocalId)
    expect(names).toContain('adminIdentityIds')
    expect(names).toContain('staffIdentityIds')
    expect(names).not.toContain('admins')
    expect(names).not.toContain('staff')

    const item = await loadPublication(seedLocalId)
    expect(Object.keys(item.allProperties)).toEqual(expect.arrayContaining(['admins', 'staff']))

    const uids = schemaUidsIn(await item.getPublishPayload([]))
    expect(uids).toContain(staffUid.toLowerCase())
    expect(uids).toContain(adminsUid.toLowerCase())
    expect(uids).not.toContain(DECOY_STAFF_UID)
    expect(uids).not.toContain(DECOY_ADMINS_UID)
  }, 60000)

  it('a legacy row under the schema key with a cached bytes32[] staff schemaUid still publishes as staff_identity_ids', async () => {
    const member = await createIdentity()
    const { seedLocalId, versionLocalId } = await createNewItem({ modelName: 'Publication', name: 'Legacy' } as any)
    const db = BaseDb.getAppDb()!
    await db
      .delete(metadata)
      .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'staffIdentityIds')))
    await db.insert(metadata).values({
      localId: generateId(),
      propertyName: 'staff',
      propertyValue: JSON.stringify([member]),
      schemaUid: DECOY_STAFF_UID,
      modelType: 'publication',
      seedLocalId,
      versionLocalId,
      createdAt: Date.now(),
    })

    const item = await loadPublication(seedLocalId)
    // Hydration doesn't always carry the row's schemaUid onto the instance; make sure it does here.
    const staff = item.allProperties['staff']!
    staff.getService().send({ type: 'updateContext', schemaUid: DECOY_STAFF_UID } as any)
    expect(staff.schemaUid).toBe(DECOY_STAFF_UID)

    const uids = schemaUidsIn(await item.getPublishPayload([]))
    expect(uids).toContain(staffUid.toLowerCase())
    expect(uids).not.toContain(DECOY_STAFF_UID)
  }, 60000)

  it('an ItemProperty built before its schema moves to the storage name and keeps the schema key public', async () => {
    const property = new ItemProperty({
      modelName: 'Publication',
      propertyName: 'staff',
      seedLocalId: generateId(),
    } as any)
    expect(property.storagePropertyName).toBe('staff')

    property.getService().send({
      type: 'updateContext',
      propertyRecordSchema: { dataType: 'List', refValueType: 'Relation', ref: 'Identity' },
    } as any)

    expect(property.storagePropertyName).toBe('staffIdentityIds')
    expect(property.propertyName).toBe('staff')
    property.unload()
  })
})
