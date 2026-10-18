import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { ItemProperty, ItemPropertySaveValidationError } from '@/ItemProperty/ItemProperty'
import { OwnershipError } from '@/helpers/ownership'
import { setGetPublisherForNewSeeds } from '@/helpers/publishConfig'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { Model } from '@/Model/Model'
import { Schema } from '@/Schema/Schema'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForSchemaIdle } from '../test-utils/waitForIdle'

/**
 * The property save path: what a rejected save leaves behind, which error save() throws, and
 * Relation values whose schema sets a refValueType.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Save Path'
const MINE = '0x' + '7'.repeat(40)
const OTHER = '0x' + '8'.repeat(40)

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      SavePathAuthor: {
        id: generateId(),
        properties: { name: { id: generateId(), type: 'Text' } },
      },
      SavePathNote: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text', validation: { maxLength: 255 } },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

const createNote = (title: string) =>
  Item.create({ modelName: 'SavePathNote', schemaName: SCHEMA_NAME, title } as never) as Promise<any>

const storedValues = async (seedLocalId: string, propertyName: string): Promise<(string | null)[]> => {
  const rows = await BaseDb.getAppDb()!
    .select({ value: metadata.propertyValue })
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, propertyName)))
  return rows.map((row: { value: string | null }) => row.value)
}

testDescribe('ItemProperty save path', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(async () => {
    setGetPublisherForNewSeeds(null)
    const { client } = await import('@/client')
    await client.setAddresses({ owned: [], watched: [] })
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('a value that breaks its rule is rolled back everywhere in the process', async () => {
    const item = await createNote('Original title')
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'title' })

    property!.value = 'x'.repeat(300)
    const error = await property!.save().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ItemPropertySaveValidationError)
    expect(property!.value).toBe('Original title')
    expect(property!.saveValidationErrors.map((e) => e.code)).toContain('max_length_exceeded')
    expect(item.title).toBe('Original title')
    const found = (await Item.find({ seedLocalId: item.seedLocalId })) as any
    expect(found.title).toBe('Original title')
    const all = (await Item.all('SavePathNote')) as any[]
    expect(all.find((i) => i.seedLocalId === item.seedLocalId)?.title).toBe('Original title')
    expect(await storedValues(item.seedLocalId, 'title')).toEqual(['Original title'])
  }, 30000)

  it('save() rethrows an ownership refusal as an OwnershipError', async () => {
    const { client } = await import('@/client')
    // Created while OTHER is owned, then read while only MINE is: the item is read-only.
    await client.setAddresses({ owned: [OTHER], watched: [] })
    setGetPublisherForNewSeeds(async () => OTHER)
    const item = await createNote('Not mine')
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'title' })
    await client.setAddresses({ owned: [MINE], watched: [] })

    // Assignment skips save()'s up-front ownership check; the machine refuses it instead.
    property!.value = 'Overwritten'
    await vi.waitFor(() => expect(property!.getService().getSnapshot().context._saveError).toBeTruthy())
    expect(property!.getService().getSnapshot().context._saveError).toBeInstanceOf(OwnershipError)
    expect(property!.value).toBe('Not mine')
  }, 30000)

  it('setValue saves a value that is already in context', async () => {
    const item = await createNote('Before debounce')
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'title' })
    const before = { propertyValue: 'Before debounce', renderValue: 'Before debounce' }

    // What a debounced input does: show the typed value first, save later.
    property!.getService().send({ type: 'updateContext', propertyValue: 'Typed', renderValue: 'Typed' })
    property!.value = 'Typed'
    await property!.save()
    expect(await storedValues(item.seedLocalId, 'title')).toEqual(['Before debounce'])

    property!.setValue('Typed', { before })
    await property!.save()
    expect(await storedValues(item.seedLocalId, 'title')).toEqual(['Typed'])
  }, 30000)

  it('setValue rolls a rejected value back to the given before', async () => {
    const item = await createNote('Shown before typing')
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'title' })
    const before = { propertyValue: 'Shown before typing', renderValue: 'Shown before typing' }
    const tooLong = 'y'.repeat(300)

    property!.getService().send({ type: 'updateContext', propertyValue: tooLong, renderValue: tooLong })
    property!.setValue(tooLong, { before })

    await expect(property!.save()).rejects.toBeInstanceOf(ItemPropertySaveValidationError)
    expect(property!.value).toBe('Shown before typing')
    expect(await storedValues(item.seedLocalId, 'title')).toEqual(['Shown before typing'])
  }, 30000)

  it('a Relation whose schema sets refValueType saves and survives a reload', async () => {
    // Schema files drop refValueType on a non-list Relation; a model built in code keeps it.
    const schema = Schema.create(SCHEMA_NAME, { waitForReady: false }) as Schema
    await waitForSchemaIdle(schema)
    await Model.create('SavePathReview', schema, {
      properties: {
        summary: { dataType: 'Text' },
        editor: { dataType: 'Relation', ref: 'SavePathAuthor', refValueType: 'Text' },
      },
    })
    const author = (await Item.create({
      modelName: 'SavePathAuthor',
      schemaName: SCHEMA_NAME,
      name: 'Ada',
    } as never)) as any
    const review = (await Item.create({
      modelName: 'SavePathReview',
      schemaName: SCHEMA_NAME,
      summary: 'With editor',
    } as never)) as any
    const property = await ItemProperty.find({ seedLocalId: review.seedLocalId, propertyName: 'editor' })
    await vi.waitFor(() => expect(property!.propertyDef?.refValueType).toBe('Text'))

    property!.value = author.seedLocalId
    await property!.save()

    const stored = await BaseDb.getAppDb()!
      .select({ value: metadata.propertyValue, name: metadata.propertyName })
      .from(metadata)
      .where(eq(metadata.seedLocalId, review.seedLocalId))
    expect(stored.map((row: { value: string | null }) => row.value)).toContain(author.seedLocalId)

    Item.dropCachedInstancesForSeedIds([review.seedLocalId])
    await Item.find({ seedLocalId: review.seedLocalId })
    const reloaded = await ItemProperty.find({ seedLocalId: review.seedLocalId, propertyName: 'editor' })
    await vi.waitFor(() => expect(reloaded!.value).toBe(author.seedLocalId))
  }, 30000)
})
