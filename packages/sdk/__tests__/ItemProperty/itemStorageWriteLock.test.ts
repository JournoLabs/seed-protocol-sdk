import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createActor, setup } from 'xstate'
import { importJsonSchema } from '@/imports/json'
import { generateId } from '@/helpers'
import { createNewItem } from '@/db/write/createNewItem'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, type MetadataType } from '@/seedSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { convertVerbatimItemStorageRow } from '@/db/write/convertVerbatimItemStorageRow'
import { saveItemStorage } from '@/ItemProperty/service/actors/saveValueToDb/saveItemStorage'
import { itemStorageFileLockName, withItemStorageFileLock } from '@/helpers/itemStorageFile'
import { setupTestEnvironment, teardownTestEnvironment, SETUP_HOOK_TIMEOUT_MS } from '../test-utils/client-init'

/**
 * Writers of one ItemStorage file (saveItemStorage, the legacy-row conversion used by the migration
 * and publish) take turns under `seed:item-storage:<file path>`, so the file and the row always end
 * with the same writer's content. Steps are interleaved deterministically by holding a writer inside
 * BaseFileManager.saveFile. Runs in both the NodeJS and browser projects; each race also runs
 * without Web Locks (the in-process fallback).
 *
 * Later writes are shorter than earlier ones, so a write that left the old tail in place (as
 * @zenfs/dom's WebAccessFS.write did in the browser) would show in the file's content.
 */
const testDescribe = typeof window === 'undefined' ? (describe.sequential || describe) : describe.sequential

const SCHEMA_NAME = 'Test Schema itemStorageWriteLock'
const MODEL = 'LockPost'
const HTML_SCHEMA = { dataType: 'Text', storageType: 'ItemStorage', localStorageDir: '/html', filenameSuffix: '.html' }

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
      },
    },
  },
  enums: {},
  migrations: [],
})

const db = () => BaseDb.getAppDb()

const rowByLocalId = async (localId: string): Promise<MetadataType> => {
  const rows = await db().select().from(metadata).where(eq(metadata.localId, localId))
  expect(rows).toHaveLength(1)
  return rows[0]!
}

/** An item whose html row is a legacy draft: `content` verbatim in property_value, no file. */
const legacyItem = async (content: string) => {
  const { seedLocalId } = await createNewItem({ modelName: MODEL, title: 'lock' } as any)
  const [row] = await db()
    .select()
    .from(metadata)
    .where(and(eq(metadata.seedLocalId, seedLocalId), eq(metadata.propertyName, 'html')))
  await db()
    .update(metadata)
    .set({ propertyValue: content, refResolvedValue: null, localStorageDir: null, refValueType: null })
    .where(eq(metadata.localId, row!.localId!))
  return {
    seedLocalId,
    localId: row!.localId!,
    filePath: BaseFileManager.getFilesPath('html', `${seedLocalId}.html`),
  }
}

/** Runs the saveItemStorage actor for one row, as the property machine does, and resolves when it is done. */
const save = (item: { seedLocalId: string; localId: string }, newValue: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const parent = setup({ actors: { saveItemStorage } }).createMachine({
      invoke: {
        src: 'saveItemStorage',
        input: {
          context: {
            localId: item.localId,
            seedLocalId: item.seedLocalId,
            propertyName: 'html',
            modelName: MODEL,
            propertyRecordSchema: HTML_SCHEMA,
          } as any,
          event: { type: 'saveValueToDb', newValue },
        },
      },
      on: {
        saveItemStorageSuccess: { actions: () => resolve() },
        saveItemStorageError: { actions: ({ event }) => reject((event as any).error) },
      },
    })
    createActor(parent).start()
  })

type Gate = { reached: Promise<void>; release: () => void }

/**
 * Spies on BaseFileManager.saveFile: records each write's content, and holds a write of a gated
 * content until its gate is released (before the write lands).
 */
const instrumentWrites = () => {
  const writes: string[] = []
  const gates = new Map<string, { gate: Gate; arrive: () => void; released: Promise<void> }>()
  const original = BaseFileManager.saveFile.bind(BaseFileManager)
  vi.spyOn(BaseFileManager, 'saveFile').mockImplementation(async (filePath, content) => {
    const text = typeof content === 'string' ? content : ''
    const gated = gates.get(text)
    if (gated) {
      gates.delete(text)
      gated.arrive()
      await gated.released
    }
    writes.push(text)
    return original(filePath, content)
  })
  const gate = (content: string): Gate => {
    let arrive!: () => void
    let release!: () => void
    const reached = new Promise<void>((resolve) => (arrive = resolve))
    const released = new Promise<void>((resolve) => (release = resolve))
    gates.set(content, { gate: { reached, release }, arrive, released })
    return { reached, release }
  }
  return { writes, gate }
}

/** Long enough for a writer that isn't blocked to reach its file write. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

const hasWebLocks = () => typeof navigator !== 'undefined' && !!navigator.locks

const heldLockNames = async (): Promise<string[]> =>
  hasWebLocks() ? ((await navigator.locks.query()).held ?? []).map((lock) => lock.name ?? '') : []

/**
 * - `web locks`: navigator.locks (Chromium; Node >= 24.5).
 * - `no web locks`: navigator.locks hidden, so withTabLock falls back to its in-process queue.
 */
