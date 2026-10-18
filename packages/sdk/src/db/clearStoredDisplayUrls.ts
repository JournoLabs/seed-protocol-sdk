import { and, eq, inArray, like, or } from 'drizzle-orm'
import debug from 'debug'
import { BaseDb } from '@/db/Db/BaseDb'
import { appState, metadata } from '@/seedSchema'
import { isLeaderTab, whenLeaderTab } from '@/helpers/tabCoordinator'

const logger = debug('seedSdk:db:clearStoredDisplayUrls')

/** appState key recording that the fix below has run on this database. */
export const STORED_DISPLAY_URLS_CLEARED_KEY = 'storedDisplayUrlsCleared'

/**
 * Nulls `ref_resolved_display_value` on File and Image rows that hold a session URL. SDK 0.7.5 and
 * 0.7.6 stored a File's content URL there: a `blob:` URL that is dead after a reload, or a
 * `file://` URL that breaks when filesDir moves. Readers now mint the URL from the file on disk and
 * ignore the column for these types; clearing it keeps older readers and direct DB queries from
 * picking the dead URL up. Returns the number of rows changed.
 */
export async function clearStoredDisplayUrls(): Promise<number> {
  const appDb = BaseDb.getAppDb()
  const where = and(
    inArray(metadata.refSeedType, ['file', 'image']),
    or(like(metadata.refResolvedDisplayValue, 'blob:%'), like(metadata.refResolvedDisplayValue, 'file:%')),
  )
  const rows = (await appDb.select({ localId: metadata.localId }).from(metadata).where(where)) as {
    localId: string | null
  }[]
  if (rows.length === 0) return 0
  await appDb.update(metadata).set({ refResolvedDisplayValue: null }).where(where)
  return rows.length
}

/** Runs the fix unless this database has had it, and records that it has. */
async function runOnce(): Promise<void> {
  const appDb = BaseDb.getAppDb()
  const marker = await appDb
    .select()
    .from(appState)
    .where(eq(appState.key, STORED_DISPLAY_URLS_CLEARED_KEY))
    .limit(1)
  if (marker.length > 0) return

  const rows = await clearStoredDisplayUrls()
  const value = JSON.stringify({ rows, at: Date.now() })
  await appDb
    .insert(appState)
    .values({ key: STORED_DISPLAY_URLS_CLEARED_KEY, value })
    .onConflictDoUpdate({ target: appState.key, set: { value } })
  if (rows > 0) {
    logger(`cleared stored display URLs on ${rows} File/Image rows`)
  }
}

let running: Promise<void> | undefined
let deferredUntilLeader = false

const runInBackground = (): Promise<void> => {
  running ??= runOnce()
    .catch((error) => {
      // Never fails init: readers ignore the column for File and Image anyway.
      logger('clearing stored display URLs failed', error)
    })
    .finally(() => {
      running = undefined
    })
  return running
}

/**
 * Starts {@link clearStoredDisplayUrls} in the background after client init, once per database.
 * Leader tab only (docs/MULTI_TAB.md). Never throws.
 */
export function startClearStoredDisplayUrls(): void {
  if (isLeaderTab()) {
    void runInBackground()
    return
  }
  if (deferredUntilLeader) return
  deferredUntilLeader = true
  void whenLeaderTab().then(() => {
    deferredUntilLeader = false
    void runInBackground()
  })
}

/** Resolves when a background run has finished (at once if none is running). */
export function whenClearStoredDisplayUrlsSettled(): Promise<void> {
  return running ?? Promise.resolve()
}
