// Schema files get the property checks code-defined properties get: unknown type names and
// length/pattern rules on non-string types reject the file (decision D19); `custom` loads with a
// warning and is ignored everywhere (decision D5). A `custom` rule failed the structure check, so
// a property that had one couldn't be renamed in code.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'
import { waitForItemIdle, waitForModelPropertyIdle, waitForModelSettled } from '../test-utils/waitForIdle'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip

const schemaFile = (id: string, name: string, properties: Record<string, unknown>) => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id,
  metadata: { name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: { RuleNote: { id: `${id}-note`, properties } },
  enums: {},
  migrations: [],
})

testDescribe('schema file validation rules', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
  }, SETUP_HOOK_TIMEOUT_MS)
  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('rejects maxLength on a File property', async () => {
    const { importJsonSchema } = await import('@/imports/json')
    const file = schemaFile('rules-file-length', 'Rules File Length', {
      attachment: { id: 'rules-file-length-attachment', type: 'File', validation: { maxLength: 20 } },
    })
    await expect(importJsonSchema({ contents: JSON.stringify(file) }, 1)).rejects.toThrow(
      'RuleNote.attachment: validation.maxLength only apply to Text and Html properties (this one is File)',
    )
  })

  it('rejects an unknown type name', async () => {
    const { importJsonSchema } = await import('@/imports/json')
    const file = schemaFile('rules-unknown-type', 'Rules Unknown Type', {
      body: { id: 'rules-unknown-type-body', type: 'blob' },
    })
    await expect(importJsonSchema({ contents: JSON.stringify(file) }, 1)).rejects.toThrow(
      'RuleNote.body: unknown type "blob"',
    )
  })

  it('rejects a property whose EAS name is a reserved ABI word', async () => {
    const { importJsonSchema } = await import('@/imports/json')
    const file = schemaFile('rules-reserved-property', 'Rules Reserved Property', {
      view: { id: 'rules-reserved-property-view', type: 'Text' },
    })
    await expect(importJsonSchema({ contents: JSON.stringify(file) }, 1)).rejects.toThrow(
      'RuleNote.view: Property "view" publishes as "view"',
    )
  })

  it('rejects a model whose EAS name is a reserved ABI word', async () => {
    const { importJsonSchema } = await import('@/imports/json')
    const file = {
      ...schemaFile('rules-reserved-model', 'Rules Reserved Model', {}),
      models: { Event: { id: 'rules-reserved-model-event', properties: { title: { id: 'rules-reserved-model-title', type: 'Text' } } } },
    }
    await expect(importJsonSchema({ contents: JSON.stringify(file) }, 1)).rejects.toThrow(
      'Event: Model "Event" publishes as "event"',
    )
  })

  it('loads a custom rule with a warning, ignores it, and renames the property', async () => {
    const { importJsonSchema } = await import('@/imports/json')
    const { BaseDb } = await import('@/db/Db/BaseDb')
    const { properties } = await import('@/seedSchema/ModelSchema')
    const { Model } = await import('@/Model/Model')
    const { ModelProperty } = await import('@/ModelProperty/ModelProperty')
    const { Item } = await import('@/Item/Item')
    const db = BaseDb.getAppDb()!
    const schemaName = 'Rules Custom'
    const propertyId = 'rules-custom-slug'
    const file = schemaFile('rules-custom', schemaName, {
      slug: { id: propertyId, type: 'Text', validation: { custom: 'isSlug' } },
    })

    const warn = vi.spyOn(console, 'warn')
    try {
      await importJsonSchema({ contents: JSON.stringify(file) }, 1)
      expect(warn.mock.calls.map((call) => String(call[0]))).toContainEqual(
        expect.stringContaining('RuleNote.slug: Custom validators are not supported'),
      )
    } finally {
      warn.mockRestore()
    }

    const model = await Model.create('RuleNote', schemaName, { modelFileId: 'rules-custom-note' })
    await waitForModelSettled(model as any)
    const item = await Item.create({ modelName: 'RuleNote', schemaName, slug: 'Not A Slug!' })
    await waitForItemIdle(item as any)
    expect((item as any).slug).toBe('Not A Slug!')
    item.unload()

    const prop = ModelProperty.getById(propertyId)!
    await waitForModelPropertyIdle(prop as any)
    expect(prop.isValid).toBe(true)
    ;(prop as any).name = 'handle'
    await waitForModelPropertyIdle(prop as any)
    const propRow = async () => (await db.select().from(properties).where(eq(properties.schemaFileId, propertyId)))[0]
    await vi.waitFor(async () => expect((await propRow()).name).toBe('handle'), { timeout: WAIT_TIMEOUT_MS })
    expect(prop.isValid).toBe(true)
  }, 60_000)
})
