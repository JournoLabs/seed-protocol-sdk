import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Item, importJsonSchema, generateId } from '@seedprotocol/sdk'
import { getPublishUploadData } from './getPublishUploadData'
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  SETUP_HOOK_TIMEOUT_MS,
} from '../../../../../sdk/__tests__/test-utils/client-init'
import {
  createGetPublishPayloadTestSchema,
  waitForPropertyInstances,
} from '../../../../../sdk/__tests__/test-utils/getPublishPayloadIntegrationHelpers'

/**
 * A server publishing on someone's behalf only holds the uids of their other seeds (no local rows).
 * The upload walk must treat those relations as already published instead of throwing.
 */
describe.sequential('getPublishUploadData with relations to published uids', () => {
  beforeAll(async () => {
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: SETUP_HOOK_TIMEOUT_MS,
    })
    await createGetPublishPayloadTestSchema()
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('skips a 0x relation with no local item', async () => {
    const postItem = await Item.create({
      modelName: 'Post',
      title: 'Post with uid author',
      author: '0x' + 'a'.repeat(64),
      tagIds: ['0x' + 'b'.repeat(64)],
    } as any)
    await waitForPropertyInstances(postItem)
    await expect(getPublishUploadData(postItem)).resolves.toEqual([])
  }, 30000)

  it('still throws for a local id with no local item', async () => {
    const postItem = await Item.create({
      modelName: 'Post',
      title: 'Post with broken author',
      author: '0000000000',
    } as any)
    await waitForPropertyInstances(postItem)
    await expect(getPublishUploadData(postItem)).rejects.toThrow('No relatedItem found for author')
  }, 30000)

  it('walks every related draft: through lists, relations of drafts, and cycles', async () => {
    const schemaName = 'Test Schema publishUploadDataGraph'
    const schema = {
      $schema: 'https://seedprotocol.org/schemas/data-model/v1',
      version: 1,
      id: generateId(),
      metadata: { name: schemaName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      models: {
        UploadGraphNode: {
          id: generateId(),
          properties: {
            label: { id: generateId(), type: 'Text' },
            next: { id: generateId(), type: 'Relation', model: 'UploadGraphNode' },
            body: { id: generateId(), type: 'Html' },
          },
        },
        UploadGraphRoot: {
          id: generateId(),
          properties: {
            title: { id: generateId(), type: 'Text' },
            nodes: { id: generateId(), type: 'List', refValueType: 'Relation', ref: 'UploadGraphNode' },
          },
        },
      },
      enums: {},
      migrations: [],
    }
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    const create = async (props: Record<string, unknown>) => {
      const item = await Item.create({ schemaName, ...props } as any)
      await waitForPropertyInstances(item as any)
      return item
    }
    const b = await create({ modelName: 'UploadGraphNode', label: 'B', body: '<p>deep draft</p>' })
    const a = await create({ modelName: 'UploadGraphNode', label: 'A', next: b.seedLocalId })
    // B → A closes a cycle.
    const bNext = b.allProperties.next!
    bNext.value = a.seedLocalId
    await bNext.save()
    const root = await create({ modelName: 'UploadGraphRoot', title: 'root', nodes: [a.seedLocalId] })

    const bHtmlSeed = (b.allProperties.body!.getService().getSnapshot() as any).context.propertyValue
    expect(bHtmlSeed).toBeTruthy()
    const uploads = await getPublishUploadData(root as any)
    expect(uploads.map((u) => u.seedLocalId)).toContain(bHtmlSeed)
  }, 60000)
})

