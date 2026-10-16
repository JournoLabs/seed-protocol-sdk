import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { Item } from '@/Item/Item'
import { ItemProperty } from '@/ItemProperty/ItemProperty'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { createNewItem } from '@/db/write/createNewItem'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState, metadata, type MetadataType } from '@/seedSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import {
  LEGACY_ITEM_STORAGE_MIGRATION_KEY,
  migrateLegacyItemStorageRows,
  startLegacyItemStorageMigration,
  whenLegacyItemStorageMigrationSettled,
  type LegacyItemStorageMigrationMarker,
} from '@/db/migrateLegacyItemStorageRows'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'
import { waitForPropertyInstances } from '../test-utils/getPublishPayloadIntegrationHelpers'
import { waitForIdle } from '../test-utils/waitForIdle'

/**
 * The one-time migration that writes legacy ItemStorage rows (content verbatim in property_value,
 * no file) to their files. Runs in both the NodeJS and browser projects.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema legacyItemStorageMigration'
const MODEL = 'MigratePost'

const schemaFile = () => ({
  $schema: 'https://seedprotocol.org/schemas/data-model/v1',
  version: 1,
  id: generateId(),
  metadata: { name: SCHEMA_NAME, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  models: {
    [MODEL]: {
      id: generateId(),
      properties: {
        title: { id: generateId(), type: 'Text' },
        html: { id: generateId(), type: 'Text', storage: { type: 'ItemStorage', path: '/html', extension: '.html' } },
        cover: { id: generateId(), type: 'Text', storage: { type: 'ItemStorage', path: '/files', extension: '.bin' } },
      },
    },
  },
  enums: {},
  migrations: [],
})

const db = () => BaseDb.getAppDb()

const rowsOf = async (seedLocalId: string, propertyName: string): Promise<MetadataType[]> =>
  db()
    .select()
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, propertyName)))

const rowByLocalId = async (localId: string): Promise<MetadataType> => {
  const rows = await db().select().from(metadata).where(eq(metadata.localId, localId))
  expect(rows).toHaveLength(1)
  return rows[0]!
}

/** An EAS-uid-shaped value no other test uses. */
const randomUid = () =>
  `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')}`

/**
 * Make a property's row look like one stored before Item.create saved ItemStorage values: the
 * content in property_value, no file reference, no file. `extra` sets other columns (e.g. a uid).
 */
const makeLegacyRow = async (
  seedLocalId: string,
  propertyName: string,
  content: string,
  extra: Partial<MetadataType> = {},
): Promise<MetadataType> => {
  const [row] = await rowsOf(seedLocalId, propertyName)
  await db()
    .update(metadata)
    .set({ propertyValue: content, refResolvedValue: null, localStorageDir: null, refValueType: null, ...extra })
    .where(eq(metadata.localId, row!.localId!))
  return rowByLocalId(row!.localId!)
}

const newItem = async () => (await createNewItem({ modelName: MODEL, title: 'legacy' } as any)).seedLocalId

const readMarker = async (): Promise<LegacyItemStorageMigrationMarker | undefined> => {
  const rows = await db().select().from(appState).where(eq(appState.key, LEGACY_ITEM_STORAGE_MIGRATION_KEY))
  return rows[0]?.value ? JSON.parse(rows[0].value) : undefined
}

const clearMarker = () => db().delete(appState).where(eq(appState.key, LEGACY_ITEM_STORAGE_MIGRATION_KEY))

/** Cold load: a fresh Item and fresh property instances built from the DB, not cached ones. */
const coldLoad = async (seedLocalId: string) => {
  ItemProperty.clearInstanceCacheForItem(seedLocalId)
  const item = await Item.create({ schemaName: SCHEMA_NAME, modelName: MODEL, seedLocalId } as any)
  await waitForIdle(item, 'Item', 15000)
  await waitForPropertyInstances(item)
  return item
}

const expectValue = async (item: Item<any>, propertyName: string, value: string) =>
  vi.waitFor(() => expect(item.allProperties[propertyName]?.value).toBe(value), { timeout: 15000 })