const modes = [
  ...(hasWebLocks() ? (['web locks'] as const) : []),
  // Hiding navigator.locks is only safe in Node: the browser page needs it (SQLocal, tab coordination).
  ...(typeof window === 'undefined' ? (['no web locks'] as const) : []),
]

const useMode = (mode: (typeof modes)[number]) => {
  if (mode === 'no web locks' && hasWebLocks()) {
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent })
    expect(hasWebLocks()).toBe(false)
  }
}

testDescribe('ItemStorage file write lock', () => {
  beforeAll(async () => {
    await setupTestEnvironment({ testFileUrl: import.meta.url, timeout: SETUP_HOOK_TIMEOUT_MS })
    const schema = schemaFile()
    await importJsonSchema({ contents: JSON.stringify(schema) }, schema.version)
  }, SETUP_HOOK_TIMEOUT_MS)

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await teardownTestEnvironment()
  })

  for (const mode of modes) {
    describe(mode, () => {
      it('a save that arrives while a conversion writes the legacy content wins in file and row', async () => {
        const item = await legacyItem('<p>legacy content, longer than the save</p>')
        const { writes, gate } = instrumentWrites()
        useMode(mode)

        // The conversion has read the row and is about to write the legacy content.
        const legacyWrite = gate('<p>legacy content, longer than the save</p>')
        const converting = convertVerbatimItemStorageRow(item.localId, { localStorageDir: '/html', filenameSuffix: '.html' })
        await legacyWrite.reached
        if (mode === 'web locks') {
          expect(await heldLockNames()).toContain(itemStorageFileLockName(item.filePath))
        }

        // A save now waits for the conversion instead of writing first and being overwritten.
        const saving = save(item, '<p>saved</p>')
        await settle()
        expect(writes).toEqual([])

        legacyWrite.release()
        expect(await converting).toMatchObject({ fileName: `${item.seedLocalId}.html`, content: '<p>legacy content, longer than the save</p>' })
        await saving

        expect(writes).toEqual(['<p>legacy content, longer than the save</p>', '<p>saved</p>'])
        expect(await BaseFileManager.readFileAsString(item.filePath)).toBe('<p>saved</p>')
        expect(await rowByLocalId(item.localId)).toMatchObject({
          refResolvedValue: `${item.seedLocalId}.html`,
          localStorageDir: '/html',
          refValueType: 'file',
          propertyValue: null,
        })
      }, 60000)

      it('a conversion that arrives during a save skips the row the save converted', async () => {
        const item = await legacyItem('<p>legacy</p>')
        const { writes, gate } = instrumentWrites()
        useMode(mode)

        const savedWrite = gate('<p>saved text</p>')
        const saving = save(item, '<p>saved text</p>')
        await savedWrite.reached

        // The conversion reads the row (still legacy: the save hasn't updated it) and waits for the lock.
        const converting = convertVerbatimItemStorageRow(item.localId, { localStorageDir: '/html', filenameSuffix: '.html' })
        await settle()
        expect(writes).toEqual([])

        savedWrite.release()
        await saving
        // Re-read under the lock: no longer a legacy row, so nothing is written.
        expect(await converting).toBeUndefined()

        expect(writes).toEqual(['<p>saved text</p>'])
        expect(await BaseFileManager.readFileAsString(item.filePath)).toBe('<p>saved text</p>')
        expect(await rowByLocalId(item.localId)).toMatchObject({
          refResolvedValue: `${item.seedLocalId}.html`,
          refValueType: 'file',
          propertyValue: null,
        })
      }, 60000)

      it('two saves of one file take turns; the later one ends in the file', async () => {
        const item = await legacyItem('<p>legacy</p>')
        const { writes, gate } = instrumentWrites()
        useMode(mode)

        const firstWrite = gate('<p>first save, the longer one</p>')
        const first = save(item, '<p>first save, the longer one</p>')
        await firstWrite.reached

        const second = save(item, '<p>2nd</p>')
        await settle()
        expect(writes).toEqual([])

        firstWrite.release()
        await Promise.all([first, second])

        expect(writes).toEqual(['<p>first save, the longer one</p>', '<p>2nd</p>'])
        expect(await BaseFileManager.readFileAsString(item.filePath)).toBe('<p>2nd</p>')
        expect(await rowByLocalId(item.localId)).toMatchObject({
          refResolvedValue: `${item.seedLocalId}.html`,
          propertyValue: null,
        })
      }, 60000)

      it('locks per file: a held file does not block saves of another file', async () => {
        const held = await legacyItem('<p>held</p>')
        const other = await legacyItem('<p>other legacy</p>')
        useMode(mode)

        let release!: () => void
        const holding = withItemStorageFileLock(held.filePath, () => new Promise<void>((resolve) => (release = resolve)))
        await settle()

        await save(other, '<p>other saved</p>')
        expect(await BaseFileManager.readFileAsString(other.filePath)).toBe('<p>other saved</p>')
        expect(await convertVerbatimItemStorageRow(other.localId)).toBeUndefined()

        // The held file's writers wait until it is released.
        let saved = false
        const saving = save(held, '<p>held saved</p>').then(() => (saved = true))
        await settle()
        expect(saved).toBe(false)
        release()
        await holding
        await saving
        expect(await BaseFileManager.readFileAsString(held.filePath)).toBe('<p>held saved</p>')
      }, 60000)
    })
  }
})
