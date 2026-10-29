/**
 * SDK audit T9: definition rows through db/write/definitions.ts, and chain-uid writers on the
 * unique indexes of migration 0029.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, models, properties, schemas, seeds, versions } from '@/seedSchema'
import { modelSchemas } from '@/seedSchema/ModelSchemaSchema'
import { Model } from '@/Model/Model'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { savePropertyToDb, writePropertyToDb } from '@/helpers/db'
import { inDefinitionsTransaction, linkModelToSchemaRow, upsertPropertyRow } from '@/db/write/definitions'
import { createSeeds } from '@/db/write/createSeeds'
import { updateSeedUid } from '@/db/write/updateSeedUid'
import { updateVersionUid } from '@/db/write/updateVersionUid'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

const testDescribe = typeof window === 'undefined' ? describe.sequential : describe

const randomUid = () =>
  '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

const schemaFile = (name: string): SchemaFileFormat => {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name, createdAt: now, updatedAt: now },
    models: { Note: { id: generateId(), properties: { body: { id: generateId(), type: 'Text' } } } },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

const db = () => BaseDb.getAppDb()!

testDescribe('definition upserts (T9)', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('linkModelToSchemaRow inserts a link once', async () => {
    const file = schemaFile(`T9 Links ${Date.now()}`)
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const [schemaRecord] = await db().select().from(schemas).where(eq(schemas.schemaFileId, file.id!))
    const [model] = await db().select().from(models).where(eq(models.schemaFileId, file.models.Note.id!))
    const results = await Promise.all([
      inDefinitionsTransaction((tx) => linkModelToSchemaRow(tx, model.id, schemaRecord.id)),
      inDefinitionsTransaction((tx) => linkModelToSchemaRow(tx, model.id, schemaRecord.id)),
    ])
    expect(results).toEqual([false, false]) // the import linked it
    const links = await db()
      .select()
      .from(modelSchemas)
      .where(and(eq(modelSchemas.modelId, model.id), eq(modelSchemas.schemaId, schemaRecord.id)))
    expect(links).toHaveLength(1)
  })

  it('a property save without `required` keeps the row\'s (G04-2)', async () => {
    const file = schemaFile(`T9 Required ${Date.now()}`)
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const [model] = await db().select().from(models).where(eq(models.schemaFileId, file.models.Note.id!))
    const propertyFileId = generateId()
    await writePropertyToDb(propertyFileId, { modelId: model.id, name: 'cover', dataType: 'Text', required: true })

    await savePropertyToDb({
      name: 'cover',
      modelId: model.id,
      modelName: 'Note',
      dataType: 'Text',
      _propertyFileId: propertyFileId,
    } as Parameters<typeof savePropertyToDb>[0])

    const [row] = await db().select().from(properties).where(eq(properties.schemaFileId, propertyFileId))
    expect(row).toMatchObject({ required: true, isEdited: true })
  })

  it('refuses a new property or a rename to a reserved ABI word, and leaves no row', async () => {
    const file = schemaFile(`T9 Reserved ${Date.now()}`)
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const [model] = await db().select().from(models).where(eq(models.schemaFileId, file.models.Note.id!))
    await expect(
      writePropertyToDb(generateId(), { modelId: model.id, name: 'storage', dataType: 'Text' }),
    ).rejects.toThrow('Property "storage" publishes as "storage"')
    await expect(
      inDefinitionsTransaction((tx) => upsertPropertyRow(tx, { modelId: model.id, name: 'view', previousName: 'body', dataType: undefined })),
    ).rejects.toThrow('publishes as "view"')
    const names = (await db().select().from(properties).where(eq(properties.modelId, model.id))).map((row) => row.name)
    expect(names).toContain('body')
    expect(names).not.toContain('storage')
    expect(names).not.toContain('view')
  })

  it('Model.lastSaveError reports a failed rename save (G11-7)', async () => {
    const schemaName = `T9 Model Save Error ${Date.now()}`
    const file = schemaFile(schemaName)
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
    const model = (await Model.find({ modelName: 'Note', schemaName }))!
    expect(model).toBeDefined()
    // Another writer renamed the row: the rename by the old name finds nothing in the schema.
    await db().update(models).set({ name: 'Elsewhere' }).where(eq(models.schemaFileId, file.models.Note.id!))

    model.modelName = 'Memo'

    await vi.waitFor(() => expect(model.lastSaveError?.message).toMatch(/not found in schema/), { timeout: 10_000 })
  })

  it('createSeeds skips a uid another row has', async () => {
    const uid = randomUid()
    const first = generateId()
    const second = generateId()
    expect([...(await createSeeds([{ localId: first, uid, type: 'note' }]))]).toEqual([first])
    expect([...(await createSeeds([{ localId: second, uid, type: 'note' }]))]).toEqual([])
    const rows = await db().select({ localId: seeds.localId }).from(seeds).where(eq(seeds.uid, uid))
    expect(rows).toEqual([{ localId: first }])
  })

  it('publish recording merges rows a sync inserted for the same uids (G19-8)', async () => {
    const seedUid = randomUid()
    const versionUid = randomUid()
    const item = generateId()
    const draftVersion = generateId()
    await db().insert(seeds).values({ localId: item, type: 'note', createdAt: Date.now() })
    await db().insert(versions).values({ localId: draftVersion, seedLocalId: item, seedType: 'note', createdAt: Date.now() })
    // A sync that ran during the publish stored the new attestations as their own rows.
    const synced = generateId()
    const syncedVersion = generateId()
    await db().insert(seeds).values({ localId: synced, uid: seedUid, type: 'note', attestationRaw: '{"s":1}' })
    await db().insert(versions).values({ localId: syncedVersion, seedLocalId: synced, seedUid, uid: versionUid, seedType: 'note' })
    await db().insert(metadata).values({
      localId: generateId(),
      seedLocalId: synced,
      versionLocalId: syncedVersion,
      propertyName: 'body',
      propertyValue: 'Hi',
      uid: randomUid(),
    })

    await updateVersionUid({ seedLocalId: item, versionUid })
    await updateSeedUid({ seedLocalId: item, seedUid })

    expect(await db().select({ localId: seeds.localId, attestationRaw: seeds.attestationRaw }).from(seeds).where(eq(seeds.uid, seedUid)))
      .toEqual([{ localId: item, attestationRaw: '{"s":1}' }])
    expect(await db().select({ localId: versions.localId, seedLocalId: versions.seedLocalId }).from(versions).where(eq(versions.uid, versionUid)))
      .toEqual([{ localId: draftVersion, seedLocalId: item }])
    const moved = await db()
      .select({ seedLocalId: metadata.seedLocalId, versionLocalId: metadata.versionLocalId })
      .from(metadata)
      .where(eq(metadata.propertyName, 'body'))
    expect(moved).toContainEqual({ seedLocalId: item, versionLocalId: draftVersion })
  })
})
