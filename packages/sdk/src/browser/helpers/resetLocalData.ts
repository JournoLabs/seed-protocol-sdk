import debug from 'debug'
import type { ResetLocalDataResult } from '@/types'
import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { dbOpenLockName, TAB_ID } from '@/helpers/tabCoordinator'

const logger = debug('seedSdk:browser:helpers:resetLocalData')

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

/**
 * The browser half of `client.resetLocalData()`, run once this tab's client has stopped. Asks the
 * other tabs of the database to stop theirs (`close-db` on `seed:tabs:<db>`), waits up to
 * `otherTabsTimeoutMs` for them to let go of `seed:open:<db>`, then deletes `filesDir` from OPFS
 * entry by entry while holding that lock, and unmounts this tab's file system.
 */
export async function resetBrowserLocalData({
  filesDir,
  otherTabsTimeoutMs,
}: {
  filesDir: string
  otherTabsTimeoutMs: number
}): Promise<ResetLocalDataResult> {
  const deleteAll = async () => {
    const result = await deleteOpfsDirectory(filesDir)
    await BaseFileManager.unmountFileSystem()
    return result
  }

  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  // Queued before close-db goes out, so a tab that inits after hearing it waits for the delete.
  const deleted = locks
    ? locks
        .request(dbOpenLockName(filesDir), { mode: 'exclusive', signal: AbortSignal.timeout(otherTabsTimeoutMs) }, deleteAll)
        .catch((error) => {
          if ((error as DOMException | null)?.name !== 'TimeoutError') throw error
          // A tab that didn't close in time keeps its files open: they land in `failed`.
          logger(`other tabs still had ${filesDir} open after ${otherTabsTimeoutMs} ms; deleting anyway`)
          return deleteAll()
        })
    : undefined

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(`seed:tabs:${filesDir}/db/seed.db`)
    channel.postMessage({ type: 'close-db', from: TAB_ID })
    channel.close()
  }

  return deleted ?? deleteAll()
}

/**
 * Removes `filesDir` and everything under it from OPFS, one entry at a time, so an entry that
 * can't be removed (a file another tab holds open) is reported and the rest still go. A directory
 * is removed only once all its entries are gone.
 */
async function deleteOpfsDirectory(filesDir: string): Promise<ResetLocalDataResult> {
  const result: ResetLocalDataResult = { deleted: [], failed: [] }
  const base = filesDir.replace(/\/+$/, '')
  const segments = base.split('/').filter(Boolean)
  const name = segments.pop()
  if (!name) {
    result.failed.push({ path: filesDir, error: 'filesDir names no directory' })
    return result
  }
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
    result.failed.push({ path: base, error: 'OPFS is not available' })
    return result
  }

  let parent: FileSystemDirectoryHandle
  let dir: FileSystemDirectoryHandle
  try {
    parent = await navigator.storage.getDirectory()
    for (const segment of segments) parent = await parent.getDirectoryHandle(segment)
    dir = await parent.getDirectoryHandle(name)
  } catch (error) {
    if ((error as DOMException | null)?.name === 'NotFoundError') return result
    result.failed.push({ path: base, error: describeError(error) })
    return result
  }

  if (await removeEntries(dir, base, result)) {
    try {
      await parent.removeEntry(name, { recursive: true })
      result.deleted.push(base)
    } catch (error) {
      result.failed.push({ path: base, error: describeError(error) })
    }
  }
  return result
}

/** Removes every entry under `dir`; true when all of them went. */
async function removeEntries(dir: FileSystemDirectoryHandle, path: string, result: ResetLocalDataResult): Promise<boolean> {
  const entries: FileSystemHandle[] = []
  try {
    for await (const entry of dir.values()) entries.push(entry)
  } catch (error) {
    result.failed.push({ path, error: describeError(error) })
    return false
  }

  let removedAll = true
  for (const entry of entries) {
    const entryPath = `${path}/${entry.name}`
    if (entry.kind === 'directory' && !(await removeEntries(entry as FileSystemDirectoryHandle, entryPath, result))) {
      removedAll = false
      continue
    }
    try {
      // recursive: an entry written since the listing goes with its directory.
      await dir.removeEntry(entry.name, { recursive: entry.kind === 'directory' })
      result.deleted.push(entryPath)
    } catch (error) {
      if ((error as DOMException | null)?.name === 'NotFoundError') continue
      removedAll = false
      result.failed.push({ path: entryPath, error: describeError(error) })
    }
  }
  return removedAll
}
