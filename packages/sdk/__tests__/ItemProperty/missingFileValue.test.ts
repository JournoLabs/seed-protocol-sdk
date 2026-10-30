import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { eventEmitter } from '@/eventBus'
import { FILES_CHANGED_EVENT } from '@/helpers/tabEvents'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForIdle } from '../test-utils/waitForIdle'
import { waitForPropertyInstances } from '../test-utils/getPublishPayloadIntegrationHelpers'

/**
 * An Html property whose file isn't there read as its storage seed's id, which callers couldn't
 * tell from content (PermaPress seed-image-property-churn §6). It reads as undefined with
 * `valueStatus: 'missing'`, and resolves once the file is saved.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.skip
const SCHEMA_NAME = 'Test Schema Missing File Value'

const schemaFile = () => ({
  $schema: 'https://seedprotocol.io/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    MissingPost: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        body: { id: generateId(), type: 'Html' },
      },
    },
  },
  enums: {},
  migrations: [],
})

testDescribe('a file-backed value whose file is missing', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('reads as undefined with valueStatus missing, then resolves when the file is saved', async () => {
    const post = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'MissingPost', title: 'missing' } as any)
    await waitForIdle(post, 'Item', 15000)
    await waitForPropertyInstances(post)
    const body = post.properties.find((p) => p.propertyName === 'body')!
    body.value = '<p>body</p>'
    await body.save()
    expect(body.valueStatus).toBe('resolved')
    const fileName = body.refResolvedValue!
    const filePath = BaseFileManager.getFilesPath('html', fileName)
    const seedLocalId = post.seedLocalId
    post.unload()

    const fs = await import('node:fs')
    await fs.promises.unlink(filePath)

    const reloaded = (await Item.find({ seedLocalId, hold: true } as any))!
    await waitForPropertyInstances(reloaded)
    const missing = reloaded.properties.find((p) => p.propertyName === 'body')!
    await missing.waitForReady({ timeout: 20000 })
    expect(missing.valueStatus).toBe('missing')
    expect(missing.value).toBeUndefined()
    expect(missing.missingFile).toEqual({ path: filePath })

    await fs.promises.writeFile(filePath, '<p>back</p>')
    eventEmitter.emit(FILES_CHANGED_EVENT, [filePath])
    await vi.waitFor(() => expect(missing.valueStatus).toBe('resolved'), { timeout: 15000 })
    expect(missing.value).toBe('<p>back</p>')
    expect(missing.missingFile).toBeNull()
    reloaded.unload()
  }, 60000)

  it('is resolved for a property that holds no file', async () => {
    const post = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'MissingPost', title: 'plain' } as any)
    await waitForIdle(post, 'Item', 15000)
    await waitForPropertyInstances(post)
    const title = post.properties.find((p) => p.propertyName === 'title')!
    const body = post.properties.find((p) => p.propertyName === 'body')!
    expect(title.valueStatus).toBe('resolved')
    expect(body.valueStatus).toBe('resolved')
    expect(body.missingFile).toBeNull()
    post.unload()
  }, 30000)
})
