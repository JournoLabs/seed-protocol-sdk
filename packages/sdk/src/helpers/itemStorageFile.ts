import { eq } from 'drizzle-orm'
import { BaseDb } from '@/db/Db/BaseDb'
import { metadata, type MetadataType } from '@/seedSchema'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { getItemStorageLocalFileName, getItemStorageSubdir } from '@/helpers/storageDir'
import { withTabLock } from '@/helpers/tabLocks'

export type ItemStorageFileTarget = {
  /** The item's seedUid, else its seedLocalId: the file is `<seedId><extension>`. */
  seedId: string
  /** The property's `storage.path` (e.g. `/html`); `files` when unset. */
  localStorageDir?: string | null
  /** The property's `storage.extension` (e.g. `.html`). */
  filenameSuffix?: string | null
  /** An existing file name to write to instead (the row's refResolvedValue). */
  fileName?: string | null
}

/** Absolute path of the file {@link writeItemStorageFile} writes for `target`. */
export const getItemStorageFilePath = (target: ItemStorageFileTarget): string =>
  BaseFileManager.getFilesPath(
    getItemStorageSubdir(target.localStorageDir),
    target.fileName || getItemStorageLocalFileName(target.seedId, target.filenameSuffix),
  )

/**
 * Write an ItemStorage property's content to its local file, where saveItemStorage, reads, publish
 * (resolveItemStorageChildFile) and download all look for it. Returns what the metadata row records:
 * `refResolvedValue` (the file name) and `localStorageDir` (with a leading slash).
 *
 * Callers that also update the file's metadata row hold {@link withItemStorageFileLock} around
 * both, so another writer of the same file can't land in between.
 */
export const writeItemStorageFile = async (
  target: ItemStorageFileTarget,
  content: string | Blob | ArrayBuffer,
): Promise<{ fileName: string; filePath: string; localStorageDir: string }> => {
  const dir = getItemStorageSubdir(target.localStorageDir)
  const fileName = target.fileName || getItemStorageLocalFileName(target.seedId, target.filenameSuffix)
  await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath(dir))
  const filePath = BaseFileManager.getFilesPath(dir, fileName)
  await BaseFileManager.saveFile(filePath, content)
  return { fileName, filePath, localStorageDir: target.localStorageDir || `/${dir}` }
}

/**
 * Lock name for one ItemStorage file: `seed:item-storage:<absolute file path>`. The path starts
 * with the files root, which also names the database (`<filesDir>/db/seed.db`), so the name is
 * per database as well as per file.
 */
export const itemStorageFileLockName = (filePath: string): string => `seed:item-storage:${filePath}`

/**
 * Runs `fn` holding the lock of one ItemStorage file, across tabs (Web Locks) and within this JS
 * realm (an in-process queue where Web Locks are missing, e.g. Node < 24.5; see `withTabLock`).
 *
 * Writers of a local draft's file (saveItemStorage, convertVerbatimItemStorageRow, createNewItem)
 * hold it across "read the row → write the file → update the row", so the file and the row end
 * with the same writer's content. See docs/MULTI_TAB.md.
 *
 * Lock ordering: this lock is always the innermost. It may be taken while holding a broader lock
 * (`seed:item-storage-migration:<db>`, `seed:publish:<seedLocalId>`), never the other way round,
 * and no other lock (nor a second file lock) is requested while it is held. Keep the section to
 * local DB and file I/O: no network. Not re-entrant.
 */
export function withItemStorageFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  return withTabLock(itemStorageFileLockName(filePath), fn)
}

/** Lock attempts before giving up when the row's target file keeps changing under us. */
const ROW_LOCK_ATTEMPTS = 3

const readRow = async (localId: string): Promise<MetadataType | undefined> => {
  const rows: MetadataType[] = await BaseDb.getAppDb()
    .select()
    .from(metadata)
    .where(eq(metadata.localId, localId))
    .limit(1)
  return rows[0]
}

/**
 * Runs `fn` with a fresh read of metadata row `localId`, holding the lock of the file that row's
 * content goes to. `fileOf` names that file (absolute path) for a row, or returns undefined when
 * there is nothing to write (then `fn` isn't called and the result is undefined).
 *
 * The file depends on the row, so the row is read once to pick the lock and again once it is held;
 * if the row now points at another file (another writer changed it meanwhile), the lock is
 * released and taken again for that file.
 */
export async function withLockedItemStorageRow<T>(
  localId: string,
  fileOf: (row: MetadataType) => string | undefined,
  fn: (row: MetadataType, filePath: string) => Promise<T>,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < ROW_LOCK_ATTEMPTS; attempt++) {
    const row = await readRow(localId)
    const filePath = row && fileOf(row)
    if (!filePath) return undefined

    const outcome = await withItemStorageFileLock(filePath, async () => {
      const fresh = await readRow(localId)
      const freshPath = fresh && fileOf(fresh)
      if (!freshPath) return { done: true as const, value: undefined }
      if (freshPath !== filePath) return { done: false as const }
      return { done: true as const, value: await fn(fresh, filePath) }
    })
    if (outcome.done) return outcome.value
  }
  throw new Error(`ItemStorage file of metadata row ${localId} kept changing; not written`)
}
