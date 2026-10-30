import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { getItemStorageLocalFileName, getItemStorageSubdir } from '@/helpers/storageDir'
import { tryWithTabLock, withTabLock } from '@/helpers/tabLocks'

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
 * Writers of a local draft's file (saveItemStorage, createNewItem)
 * hold it across "read the row → write the file → update the row", so the file and the row end
 * with the same writer's content. See docs/MULTI_TAB.md.
 *
 * Lock ordering: this lock is always the innermost. It may be taken while holding a broader lock
 * (`seed:publish:<seedLocalId>`), never the other way round,
 * and no other lock (nor a second file lock) is requested while it is held. Keep the section to
 * local DB and file I/O: no network. Not re-entrant.
 */
export function withItemStorageFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  return withTabLock(itemStorageFileLockName(filePath), fn)
}

/** {@link withItemStorageFileLock} only if the lock is free now (see `tryWithTabLock`). */
export function tryWithItemStorageFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  return tryWithTabLock(itemStorageFileLockName(filePath), fn)
}
