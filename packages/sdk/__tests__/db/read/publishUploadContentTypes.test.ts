import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { BaseArweaveClient } from '@seedprotocol/arweave'
import { getPublishUploadData, getPublishUploads } from '@/db/read/getPublishUploads'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../../test-utils/client-init'
import {
  ensureModelUidsForGetPublishPayloadTest,
  ensurePropertySchemaUidsForGetPublishPayloadTest,
  waitForPropertyInstances,
} from '../../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../../test-utils/waitForIdle'
import { WAIT_TIMEOUT_MS } from '../../test-utils/timeouts'

/**
 * Uploads carry a Content-Type for every file type the SDK knows, not just images / html / json:
 * from the file name when it has a known extension, else from the bytes' signature. Composites of
 * ItemStorage files: see ItemProperty/itemStoragePublishUploads.test.ts.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema publishUploadContentTypes'

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    UploadTypesDoc: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        report: { id: generateId(), type: 'File' },
        audio: { id: generateId(), type: 'File' },
        untitled: { id: generateId(), type: 'File' },
      },
    },
  },
  enums: {},
  migrations: [],
})

const PDF = new TextEncoder().encode('%PDF-1.4\n%âã\n1 0 obj << >> endobj\n')
const WAV = new Uint8Array([
  ...Array.from('RIFF').map((c) => c.charCodeAt(0)), 36, 0, 0, 0,
  ...Array.from('WAVEfmt ').map((c) => c.charCodeAt(0)), 16, 0, 0, 0, 1, 0, 1, 0,
  0x44, 0xac, 0, 0, 0x88, 0x58, 0x01, 0, 2, 0, 16, 0,
])

const setFile = async (item: Item<any>, propertyName: string, file: File) => {
  const prop = item.allProperties[propertyName]!
  prop.value = file
  await prop.save()
  await vi.waitFor(() => {
    const ctx = (prop.getService().getSnapshot() as any).context
    expect(typeof ctx.propertyValue).toBe('string')
    expect(ctx.refResolvedValue).toBeTruthy()
  }, { timeout: WAIT_TIMEOUT_MS })
}

testDescribe('publish upload Content-Type', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
    await ensureModelUidsForGetPublishPayloadTest(['UploadTypesDoc', 'File'], SCHEMA_NAME)
    await ensurePropertySchemaUidsForGetPublishPayloadTest(schema as any)
    vi.spyOn(BaseArweaveClient, 'createTransaction').mockImplementation(
      async (_data: unknown, options?: { tags?: { name: string; value: string }[] }) =>
        ({ id: 'unsigned', tags: options?.tags ?? [] }) as any,
    )
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    vi.restoreAllMocks()
    await teardownTestEnvironment()
  })

  it('pdf / wav by extension, and a nameless file by its signature', async () => {
    const item = await Item.create({ schemaName: SCHEMA_NAME, modelName: 'UploadTypesDoc', title: 'types' } as any)
    await waitForIdle(item, 'Item', 15000)
    await waitForPropertyInstances(item)

    await setFile(item, 'report', new File([PDF], `report-${generateId()}.pdf`))
    await setFile(item, 'audio', new File([WAV], `clip-${generateId()}.wav`))
    await setFile(item, 'untitled', new File([PDF], `untitled-${generateId()}`))

    const uploads = await getPublishUploadData(item as any)
    const byProperty = Object.fromEntries(uploads.map((u) => [u.itemPropertyName, u]))
    expect(byProperty.report?.contentType).toBe('application/pdf')
    expect(byProperty.audio?.contentType).toBe('audio/wav')
    expect(byProperty.untitled?.contentType).toBe('application/pdf')
    expect(byProperty.audio?.tags).toContainEqual({ name: 'Content-Type', value: 'audio/wav' })
    // Bytes are uploaded as stored.
    expect(Array.from(byProperty.audio!.data)).toEqual(Array.from(WAV))

    // The L1 transactions carry the same tags, in the same order as the upload data.
    const txs = await getPublishUploads(item as any)
    expect(txs.map((t) => t.itemPropertyLocalId)).toEqual(uploads.map((u) => u.itemPropertyLocalId))
    expect(txs.map((t) => (t.transactionToSign as any).tags)).toEqual(uploads.map((u) => u.tags))
  }, 90000)
})
