import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { waitFor } from 'xstate'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema/MetadataSchema'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle } from '../test-utils/waitForIdle'
import { waitForPropertyInstances } from '../test-utils/getPublishPayloadIntegrationHelpers'

/**
 * Two quick assignments to an Html property: the newer value must win in memory and in the DB,
 * whichever save finishes its work first (ADR 0019: assignment-order tickets, then the outbox).
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential
const SCHEMA_NAME = 'Test Schema Storage Save Order'
const ROUNDS = 5

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    OrderPost: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        html: { id: generateId(), type: 'Html' },
      },
    },
  },
  enums: {},
  migrations: [],
})

testDescribe('storage value saves', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  /** The Html stored for the item's newest html metadata row. */
  const storedHtml = async (seedLocalId: string) => {
    const db = BaseDb.getAppDb()!
    const [row] = await db
      .select({ refResolvedValue: metadata.refResolvedValue })
      .from(metadata)
      .where(and(eq(metadata.seedLocalId, seedLocalId), inArray(metadata.propertyName, ['html', 'htmlId'])))
      .orderBy(desc(metadata.createdAt), desc(metadata.localId))
      .limit(1)
    if (!row?.refResolvedValue) return undefined
    return BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('html', row.refResolvedValue))
  }

  it('keeps the newer of two quick Html assignments', async () => {
    const post = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'OrderPost', title: 'order' } as any)
    await waitForIdle(post, 'Item', 15000)
    await waitForPropertyInstances(post)
    const html = post.properties.find((p) => p.propertyName === 'html' || p.propertyName === 'htmlId')!

    for (let round = 0; round < ROUNDS; round++) {
      const older = `<p>older ${round}</p>`
      const newer = `<p>newer ${round}</p>`
      html.value = older
      html.value = newer

      await waitFor(
        html.getService(),
        (s) => s.value === 'idle' && !(s.context as { isSaving?: boolean }).isSaving,
        { timeout: 15000 },
      )
      // Let any write still running for the older value land
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(await storedHtml(post.seedLocalId), `round ${round}`).toBe(newer)
    }
    post.unload()
  }, 90000)
})
