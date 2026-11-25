import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Schema } from '@/Schema/Schema'
import { Model } from '@/Model/Model'
import { Item } from '@/Item/Item'
import { getPublishPayload } from '@/db/read/getPublishPayload'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import { ensureModelUidsForGetPublishPayloadTest } from '../../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForItemIdle } from '../../test-utils/waitForIdle'
import { persistDefinitionFields } from '@/helpers/propertyDefinition'
import { BaseDb } from '@/db/Db/BaseDb'
import { properties } from '@/seedSchema'
import { eq } from 'drizzle-orm'

/**
 * Schema files and `Model.create` refuse `private: true` on a scalar (ADR 0033). A row that has it
 * anyway (written by other code) would attest the value as plaintext, so the payload refuses it.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema Private Scalar'

testDescribe('a private scalar from a code-defined model', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    await Schema.create(SCHEMA_NAME)
    await Model.create('Confession', SCHEMA_NAME, {
      properties: {
        title: { dataType: 'Text' },
        secret: { dataType: 'Text' },
      },
    })
    const [row] = await BaseDb.getAppDb()!.select({ id: properties.id }).from(properties).where(eq(properties.name, 'secret'))
    await persistDefinitionFields({ id: row!.id }, { private: true })
    await ensureModelUidsForGetPublishPayloadTest(['Confession'], SCHEMA_NAME)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('is refused instead of attested', async () => {
    const item = await Item.create({ modelName: 'Confession', schemaName: SCHEMA_NAME, title: 'public', secret: 'plaintext' } as any)
    await waitForItemIdle(item)
    await expect(getPublishPayload(item as any, [])).rejects.toThrow(/secret: it is marked private/)
  }, 30000)
})
