import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { importJsonSchema } from '@/imports/json'
import { Model } from '@/Model/Model'
import { ModelProperty } from '@/ModelProperty/ModelProperty'
import { Schema } from '@/Schema/Schema'
import { AmbiguousModelError } from '@/Model/errors'
import { setEntityUnloadGraceMs } from '@/helpers/entity/entityCache'
import { EntityUnloadedError, evictEntities } from '@/helpers/entity/entityLifecycle'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Schema, Model and ModelProperty stay cached with no holds until they are destroyed or evicted:
 * Model.resolve, findByModelType and sync read the cache synchronously. Item and ItemProperty
 * keep the grace period. Test setups use a grace period of 0, under which an instance that never
 * had a hold stays cached anyway, so these tests set their own.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_A = 'Def Cached Schema A'
const SCHEMA_B = 'Def Cached Schema B'
const GRACE_MS = 50

const refCount = (cache: { entryOf(instance: any): { refCount: number } | undefined }, instance: unknown) =>
  cache.entryOf(instance)?.refCount
const pastGrace = () => new Promise((resolve) => setTimeout(resolve, GRACE_MS * 4))

/** Drop every cached definition, so the next lookup caches them under the current grace period. */
const evictDefinitions = () => {
  evictEntities(ModelProperty.cache, () => true)
  evictEntities(Model.cache, () => true)
  evictEntities(Schema.cache, () => true)
}