testDescribe('legacy ItemStorage migration', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  it('converts local drafts, leaves published, derived and older rows alone, and retries failed writes', async () => {
    // A: two legacy drafts (html + cover); its html also has an older legacy row from an earlier version.
    const a = await newItem()
    const aHtml = await makeLegacyRow(a, 'html', '<p>legacy A héllo 你好</p>')
    await makeLegacyRow(a, 'cover', 'cover A')
    const olderLocalId = generateId()
    await db().insert(metadata).values({
      ...aHtml,
      localId: olderLocalId,
      propertyValue: '<p>older A</p>',
      versionLocalId: generateId(),
      createdAt: (aHtml.createdAt ?? Date.now()) - 60_000,
      updatedAt: (aHtml.createdAt ?? Date.now()) - 60_000,
    })

    // B: a published row and C: a row sync derived from an attestation, both holding text.
    const b = await newItem()
    const published = await makeLegacyRow(b, 'html', '<p>published B</p>', { uid: randomUid(), seedUid: randomUid() })
    const c = await newItem()
    const derived = await makeLegacyRow(c, 'html', 'tx-id-c', { derivedFromUid: randomUid(), refValueType: 'file' })

    // D: a draft whose file can't be written.
    const d = await newItem()
    const dCover = await makeLegacyRow(d, 'cover', 'cover D')
    const dCoverPath = BaseFileManager.getFilesPath('files', `${d}.bin`)

    // Reads before the migration return the verbatim content.
    const before = await coldLoad(a)
    await expectValue(before, 'html', '<p>legacy A héllo 你好</p>')
    before.unload()

    const saveFile = BaseFileManager.saveFile.bind(BaseFileManager)
    vi.spyOn(BaseFileManager, 'saveFile').mockImplementation(async (filePath, content) => {
      if (filePath === dCoverPath) throw new Error('disk full (test)')
      return saveFile(filePath, content)
    })

    await clearMarker()
    const first = await migrateLegacyItemStorageRows()
    expect(first.alreadyDone).toBe(false)
    expect(first.converted).toBeGreaterThanOrEqual(2)
    expect(first.failed).toBeGreaterThanOrEqual(1)
    expect(first.skipped).toBeGreaterThanOrEqual(1)

    // A's newest rows: the content is in the file, the row has the shape a save gives it.
    const htmlPath = BaseFileManager.getFilesPath('html', `${a}.html`)
    expect(await BaseFileManager.readFileAsString(htmlPath)).toBe('<p>legacy A héllo 你好</p>')
    const aHtmlAfter = await rowByLocalId(aHtml.localId!)
    expect(aHtmlAfter).toMatchObject({
      refResolvedValue: `${a}.html`,
      localStorageDir: '/html',
      refValueType: 'file',
      propertyValue: null,
    })
    expect(await BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('files', `${a}.bin`))).toBe('cover A')
    expect((await rowsOf(a, 'cover'))[0]).toMatchObject({ refResolvedValue: `${a}.bin`, localStorageDir: '/files', propertyValue: null })

    // Untouched: the older row of A's html, the published and derived rows, and D's failed row.
    expect((await rowByLocalId(olderLocalId)).propertyValue).toBe('<p>older A</p>')
    expect((await rowByLocalId(olderLocalId)).refResolvedValue).toBeNull()
    expect(await rowByLocalId(published.localId!)).toEqual(published)
    expect(await rowByLocalId(derived.localId!)).toEqual(derived)
    expect(await rowByLocalId(dCover.localId!)).toEqual(dCover)
    expect(await BaseFileManager.pathExists(dCoverPath)).toBe(false)

    // A run with failures is retried on the next start.
    expect(await readMarker()).toMatchObject({ status: 'retry', attempts: 1 })

    // Second run: nothing converted twice, D still failing.
    const second = await migrateLegacyItemStorageRows()
    expect(second.alreadyDone).toBe(false)
    expect(await rowByLocalId(aHtml.localId!)).toEqual(aHtmlAfter)
    expect(await rowByLocalId(dCover.localId!)).toEqual(dCover)
    expect(await readMarker()).toMatchObject({ status: 'retry', attempts: 2 })

    // The write works again: D is converted and the marker says done.
    vi.restoreAllMocks()
    const third = await migrateLegacyItemStorageRows()
    expect(third.converted).toBeGreaterThanOrEqual(1)
    expect(await BaseFileManager.readFileAsString(dCoverPath)).toBe('cover D')
    expect(await rowByLocalId(dCover.localId!)).toMatchObject({ refResolvedValue: `${d}.bin`, propertyValue: null })
    expect(await readMarker()).toMatchObject({ status: 'done', attempts: 3, failed: 0 })

    // Done: later runs check nothing.
    const fourth = await migrateLegacyItemStorageRows()
    expect(fourth).toMatchObject({ alreadyDone: true, candidates: 0, converted: 0 })
    expect(await rowByLocalId(published.localId!)).toEqual(published)

    // Reads after a cold load return the same content, now from the files.
    const after = await coldLoad(a)
    await expectValue(after, 'html', '<p>legacy A héllo 你好</p>')
    await expectValue(after, 'cover', 'cover A')
    after.unload()
    const afterD = await coldLoad(d)
    await expectValue(afterD, 'cover', 'cover D')
    afterD.unload()
  }, 120000)

  it('gives up retrying after the last attempt and marks the migration done', async () => {
    const e = await newItem()
    const eHtml = await makeLegacyRow(e, 'html', '<p>never written</p>')
    const ePath = BaseFileManager.getFilesPath('html', `${e}.html`)
    const saveFile = BaseFileManager.saveFile.bind(BaseFileManager)
    vi.spyOn(BaseFileManager, 'saveFile').mockImplementation(async (filePath, content) => {
      if (filePath === ePath) throw new Error('disk full (test)')
      return saveFile(filePath, content)
    })

    await clearMarker()
    for (let i = 0; i < 3; i++) await migrateLegacyItemStorageRows()
    expect(await readMarker()).toMatchObject({ status: 'done', attempts: 3 })
    expect(await rowByLocalId(eHtml.localId!)).toEqual(eHtml)
    expect((await migrateLegacyItemStorageRows()).alreadyDone).toBe(true)

    // Still readable verbatim; publish converts it lazily.
    vi.restoreAllMocks()
    const item = await coldLoad(e)
    await expectValue(item, 'html', '<p>never written</p>')
    item.unload()
  }, 120000)

  it('runs in the background from startLegacyItemStorageMigration', async () => {
    const f = await newItem()
    const fHtml = await makeLegacyRow(f, 'html', '<p>background</p>')
    await clearMarker()

    startLegacyItemStorageMigration()
    await whenLegacyItemStorageMigrationSettled()

    expect(await rowByLocalId(fHtml.localId!)).toMatchObject({ refResolvedValue: `${f}.html`, propertyValue: null })
    expect(await BaseFileManager.readFileAsString(BaseFileManager.getFilesPath('html', `${f}.html`))).toBe('<p>background</p>')
    expect((await readMarker())?.status).toBe('done')
  }, 60000)
})
