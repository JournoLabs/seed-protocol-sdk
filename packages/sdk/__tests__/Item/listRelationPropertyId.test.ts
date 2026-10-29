// Defect 1.9 (SDK audit V9): List-of-Relation rows written by Item.create, and rows an edit adds
// over a published row, had no property_id. Every metadata writer sets it now (decision D4).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { Model } from '@/Model/Model'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { properties } from '@/seedSchema'
import { waitForEntityReady } from '@/helpers/entity/entityLifecycle'
import { updateItemPropertyValue } from '@/db/write/updateItemPropertyValue'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'
import { waitUntilOrThrow } from '../test-utils/waitUntil'

const SCHEMA_NAME = 'List relation property id'

function schema(): SchemaFileFormat {
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    models: {
      Identity: { id: generateId(), properties: { displayName: { id: generateId(), type: 'Text' } } },
      Publication: {
        id: generateId(),
        properties: {
          name: { id: generateId(), type: 'Text' },
          admins: { id: generateId(), type: 'List', refValueType: 'Relation', ref: 'Identity' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

describe.sequential('List-of-Relation property_id', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const s = schema()
    await importJsonSchema({ contents: JSON.stringify(s) }, s.version)
    for (const name of ['Identity', 'Publication']) {
      await waitForEntityReady(Model.create(name, SCHEMA_NAME, { waitForReady: false }), { timeout: WAIT_TIMEOUT_MS })
    }
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('Item.create and an edit over a published row link the list row to its property', async () => {
    const identity = await Item.create({ modelName: 'Identity', schemaName: SCHEMA_NAME, displayName: 'Someone' } as any)
    await waitForEntityReady(identity, { timeout: WAIT_TIMEOUT_MS })

    const pub = await Item.create({
      modelName: 'Publication',
      schemaName: SCHEMA_NAME,
      name: 'Pub',
      admins: [identity.seedLocalId],
    } as any)
    await waitForEntityReady(pub, { timeout: WAIT_TIMEOUT_MS })

    const db = BaseDb.getAppDb()!
    const rowsFor = async () =>
      db
        .select({ localId: metadata.localId, propertyName: metadata.propertyName, propertyId: metadata.propertyId })
        .from(metadata)
        .where(eq(metadata.seedLocalId, pub.seedLocalId!))
    await waitUntilOrThrow(
      async () => (await rowsFor()).some((r: any) => r.propertyName === 'adminIdentityIds'),
      'the adminIdentityIds row to be written',
      WAIT_TIMEOUT_MS,
    )
    const propertyIds = new Map(
      (await db.select({ id: properties.id, name: properties.name }).from(properties)).map((p: any) => [p.name, p.id]),
    )
    const listRow = (await rowsFor()).find((r: any) => r.propertyName === 'adminIdentityIds')!
    expect(listRow.propertyId).toBe(propertyIds.get('admins'))

    // A published row: an edit of it adds a draft row, which takes the property's id and storage name
    await db.update(metadata).set({ uid: '0x' + 'ab'.repeat(32) }).where(eq(metadata.localId, listRow.localId!))
    const result = await updateItemPropertyValue({
      propertyName: 'admins',
      seedLocalId: pub.seedLocalId,
      modelName: 'Publication',
      newValue: JSON.stringify([]),
    })
    expect(result?.localId).not.toBe(listRow.localId)
    const [draft] = await db
      .select({ propertyName: metadata.propertyName, propertyId: metadata.propertyId })
      .from(metadata)
      .where(and(eq(metadata.localId, result!.localId)))
    expect(draft).toEqual({ propertyName: 'adminIdentityIds', propertyId: propertyIds.get('admins') })
    pub.unload?.()
    identity.unload?.()
  }, 60000)
})
