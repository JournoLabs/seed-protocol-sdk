import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { clearStoredDisplayUrls } from '@/db/clearStoredDisplayUrls'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { and, eq } from 'drizzle-orm'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'

/**
 * A File property's value is its content URL (file:// in Node, a blob URL in browsers), before and
 * after a reload. It used to turn into the file's text a moment after each save or load. The URL is
 * minted from the file each session: 0.7.5–0.7.6 stored it, and after a reload the value was the
 * previous session's dead blob: URL.
 */

const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe
const SCHEMA_NAME = 'Test Schema File Value'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.org/schemas/data-model/v1',
    version: 1,
    id: generateId(),
    metadata: { name: SCHEMA_NAME, createdAt: now, updatedAt: now },
    models: {
      FileDoc: {
        id: generateId(),
        properties: {
          title: { id: generateId(), type: 'Text' },
          attachment: { id: generateId(), type: 'File' },
        },
      },
    },
    enums: {},
    migrations: [],
  } as SchemaFileFormat
}

const fileRow = async (seedLocalId: string) => {
  const rows = await BaseDb.getAppDb()
    .select({
      localId: metadata.localId,
      refResolvedValue: metadata.refResolvedValue,
      refResolvedDisplayValue: metadata.refResolvedDisplayValue,
    })
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.refSeedType, 'file')))
  expect(rows).toHaveLength(1)
  return rows[0]!
}

// What 0.7.5–0.7.6 left in the row.
const storeDisplayValue = (localId: string, value: string) =>
  BaseDb.getAppDb().update(metadata).set({ refResolvedDisplayValue: value }).where(eq(metadata.localId, localId))

const reload = async (seedLocalId: string) => {
  Item.dropCachedInstancesForSeedIds([seedLocalId])
  return (await Item.find({ seedLocalId })) as any
}

testDescribe('File property values', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const file = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(file) }, file.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('stay the content URL after the save settles and after a reload', async () => {
    if (typeof window !== 'undefined') return // Node: file:// URLs
    const item = (await Item.create({ modelName: 'FileDoc', schemaName: SCHEMA_NAME, title: 'doc' } as never)) as any
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'attachment' })
    property!.value = 'data:text/plain,hi%20there'
    await property!.save()

    await vi.waitFor(() => expect(String(item.attachment)).toMatch(/^file:\/\//), { timeout: WAIT_TIMEOUT_MS })
    const urlAfterSave = item.attachment
    // The subscription that used to swap in the file's text runs after the save.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(item.attachment).toBe(urlAfterSave)

    Item.dropCachedInstancesForSeedIds([item.seedLocalId])
    const reloaded = (await Item.find({ seedLocalId: item.seedLocalId })) as any
    await vi.waitFor(() => expect(String(reloaded.attachment)).toMatch(/^file:\/\//), { timeout: WAIT_TIMEOUT_MS })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(reloaded.attachment).toBe(urlAfterSave)
  }, 30000)

  it('are minted from the file in Node, not read from a stored URL', async () => {
    if (typeof window !== 'undefined') return
    const item = (await Item.create({ modelName: 'FileDoc', schemaName: SCHEMA_NAME, title: 'moved' } as never)) as any
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'attachment' })
    property!.value = 'data:text/plain,moved'
    await property!.save()
    await vi.waitFor(() => expect(String(item.attachment)).toMatch(/^file:\/\//), { timeout: WAIT_TIMEOUT_MS })

    const row = await fileRow(item.seedLocalId)
    expect(row.refResolvedDisplayValue).toBeNull()
    const { pathToFileURL } = await import('url')
    const path = await import('path')
    const expected = pathToFileURL(path.resolve(BaseFileManager.getFilesPath('files', row.refResolvedValue!))).href
    expect(item.attachment).toBe(expected)

    // A URL stored under an older filesDir: the value follows the file's current path instead.
    await storeDisplayValue(row.localId!, 'file:///old/files/dir/files/' + row.refResolvedValue)
    const reloaded = await reload(item.seedLocalId)
    await vi.waitFor(() => expect(reloaded.attachment).toBe(expected), { timeout: WAIT_TIMEOUT_MS })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(reloaded.attachment).toBe(expected)

    expect(await clearStoredDisplayUrls()).toBeGreaterThanOrEqual(1)
    expect((await fileRow(item.seedLocalId)).refResolvedDisplayValue).toBeNull()
  }, 30000)

  it('fetch after a reload in the browser', async () => {
    if (typeof window === 'undefined') return
    const item = (await Item.create({ modelName: 'FileDoc', schemaName: SCHEMA_NAME, title: 'reload' } as never)) as any
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'attachment' })
    property!.value = new File(['hi there'], 'note.txt', { type: 'text/plain' }) as never
    await property!.save()

    await vi.waitFor(() => expect(String(item.attachment)).toMatch(/^blob:/), { timeout: WAIT_TIMEOUT_MS })
    const sessionUrl = String(item.attachment)
    expect(await (await fetch(sessionUrl)).text()).toBe('hi there')
    const row = await fileRow(item.seedLocalId)
    expect(row.refResolvedDisplayValue).toBeNull()

    // A reload: the old session's blob URL is dead, and an older SDK left it in the row.
    URL.revokeObjectURL(sessionUrl)
    await storeDisplayValue(row.localId!, sessionUrl)
    const reloaded = await reload(item.seedLocalId)
    await vi.waitFor(() => {
      expect(String(reloaded.attachment)).toMatch(/^blob:/)
      expect(reloaded.attachment).not.toBe(sessionUrl)
    }, { timeout: WAIT_TIMEOUT_MS })
    // The live query must not put the stored URL back.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(reloaded.attachment).not.toBe(sessionUrl)
    expect(await (await fetch(String(reloaded.attachment))).text()).toBe('hi there')

    expect(await clearStoredDisplayUrls()).toBeGreaterThanOrEqual(1)
    expect((await fileRow(item.seedLocalId)).refResolvedDisplayValue).toBeNull()
  }, 30000)
})