testDescribe('definition caches', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({
      contents: JSON.stringify({
        name: SCHEMA_A,
        models: {
          DcPostPage: { properties: { title: { type: 'Text' } } },
          DcSharedPost: { properties: { body: { type: 'Text' } } },
        },
      }),
    })
    await importJsonSchema({
      contents: JSON.stringify({
        name: SCHEMA_B,
        models: { DcSharedPost: { properties: { body: { type: 'Text' } } } },
      }),
    })
    await importJsonSchema({
      contents: JSON.stringify({
        name: 'Def Hold Counts',
        models: { DhPage: { properties: { title: { type: 'Text' } } } },
      }),
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(() => {
    setEntityUnloadGraceMs(undefined)
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('Model.resolve and findByModelType still find a model after the grace period', async () => {
    setEntityUnloadGraceMs(GRACE_MS)
    evictDefinitions()
    const models = await Model.all(SCHEMA_A, { waitForReady: true })
    expect(models.map((m) => m.modelName).sort()).toEqual(['DcPostPage', 'DcSharedPost'])

    await pastGrace()
    expect(Model.findByModelType('dc_post_page')?.modelName).toBe('DcPostPage')
    expect(Model.resolve('DcPostPage', { schemaName: SCHEMA_A })?.modelName).toBe('DcPostPage')
    for (const model of models) expect(model.getService().getSnapshot().status).toBe('active')
  }, 30000)

  it('a model two schemas define is still ambiguous after the grace period', async () => {
    setEntityUnloadGraceMs(GRACE_MS)
    evictDefinitions()
    await Model.all(undefined, { waitForReady: true })
    expect(() => Model.findByModelType('dc_shared_post')).toThrow(AmbiguousModelError)

    await pastGrace()
    expect(() => Model.findByModelType('dc_shared_post')).toThrow(AmbiguousModelError)
  }, 30000)

  it('a schema and its model properties stay cached after the grace period', async () => {
    setEntityUnloadGraceMs(GRACE_MS)
    evictDefinitions()
    const schema = await Schema.find({ schemaName: SCHEMA_A })
    const model = await Model.find({ modelName: 'DcPostPage', schemaName: SCHEMA_A })
    const properties = await ModelProperty.all(model!.id!, { waitForReady: true })
    expect(properties.length).toBeGreaterThan(0)

    await pastGrace()
    expect(Schema.peek(SCHEMA_A)).toBe(schema)
    expect(Model.peekByName('DcPostPage', SCHEMA_A)).toBe(model)
    for (const property of properties) expect(ModelProperty.getById(property.id!)).toBe(property)
  }, 30000)

  it("releasing a definition's last hold keeps it cached", async () => {
    setEntityUnloadGraceMs(0)
    evictDefinitions()
    // Not through its schema, which would hold it too
    const model = await Model.find({ modelName: 'DcPostPage', schemaName: SCHEMA_A, hold: true })
    expect(Schema.peek(SCHEMA_A)).toBeUndefined()
    expect(refCount(Model.cache, model)).toBe(1)
    model!.unload()
    expect(refCount(Model.cache, model)).toBe(0)
    expect(model!.getService().getSnapshot().status).toBe('active')
    // A second unload, with no hold left, changes nothing
    model!.unload()
    expect(Model.peekByName('DcPostPage', SCHEMA_A)).toBe(model)
  }, 30000)

  it('evicting a schema evicts the models it holds', async () => {
    const schema = await Schema.find({ schemaName: SCHEMA_B })
    const model = await Model.find({ modelName: 'DcSharedPost', schemaName: SCHEMA_B })
    expect(model).toBeDefined()
    Schema.evict(SCHEMA_B)
    expect(schema!.getService().getSnapshot().status).toBe('stopped')
    expect(model!.getService().getSnapshot().status).toBe('stopped')
  }, 30000)

  const schemaName = 'Def Hold Counts'

  it('Schema lookups take no hold unless hold: true', async () => {
    const schema = (await Schema.find({ schemaName }))!
    const id = schema.id!
    const base = refCount(Schema.cache, schema)!

    const lookups: Array<[string, (hold?: boolean) => Promise<unknown> | unknown]> = [
      ['create', (hold) => Schema.create(schemaName, { hold })],
      ['getById', (hold) => Schema.getById(id, { hold })],
      ['createById', (hold) => Schema.createById(id, { hold })],
      ['find by name', (hold) => Schema.find({ schemaName, hold })],
      ['find by id', (hold) => Schema.find({ schemaFileId: id, hold })],
      ['all', (hold) => Schema.all({ hold })],
    ]
    for (const [name, lookup] of lookups) {
      await lookup()
      expect(refCount(Schema.cache, schema), `${name} without hold`).toBe(base)
      await lookup(true)
      expect(refCount(Schema.cache, schema), `${name} with hold`).toBe(base + 1)
      schema.unload()
    }
  }, 30000)

  it('Model lookups take no hold unless hold: true', async () => {
    const model = (await Model.find({ modelName: 'DhPage', schemaName }))!
    const id = model.id!
    const base = refCount(Model.cache, model)!

    const lookups: Array<[string, (hold?: boolean) => Promise<unknown> | unknown]> = [
      ['create', (hold) => Model.create('DhPage', schemaName, { id, hold })],
      ['getById', (hold) => Model.getById(id, { hold })],
      ['getByName', (hold) => Model.getByName('DhPage', schemaName, { hold })],
      ['getByNameAsync', (hold) => Model.getByNameAsync('DhPage', schemaName, { hold })],
      ['createById', (hold) => Model.createById(id, { hold })],
      ['createBySchemaId', (hold) => Model.createBySchemaId(schemaName, { hold })],
      ['find by id', (hold) => Model.find({ modelFileId: id, hold })],
      ['find by name', (hold) => Model.find({ modelName: 'DhPage', schemaName, hold })],
      ['all', (hold) => Model.all(schemaName, { hold })],
    ]
    for (const [name, lookup] of lookups) {
      await lookup()
      expect(refCount(Model.cache, model), `${name} without hold`).toBe(base)
      await lookup(true)
      expect(refCount(Model.cache, model), `${name} with hold`).toBe(base + 1)
      model.unload()
    }
  }, 30000)

  it('ModelProperty lookups take no hold unless hold: true', async () => {
    const model = (await Model.find({ modelName: 'DhPage', schemaName }))!
    const [property] = await ModelProperty.all(model.id!, { waitForReady: true })
    const id = property.id!
    const base = refCount(ModelProperty.cache, property)!
    const definition = { ...property._getSnapshotContext(), id }

    const lookups: Array<[string, (hold?: boolean) => Promise<unknown> | unknown]> = [
      ['create', (hold) => ModelProperty.create(definition as any, { hold })],
      ['getById', (hold) => ModelProperty.getById(id, { hold })],
      ['createById', (hold) => ModelProperty.createById(id, { hold })],
      ['find', (hold) => ModelProperty.find({ propertyFileId: id, hold })],
      ['all', (hold) => ModelProperty.all(model.id!, { hold })],
    ]
    for (const [name, lookup] of lookups) {
      await lookup()
      expect(refCount(ModelProperty.cache, property), `${name} without hold`).toBe(base)
      await lookup(true)
      expect(refCount(ModelProperty.cache, property), `${name} with hold`).toBe(base + 1)
      property.unload()
    }
  }, 30000)

  it('writes on an evicted definition throw EntityUnloadedError; reads do not', async () => {
    await importJsonSchema({
      contents: JSON.stringify({ name: 'Def Evicted Writes', models: { DeNote: { properties: { body: { type: 'Text' } } } } }),
    })
    const schema = (await Schema.find({ schemaName: 'Def Evicted Writes' }))!
    const model = (await Model.find({ modelName: 'DeNote', schemaName: 'Def Evicted Writes' }))!
    const [property] = await ModelProperty.all(model.id!, { waitForReady: true })
    Schema.evict('Def Evicted Writes')
    evictEntities(ModelProperty.cache, (p) => p === property)

    expect(() => {
      schema.name = 'Renamed'
    }).toThrow(EntityUnloadedError)
    await expect(schema.saveNewVersion()).rejects.toThrow(/schema Def Evicted Writes/)
    expect(() => {
      model.modelName = 'Renamed'
    }).toThrow(/model Def Evicted Writes\.DeNote/)
    await expect(model.create({ body: 'x' })).rejects.toThrow(EntityUnloadedError)
    expect(() => {
      property.name = 'renamed'
    }).toThrow(/property DeNote\.body/)
    expect(() => property.save()).toThrow(EntityUnloadedError)

    expect(schema.name).toBe('Def Evicted Writes')
    expect(model.modelName).toBe('DeNote')
    expect(property.name).toBe('body')
  }, 30000)
})
