import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'
import { embeddedImageBytes } from '../test-utils/embeddedImage'

// Repro for a PermaPress report: after an Image save, the property's value took a new blob: URL
// about 60 times a second until reload.

const SCHEMA_NAME = 'Test Schema Image Churn'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      Clip: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          image: { id: generateId(), type: 'Image' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

const countChanges = async (read: () => unknown, ms: number) => {
  let last = read()
  let changes = 0
  const end = Date.now() + ms
  while (Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    const now = read()
    if (!Object.is(now, last)) changes++
    last = now
  }
  return changes
}

describe('Image property value after a save', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('stays the same URL once the save settles', async () => {
    if (typeof window === 'undefined') return // Node mints stable file:// URLs
    const item = (await Item.create({ modelName: 'Clip', schemaName: SCHEMA_NAME, title: 'clip' } as never)) as any
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'image' })
    const t0 = performance.now()
    property!.value = new File([embeddedImageBytes()], 'drop.png', { type: 'image/png' }) as never
    await property!.save()
    console.error('[churn] save ms', Math.round(performance.now() - t0))

    await vi.waitFor(() => expect(String(property!.value)).toMatch(/^blob:/), { timeout: WAIT_TIMEOUT_MS })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const changes = await countChanges(() => property!.value, 2000)
    console.error('[churn] value changes in 2 s after save:', changes, 'ctx display', (property as any)._service.getSnapshot().context.refResolvedDisplayValue)
    expect(changes).toBe(0)
  }, 60000)

  it('mints one URL, not one per render', async () => {
    if (typeof window === 'undefined') return
    const item = (await Item.create({ modelName: 'Clip', schemaName: SCHEMA_NAME, title: 'clip2' } as never)) as any
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'image' })
    property!.value = new File([embeddedImageBytes()], 'drop2.png', { type: 'image/png' }) as never
    await property!.save()
    await vi.waitFor(() => expect(String(property!.value)).toMatch(/^blob:/), { timeout: WAIT_TIMEOUT_MS })
    // What displayValueFromRow does when the row names a different file (another tab's save).
    ;(property as any)._service.send({ type: 'updateContext', refResolvedDisplayValue: undefined })
    const changes = await countChanges(() => property!.value, 2000)
    console.error('[churn] cleared-display changes in 2 s:', changes)
    expect(changes).toBeLessThanOrEqual(1)
  }, 60000)
})
