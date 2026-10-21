import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { count, eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { seeds, versions } from '@/seedSchema'
import { models as modelsTable } from '@/seedSchema/ModelSchema'
import { schemas as schemasTable } from '@/seedSchema/SchemaSchema'
import { findSeedRow } from '@/db/read/findSeedRow'
import { modelNameForType, resolveModelRecord, resolvePropertyModelRecord } from '@/db/read/resolveModelRecord'
import { getItemData } from '@/db/read/getItemData'
import { importJsonSchema } from '@/imports/json'
import { Schema } from '@/Schema/Schema'
import { generateId } from '@/helpers'
import { ZERO_BYTES32 } from '@/helpers/constants'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'

const uid = (c: string) => `0x${c.repeat(64)}`

const schemaFile = (schemaName: string, models: Record<string, { id: string; properties: Record<string, { id: string; type: string }> }>) => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models,
  enums: {},
  migrations: [],
})

describe.sequential('identity resolvers', () => {
  const suffix = generateId()
  const blogPostId = generateId()
  const titleId = generateId()
  const strictId = generateId()
  const schemaName = `Identity Resolvers ${suffix}`
  const otherSchemaName = `Identity Resolvers Other ${suffix}`

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const main = schemaFile(schemaName, {
      'Blog Post': { id: blogPostId, properties: { title: { id: titleId, type: 'Text' } } },
      // startCase('ir_tag_page') is "Ir Tag Page": only the easName match finds this one.
      IRTagPage: { id: generateId(), properties: { body: { id: generateId(), type: 'Text' } } },
      [`StrictThing${suffix}`]: { id: strictId, properties: { label: { id: generateId(), type: 'Text' } } },
    })
    await importJsonSchema({ contents: JSON.stringify(main) }, main.version)
    const other = schemaFile(otherSchemaName, {
      [`Unrelated${suffix}`]: { id: generateId(), properties: { name: { id: generateId(), type: 'Text' } } },
    })
    await importJsonSchema({ contents: JSON.stringify(other) }, other.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  describe('findSeedRow', () => {
    // Seed A was published as U0, unpublished and published again as U1: its row holds U1, its old
    // version still records U0. A version-less row C also holds U0 (an older sync's ghost).
    const a = `ir-seed-a-${suffix}`
    const b = `ir-seed-b-${suffix}`
    const ghost = `ir-seed-ghost-${suffix}`
    const [u0, u1, u2, u3] = [uid('a0'), uid('a1'), uid('b2'), uid('c3')]

    beforeAll(async () => {
      const db = BaseDb.getAppDb()
      await db.insert(seeds).values([
        { localId: a, uid: u1, type: 'ir_post' },
        { localId: b, uid: u2, type: 'ir_post' },
        { localId: ghost, uid: u0, type: 'ir_post' },
        { localId: `ir-seed-d-${suffix}`, uid: u3, type: 'ir_post' },
      ])
      await db.insert(versions).values([
        { localId: `ir-version-a0-${suffix}`, seedLocalId: a, seedUid: u0, seedType: 'ir_post' },
        { localId: `ir-version-a1-${suffix}`, seedLocalId: a, seedUid: u1, seedType: 'ir_post' },
      ])
    })

    it('takes the local id over the uid', async () => {
      expect((await findSeedRow({ localId: a, uid: u2 }))?.localId).toBe(a)
    })

    it('falls back to the uid when the local id matches nothing', async () => {
      expect((await findSeedRow({ localId: 'no-such-seed', uid: u2 }))?.localId).toBe(b)
    })

    it("follows an old uid through versions.seed_uid before seeds.uid", async () => {
      expect((await findSeedRow({ uid: u0 }))?.localId).toBe(a)
    })

    it('resolves a uid no version records by seeds.uid', async () => {
      expect((await findSeedRow({ uid: u3 }))?.localId).toBe(`ir-seed-d-${suffix}`)
    })

    it('matches nothing for the zero uid, a missing uid, or no ids', async () => {
      expect(await findSeedRow({ uid: ZERO_BYTES32 })).toBeUndefined()
      expect(await findSeedRow({ uid: uid('ff') })).toBeUndefined()
      expect(await findSeedRow({})).toBeUndefined()
    })
  })

  describe('resolveModelRecord', () => {
    it("with strict, a schema that lacks the model gives nothing instead of another schema's model", async () => {
      const name = `StrictThing${suffix}`
      expect(await resolveModelRecord(name, { schemaName: otherSchemaName, strict: true })).toBeUndefined()
      // Without strict the name alone still finds it.
      expect((await resolveModelRecord(name, { schemaName: otherSchemaName }))?.schemaFileId).toBe(strictId)
      expect((await resolveModelRecord(name, { schemaName, strict: true }))?.schemaFileId).toBe(strictId)
    })

    it("resolves the model of a property row by the property's schemaFileId", async () => {
      expect((await resolveModelRecord(undefined, { propertyFileId: titleId }))?.schemaFileId).toBe(blogPostId)
      expect(await resolvePropertyModelRecord(titleId)).toMatchObject({ name: 'Blog Post', dataType: 'Text' })
    })

    it('takes modelId before the property row and the name', async () => {
      const db = BaseDb.getAppDb()
      const [strictRow] = await db.select().from(modelsTable).where(eq(modelsTable.schemaFileId, strictId))
      const record = await resolveModelRecord('Blog Post', { modelId: strictRow.id, propertyFileId: titleId })
      expect(record?.schemaFileId).toBe(strictId)
    })
  })

  describe('model type to model name', () => {
    it('finds "Blog Post" for blog_post through its easName', async () => {
      expect(await modelNameForType('blog_post')).toBe('Blog Post')
      expect(await modelNameForType('Blog Post')).toBe('Blog Post')
      expect(await modelNameForType('ir_tag_page')).toBe('IRTagPage')
      expect(await modelNameForType('no_such_model_type')).toBeUndefined()
    })

    it('gives a synced blog_post seed without a model_file_id its model and schema', async () => {
      const localId = `ir-blog-${suffix}`
      await BaseDb.getAppDb().insert(seeds).values({ localId, uid: uid('d4'), type: 'blog_post' })
      const data = await getItemData({ seedLocalId: localId })
      expect(data).toMatchObject({ modelName: 'Blog Post', schemaName })

      const tagLocalId = `ir-tag-${suffix}`
      await BaseDb.getAppDb().insert(seeds).values({ localId: tagLocalId, uid: uid('e5'), type: 'ir_tag_page' })
      expect(await getItemData({ seedLocalId: tagLocalId })).toMatchObject({ modelName: 'IRTagPage', schemaName })
    })
  })

  describe('Schema.find', () => {
    it('finds a stored schema by name', async () => {
      const schema = await Schema.find({ schemaName, hold: false })
      expect(schema?.schemaName).toBe(schemaName)
    })

    it('returns undefined for an unknown name and writes no schema row', async () => {
      const db = BaseDb.getAppDb()
      const countRows = async () => (await db.select({ n: count() }).from(schemasTable))[0].n
      const before = await countRows()
      expect(await Schema.find({ schemaName: `No Such Schema ${suffix}`, waitForReady: false })).toBeUndefined()
      expect(await countRows()).toBe(before)
      expect(Schema.peek(`No Such Schema ${suffix}`)).toBeUndefined()
    })
  })
})
