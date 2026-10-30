import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import type { SchemaFileFormat } from '@/types/import'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { WAIT_TIMEOUT_MS } from '../test-utils/timeouts'
import { embeddedImageBytes } from '../test-utils/embeddedImage'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata } from '@/seedSchema'
import { and, eq } from 'drizzle-orm'

// PermaPress report (0.7.5): after an Image save, the property's value took a new blob: URL about
// 60 times a second until reload. The URLs were never revoked either.

const SCHEMA_NAME = 'Test Schema Image Churn'

function schemaFile(): SchemaFileFormat {
  const now = new Date().toISOString()
  return {
    $schema: 'https://seedprotocol.io/schemas/data-model/v1',
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

// Resolves once the value has gone `quietMs` without changing.
const waitUntilSettled = async (read: () => unknown, quietMs: number, timeoutMs: number) => {
  let last = read()
  let quietSince = Date.now()
  const end = Date.now() + timeoutMs
  while (Date.now() - quietSince < quietMs) {
    if (Date.now() > end) throw new Error(`value still changing after ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, 10))
    const now = read()
    if (!Object.is(now, last)) quietSince = Date.now()
    last = now
  }
}

// The item and the test's find each hold the property once; it stops at the second release.
const releaseItemAndFind = (item: { unload(): void }, property: ItemProperty<any>) => {
  item.unload()
  property.unload()
  expect(property.getService().getSnapshot().status).toBe('stopped')
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
    property!.value = new File([embeddedImageBytes()], 'drop.png', { type: 'image/png' }) as never
    await property!.save()

    await vi.waitFor(() => expect(String(property!.value)).toMatch(/^blob:/), { timeout: WAIT_TIMEOUT_MS })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const changes = await countChanges(() => property!.value, 2000)
    expect(changes).toBe(0)
  }, 60000)

  it('stays the same URL when its metadata row changes but names the same file', async () => {
    if (typeof window === 'undefined') return
    const item = (await Item.create({ modelName: 'Clip', schemaName: SCHEMA_NAME, title: 'row' } as never)) as any
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'image' })
    property!.value = new File([embeddedImageBytes()], 'row.png', { type: 'image/png' }) as never
    await property!.save()
    await vi.waitFor(() => expect(String(property!.value)).toMatch(/^blob:/), { timeout: WAIT_TIMEOUT_MS })
    await new Promise((resolve) => setTimeout(resolve, 500))
    const url = property!.value

    const values: unknown[] = []
    const sub = property!.subscribe({ next: (value: unknown) => values.push(value) })
    // The live query re-emits the row; it used to show the storage seed id, then the URL again.
    await BaseDb.getAppDb()
      .update(metadata)
      .set({ schemaUid: '0x' + '1'.repeat(64) })
      .where(and(eq(metadata.seedLocalId, item.seedLocalId), eq(metadata.refSeedType, 'image')))
    await vi.waitFor(() => expect(values.length).toBeGreaterThan(0), { timeout: WAIT_TIMEOUT_MS })
    await new Promise((resolve) => setTimeout(resolve, 500))
    sub.unsubscribe()
    expect(values.filter((value) => value !== url)).toEqual([])
  }, 60000)

  it('mints one URL, not one per render', async () => {
    if (typeof window === 'undefined') return
    const item = (await Item.create({ modelName: 'Clip', schemaName: SCHEMA_NAME, title: 'clip2' } as never)) as any
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'image' })
    property!.value = new File([embeddedImageBytes()], 'drop2.png', { type: 'image/png' }) as never
    await property!.save()
    await vi.waitFor(() => expect(String(property!.value)).toMatch(/^blob:/), { timeout: WAIT_TIMEOUT_MS })
    // The save can still swap the URL once more on a slow runner; count only the remint below.
    await waitUntilSettled(() => property!.value, 1000, WAIT_TIMEOUT_MS)
    // What displayValueFromRow does when the row names a different file (another tab's save).
    ;(property as any)._service.send({ type: 'updateContext', refResolvedDisplayValue: undefined })
    const changes = await countChanges(() => property!.value, 2000)
    expect(changes).toBe(1)
  }, 60000)

  it('revokes the URL it replaced, and the one it holds when unloaded', async () => {
    if (typeof window === 'undefined') return
    const item = (await Item.create({ modelName: 'Clip', schemaName: SCHEMA_NAME, title: 'clip3' } as never)) as any
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'image' })
    property!.value = new File([embeddedImageBytes()], 'first.png', { type: 'image/png' }) as never
    await property!.save()
    await vi.waitFor(() => expect(String(property!.value)).toMatch(/^blob:/), { timeout: WAIT_TIMEOUT_MS })
    const firstUrl = String(property!.value)
    expect((await fetch(firstUrl)).ok).toBe(true)

    property!.value = new File([embeddedImageBytes(5000)], 'second.png', { type: 'image/png' }) as never
    await property!.save()
    await vi.waitFor(() => {
      expect(String(property!.value)).toMatch(/^blob:/)
      expect(property!.value).not.toBe(firstUrl)
    }, { timeout: WAIT_TIMEOUT_MS })
    const secondUrl = String(property!.value)
    expect((await fetch(secondUrl)).ok).toBe(true)
    await expect(fetch(firstUrl)).rejects.toThrow()

    releaseItemAndFind(item, property!)
    await expect(fetch(secondUrl)).rejects.toThrow()
  }, 60000)

  it('leaves a blob URL the app passed in', async () => {
    if (typeof window === 'undefined') return
    const item = (await Item.create({ modelName: 'Clip', schemaName: SCHEMA_NAME, title: 'clip4' } as never)) as any
    const property = await ItemProperty.find({ seedLocalId: item.seedLocalId, propertyName: 'image' })
    const appUrl = URL.createObjectURL(new Blob([embeddedImageBytes()], { type: 'image/png' }))
    property!.value = appUrl as never
    await property!.save()
    await vi.waitFor(() => {
      expect(String(property!.value)).toMatch(/^blob:/)
      expect(property!.value).not.toBe(appUrl)
    }, { timeout: WAIT_TIMEOUT_MS })
    releaseItemAndFind(item, property!)
    expect((await fetch(appUrl)).ok).toBe(true)
    URL.revokeObjectURL(appUrl)
  }, 60000)
})
