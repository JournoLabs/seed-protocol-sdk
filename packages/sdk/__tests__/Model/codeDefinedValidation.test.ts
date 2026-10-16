import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { ItemProperty, ItemPropertySaveValidationError } from '@/ItemProperty/ItemProperty'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForItemIdle } from '../test-utils/waitForIdle'

/**
 * Validation rules on properties defined in code (no schema file) are enforced. They used to
 * be dropped when the Model created its ModelProperty instances.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Code Defined Validation'

testDescribe('validation on code-defined properties', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await Schema.create(SCHEMA_NAME)
    await Model.create('Slugged', SCHEMA_NAME, {
      properties: {
        slug: { dataType: 'Text', validation: { pattern: '^[a-z-]+$' } },
      },
    })
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('rejects a value that breaks the pattern', async () => {
    const item = await Item.create({ modelName: 'Slugged', schemaName: SCHEMA_NAME, slug: 'good-slug' })
    await waitForItemIdle(item)
    const slug = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'slug' })

    slug!.value = 'Not A Slug'
    await expect(slug!.save()).rejects.toBeInstanceOf(ItemPropertySaveValidationError)

    slug!.value = 'still-fine'
    await expect(slug!.save()).resolves.toBeUndefined()
  }, 30000)
})
