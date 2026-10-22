import { BaseFileManager } from '@/helpers/FileManager/BaseFileManager'
import { tryWithTabLock, withTabLock } from '@/helpers/tabLocks'
import { OutboxOpDeferredError } from '@/outbox/outbox'

/**
 * Staged files: an assigned storage value's bytes, written by the tab that appended its op (ADR
 * 0019) and read by the drainer, which may run in another tab. The writer holds a lock named for
 * the file while it writes, so the drainer can tell a file still being written from one whose
 * writer is gone (a closed or crashed tab, a failed write).
 */

const stagingLockName = (path: string): string => `seed:staging:${path}`

/** A new path in the staging folder. Throws while the client hasn't set up the file system. */
export const newStagedPath = (id: string): string => BaseFileManager.getFilesPath('staging', id)

/**
 * Writes `content` to `path`, holding the file's staging lock. Call it before appending the op that
 * names the file: the lock is requested before this returns, so a drainer that sees the op also
 * sees the lock taken.
 */
export function writeStagedFile(path: string, content: string | Blob | ArrayBuffer): Promise<void> {
  return withTabLock(stagingLockName(path), async () => {
    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('staging'))
    await BaseFileManager.saveFile(path, content)
  })
}

/** An op's staged file is missing and nothing is writing it: the appending tab closed first, or its write failed. */
export class StagedValueMissingError extends Error {
  constructor(readonly path: string) {
    super(`The staged value ${path} was never written`)
    this.name = 'StagedValueMissingError'
  }
}

/**
 * Makes sure an op's staged file is there before it applies: written from `source` (an assigned
 * string the op carries) when it's missing. Throws OutboxOpDeferredError while the appending tab
 * still writes it, and StagedValueMissingError when it's missing with no source and no writer.
 */
export async function requireStagedFile(path: string, source?: string): Promise<void> {
  if (await BaseFileManager.pathExists(path)) return
  const outcome = await tryWithTabLock(stagingLockName(path), async () => {
    if (await BaseFileManager.pathExists(path)) return true
    if (source === undefined) return false
    await BaseFileManager.createDirIfNotExists(BaseFileManager.getFilesPath('staging'))
    await BaseFileManager.saveFile(path, source)
    return true
  })
  if (!outcome.acquired) throw new OutboxOpDeferredError(`Staged value ${path} is being written`)
  if (!outcome.value) throw new StagedValueMissingError(path)
}

/** Deletes a staged file; best-effort. */
export async function deleteStagedFile(path: string | null | undefined): Promise<void> {
  if (!path) return
  try {
    if (!(await BaseFileManager.pathExists(path))) return
    const fs = await BaseFileManager.getFs()
    if (fs?.promises?.unlink) await fs.promises.unlink(path)
    else fs?.unlinkSync?.(path)
  } catch {
    // A staged file left behind is never read again
  }
}
