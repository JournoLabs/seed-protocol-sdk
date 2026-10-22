/**
 * Typing into an input bound to a property assigns a value per keystroke, each built on the value
 * the property shows. Saves of earlier keystrokes, and (in the browser) the metadata live query
 * reporting them, must not put an older value back, or later keystrokes build on it and drop
 * characters (docs-writer batch 4).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { eq, and } from 'drizzle-orm'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { SchemaFileFormat } from '@/types/import'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle, type HasService } from '../test-utils/waitForIdle'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe

testDescribe('typing into a property', () => {
  const schemaName = 'Test Schema Fast Typing'
  const testSchema: SchemaFileFormat = {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: 'test-schema-fast-typing',
    metadata: {
      name: schemaName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    models: {
      Note: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
        },
      },
    },
    enums: {},
    migrations: [],
  }

  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await importJsonSchema({ contents: JSON.stringify(testSchema) }, testSchema.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  for (const keyDelayMs of [0, 15, 40]) {
    it(`keeps every keystroke at ${keyDelayMs} ms per key`, async () => {
      const model = Model.create('Note', schemaName, { waitForReady: false })
      await model.waitForReady({ timeout: WAIT_TIMEOUT_MS })

      const item = await Item.create({ modelName: 'Note', schemaName, title: '' })
      await waitForIdle(item as unknown as HasService, 'Item', 10_000)
      const title = item.properties.find((p) => p.propertyName === 'title') as ItemProperty<any>
      expect(title).toBeTruthy()

      const text = 'Sabcehklop quick brown fox'
      for (const ch of text) {
        // A controlled input: the next value is whatever the property shows, plus the key.
        title.value = `${title.value ?? ''}${ch}`
        await new Promise((r) => setTimeout(r, keyDelayMs))
      }

      expect(title.value).toBe(text)
      await waitFor(title.getService(), (s) => s.value === 'idle' && !s.context.isSaving, {
        timeout: WAIT_TIMEOUT_MS,
      })
      // Let the live query (browser) report the final write.
      await new Promise((r) => setTimeout(r, 300))
      expect(title.value).toBe(text)

      const rows = await BaseDb.getAppDb()
        .select({ propertyValue: metadata.propertyValue })
        .from(metadata)
        .where(and(eq(metadata.seedLocalId, item.seedLocalId!), eq(metadata.propertyName, 'title')))
      expect(rows.map((r) => r.propertyValue)).toEqual([text])
    })
  }
})
